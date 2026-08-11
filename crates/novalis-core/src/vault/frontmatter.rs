//! YAML frontmatter parsing and serialization.
//!
//! Novalis writes YAML frontmatter exclusively (decision #7) for Obsidian
//! compatibility. Reading is currently YAML-only; migration of legacy formats
//! (Logseq `key:: value`, TOML `+++`) is a tracked follow-up.

use std::sync::OnceLock;

use chrono::Utc;
use gray_matter::engine::YAML;
use gray_matter::Matter;
use regex::Regex;

use crate::error::{CoreError, CoreResult};
use crate::models::{NoteFrontmatter, NotePropertyEntry, PropertyValue};

/// Parse YAML frontmatter from a markdown string.
/// Returns the parsed frontmatter and the body (content after frontmatter).
pub fn parse_frontmatter(content: &str) -> (NoteFrontmatter, String) {
    let matter = Matter::<YAML>::new();
    // gray_matter 0.3 made `parse` fallible. This is the LENIENT reader (index
    // and display paths), so a block it cannot even split degrades to "no
    // frontmatter, everything is body" rather than failing — the same shape as
    // 0.2, which reported an unparseable block as `data: None`. Returning the
    // input untouched as the body is the only option here that cannot lose text.
    // Do NOT `unwrap()`: this parses arbitrary user files.
    let result = match matter.parse::<gray_matter::Pod>(content) {
        Ok(r) => r,
        Err(e) => {
            log::warn!("failed to parse frontmatter block: {e}");
            return (NoteFrontmatter::default(), content.to_string());
        }
    };

    let fm = match frontmatter_value(&result.data) {
        // No block, or a legitimately-empty `---\n---` (YAML null), or a
        // non-mapping (a stray scalar/list) — none of which is metadata.
        None => NoteFrontmatter::default(),
        Some(val) => match serde_json::from_value(val) {
            Ok(fm) => fm,
            Err(e) => {
                log::warn!("failed to deserialize frontmatter: {e}");
                NoteFrontmatter::default()
            }
        },
    };

    (fm, result.content)
}

/// Normalize a parsed frontmatter block to a mapping value ready to deserialize,
/// or `None` when it is absent / null / not a mapping (an empty `---\n---` block
/// parses to YAML null, which is not malformed — just empty). Real vaults hold
/// values whose YAML type doesn't match ours (a year written as an integer
/// `created: 2026`, a single tag written as a bare scalar `tags: work`); those
/// are coerced here so one odd field doesn't fail the whole struct and drop ALL
/// of the note's metadata from the index.
fn frontmatter_value(data: &Option<gray_matter::Pod>) -> Option<serde_json::Value> {
    let mut val: serde_json::Value = data.as_ref()?.deserialize().ok()?;
    let obj = val.as_object_mut()?;
    // String-typed fields: coerce a number/bool to its string form; a null to "".
    for key in ["title", "created", "modified"] {
        if let Some(v) = obj.get_mut(key) {
            match v {
                serde_json::Value::Number(_) | serde_json::Value::Bool(_) => {
                    *v = serde_json::Value::String(scalar_to_string(v));
                }
                // `title` is optional (null → None); `created`/`modified` are
                // required strings, so a null there becomes "".
                serde_json::Value::Null if key != "title" => {
                    *v = serde_json::Value::String(String::new());
                }
                _ => {}
            }
        }
    }
    // List-typed fields: a bare scalar becomes a one-element list; a null becomes
    // an empty list; existing list elements get number/bool coercion.
    for key in ["tags", "aliases"] {
        match obj.get_mut(key) {
            Some(serde_json::Value::Array(arr)) => {
                for e in arr.iter_mut() {
                    if matches!(e, serde_json::Value::Number(_) | serde_json::Value::Bool(_)) {
                        *e = serde_json::Value::String(scalar_to_string(e));
                    }
                }
            }
            Some(
                v @ (serde_json::Value::String(_)
                | serde_json::Value::Number(_)
                | serde_json::Value::Bool(_)),
            ) => {
                *v = serde_json::Value::Array(vec![serde_json::Value::String(scalar_to_string(v))]);
            }
            Some(v @ serde_json::Value::Null) => {
                *v = serde_json::Value::Array(Vec::new());
            }
            _ => {}
        }
    }
    Some(val)
}

