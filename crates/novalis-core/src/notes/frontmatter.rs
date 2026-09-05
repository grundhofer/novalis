//! YAML frontmatter: a lenient reader for `title` and `tags`, and a
//! surgical line-level editor for one named key (D22: the block is never
//! re-serialized; only the named key's lines change).
//!
//! The reader understands the subset real vaults use: `key: scalar`,
//! quoted scalars, flow lists `[a, b]`, block lists (`- a`), comments. The
//! coercions of the old reader are kept: a bare scalar under `tags` is a
//! one-element list, numbers and booleans read as strings, `null` is empty.
//! The editor refuses (`Parse`) to touch a block that is not a plain
//! top-level mapping, so a note that opens with a thematic break is never
//! rewritten (the old app deleted a user's first section that way).

use std::sync::OnceLock;

use regex::Regex;

use crate::error::{CoreError, CoreResult};

/// The fields novalis reads from a frontmatter block.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Frontmatter {
    pub title: Option<String>,
    pub tags: Vec<String>,
    /// Every top-level key, in file order (for `doctor` and `meta` output).
    pub keys: Vec<String>,
}

/// Byte offsets of a frontmatter block inside a note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BlockSpan {
    /// Start of the inner text (the byte after the opening `---` line).
    pub inner_start: usize,
    /// End of the inner text (start of the closing `---` line).
    pub inner_end: usize,
    /// End of the whole block (the byte after the closing line's newline).
    pub block_end: usize,
}

fn line_end(text: &str, from: usize) -> (usize, usize) {
    // Returns (end of content, start of next line).
    match text[from..].find('\n') {
        Some(i) => {
            let nl = from + i;
            let content_end = if nl > from && text.as_bytes()[nl - 1] == b'\r' {
                nl - 1
            } else {
                nl
            };
            (content_end, nl + 1)
        }
        None => (text.len(), text.len()),
    }
}

/// Locate the frontmatter block: the note must start with a `---` line
/// (after an optional BOM) and a later `---` or `...` line closes it.
pub fn block_span(text: &str) -> Option<BlockSpan> {
    let start = if text.starts_with('\u{feff}') { 3 } else { 0 };
    let (first_end, mut pos) = line_end(text, start);
    if text[start..first_end].trim_end() != "---" {
        return None;
    }
    let inner_start = pos;
    while pos < text.len() {
        let (end, next) = line_end(text, pos);
        let line = text[pos..end].trim_end();
        if line == "---" || line == "..." {
            return Some(BlockSpan {
                inner_start,
                inner_end: pos,
                block_end: next,
            });
        }
        pos = next;
    }
    None
}

/// The note body: everything after the frontmatter block (the whole text
/// when there is none).
pub fn body(text: &str) -> &str {
    match block_span(text) {
        Some(span) => &text[span.block_end..],
        None => text,
    }
}

fn key_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^([A-Za-z0-9_][A-Za-z0-9_.\-]*)\s*:(?:\s+(.*)|\s*)$").unwrap())
}

/// Strip an unquoted trailing ` # comment`.
fn strip_comment(v: &str) -> &str {
    match v.find(" #") {
        Some(i) if !v.trim_start().starts_with(['"', '\'']) => v[..i].trim_end(),
        _ => v,
    }
}

/// Unquote a YAML scalar: double quotes (with `\"`, `\\`, `\n`, `\t`
/// escapes), single quotes (`''`), or a plain value trimmed.
pub fn unquote(raw: &str) -> String {
    let v = raw.trim();
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        let inner = &v[1..v.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut chars = inner.chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.next() {
                    Some('n') => out.push('\n'),
                    Some('t') => out.push('\t'),
                    Some(other) => out.push(other),
                    None => out.push('\\'),
                }
            } else {
                out.push(c);
            }
        }
        return out;
    }
    if v.len() >= 2 && v.starts_with('\'') && v.ends_with('\'') {
        return v[1..v.len() - 1].replace("''", "'");
    }
    strip_comment(v).trim().to_string()
}

fn is_null(v: &str) -> bool {
    matches!(v.trim(), "" | "~" | "null" | "Null" | "NULL")
}

