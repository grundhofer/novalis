//! A small, safe query DSL compiled to parameterized SQL over the existing
//! index tables — the "Bases++" query engine.
//!
//! # The DSL
//!
//! A query is whitespace-separated *terms*. A term is one of:
//!
//! | Term                         | Meaning                                                        |
//! |------------------------------|----------------------------------------------------------------|
//! | `word` / `"a phrase"`        | full-text (FTS5) match on the note body/title/tags             |
//! | `tag:urgent`                 | note carries the tag `urgent` (exact, JSON-array membership)    |
//! | `folder:Projects`            | note is in `Projects` or any subfolder                         |
//! | `title:launch`              | note title contains `launch` (substring)                       |
//! | `path:2026/`                | note path contains `2026/` (substring)                         |
//! | `alias:acme`                | a note alias contains `acme` (substring)                       |
//! | `type:meeting`              | frontmatter property `type` equals `meeting`                   |
//! | `rating>=4`                 | numeric property `rating` ≥ 4 (`<`, `<=`, `>`, `>=`, `=`, `!=`) |
//! | `status!=done`              | property `status` is not `done`                                |
//! | `project:[[Launch]]`        | typed relation `project` points at the note titled `Launch`    |
//! | `has:task`                  | note has at least one task (also `has:link` / `has:backlink`)   |
//! | `has:deadline`              | note has a frontmatter property named `deadline`               |
//! | `task.status:done`          | note has a task with status `done`                             |
//! | `task.priority:high`        | note has a high-priority task (also `project`/`epic`)          |
//! | `task.due<2026-08-01`       | note has a task due before a date (also `start`)               |
//! | `task.done:true`            | note has a completed task                                      |
//! | `sort:modified:desc`        | order by `title`/`path`/`modified`/`created`/`<propkey>`       |
//! | `sort:similarity:"launch"`  | order by semantic similarity to a phrase (executed in the shell)|
//! | `view:kanban`               | request a result view (`table` / `kanban` / `calendar`)        |
//!
//! Any term may be negated with a leading `-` (e.g. `-tag:archived`,
//! `-has:task`, `-"draft"`).
//!
//! # Injection safety
//!
//! Every user-derived *value* — filter values, property keys, relation keys,
//! FTS phrases — is passed as a bound [`rusqlite::types::Value`] and referenced
//! by a `?N` placeholder; it is never interpolated into the SQL text. The only
//! substrings templated into SQL are (a) column names drawn from the fixed
//! [`MetaField`] / [`TaskField`] allowlists (each a `&'static str`) and (b)
//! comparison operators drawn from the fixed [`Comparator`] set. There is no
//! code path by which a hostile value reaches the SQL string, so a value like
//! `x'; DROP TABLE note_meta; --` binds as a harmless literal — proven by
//! [`tests::hostile_values_bind_as_literals`].

use rusqlite::types::Value as SqlValue;
use rusqlite::Connection;

use crate::error::{CoreError, CoreResult};
use crate::index::properties;
use crate::models::{NotePropertyEntry, QueryNoteRow, QueryResult, QueryViewKind, Task};

/// Cap on returned notes — keeps property hydration and the UI bounded.
const RESULT_LIMIT: usize = 500;

// ── AST ──────────────────────────────────────────────────────────────────────

/// Comparison operators. A fixed set — the only operator strings ever templated
/// into SQL (see [`Comparator::sql`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Comparator {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    /// Substring match (`LIKE %value%`), text fields only.
    Like,
}

impl Comparator {
    /// The SQL operator. `Like` has no plain operator (it templates a `LIKE`
    /// clause directly), so it is not produced here.
    fn sql(self) -> &'static str {
        match self {
            Comparator::Eq => "=",
            Comparator::Ne => "<>",
            Comparator::Lt => "<",
            Comparator::Le => "<=",
            Comparator::Gt => ">",
            Comparator::Ge => ">=",
            Comparator::Like => "LIKE",
        }
    }

    fn is_ordering(self) -> bool {
        matches!(
            self,
            Comparator::Lt | Comparator::Le | Comparator::Gt | Comparator::Ge
        )
    }
}

/// An allowlisted `note_meta` column that can be filtered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetaField {
    Path,
    Folder,
    Title,
    Tag,
    Alias,
}

/// An allowlisted `tasks` column that a task facet can filter on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskField {
    Status,
    Priority,
    Project,
    Epic,
    Due,
    Start,
    /// The `completed` boolean.
    Done,
}

impl TaskField {
    fn column(self) -> &'static str {
        match self {
            TaskField::Status => "status",
            TaskField::Priority => "priority",
            TaskField::Project => "project",
            TaskField::Epic => "epic",
            TaskField::Due => "due_date",
            TaskField::Start => "start_date",
            TaskField::Done => "completed",
        }
    }
}

/// An existence facet (`has:...`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Facet {
    /// Note has ≥1 task.
    Task,
    /// Note has ≥1 outgoing `[[wikilink]]`.
    Link,
    /// Note is the target of ≥1 incoming link.
    Backlink,
    /// Note has a frontmatter property with this key.
    Property(String),
}

/// One filter term in the query. Each compiles to a single boolean SQL
/// condition (optionally negated).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Filter {
    Meta {
        field: MetaField,
        op: Comparator,
        value: String,
        negated: bool,
    },
    Property {
        key: String,
        op: Comparator,
        value: String,
        negated: bool,
    },
    Relation {
        key: String,
        target_title: String,
        negated: bool,
    },
    Task {
        field: TaskField,
        op: Comparator,
        value: String,
        negated: bool,
    },
    Facet {
        facet: Facet,
        negated: bool,
    },
    FullText {
        phrase: String,
        negated: bool,
    },
}

/// The sort key for the result set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SortKey {
    Title,
    Path,
    Modified,
    Created,
    Property(String),
    /// Semantic similarity to a phrase. The pure SQL layer can't embed text, so
    /// it falls back to the deterministic default order; the shell command
    /// re-ranks (see `desktop::commands::run_query`). Carried in the AST so the
    /// grammar is complete and the intent survives to the caller.
    Similarity(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sort {
    pub key: SortKey,
    pub desc: bool,
}

/// A fully-parsed query.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Query {
    pub filters: Vec<Filter>,
    pub sort: Option<Sort>,
    pub view: Option<QueryViewKind>,
}