/// A JSON scalar (string/number/bool) rendered as a plain string.
fn scalar_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

/// Like [`parse_frontmatter`], but a frontmatter block that EXISTS yet fails
/// to deserialize is an error instead of a silent default — for write paths
/// that re-serialize the parsed struct, where the default would erase the
/// user's hand-written metadata irrecoverably.
pub fn parse_frontmatter_strict(content: &str) -> CoreResult<(NoteFrontmatter, String)> {
    let matter = Matter::<YAML>::new();
    // The strict counterpart: an unparseable block is an ERROR here, never a
    // default. Callers re-serialize what they get back, so degrading would write
    // the default over the user's hand-written metadata and lose it for good.
    // That asymmetry with `parse_frontmatter` above is the whole point of this
    // function, and gray_matter 0.3's fallible `parse` is a second way in.
    let result = matter.parse::<gray_matter::Pod>(content).map_err(|e| {
        CoreError::BadRequest(format!(
            "frontmatter block could not be parsed ({e}); fix it in the editor first"
        ))
    })?;
    let fm = match frontmatter_value(&result.data) {
        None => NoteFrontmatter::default(),
        Some(val) => serde_json::from_value(val).map_err(|e| {
            CoreError::BadRequest(format!(
                "frontmatter is not valid ({e}); fix it in the editor first"
            ))
        })?,
    };
    Ok((fm, result.content))
}

/// Serialize frontmatter and body back into markdown with YAML front matter.
pub fn serialize_frontmatter(fm: &NoteFrontmatter, body: &str) -> String {
    let yaml = serde_yaml::to_string(fm).unwrap_or_default();
    // serde_yaml adds a trailing newline; trim it for cleanliness.
    let yaml = yaml.trim_end();
    format!("---\n{yaml}\n---\n{body}")
}

/// Map the frontmatter `extra` passthrough (custom YAML keys) to the typed
/// property entries surfaced on [`crate::models::Note`]. Scalars map to their
/// natural kind; a string array becomes `List`; anything else a user
/// hand-wrote (nested map, mixed array) degrades to `Text` of its JSON so it
/// is visible without being silently coerced. `null` reads as empty text.
/// Order follows the underlying map (BTreeMap → alphabetical), matching how
/// serde_yaml re-emits the keys.
pub fn properties_from_extra(extra: &serde_json::Value) -> Vec<NotePropertyEntry> {
    let serde_json::Value::Object(map) = extra else {
        return Vec::new();
    };
    map.iter()
        .map(|(key, v)| {
            let value = match v {
                serde_json::Value::String(s) => PropertyValue::Text(s.clone()),
                serde_json::Value::Bool(b) => PropertyValue::Checkbox(*b),
                serde_json::Value::Number(n) => number_property(n),
                serde_json::Value::Array(items)
                    if items
                        .iter()
                        .all(|i| matches!(i, serde_json::Value::String(_))) =>
                {
                    PropertyValue::List(
                        items
                            .iter()
                            .filter_map(|i| i.as_str().map(str::to_string))
                            .collect(),
                    )
                }
                serde_json::Value::Null => PropertyValue::Text(String::new()),
                other => PropertyValue::Text(other.to_string()),
            };
            NotePropertyEntry {
                key: key.clone(),
                value,
            }
        })
        .collect()
}

/// Map a YAML/JSON number to a property value. Integers beyond f64's exact
/// range (±2^53) degrade to `Text` — surfacing a rounded `Number` would let an
/// explicit panel edit persist the corruption of a hand-written ID. (Untouched
/// keys always re-serialize from the original parsed value, so unrelated
/// writes are lossless either way.)
fn number_property(n: &serde_json::Number) -> PropertyValue {
    const EXACT: u64 = 1 << 53;
    if let Some(u) = n.as_u64() {
        if u > EXACT {
            return PropertyValue::Text(n.to_string());
        }
    }
    if let Some(i) = n.as_i64() {
        if i.unsigned_abs() > EXACT {
            return PropertyValue::Text(n.to_string());
        }
    }
    match n.as_f64() {
        Some(f) => PropertyValue::Number(Some(f)),
        None => PropertyValue::Text(n.to_string()),
    }
}