/// Split a flow sequence `[a, "b, c", d]` into items.
fn flow_items(inner: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    for c in inner.chars() {
        match quote {
            Some(q) => {
                cur.push(c);
                if c == q {
                    quote = None;
                }
            }
            None => match c {
                '"' | '\'' => {
                    quote = Some(c);
                    cur.push(c);
                }
                ',' => {
                    items.push(std::mem::take(&mut cur));
                }
                _ => cur.push(c),
            },
        }
    }
    items.push(cur);
    items
        .into_iter()
        .map(|s| unquote(&s))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Lenient read of `title` and `tags` (plus the list of top-level keys).
/// Never fails: an absent or unreadable block reads as empty metadata.
pub fn read(text: &str) -> Frontmatter {
    let Some(span) = block_span(text) else {
        return Frontmatter::default();
    };
    let inner = &text[span.inner_start..span.inner_end];
    let mut fm = Frontmatter::default();
    let mut lines = inner.lines().peekable();
    while let Some(line) = lines.next() {
        let Some(caps) = key_re().captures(line) else {
            continue;
        };
        let key = caps[1].to_string();
        let value = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        // Collect indented continuation / block-list lines.
        let mut items: Vec<String> = Vec::new();
        while let Some(next) = lines.peek() {
            let t = next.trim_start();
            if next.starts_with([' ', '\t']) || t.starts_with("- ") || t == "-" {
                if let Some(item) = t.strip_prefix('-') {
                    let item = unquote(item);
                    if !item.is_empty() {
                        items.push(item);
                    }
                }
                lines.next();
            } else {
                break;
            }
        }
        match key.as_str() {
            "title" => {
                let v = unquote(value);
                fm.title = if is_null(&v) { None } else { Some(v) };
            }
            "tags" => {
                let v = value.trim();
                if v.starts_with('[') && v.ends_with(']') {
                    fm.tags = flow_items(&v[1..v.len() - 1]);
                } else if !items.is_empty() {
                    fm.tags = items;
                } else if !is_null(v) {
                    let s = unquote(v);
                    if !s.is_empty() {
                        fm.tags = vec![s];
                    }
                }
            }
            _ => {}
        }
        fm.keys.push(key);
    }
    fm
}

/// Display title: frontmatter `title` → first `# H1` in the body → `stem`.
pub fn title(text: &str, stem: &str) -> String {
    let fm = read(text);
    if let Some(t) = fm.title.filter(|t| !t.trim().is_empty()) {
        return t;
    }
    for line in body(text).lines() {
        if let Some(h) = line.trim().strip_prefix("# ") {
            let h = h.trim();
            if !h.is_empty() {
                return h.to_string();
            }
        }
    }
    stem.to_string()
}

/// Inline `#tag` references in a body, first-seen order, verbatim (no case
/// folding). Headings, fenced code and inline code are skipped. Lifted from
/// the old reader.
pub fn body_tags(body: &str) -> Vec<String> {
    static TAG_RE: OnceLock<Regex> = OnceLock::new();
    static HEADING_RE: OnceLock<Regex> = OnceLock::new();
    static INLINE_CODE_RE: OnceLock<Regex> = OnceLock::new();
    let tag_re = TAG_RE.get_or_init(|| Regex::new(r"(?:^|[^\w/#])#([A-Za-z0-9_][\w/-]*)").unwrap());
    let heading_re = HEADING_RE.get_or_init(|| Regex::new(r"^ {0,3}#{1,6}\s+").unwrap());
    let inline_code_re = INLINE_CODE_RE.get_or_init(|| Regex::new(r"`[^`]*`").unwrap());

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut in_fence = false;
    for line in body.lines() {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || heading_re.is_match(line) {
            continue;
        }
        let scrubbed = inline_code_re.replace_all(line, " ");
        for caps in tag_re.captures_iter(&scrubbed) {
            let tag = caps[1].to_string();
            if seen.insert(tag.clone()) {
                out.push(tag);
            }
        }
    }
    out
}

/// Frontmatter tags followed by body tags, de-duplicated case-insensitively.
pub fn all_tags(text: &str) -> Vec<String> {
    let mut tags = read(text).tags;
    for t in body_tags(body(text)) {
        if !tags.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
            tags.push(t);
        }
    }
    tags
}

/// Quote a scalar for a `key: value` line when a plain scalar would be
/// misread (empty, leading/trailing space, YAML indicators, `: `, ` #`,
/// booleans/null/numbers that must stay strings).
pub fn quote_scalar(value: &str) -> String {
    let needs = value.is_empty()
        || value != value.trim()
        || value.contains(": ")
        || value.contains(" #")
        || value.ends_with(':')
        || value.contains('\n')
        || value.contains(['"', '\'', '\\'])
        || value.starts_with([
            '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@', '`', '-', '?',
            ',',
        ])
        || matches!(
            value.to_ascii_lowercase().as_str(),
            "true" | "false" | "null" | "~" | "yes" | "no" | "on" | "off"
        )
        || value.parse::<f64>().is_ok();
    if needs {
        let escaped = value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n");
        format!("\"{escaped}\"")
    } else {
        value.to_string()
    }
}