impl Query {
    /// Whether the query touches tasks — the result should then carry the tasks
    /// of the matched notes (and default to the kanban view).
    pub fn touches_tasks(&self) -> bool {
        self.view == Some(QueryViewKind::Kanban)
            || self.filters.iter().any(|f| {
                matches!(f, Filter::Task { .. })
                    || matches!(
                        f,
                        Filter::Facet {
                            facet: Facet::Task,
                            ..
                        }
                    )
            })
    }

    /// The phrase to rank by, if the sort is `similarity:`. Lets the shell wire
    /// semantic ordering without re-parsing.
    pub fn similarity_phrase(&self) -> Option<&str> {
        match &self.sort {
            Some(Sort {
                key: SortKey::Similarity(p),
                ..
            }) => Some(p.as_str()),
            _ => None,
        }
    }
}

// ── parsing ──────────────────────────────────────────────────────────────────

/// Split an input string into terms, honoring `"double quotes"` (stripped) and
/// `[[wikilink]]` spans (kept), both of which suppress whitespace splitting — so
/// `client:[[Acme Corp]]` and `title:"my note"` each stay one term. Pure.
///
/// A bare `"a b"` yields the single term `a b`; an unterminated quote or bracket
/// span consumes to end-of-input.
pub fn tokenize(input: &str) -> Vec<String> {
    let chars: Vec<char> = input.chars().collect();
    let mut terms = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut bracket_depth = 0usize;
    let mut has_content = false;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if ch == '"' {
            in_quotes = !in_quotes;
            has_content = true; // an empty "" is still an (empty) term
            i += 1;
            continue;
        }
        // `[[` / `]]` delimit a wikilink span whose inner whitespace is literal.
        if !in_quotes && ch == '[' && chars.get(i + 1) == Some(&'[') {
            bracket_depth += 1;
            cur.push_str("[[");
            has_content = true;
            i += 2;
            continue;
        }
        if !in_quotes && bracket_depth > 0 && ch == ']' && chars.get(i + 1) == Some(&']') {
            bracket_depth -= 1;
            cur.push_str("]]");
            i += 2;
            continue;
        }
        if ch.is_whitespace() && !in_quotes && bracket_depth == 0 {
            if has_content {
                terms.push(std::mem::take(&mut cur));
                has_content = false;
            }
            i += 1;
            continue;
        }
        cur.push(ch);
        has_content = true;
        i += 1;
    }
    if has_content {
        terms.push(cur);
    }
    terms
}