/// Update the `modified` field in frontmatter to the current UTC time.
///
/// STRICT parse: this re-serializes the parsed struct, so a lenient
/// fall-back-to-default on malformed YAML would silently erase the user's
/// title/created/tags/custom keys on every save. Broken frontmatter errors
/// instead — the caller surfaces it and leaves the file untouched.
pub fn update_modified(content: &str) -> CoreResult<String> {
    let (mut fm, body) = parse_frontmatter_strict(content)?;
    fm.modified = Utc::now().to_rfc3339();
    Ok(serialize_frontmatter(&fm, &body))
}

/// Extract a display title from frontmatter, first H1 heading, or filename.
pub fn extract_title(fm: &NoteFrontmatter, body: &str, filename: &str) -> String {
    // 1. Title from frontmatter
    if let Some(ref t) = fm.title {
        if !t.is_empty() {
            return t.clone();
        }
    }

    // 2. First H1 heading in body
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed.strip_prefix("# ") {
            let heading = heading.trim();
            if !heading.is_empty() {
                return heading.to_string();
            }
        }
    }

    // 3. Filename without extension
    filename.strip_suffix(".md").unwrap_or(filename).to_string()
}

/// Count words in a string (body text).
pub fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

/// Extract inline `#tag` references from a note body, preserving first-seen
/// order. Tags allow nesting (`#area/work`) and hyphens (`#in-progress`) and are
/// returned verbatim (without the leading `#`, no case folding) for parity with
/// frontmatter tags. ATX headings, fenced code blocks, and inline code spans are
/// skipped so a `#` in any of those isn't mistaken for a tag.
///
/// Expects the note *body* (post-frontmatter), as returned by
/// [`parse_frontmatter`].
pub fn extract_body_tags(body: &str) -> Vec<String> {
    // A tag is `#` + an alnum/underscore lead, then word chars plus `/` and `-`.
    // The `(?:^|[^\w/#])` guard keeps `a#b`, `path/#x`, and `##` from matching
    // mid-token. Group 1 is the tag text without the `#`.
    static TAG_RE: OnceLock<Regex> = OnceLock::new();
    static HEADING_RE: OnceLock<Regex> = OnceLock::new();
    static INLINE_CODE_RE: OnceLock<Regex> = OnceLock::new();
    let tag_re = TAG_RE.get_or_init(|| Regex::new(r"(?:^|[^\w/#])#([A-Za-z0-9_][\w/-]*)").unwrap());
    let heading_re = HEADING_RE.get_or_init(|| Regex::new(r"^ {0,3}#{1,6}\s+").unwrap());
    let inline_code_re = INLINE_CODE_RE.get_or_init(|| Regex::new(r"`[^`]*`").unwrap());

    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut in_code_fence = false;

    for line in body.lines() {
        let fence = line.trim_start();
        if fence.starts_with("```") || fence.starts_with("~~~") {
            in_code_fence = !in_code_fence;
            continue;
        }
        if in_code_fence || heading_re.is_match(line) {
            continue;
        }
        // Blank out inline code spans so a `#` inside backticks isn't a tag.
        let scrubbed = inline_code_re.replace_all(line, " ");
        for caps in tag_re.captures_iter(&scrubbed) {
            let tag = caps.get(1).unwrap().as_str().to_string();
            if seen.insert(tag.clone()) {
                out.push(tag);
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// gray_matter 0.3 made `parse` fallible, and that CLOSES A HOLE rather than
    /// opening one. On 0.2 a block whose YAML could not be parsed at all came
    /// back as `data: None`, which is indistinguishable from "no frontmatter" —
    /// so the strict reader returned a DEFAULT, and every write path that
    /// re-serializes what it read would then overwrite the user's block with
    /// that default. Exactly the erasure this function exists to prevent.
    ///
    /// Now it is an error on the strict path and a leave-it-alone on the lenient
    /// one. If either half of this ever regresses, notes lose metadata silently.
    #[test]
    fn unparseable_block_errors_strictly_and_is_left_alone_leniently() {
        let broken = "---\na: [1, 2\nb: }{\n---\nbody text\n";

        assert!(
            parse_frontmatter_strict(broken).is_err(),
            "strict must refuse a block it cannot parse, never default"
        );

        let (fm, body) = parse_frontmatter(broken);
        assert!(fm.title.is_none(), "lenient must fall back to the default");
        assert!(fm.tags.is_empty());
        assert!(
            body.contains("body text"),
            "lenient must not drop the text: {body}"
        );
    }

    #[test]
    fn extract_body_tags_basic_and_nested() {
        assert_eq!(
            extract_body_tags("see #project/alpha and #in-progress now"),
            vec!["project/alpha".to_string(), "in-progress".to_string()]
        );
    }

    #[test]
    fn extract_body_tags_skips_code_and_headings_and_midword() {
        let body =
            "# Heading #notatag\n\nreal #keep here\n\n`#incode` and a#b\n\n```\n#fenced\n```\n";
        assert_eq!(extract_body_tags(body), vec!["keep".to_string()]);
    }

    #[test]
    fn extract_body_tags_dedupes_preserving_order() {
        assert_eq!(
            extract_body_tags("#x and #y then #x again"),
            vec!["x".to_string(), "y".to_string()]
        );
    }

    #[test]
    fn extract_body_tags_ignores_bare_hash() {
        assert_eq!(
            extract_body_tags("just a # and ## with spaces"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn tolerates_integer_valued_string_fields() {
        // A year written as a bare integer must not drop the note's other
        // metadata (the pre-fix behaviour discarded the whole struct).
        let (fm, body) = parse_frontmatter("---\ncreated: 2026\ntags:\n  - work\n---\nbody\n");
        assert_eq!(fm.created, "2026");
        assert_eq!(fm.tags, vec!["work".to_string()]);
        assert_eq!(body.trim(), "body");
    }

    #[test]
    fn tolerates_scalar_where_a_list_is_expected() {
        let (fm, _) = parse_frontmatter("---\ntags: work\naliases: 2026\n---\nx");
        assert_eq!(fm.tags, vec!["work".to_string()]);
        assert_eq!(fm.aliases, vec!["2026".to_string()]);
    }

    #[test]
    fn empty_null_frontmatter_block_is_default_not_a_warning() {
        // An empty `---\n---` block parses to YAML null — legitimately empty,
        // must yield defaults (and stay silent, verified by no panic/err here).
        let (fm, body) = parse_frontmatter("---\n---\nhello\n");
        assert!(fm.title.is_none());
        assert!(fm.tags.is_empty());
        assert_eq!(body.trim(), "hello");
    }

    #[test]
    fn integer_title_becomes_a_string() {
        let (fm, _) = parse_frontmatter("---\ntitle: 2026\n---\nx");
        assert_eq!(fm.title.as_deref(), Some("2026"));
    }

    #[test]
    fn strict_parse_also_coerces_instead_of_erroring() {
        // The write path must not refuse to save a note that merely has an
        // integer-valued field; it coerces (preserving the value) like the read.
        let (fm, _) = parse_frontmatter_strict("---\ncreated: 2026\n---\nx").unwrap();
        assert_eq!(fm.created, "2026");
    }

    #[test]
    fn well_typed_frontmatter_is_unchanged() {
        let (fm, _) =
            parse_frontmatter("---\ntitle: Note\ntags: [a, b]\ncreated: \"2026-01-02\"\n---\nx");
        assert_eq!(fm.title.as_deref(), Some("Note"));
        assert_eq!(fm.tags, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(fm.created, "2026-01-02");
    }
}