/// Format a flow list value `[a, b]` with per-item quoting.
pub fn format_list(items: &[String]) -> String {
    let inner: Vec<String> = items.iter().map(|i| quote_scalar(i)).collect();
    format!("[{}]", inner.join(", "))
}

/// Strictness check for the editor: every line of the block must be blank,
/// a comment, a top-level `key:` line, or an indented / `- ` continuation.
fn check_mapping(inner: &str) -> CoreResult<()> {
    let mut seen_key = false;
    for line in inner.lines() {
        let t = line.trim_start();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        if line.starts_with([' ', '\t']) || t.starts_with("- ") || t == "-" {
            if seen_key {
                continue;
            }
            return Err(CoreError::parse(None, "frontmatter block is not a mapping"));
        }
        if key_re().is_match(line) {
            seen_key = true;
            continue;
        }
        return Err(CoreError::parse(
            None,
            format!("frontmatter line is not a key: {}", line.trim()),
        ));
    }
    Ok(())
}

/// Insert, replace or remove exactly one top-level key in the frontmatter
/// block, as a text edit. `Some(value)` sets the key (scalar, quoted when
/// needed; pass a preformatted list via [`format_list`] through
/// [`edit_key_raw`]); `None` removes it. A note without a block gets a
/// minimal one only when setting. Nothing else in the file changes.
pub fn edit_key(text: &str, key: &str, value: Option<&str>) -> CoreResult<String> {
    edit_key_raw(text, key, value.map(quote_scalar).as_deref())
}

/// Like [`edit_key`] but `value` is written verbatim after `key: `.
pub fn edit_key_raw(text: &str, key: &str, value: Option<&str>) -> CoreResult<String> {
    if !key_re().is_match(&format!("{key}:")) {
        return Err(CoreError::parse(
            None,
            format!("invalid frontmatter key: {key}"),
        ));
    }
    let Some(span) = block_span(text) else {
        return Ok(match value {
            None => text.to_string(),
            Some(v) => {
                let (bom, rest) = if let Some(r) = text.strip_prefix('\u{feff}') {
                    ("\u{feff}", r)
                } else {
                    ("", text)
                };
                format!("{bom}---\n{key}: {v}\n---\n{rest}")
            }
        });
    };
    let inner = &text[span.inner_start..span.inner_end];
    check_mapping(inner)?;
    let eol = if inner.contains("\r\n") || text[..span.inner_start].contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };

    // Locate the key's line range (with continuation lines) inside `inner`.
    let mut pos = 0;
    let mut found: Option<(usize, usize)> = None;
    while pos < inner.len() {
        let (end, next) = line_end(inner, pos);
        let line = &inner[pos..end];
        if let Some(caps) = key_re().captures(line) {
            if &caps[1] == key {
                let mut stop = next;
                while stop < inner.len() {
                    let (e2, n2) = line_end(inner, stop);
                    let l2 = &inner[stop..e2];
                    let t = l2.trim_start();
                    if l2.starts_with([' ', '\t']) || t.starts_with("- ") || t == "-" {
                        stop = n2;
                    } else {
                        break;
                    }
                }
                found = Some((pos, stop));
                break;
            }
        }
        pos = next;
    }

    let mut new_inner = String::with_capacity(inner.len() + 64);
    match (found, value) {
        (Some((s, e)), Some(v)) => {
            new_inner.push_str(&inner[..s]);
            new_inner.push_str(&format!("{key}: {v}{eol}"));
            new_inner.push_str(&inner[e..]);
        }
        (Some((s, e)), None) => {
            new_inner.push_str(&inner[..s]);
            new_inner.push_str(&inner[e..]);
        }
        (None, Some(v)) => {
            new_inner.push_str(inner);
            if !inner.is_empty() && !inner.ends_with('\n') {
                new_inner.push_str(eol);
            }
            new_inner.push_str(&format!("{key}: {v}{eol}"));
        }
        (None, None) => return Ok(text.to_string()),
    }
    let mut out = String::with_capacity(text.len() + 64);
    out.push_str(&text[..span.inner_start]);
    out.push_str(&new_inner);
    out.push_str(&text[span.inner_end..]);
    Ok(out)
}

/// Set the `tags` key to `tags` as a flow list (or remove it when empty).
pub fn set_tags(text: &str, tags: &[String]) -> CoreResult<String> {
    if tags.is_empty() {
        edit_key_raw(text, "tags", None)
    } else {
        edit_key_raw(text, "tags", Some(&format_list(tags)))
    }
}