/// A field name is an identifier: ASCII letters/digits and `.`/`_`/`-`, at least
/// one char. Anything else (e.g. a phrase with a space) is not a `field:value`.
fn is_field_name(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Find the operator in a term: the earliest of the two-char (`>=`,`<=`,`!=`)
/// and single-char (`:`,`=`,`<`,`>`) operators. Returns `(field, comparator,
/// value)`. `None` when the term carries no operator (→ full-text).
fn split_operator(term: &str) -> Option<(&str, Comparator, &str)> {
    // Scan for the first operator position; two-char ops take precedence at the
    // same index so `>=` isn't read as `>` then `=`.
    let bytes = term.as_bytes();
    for i in 0..bytes.len() {
        let two = term.get(i..i + 2);
        let (op, len) = match two {
            Some(">=") => (Comparator::Ge, 2),
            Some("<=") => (Comparator::Le, 2),
            Some("!=") => (Comparator::Ne, 2),
            _ => match bytes[i] {
                b':' => (Comparator::Eq, 1),
                b'=' => (Comparator::Eq, 1),
                b'<' => (Comparator::Lt, 1),
                b'>' => (Comparator::Gt, 1),
                _ => continue,
            },
        };
        let field = &term[..i];
        let value = &term[i + len..];
        return Some((field, op, value));
    }
    None
}

/// Strip `[[wikilink]]` brackets, returning the inner title if the whole value
/// is a bracketed link. Used to detect relation filters.
fn as_wikilink(value: &str) -> Option<&str> {
    let inner = value.strip_prefix("[[")?.strip_suffix("]]")?.trim();
    if inner.is_empty() {
        None
    } else {
        Some(inner)
    }
}

/// Parse a full query string into a [`Query`]. Pure and total: returns a
/// [`CoreError::BadRequest`] describing the first malformed term (fail loud) —
/// never silently drops one.
pub fn parse(input: &str) -> CoreResult<Query> {
    let mut query = Query::default();
    for term in tokenize(input) {
        parse_term(&term, &mut query)?;
    }
    Ok(query)
}

fn bad(msg: impl Into<String>) -> CoreError {
    CoreError::BadRequest(msg.into())
}

fn parse_term(term: &str, query: &mut Query) -> CoreResult<()> {
    // Leading `-` negates (but a lone "-" is just text).
    let (negated, term) = match term.strip_prefix('-') {
        Some(rest) if !rest.is_empty() => (true, rest),
        _ => (false, term),
    };

    let Some((field, op, value)) = split_operator(term) else {
        // No operator → full-text term.
        if term.is_empty() {
            return Ok(());
        }
        query.filters.push(Filter::FullText {
            phrase: term.to_string(),
            negated,
        });
        return Ok(());
    };

    // A term like `50% off` (space suppressed by quotes) or `a:b` where the
    // "field" isn't an identifier is treated as full text, not a filter.
    if !is_field_name(field) {
        query.filters.push(Filter::FullText {
            phrase: term.to_string(),
            negated,
        });
        return Ok(());
    }

    match field {
        "sort" => {
            if negated {
                return Err(bad("`sort:` cannot be negated"));
            }
            query.sort = Some(parse_sort(op, value)?);
            Ok(())
        }
        "view" => {
            if negated {
                return Err(bad("`view:` cannot be negated"));
            }
            query.view = Some(parse_view(value)?);
            Ok(())
        }
        "has" => {
            let facet = parse_facet(value)?;
            query.filters.push(Filter::Facet { facet, negated });
            Ok(())
        }
        "path" | "folder" | "title" | "tag" | "alias" => {
            query.filters.push(parse_meta(field, op, value, negated)?);
            Ok(())
        }
        _ if field.starts_with("task.") => {
            query.filters.push(parse_task(field, op, value, negated)?);
            Ok(())
        }
        // Any other identifier is a frontmatter property (or a relation, when
        // the value is a `[[wikilink]]`).
        _ => {
            if let Some(title) = as_wikilink(value) {
                if op != Comparator::Eq {
                    return Err(bad(format!(
                        "relation filter `{field}` only supports `:` / `=`"
                    )));
                }
                query.filters.push(Filter::Relation {
                    key: field.to_string(),
                    target_title: title.to_string(),
                    negated,
                });
            } else {
                if value.is_empty() {
                    return Err(bad(format!("`{field}` needs a value")));
                }
                // An ordering comparator on a property is numeric — validate the
                // value up front so a bad number fails loud at parse time.
                if op.is_ordering() && value.parse::<f64>().is_err() {
                    return Err(bad(format!("`{field}{}{value}` needs a number", op.sql())));
                }
                query.filters.push(Filter::Property {
                    key: field.to_string(),
                    op,
                    value: value.to_string(),
                    negated,
                });
            }
            Ok(())
        }
    }
}

fn parse_meta(field: &str, op: Comparator, value: &str, negated: bool) -> CoreResult<Filter> {
    let mf = match field {
        "path" => MetaField::Path,
        "folder" => MetaField::Folder,
        "title" => MetaField::Title,
        "tag" => MetaField::Tag,
        "alias" => MetaField::Alias,
        _ => unreachable!("caller matched the field set"),
    };
    // Metadata is textual: ordering comparators are meaningless here.
    if op.is_ordering() {
        return Err(bad(format!(
            "`{field}` is a text field; `<`/`>` comparators aren't supported"
        )));
    }
    // `:`/`=` on path/title/alias mean substring; on folder/tag mean exact
    // (folder = subtree, tag = membership). `!=` is exact-negation everywhere.
    let op = match (mf, op) {
        (MetaField::Path | MetaField::Title | MetaField::Alias, Comparator::Eq) => Comparator::Like,
        (_, other) => other,
    };
    if value.is_empty() {
        return Err(bad(format!("`{field}:` needs a value")));
    }
    Ok(Filter::Meta {
        field: mf,
        op,
        value: value.to_string(),
        negated,
    })
}

fn parse_task(field: &str, op: Comparator, value: &str, negated: bool) -> CoreResult<Filter> {
    let sub = &field["task.".len()..];
    let tf = match sub {
        "status" => TaskField::Status,
        "priority" => TaskField::Priority,
        "project" => TaskField::Project,
        "epic" => TaskField::Epic,
        "due" => TaskField::Due,
        "start" => TaskField::Start,
        "done" => TaskField::Done,
        other => return Err(bad(format!("unknown task facet `task.{other}`"))),
    };
    if value.is_empty() {
        return Err(bad(format!("`{field}` needs a value")));
    }
    // `done` is boolean; ordering only makes sense on the date columns.
    if tf == TaskField::Done && op.is_ordering() {
        return Err(bad("`task.done` takes `true`/`false`, not `<`/`>`"));
    }
    if op.is_ordering() && !matches!(tf, TaskField::Due | TaskField::Start) {
        return Err(bad(format!(
            "`task.{sub}` is a text field; `<`/`>` comparators aren't supported"
        )));
    }
    if tf == TaskField::Done && !matches!(value, "true" | "false") {
        return Err(bad("`task.done` takes `true` or `false`"));
    }
    Ok(Filter::Task {
        field: tf,
        op,
        value: value.to_string(),
        negated,
    })
}

fn parse_facet(value: &str) -> CoreResult<Facet> {
    match value {
        "task" | "tasks" => Ok(Facet::Task),
        "link" | "links" => Ok(Facet::Link),
        "backlink" | "backlinks" => Ok(Facet::Backlink),
        "" => Err(bad(
            "`has:` needs a facet (task/link/backlink) or a property key",
        )),
        // `has:deadline` → the note has a property named `deadline`.
        key if is_field_name(key) => Ok(Facet::Property(key.to_string())),
        other => Err(bad(format!("unknown facet `has:{other}`"))),
    }
}

fn parse_sort(op: Comparator, value: &str) -> CoreResult<Sort> {
    if op != Comparator::Eq {
        return Err(bad("`sort` uses `sort:field` or `sort:field:desc`"));
    }
    // `similarity:phrase` — a phrase may itself contain colons, so split once.
    if let Some(phrase) = value.strip_prefix("similarity:") {
        if phrase.is_empty() {
            return Err(bad("`sort:similarity:` needs a phrase"));
        }
        return Ok(Sort {
            key: SortKey::Similarity(phrase.to_string()),
            desc: true, // most-similar first
        });
    }
    // `field` or `field:desc` / `field:asc`.
    let (key_str, desc) = match value.rsplit_once(':') {
        Some((k, "desc")) => (k, true),
        Some((k, "asc")) => (k, false),
        Some(_) => return Err(bad("sort direction must be `asc` or `desc`")),
        None => (value, false),
    };
    let key = match key_str {
        "title" => SortKey::Title,
        "path" => SortKey::Path,
        "modified" => SortKey::Modified,
        "created" => SortKey::Created,
        "" => return Err(bad("`sort:` needs a field")),
        k if is_field_name(k) => SortKey::Property(k.to_string()),
        k => return Err(bad(format!("invalid sort field `{k}`"))),
    };
    Ok(Sort { key, desc })
}

fn parse_view(value: &str) -> CoreResult<QueryViewKind> {
    match value {
        "table" => Ok(QueryViewKind::Table),
        "kanban" | "board" => Ok(QueryViewKind::Kanban),
        "calendar" => Ok(QueryViewKind::Calendar),
        other => Err(bad(format!(
            "unknown view `{other}` (table/kanban/calendar)"
        ))),
    }
}

// ── SQL compilation ──────────────────────────────────────────────────────────

/// Escape SQL `LIKE` wildcards so a user value matches literally under
/// `ESCAPE '\'`. Same contract as [`crate::index::search::escape_like`].
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Quote a phrase as a single FTS5 string literal (doubling embedded quotes), so
/// an apostrophe or operator in the phrase can't break the MATCH grammar.
fn fts_phrase(phrase: &str) -> String {
    format!("\"{}\"", phrase.replace('"', "\"\""))
}

/// A running SQL builder: accumulates `WHERE` conditions and their bound values
/// in lockstep, so a placeholder index always matches its value's position.
struct Builder {
    conditions: Vec<String>,
    binds: Vec<SqlValue>,
}

impl Builder {
    fn new() -> Self {
        Self {
            conditions: Vec::new(),
            binds: Vec::new(),
        }
    }

    /// Push a bound value and return its `?N` placeholder (1-based).
    fn bind(&mut self, v: SqlValue) -> String {
        self.binds.push(v);
        format!("?{}", self.binds.len())
    }

    fn bind_text(&mut self, s: &str) -> String {
        self.bind(SqlValue::Text(s.to_string()))
    }
}

/// Compile a parsed [`Query`] into `(sql, binds)`. Pure — no DB access, so it is
/// exhaustively unit-testable. Every user value goes into `binds`; only
/// allowlisted column names and fixed operators are templated into `sql`.
pub fn compile(query: &Query) -> CoreResult<(String, Vec<SqlValue>)> {
    let mut b = Builder::new();
    for filter in &query.filters {
        let cond = compile_filter(filter, &mut b)?;
        b.conditions.push(cond);
    }

    let mut sql = String::from(
        "SELECT m.path, m.title, m.folder, m.modified, m.created, m.tags FROM note_meta m",
    );
    if !b.conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&b.conditions.join(" AND "));
    }
    sql.push_str(&order_by(query.sort.as_ref()));
    sql.push_str(&format!(" LIMIT {RESULT_LIMIT}"));
    Ok((sql, b.binds))
}