/// Add a tag (no-op when present, case-insensitively).
pub fn add_tag(text: &str, tag: &str) -> CoreResult<String> {
    let mut tags = read(text).tags;
    if tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
        return Ok(text.to_string());
    }
    tags.push(tag.to_string());
    set_tags(text, &tags)
}

/// Remove a tag (no-op when absent, case-insensitively).
pub fn remove_tag(text: &str, tag: &str) -> CoreResult<String> {
    let tags = read(text).tags;
    let kept: Vec<String> = tags
        .iter()
        .filter(|t| !t.eq_ignore_ascii_case(tag))
        .cloned()
        .collect();
    if kept.len() == tags.len() {
        return Ok(text.to_string());
    }
    set_tags(text, &kept)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_title_tags_and_keys_leniently() {
        let t = "---\ntitle: \"Notes on: Walden\"\ncreated: 2026\ntags:\n  - work\n  - 'deep-dive'\nstatus: reading # comment\n---\nbody\n";
        let fm = read(t);
        assert_eq!(fm.title.as_deref(), Some("Notes on: Walden"));
        assert_eq!(fm.tags, vec!["work", "deep-dive"]);
        assert_eq!(fm.keys, vec!["title", "created", "tags", "status"]);
        assert_eq!(body(t), "body\n");

        let fm = read("---\ntags: [a, \"b, c\", d]\ntitle: 2026\n---\n");
        assert_eq!(fm.tags, vec!["a", "b, c", "d"]);
        assert_eq!(fm.title.as_deref(), Some("2026"));

        let fm = read("---\ntags: work\naliases: x\n---\nx");
        assert_eq!(fm.tags, vec!["work"]);

        let fm = read("---\ntitle: ~\ntags: null\n---\n");
        assert_eq!(fm.title, None);
        assert!(fm.tags.is_empty());

        assert_eq!(read("---\n---\nhello\n"), Frontmatter::default());
        assert_eq!(read("no block\n"), Frontmatter::default());
        assert_eq!(read("---\nunterminated\n"), Frontmatter::default());
        // CRLF and BOM.
        let fm = read("\u{feff}---\r\ntitle: X\r\n---\r\nbody");
        assert_eq!(fm.title.as_deref(), Some("X"));
    }

    #[test]
    fn unparseable_block_is_left_alone_leniently() {
        let broken = "---\na: [1, 2\nb: }{\n---\nbody text\n";
        let fm = read(broken);
        assert!(fm.title.is_none());
        assert!(fm.tags.is_empty());
        assert_eq!(body(broken), "body text\n");
    }

    #[test]
    fn title_falls_back_to_h1_then_stem() {
        assert_eq!(title("---\ntitle: FM\n---\n# H1\n", "stem"), "FM");
        assert_eq!(
            title("---\ntitle: \"\"\n---\n\n# H1 Title \n", "stem"),
            "H1 Title"
        );
        assert_eq!(title("no heading", "stem"), "stem");
        assert_eq!(title("## not h1\n# real\n", "stem"), "real");
    }

    #[test]
    fn body_tags_ported_behaviour() {
        assert_eq!(
            body_tags("see #project/alpha and #in-progress now"),
            vec!["project/alpha", "in-progress"]
        );
        let b = "# Heading #notatag\n\nreal #keep here\n\n`#incode` and a#b\n\n```\n#fenced\n```\n";
        assert_eq!(body_tags(b), vec!["keep"]);
        assert_eq!(body_tags("#x and #y then #x again"), vec!["x", "y"]);
        assert_eq!(
            body_tags("just a # and ## with spaces"),
            Vec::<String>::new()
        );
        assert_eq!(
            all_tags("---\ntags:\n  - work\n---\n\nbody with #urgent and #Work\n"),
            vec!["work", "urgent"]
        );
    }

    #[test]
    fn edit_key_replaces_inserts_removes_without_touching_the_rest() {
        let t = "---\ntitle: Old\ncreated: 2026-01-01\ntags:\n  - a\n  - b\ncustom: keep me   \n---\n\n# Body\n\nText.\n";
        let out = edit_key(t, "title", Some("New: Title")).unwrap();
        assert_eq!(
            out,
            "---\ntitle: \"New: Title\"\ncreated: 2026-01-01\ntags:\n  - a\n  - b\ncustom: keep me   \n---\n\n# Body\n\nText.\n"
        );
        let out = edit_key(t, "status", Some("active")).unwrap();
        assert!(out.contains("custom: keep me   \nstatus: active\n---\n"));
        let out = edit_key(t, "tags", None).unwrap();
        assert_eq!(
            out,
            "---\ntitle: Old\ncreated: 2026-01-01\ncustom: keep me   \n---\n\n# Body\n\nText.\n"
        );
        // Removing an absent key is the identity.
        assert_eq!(edit_key(t, "missing", None).unwrap(), t);
        // Replacing a block list with a scalar removes the continuation lines.
        let out = edit_key_raw(t, "tags", Some("[x]")).unwrap();
        assert!(out.contains("tags: [x]\ncustom: keep me"));
        assert!(!out.contains("  - a"));
    }

    #[test]
    fn edit_key_creates_a_minimal_block_only_when_setting() {
        assert_eq!(
            edit_key("# Body\n", "title", Some("T")).unwrap(),
            "---\ntitle: T\n---\n# Body\n"
        );
        assert_eq!(edit_key("# Body\n", "title", None).unwrap(), "# Body\n");
        assert_eq!(
            edit_key("---\n---\nbody", "k", Some("v")).unwrap(),
            "---\nk: v\n---\nbody"
        );
        assert_eq!(
            edit_key("\u{feff}x", "k", Some("v")).unwrap(),
            "\u{feff}---\nk: v\n---\nx"
        );
    }

    #[test]
    fn edit_key_keeps_crlf() {
        let t = "---\r\ntitle: A\r\n---\r\nbody\r\n";
        assert_eq!(
            edit_key(t, "title", Some("B")).unwrap(),
            "---\r\ntitle: B\r\n---\r\nbody\r\n"
        );
        assert_eq!(
            edit_key(t, "x", Some("y")).unwrap(),
            "---\r\ntitle: A\r\nx: y\r\n---\r\nbody\r\n"
        );
    }

    #[test]
    fn edit_key_refuses_non_mapping_blocks() {
        let thematic = "---\n\nFirst section.\n\n---\n\nSecond section.\n";
        assert!(matches!(
            edit_key(thematic, "title", Some("x")),
            Err(CoreError::Parse { .. })
        ));
        assert!(matches!(
            edit_key("---\n- one\n- two\n---\nBody\n", "k", Some("v")),
            Err(CoreError::Parse { .. })
        ));
        assert!(matches!(
            edit_key("---\na: [1, 2\nb: }{\n---\n", "k", Some("v")),
            Err(CoreError::Parse { .. })
        )
        .not());
        assert!(edit_key(
            "---\ntitle: Real\n# a comment\n\n---\nBody\n",
            "k",
            Some("v")
        )
        .is_ok());
        assert!(matches!(
            edit_key("---\nok: 1\n---\n", "bad key", Some("v")),
            Err(CoreError::Parse { .. })
        ));
    }

    trait Not {
        fn not(self) -> bool;
    }
    impl Not for bool {
        fn not(self) -> bool {
            !self
        }
    }

    #[test]
    fn quoting_rules() {
        assert_eq!(quote_scalar("plain title"), "plain title");
        assert_eq!(quote_scalar("Notes on: Walden"), "\"Notes on: Walden\"");
        assert_eq!(quote_scalar("true"), "\"true\"");
        assert_eq!(quote_scalar("2026"), "\"2026\"");
        assert_eq!(quote_scalar(""), "\"\"");
        assert_eq!(quote_scalar("- dash"), "\"- dash\"");
        assert_eq!(quote_scalar("say \"hi\""), "\"say \\\"hi\\\"\"");
        assert_eq!(
            format_list(&["a".into(), "b c".into(), "x: y".into()]),
            "[a, b c, \"x: y\"]"
        );
        assert_eq!(unquote("\"a \\\"b\\\"\""), "a \"b\"");
        assert_eq!(unquote("'it''s'"), "it's");
    }

    #[test]
    fn tag_helpers_roundtrip() {
        let t = "---\ntitle: T\ntags:\n  - work\n---\nbody\n";
        let added = add_tag(t, "urgent").unwrap();
        assert_eq!(added, "---\ntitle: T\ntags: [work, urgent]\n---\nbody\n");
        assert_eq!(add_tag(&added, "Work").unwrap(), added);
        let removed = remove_tag(&added, "WORK").unwrap();
        assert_eq!(removed, "---\ntitle: T\ntags: [urgent]\n---\nbody\n");
        assert_eq!(
            remove_tag(&removed, "urgent").unwrap(),
            "---\ntitle: T\n---\nbody\n"
        );
        assert_eq!(
            add_tag("plain\n", "x").unwrap(),
            "---\ntags: [x]\n---\nplain\n"
        );
        assert_eq!(read(&add_tag("plain\n", "x").unwrap()).tags, vec!["x"]);
    }
}