/// The `ORDER BY` clause. Property sorts left-join the value (numeric-aware);
/// similarity falls back to the default (the shell re-ranks). Column names are
/// literals; the only bound value is a property key.
fn order_by(sort: Option<&Sort>) -> String {
    let default = " ORDER BY m.title COLLATE NOCASE ASC, m.path ASC";
    let Some(sort) = sort else {
        return default.to_string();
    };
    let dir = if sort.desc { "DESC" } else { "ASC" };
    match &sort.key {
        SortKey::Title => format!(" ORDER BY m.title COLLATE NOCASE {dir}, m.path ASC"),
        SortKey::Path => format!(" ORDER BY m.path {dir}"),
        SortKey::Modified => format!(" ORDER BY m.modified {dir}, m.path ASC"),
        SortKey::Created => format!(" ORDER BY m.created {dir}, m.path ASC"),
        // A correlated subquery reads the property's value; missing values sort
        // last. Numeric-aware so `sort:rating:desc` orders 10 above 9.
        SortKey::Property(_) => format!(
            " ORDER BY (SELECT CASE WHEN p.kind = 'number' THEN printf('%020.6f', CAST(p.value AS REAL)) ELSE p.value END \
               FROM note_properties p WHERE p.path = m.path AND p.key = ? LIMIT 1) {dir} NULLS LAST, m.path ASC"
        ),
        SortKey::Similarity(_) => default.to_string(),
    }
}

/// Whether the compiled ORDER BY references a bound property key (so the caller
/// appends that bind last, after the WHERE binds). Kept in sync with
/// [`order_by`].
fn sort_bind(sort: Option<&Sort>) -> Option<SqlValue> {
    match sort.map(|s| &s.key) {
        Some(SortKey::Property(k)) => Some(SqlValue::Text(k.clone())),
        _ => None,
    }
}

fn compile_filter(filter: &Filter, b: &mut Builder) -> CoreResult<String> {
    let cond = match filter {
        Filter::Meta {
            field,
            op,
            value,
            negated,
        } => meta_condition(*field, *op, value, b, *negated),
        Filter::Property {
            key,
            op,
            value,
            negated,
        } => property_condition(key, *op, value, b, *negated)?,
        Filter::Relation {
            key,
            target_title,
            negated,
        } => relation_condition(key, target_title, b, *negated),
        Filter::Task {
            field,
            op,
            value,
            negated,
        } => task_condition(*field, *op, value, b, *negated)?,
        Filter::Facet { facet, negated } => facet_condition(facet, b, *negated),
        Filter::FullText { phrase, negated } => fulltext_condition(phrase, b, *negated),
    };
    Ok(cond)
}

fn meta_condition(
    field: MetaField,
    op: Comparator,
    value: &str,
    b: &mut Builder,
    negated: bool,
) -> String {
    let not = if negated { "NOT " } else { "" };
    match field {
        MetaField::Folder => {
            // Subtree match: the folder itself or anything nested under it.
            let exact = b.bind_text(value);
            let prefix = b.bind(SqlValue::Text(format!("{}/%", escape_like(value))));
            let inner = format!("(m.folder = {exact} OR m.folder LIKE {prefix} ESCAPE '\\')");
            if negated {
                format!("NOT {inner}")
            } else {
                inner
            }
        }
        MetaField::Tag => {
            // Exact JSON-array membership: `work` must not match `workout`.
            let p = b.bind(SqlValue::Text(format!("%\"{}\"%", escape_like(value))));
            format!("m.tags {not}LIKE {p} ESCAPE '\\'")
        }
        _ => {
            let col = match field {
                MetaField::Path => "m.path",
                MetaField::Title => "m.title",
                MetaField::Alias => "m.aliases",
                _ => unreachable!(),
            };
            match op {
                Comparator::Like => {
                    let p = b.bind(SqlValue::Text(format!("%{}%", escape_like(value))));
                    format!("{col} {not}LIKE {p} ESCAPE '\\'")
                }
                Comparator::Ne => {
                    let p = b.bind_text(value);
                    // Ne already negates; an outer `-` would double-negate.
                    let cmp = if negated { "=" } else { "<>" };
                    format!("{col} {cmp} {p}")
                }
                _ => {
                    let p = b.bind_text(value);
                    format!("{col} {not}= {p}")
                }
            }
        }
    }
}

fn property_condition(
    key: &str,
    op: Comparator,
    value: &str,
    b: &mut Builder,
    negated: bool,
) -> CoreResult<String> {
    let exists = if negated { "NOT EXISTS" } else { "EXISTS" };
    let key_p = b.bind_text(key);
    let value_cond = match op {
        Comparator::Like => {
            let p = b.bind(SqlValue::Text(format!("%{}%", escape_like(value))));
            format!("p.value LIKE {p} ESCAPE '\\'")
        }
        Comparator::Eq => {
            // Match a scalar value exactly, or membership in a list-kind value
            // (stored as a JSON array of strings — see `properties::encode_value`).
            let scalar = b.bind_text(value);
            let member = b.bind(SqlValue::Text(format!("%\"{}\"%", escape_like(value))));
            format!(
                "((p.kind <> 'list' AND p.value = {scalar}) \
                  OR (p.kind = 'list' AND p.value LIKE {member} ESCAPE '\\'))"
            )
        }
        Comparator::Ne => {
            let scalar = b.bind_text(value);
            format!("p.value <> {scalar}")
        }
        // Ordering comparators are numeric — require a number-kind row.
        Comparator::Lt | Comparator::Le | Comparator::Gt | Comparator::Ge => {
            let n: f64 = value
                .parse()
                .map_err(|_| bad(format!("`{key}{}{value}` needs a number", op.sql())))?;
            let p = b.bind(SqlValue::Real(n));
            format!(
                "p.kind = 'number' AND CAST(p.value AS REAL) {} {p}",
                op.sql()
            )
        }
    };
    Ok(format!(
        "{exists} (SELECT 1 FROM note_properties p WHERE p.path = m.path AND p.key = {key_p} AND {value_cond})"
    ))
}

fn relation_condition(key: &str, target_title: &str, b: &mut Builder, negated: bool) -> String {
    let exists = if negated { "NOT EXISTS" } else { "EXISTS" };
    let key_p = b.bind_text(key);
    let title_p = b.bind_text(target_title);
    format!(
        "{exists} (SELECT 1 FROM note_relations r JOIN note_meta t ON t.path = r.target_path \
          WHERE r.source_path = m.path AND r.key = {key_p} AND lower(t.title) = lower({title_p}))"
    )
}

fn task_condition(
    field: TaskField,
    op: Comparator,
    value: &str,
    b: &mut Builder,
    negated: bool,
) -> CoreResult<String> {
    let exists = if negated { "NOT EXISTS" } else { "EXISTS" };
    let col = field.column();
    let value_cond = if field == TaskField::Done {
        // Boolean column stored as 0/1.
        let want = if value == "true" { 1 } else { 0 };
        let p = b.bind(SqlValue::Integer(want));
        format!("tk.completed = {p}")
    } else {
        let p = b.bind_text(value);
        // Date columns (`due_date`/`start_date`) sort lexically = chronologically,
        // so ordering comparators work as plain string comparisons.
        format!("tk.{col} {} {p}", op.sql())
    };
    Ok(format!(
        "{exists} (SELECT 1 FROM tasks tk WHERE tk.source_note = m.path AND {value_cond})"
    ))
}

fn facet_condition(facet: &Facet, b: &mut Builder, negated: bool) -> String {
    let exists = if negated { "NOT EXISTS" } else { "EXISTS" };
    match facet {
        Facet::Task => {
            format!("{exists} (SELECT 1 FROM tasks tk WHERE tk.source_note = m.path)")
        }
        Facet::Link => {
            format!("{exists} (SELECT 1 FROM links l WHERE l.source_path = m.path)")
        }
        Facet::Backlink => {
            // A note is a backlink target when another note links its title.
            format!("{exists} (SELECT 1 FROM links l WHERE lower(l.target_title) = lower(m.title))")
        }
        Facet::Property(key) => {
            let key_p = b.bind_text(key);
            format!(
                "{exists} (SELECT 1 FROM note_properties p WHERE p.path = m.path AND p.key = {key_p})"
            )
        }
    }
}

fn fulltext_condition(phrase: &str, b: &mut Builder, negated: bool) -> String {
    let not = if negated { "NOT " } else { "" };
    let p = b.bind_text(&fts_phrase(phrase));
    format!("m.path {not}IN (SELECT f.path FROM notes_fts f WHERE notes_fts MATCH {p})")
}

// ── execution ────────────────────────────────────────────────────────────────

/// Parse and run a query string against the index, returning matched notes (and
/// their tasks, when the query touches tasks). Read-only. A similarity sort is
/// executed as the default order here — the shell layer re-ranks.
pub fn run_query(db: &Connection, input: &str) -> CoreResult<QueryResult> {
    let query = parse(input)?;
    run(db, &query)
}

/// Run an already-parsed query. Split out so callers that need the AST (e.g. to
/// detect a similarity sort) don't re-parse.
pub fn run(db: &Connection, query: &Query) -> CoreResult<QueryResult> {
    let (sql, mut binds) = compile(query)?;
    if let Some(v) = sort_bind(query.sort.as_ref()) {
        binds.push(v);
    }

    let mut stmt = db.prepare(&sql)?;
    let rows: Vec<(String, String, String, String, String, String)> = stmt
        .query_map(rusqlite::params_from_iter(binds), |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })?
        .filter_map(|r| super::ok_row_or_warn("note_meta", r))
        .collect();

    // Hydrate typed properties for each matched note (index-only, no disk).
    let mut property_keys: Vec<String> = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();
    let mut notes = Vec::with_capacity(rows.len());
    let mut has_dates = false;
    for (path, title, folder, modified, created, tags_json) in rows {
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        let properties = properties::properties_for(db, &path)?;
        for entry in &properties {
            if seen_keys.insert(entry.key.clone()) {
                property_keys.push(entry.key.clone());
            }
        }
        let date = pick_date(&properties, &created);
        if date.is_some() {
            has_dates = true;
        }
        notes.push(QueryNoteRow {
            path,
            title,
            folder,
            modified,
            created,
            tags,
            properties,
            date,
        });
    }

    let tasks = if query.touches_tasks() {
        tasks_for_notes(db, &notes)?
    } else {
        Vec::new()
    };

    let view = query.view.unwrap_or_else(|| {
        if query.touches_tasks() {
            QueryViewKind::Kanban
        } else {
            QueryViewKind::Table
        }
    });

    Ok(QueryResult {
        notes,
        tasks,
        view,
        property_keys,
        has_dates,
    })
}

/// The date to place a note on the calendar: the first of the `date`/`due`/
/// `start` frontmatter properties that looks like an ISO date. `None` when the
/// note carries no dated property. Pure.
fn pick_date(properties: &[NotePropertyEntry], _created: &str) -> Option<String> {
    for key in ["date", "due", "start", "when"] {
        if let Some(entry) = properties.iter().find(|p| p.key == key) {
            if let crate::models::PropertyValue::Text(s) = &entry.value {
                let t = s.trim();
                // Accept a leading YYYY-MM-DD (optionally with a time suffix).
                if t.len() >= 10 && chrono::NaiveDate::parse_from_str(&t[..10], "%Y-%m-%d").is_ok()
                {
                    return Some(t.to_string());
                }
            }
        }
    }
    None
}

/// The tasks belonging to the matched notes, in the same shape as
/// [`crate::tasks::index::query_tasks`]. One `IN (…)` query; the column list and
/// row mapping mirror the `tasks` table layout owned by `schema.rs`.
fn tasks_for_notes(db: &Connection, notes: &[QueryNoteRow]) -> CoreResult<Vec<Task>> {
    if notes.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = (1..=notes.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT id, text, completed, priority, due_date, status, source_note, source_line, tags, \
                repeat, parent_id, note_title, heading, project, epic, start_date, remind \
         FROM tasks WHERE source_note IN ({placeholders}) \
         ORDER BY due_date ASC NULLS LAST, source_note, source_line"
    );
    let binds: Vec<SqlValue> = notes
        .iter()
        .map(|n| SqlValue::Text(n.path.clone()))
        .collect();
    let mut stmt = db.prepare(&sql)?;
    let tasks = stmt
        .query_map(rusqlite::params_from_iter(binds), |row| {
            let tags_str: String = row.get(8)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(Task {
                id: row.get(0)?,
                text: row.get(1)?,
                completed: row.get::<_, i32>(2)? != 0,
                priority: row.get(3)?,
                due_date: row.get(4)?,
                status: row.get(5)?,
                source_note: row.get(6)?,
                source_line: row.get::<_, i64>(7)? as usize,
                tags,
                repeat: row.get(9)?,
                parent_id: row.get(10)?,
                note_title: row.get(11)?,
                heading: row.get(12)?,
                project: row.get(13)?,
                epic: row.get(14)?,
                start_date: row.get(15)?,
                remind: row.get(16)?,
            })
        })?
        .filter_map(|r| super::ok_row_or_warn("tasks", r))
        .collect();
    Ok(tasks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::{schema, search};
    use crate::models::{NotePropertyEntry, NoteSummary, PropertyValue};

    // ── pure parser tests ────────────────────────────────────────────────────

    #[test]
    fn tokenize_respects_quotes() {
        assert_eq!(tokenize("a b c"), vec!["a", "b", "c"]);
        assert_eq!(
            tokenize(r#"title:"my note" tag:x"#),
            vec!["title:my note", "tag:x"]
        );
        assert_eq!(tokenize(r#""quick brown""#), vec!["quick brown"]);
        assert_eq!(tokenize("   spaced   out  "), vec!["spaced", "out"]);
        // Unterminated quote runs to end.
        assert_eq!(tokenize(r#"a "b c"#), vec!["a", "b c"]);
        assert!(tokenize("   ").is_empty());
    }

    #[test]
    fn split_operator_finds_first_and_two_char() {
        assert_eq!(
            split_operator("type:meeting"),
            Some(("type", Comparator::Eq, "meeting"))
        );
        assert_eq!(
            split_operator("rating>=4"),
            Some(("rating", Comparator::Ge, "4"))
        );
        assert_eq!(split_operator("x<=2"), Some(("x", Comparator::Le, "2")));
        assert_eq!(
            split_operator("s!=done"),
            Some(("s", Comparator::Ne, "done"))
        );
        assert_eq!(split_operator("n<5"), Some(("n", Comparator::Lt, "5")));
        assert_eq!(split_operator("plainword"), None);
        // Relation value keeps its inner colon-free brackets.
        assert_eq!(
            split_operator("project:[[Launch]]"),
            Some(("project", Comparator::Eq, "[[Launch]]"))
        );
    }

    #[test]
    fn parse_builds_expected_filters() {
        let q = parse("type:meeting project:launch tag:urgent has:task").unwrap();
        assert_eq!(
            q.filters,
            vec![
                Filter::Property {
                    key: "type".into(),
                    op: Comparator::Eq,
                    value: "meeting".into(),
                    negated: false
                },
                Filter::Property {
                    key: "project".into(),
                    op: Comparator::Eq,
                    value: "launch".into(),
                    negated: false
                },
                Filter::Meta {
                    field: MetaField::Tag,
                    op: Comparator::Eq,
                    value: "urgent".into(),
                    negated: false
                },
                Filter::Facet {
                    facet: Facet::Task,
                    negated: false
                },
            ]
        );
    }

    #[test]
    fn parse_negation_and_fulltext() {
        let q = parse(r#"-tag:archived "release notes" fox"#).unwrap();
        assert_eq!(
            q.filters,
            vec![
                Filter::Meta {
                    field: MetaField::Tag,
                    op: Comparator::Eq,
                    value: "archived".into(),
                    negated: true
                },
                Filter::FullText {
                    phrase: "release notes".into(),
                    negated: false
                },
                Filter::FullText {
                    phrase: "fox".into(),
                    negated: false
                },
            ]
        );
    }

    #[test]
    fn parse_relation_from_wikilink_value() {
        let q = parse("client:[[Acme Corp]]").unwrap();
        assert_eq!(
            q.filters,
            vec![Filter::Relation {
                key: "client".into(),
                target_title: "Acme Corp".into(),
                negated: false
            }]
        );
    }

    #[test]
    fn parse_task_facets() {
        let q = parse("task.status:done task.priority:high task.due<2026-08-01 task.done:true")
            .unwrap();
        assert_eq!(
            q.filters,
            vec![
                Filter::Task {
                    field: TaskField::Status,
                    op: Comparator::Eq,
                    value: "done".into(),
                    negated: false
                },
                Filter::Task {
                    field: TaskField::Priority,
                    op: Comparator::Eq,
                    value: "high".into(),
                    negated: false
                },
                Filter::Task {
                    field: TaskField::Due,
                    op: Comparator::Lt,
                    value: "2026-08-01".into(),
                    negated: false
                },
                Filter::Task {
                    field: TaskField::Done,
                    op: Comparator::Eq,
                    value: "true".into(),
                    negated: false
                },
            ]
        );
    }

    #[test]
    fn parse_sort_and_view() {
        let q = parse("sort:modified:desc view:kanban").unwrap();
        assert_eq!(
            q.sort,
            Some(Sort {
                key: SortKey::Modified,
                desc: true
            })
        );
        assert_eq!(q.view, Some(QueryViewKind::Kanban));

        let q = parse("sort:rating").unwrap();
        assert_eq!(
            q.sort,
            Some(Sort {
                key: SortKey::Property("rating".into()),
                desc: false
            })
        );

        let q = parse(r#"sort:similarity:"launch planning""#).unwrap();
        assert_eq!(q.similarity_phrase(), Some("launch planning"));
    }

    #[test]
    fn parse_rejects_malformed_terms_loudly() {
        assert!(parse("title>x").is_err()); // ordering on a text field
        assert!(parse("rating>=notanumber").is_err()); // non-numeric comparison
        assert!(parse("task.bogus:1").is_err()); // unknown task facet
        assert!(parse("has:mystery ").is_ok()); // has:<key> is a property-exists facet
        assert!(parse("has:").is_err()); // empty facet
        assert!(parse("sort:title:sideways").is_err()); // bad direction
        assert!(parse("view:mystery").is_err()); // unknown view
        assert!(parse("task.done:maybe").is_err()); // non-boolean done
    }

    #[test]
    fn empty_query_parses_to_nothing() {
        let q = parse("   ").unwrap();
        assert!(q.filters.is_empty() && q.sort.is_none() && q.view.is_none());
    }

    #[test]
    fn touches_tasks_detects_task_terms() {
        assert!(parse("has:task").unwrap().touches_tasks());
        assert!(parse("task.priority:high").unwrap().touches_tasks());
        assert!(parse("view:kanban").unwrap().touches_tasks());
        assert!(!parse("type:note").unwrap().touches_tasks());
    }

    // ── SQL compilation tests ────────────────────────────────────────────────

    #[test]
    fn compile_parameterizes_all_values() {
        let q = parse("type:meeting tag:urgent").unwrap();
        let (sql, binds) = compile(&q).unwrap();
        // No user value appears literally in the SQL text.
        assert!(!sql.contains("meeting"), "sql leaked a value: {sql}");
        assert!(!sql.contains("urgent"), "sql leaked a value: {sql}");
        assert!(sql.contains("note_properties"));
        assert!(sql.contains("m.tags"));
        // Values are all bound.
        assert!(binds
            .iter()
            .any(|v| matches!(v, SqlValue::Text(t) if t == "meeting")));
        assert!(binds
            .iter()
            .any(|v| matches!(v, SqlValue::Text(t) if t == "type")));
    }

    #[test]
    fn compile_never_leaks_field_key_or_value_into_sql_text() {
        // A hostile value on a valid property key is bound, never templated.
        let q = parse(r#"type:x';DROP"#).unwrap();
        let (sql, binds) = compile(&q).unwrap();
        assert!(
            !sql.contains("DROP"),
            "hostile value leaked into sql: {sql}"
        );
        assert!(binds
            .iter()
            .any(|v| matches!(v, SqlValue::Text(t) if t == "x';DROP")));
        assert!(binds
            .iter()
            .any(|v| matches!(v, SqlValue::Text(t) if t == "type")));
    }

    // ── integration tests against a real index ───────────────────────────────

    fn mem_db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = schema::open_db(&dir.path().join("notes.db")).unwrap();
        (dir, db)
    }

    fn summary(path: &str, title: &str) -> NoteSummary {
        NoteSummary {
            path: path.to_string(),
            title: title.to_string(),
            folder: std::path::Path::new(path)
                .parent()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default(),
            tags: vec![],
            aliases: vec![],
            created: "2026-01-01".to_string(),
            modified: "2026-01-01".to_string(),
            pinned: false,
            word_count: 0,
            task_total: 0,
            task_completed: 0,
            cloud_only: false,
        }
    }

    fn index(
        db: &Connection,
        path: &str,
        title: &str,
        body: &str,
        props: &[(&str, PropertyValue)],
    ) {
        let mut s = summary(path, title);
        // Reflect any `tags` property into note_meta so tag: filters have data.
        if let Some((_, PropertyValue::List(items))) = props.iter().find(|(k, _)| *k == "tags") {
            s.tags = items.clone();
        }
        search::index_note(db, &s, body).unwrap();
        let entries: Vec<NotePropertyEntry> = props
            .iter()
            .map(|(k, v)| NotePropertyEntry {
                key: (*k).to_string(),
                value: v.clone(),
            })
            .collect();
        properties::index_properties(db, path, &entries).unwrap();
    }

    fn paths(r: &QueryResult) -> Vec<String> {
        r.notes.iter().map(|n| n.path.clone()).collect()
    }

    #[test]
    fn property_and_tag_filters_intersect() {
        let (_t, db) = mem_db();
        index(
            &db,
            "a.md",
            "A",
            "body",
            &[
                ("type", PropertyValue::Text("meeting".into())),
                ("tags", PropertyValue::List(vec!["urgent".into()])),
            ],
        );
        index(
            &db,
            "b.md",
            "B",
            "body",
            &[("type", PropertyValue::Text("meeting".into()))],
        );
        index(
            &db,
            "c.md",
            "C",
            "body",
            &[("type", PropertyValue::Text("note".into()))],
        );

        assert_eq!(
            paths(&run_query(&db, "type:meeting").unwrap()),
            vec!["a.md", "b.md"]
        );
        assert_eq!(
            paths(&run_query(&db, "type:meeting tag:urgent").unwrap()),
            vec!["a.md"]
        );
        assert_eq!(
            paths(&run_query(&db, "-type:meeting").unwrap()),
            vec!["c.md"]
        );
    }

    #[test]
    fn numeric_property_comparison() {
        let (_t, db) = mem_db();
        index(
            &db,
            "hi.md",
            "Hi",
            "b",
            &[("rating", PropertyValue::Number(Some(9.0)))],
        );
        index(
            &db,
            "lo.md",
            "Lo",
            "b",
            &[("rating", PropertyValue::Number(Some(3.0)))],
        );
        assert_eq!(paths(&run_query(&db, "rating>=5").unwrap()), vec!["hi.md"]);
        assert_eq!(paths(&run_query(&db, "rating<5").unwrap()), vec!["lo.md"]);
        // Sorted numerically, not lexically (10 > 9).
        index(
            &db,
            "top.md",
            "Top",
            "b",
            &[("rating", PropertyValue::Number(Some(10.0)))],
        );
        let sorted = run_query(&db, "sort:rating:desc").unwrap();
        assert_eq!(paths(&sorted), vec!["top.md", "hi.md", "lo.md"]);
    }

    #[test]
    fn list_property_membership_via_eq() {
        let (_t, db) = mem_db();
        index(
            &db,
            "a.md",
            "A",
            "b",
            &[(
                "people",
                PropertyValue::List(vec!["Alice".into(), "Bob".into()]),
            )],
        );
        index(
            &db,
            "b.md",
            "B",
            "b",
            &[("people", PropertyValue::List(vec!["Carol".into()]))],
        );
        assert_eq!(
            paths(&run_query(&db, "people:Alice").unwrap()),
            vec!["a.md"]
        );
        assert!(run_query(&db, "people:Dave").unwrap().notes.is_empty());
    }

    #[test]
    fn relation_filter_matches_typed_relation() {
        let (_t, db) = mem_db();
        index(&db, "Launch.md", "Launch", "b", &[]);
        index(
            &db,
            "task.md",
            "Task",
            "b",
            &[("project", PropertyValue::Text("[[Launch]]".into()))],
        );
        index(
            &db,
            "other.md",
            "Other",
            "b",
            &[("project", PropertyValue::Text("[[Nope]]".into()))],
        );
        assert_eq!(
            paths(&run_query(&db, "project:[[Launch]]").unwrap()),
            vec!["task.md"]
        );
        // Case-insensitive title resolution.
        assert_eq!(
            paths(&run_query(&db, "project:[[launch]]").unwrap()),
            vec!["task.md"]
        );
    }

    #[test]
    fn fulltext_and_facets_fuse() {
        let (_t, db) = mem_db();
        index(&db, "a.md", "A", "the quick brown fox", &[]);
        // A note WITH a task.
        let mut s = summary("b.md", "B");
        s.tags = vec![];
        search::index_note(&db, &s, "quick notes\n- [ ] do the thing").unwrap();

        // FTS-only.
        assert_eq!(paths(&run_query(&db, "fox").unwrap()), vec!["a.md"]);
        // FTS ∪ facet: "quick" appears in both, has:task narrows to b.
        assert_eq!(
            paths(&run_query(&db, "quick has:task").unwrap()),
            vec!["b.md"]
        );
        // The task rides along in the result.
        let r = run_query(&db, "has:task").unwrap();
        assert_eq!(r.tasks.len(), 1);
        assert_eq!(r.view, QueryViewKind::Kanban);
    }

    #[test]
    fn task_facet_filters_by_task_attribute() {
        let (_t, db) = mem_db();
        let mut s = summary("a.md", "A");
        s.tags = vec![];
        search::index_note(&db, &s, "- [ ] ship it @priority(high) @status(todo)").unwrap();
        let mut s = summary("b.md", "B");
        s.tags = vec![];
        search::index_note(&db, &s, "- [ ] later @priority(low)").unwrap();

        assert_eq!(
            paths(&run_query(&db, "task.priority:high").unwrap()),
            vec!["a.md"]
        );
        assert!(run_query(&db, "task.priority:urgent")
            .unwrap()
            .notes
            .is_empty());
    }

    #[test]
    fn calendar_date_is_picked_from_frontmatter() {
        let (_t, db) = mem_db();
        index(
            &db,
            "e.md",
            "Event",
            "b",
            &[("date", PropertyValue::Text("2026-08-15".into()))],
        );
        index(&db, "n.md", "Note", "b", &[]);
        let r = run_query(&db, "view:calendar").unwrap();
        assert!(r.has_dates);
        let e = r.notes.iter().find(|n| n.path == "e.md").unwrap();
        assert_eq!(e.date.as_deref(), Some("2026-08-15"));
        let n = r.notes.iter().find(|n| n.path == "n.md").unwrap();
        assert_eq!(n.date, None);
        assert_eq!(r.view, QueryViewKind::Calendar);
    }

    #[test]
    fn property_keys_union_is_first_seen_order() {
        let (_t, db) = mem_db();
        index(
            &db,
            "a.md",
            "A",
            "b",
            &[
                ("type", PropertyValue::Text("x".into())),
                ("rating", PropertyValue::Number(Some(1.0))),
            ],
        );
        index(
            &db,
            "b.md",
            "B",
            "b",
            &[("status", PropertyValue::Text("y".into()))],
        );
        let r = run_query(&db, "sort:path").unwrap();
        assert_eq!(r.property_keys, vec!["type", "rating", "status"]);
    }

    #[test]
    fn hostile_values_bind_as_literals() {
        let (_t, db) = mem_db();
        index(
            &db,
            "a.md",
            "A",
            "safe body",
            &[("type", PropertyValue::Text("note".into()))],
        );

        // A classic injection payload as a value must not execute — it simply
        // fails to match, and the table is untouched.
        let evil = r#"type:x'; DROP TABLE note_meta; --"#;
        let r = run_query(&db, evil).unwrap();
        assert!(r.notes.is_empty());
        // The table still exists and the row survives.
        let n: i64 = db
            .query_row("SELECT COUNT(*) FROM note_meta", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);

        // Hostile values in every position: property key, tag, title, FTS, and a
        // relation title. None may error or corrupt anything.
        for q in [
            r#"tag:") OR 1=1 --"#,
            r#"title:"' OR '1'='1""#,
            r#""); DROP TABLE tasks; --"#,
            r#"weird"key:value"#,
            r#"ref:[["]; DROP TABLE links; --]]"#,
        ] {
            let _ = run_query(&db, q).unwrap();
        }
        let n: i64 = db
            .query_row("SELECT COUNT(*) FROM note_meta", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "tables must be intact after hostile queries");
    }

    #[test]
    fn folder_filter_matches_subtree() {
        let (_t, db) = mem_db();
        index(&db, "Projects/a.md", "A", "b", &[]);
        index(&db, "Projects/Sub/b.md", "B", "b", &[]);
        index(&db, "Other/c.md", "C", "b", &[]);
        let r = run_query(&db, "folder:Projects sort:path").unwrap();
        assert_eq!(paths(&r), vec!["Projects/Sub/b.md", "Projects/a.md"]);
    }

    #[test]
    fn empty_query_returns_all_notes() {
        let (_t, db) = mem_db();
        index(&db, "a.md", "A", "b", &[]);
        index(&db, "b.md", "B", "b", &[]);
        assert_eq!(run_query(&db, "").unwrap().notes.len(), 2);
    }
}
