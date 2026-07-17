//! Evernote `.enex` importer.
//!
//! An ENEX file is XML: an `<en-export>` wrapping one `<note>` per note, each
//! with a `<title>`, an `<content>` holding the note body as ENML (Evernote's
//! XHTML dialect, usually in a CDATA section), plus `<created>`/`<updated>`
//! timestamps and repeated `<tag>` elements.
//!
//! We parse the envelope with `quick-xml`, convert the ENML body to Markdown
//! with a small in-house SAX converter (the same `quick-xml` parser drives it —
//! ENML is XML — so no HTML5 parser enters the dependency tree), and map
//! title/tags/created/updated to YAML frontmatter. One Markdown note per
//! `<note>`, written under `Imported/Evernote/`; nothing existing is overwritten.

use std::collections::HashSet;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::reader::Reader;

use crate::error::{CoreError, CoreResult};
use crate::models::NoteFrontmatter;
use crate::vault::frontmatter::serialize_frontmatter;

use super::{body_with_leading_newline, sanitize_segment, write_unique, ImportSummary};

/// Root subfolder (vault-relative) every Evernote import is written into.
pub const IMPORT_ROOT: &str = "Imported/Evernote";

/// One parsed `<note>` from the ENEX envelope.
#[derive(Default)]
struct EnexNote {
    title: String,
    content: String,
    created: String,
    updated: String,
    tags: Vec<String>,
}

/// Import an Evernote `.enex` file at `enex_path` into `vault`. Returns a
/// summary of what was written. Does not reindex — the caller does that once.
pub fn import(enex_path: &Path, vault: &Path) -> CoreResult<ImportSummary> {
    // ENEX is spec'd UTF-8; fall back to lossy decoding rather than failing.
    let bytes = std::fs::read(enex_path)?;
    let xml = String::from_utf8_lossy(&bytes);
    let notes = parse_enex(&xml)?;

    let now = chrono::Utc::now().to_rfc3339();
    let mut summary = ImportSummary {
        folder: IMPORT_ROOT.to_string(),
        ..Default::default()
    };
    let mut taken: HashSet<String> = HashSet::new();

    for note in notes {
        let display_title = if note.title.trim().is_empty() {
            "Untitled".to_string()
        } else {
            note.title.trim().to_string()
        };
        let fm = NoteFrontmatter {
            title: Some(display_title.clone()),
            tags: note.tags,
            created: if note.created.is_empty() {
                now.clone()
            } else {
                note.created
            },
            modified: if note.updated.is_empty() {
                now.clone()
            } else {
                note.updated
            },
            ..Default::default()
        };
        let body = enml_to_markdown(&note.content);
        let content = serialize_frontmatter(&fm, &body_with_leading_newline(&body));
        let rel = format!("{IMPORT_ROOT}/{}.md", sanitize_segment(&display_title));
        match write_unique(vault, &rel, &content, &mut taken) {
            Ok(_) => summary.notes_imported += 1,
            Err(e) => {
                summary.skipped += 1;
                summary.warnings.push(format!("{display_title}: {e}"));
            }
        }
    }

    Ok(summary)
}

/// The `<note>`-level fields we capture (everything else in a note is ignored).
enum Field {
    Title,
    Content,
    Created,
    Updated,
    Tag,
}

/// Parse the ENEX envelope into notes. Text is captured only for the direct
/// children of `<note>` we care about, so `<note-attributes>`/`<resource>`
/// contents can't leak into a field.
fn parse_enex(xml: &str) -> CoreResult<Vec<EnexNote>> {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut notes: Vec<EnexNote> = Vec::new();
    let mut cur: Option<EnexNote> = None;
    let mut field: Option<Field> = None;
    let mut fieldbuf = String::new();
    let mut depth: i32 = 0;
    let mut note_depth: i32 = -1;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                depth += 1;
                let name = local_name(e.local_name().as_ref());
                if name == "note" {
                    cur = Some(EnexNote::default());
                    note_depth = depth;
                    field = None;
                } else if cur.is_some() && depth == note_depth + 1 {
                    field = match name.as_str() {
                        "title" => Some(Field::Title),
                        "content" => Some(Field::Content),
                        "created" => Some(Field::Created),
                        "updated" => Some(Field::Updated),
                        "tag" => Some(Field::Tag),
                        _ => None,
                    };
                    fieldbuf.clear();
                }
            }
            Ok(Event::Text(t)) => {
                if field.is_some() {
                    fieldbuf.push_str(&t.unescape().unwrap_or_default());
                }
            }
            Ok(Event::CData(t)) => {
                if field.is_some() {
                    fieldbuf.push_str(&String::from_utf8_lossy(t.as_ref()));
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.local_name().as_ref());
                if let (Some(note), true) = (cur.as_mut(), depth == note_depth + 1) {
                    match field.take() {
                        Some(Field::Title) => note.title = fieldbuf.trim().to_string(),
                        Some(Field::Content) => note.content = fieldbuf.clone(),
                        Some(Field::Created) => note.created = parse_enex_time(&fieldbuf),
                        Some(Field::Updated) => note.updated = parse_enex_time(&fieldbuf),
                        Some(Field::Tag) => {
                            let tag = fieldbuf.trim();
                            if !tag.is_empty() {
                                note.tags.push(tag.to_string());
                            }
                        }
                        None => {}
                    }
                }
                if name == "note" && depth == note_depth {
                    if let Some(note) = cur.take() {
                        notes.push(note);
                    }
                    note_depth = -1;
                }
                depth -= 1;
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(CoreError::BadRequest(format!("invalid ENEX XML: {e}")));
            }
            _ => {}
        }
        buf.clear();
    }
    Ok(notes)
}

/// Convert an Evernote timestamp (`20240131T091500Z`) to RFC 3339. Empty on
/// anything we can't parse, so a bad value degrades to the import time.
fn parse_enex_time(s: &str) -> String {
    chrono::NaiveDateTime::parse_from_str(s.trim(), "%Y%m%dT%H%M%SZ")
        .map(|dt| {
            chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(dt, chrono::Utc).to_rfc3339()
        })
        .unwrap_or_default()
}

/// Strip a namespace prefix off an element's local name and lowercase it.
fn local_name(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_ascii_lowercase()
}

/// A list currently open in the ENML → Markdown converter.
enum List {
    Unordered,
    /// Ordered, carrying the next item number.
    Ordered(usize),
}

/// Convert an ENML/XHTML note body to Markdown. Handles the block and inline
/// constructs Evernote actually emits (paragraphs, headings, lists, checkboxes,
/// links, emphasis, code, blockquotes, rules); attachments (`<en-media>`) are
/// dropped. Unknown tags are transparent — their text still comes through.
fn enml_to_markdown(enml: &str) -> String {
    let mut reader = Reader::from_str(enml);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut lists: Vec<List> = Vec::new();
    let mut link_hrefs: Vec<String> = Vec::new();
    let mut in_pre = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = local_name(e.local_name().as_ref());
                match name.as_str() {
                    "p" | "div" => ensure_newline(&mut out),
                    "br" => out.push('\n'),
                    "h1" => start_heading(&mut out, 1),
                    "h2" => start_heading(&mut out, 2),
                    "h3" => start_heading(&mut out, 3),
                    "h4" => start_heading(&mut out, 4),
                    "h5" => start_heading(&mut out, 5),
                    "h6" => start_heading(&mut out, 6),
                    "ul" => lists.push(List::Unordered),
                    "ol" => lists.push(List::Ordered(1)),
                    "li" => start_list_item(&mut out, &mut lists),
                    "b" | "strong" => out.push_str("**"),
                    "i" | "em" => out.push('*'),
                    "code" if !in_pre => out.push('`'),
                    "pre" => {
                        ensure_newline(&mut out);
                        out.push_str("```\n");
                        in_pre = true;
                    }
                    "blockquote" => {
                        ensure_newline(&mut out);
                        out.push_str("> ");
                    }
                    "a" => {
                        link_hrefs.push(attr_value(&e, b"href"));
                        out.push('[');
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let name = local_name(e.local_name().as_ref());
                match name.as_str() {
                    "br" => out.push('\n'),
                    "hr" => {
                        ensure_newline(&mut out);
                        out.push_str("---\n");
                    }
                    "en-todo" => {
                        let checked = attr_value(&e, b"checked").eq_ignore_ascii_case("true");
                        ensure_newline(&mut out);
                        out.push_str(if checked { "- [x] " } else { "- [ ] " });
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = local_name(e.local_name().as_ref());
                match name.as_str() {
                    "p" | "div" | "li" | "blockquote" => ensure_newline(&mut out),
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => ensure_newline(&mut out),
                    "ul" | "ol" => {
                        lists.pop();
                        ensure_newline(&mut out);
                    }
                    "b" | "strong" => out.push_str("**"),
                    "i" | "em" => out.push('*'),
                    "code" if !in_pre => out.push('`'),
                    "pre" => {
                        ensure_newline(&mut out);
                        out.push_str("```\n");
                        in_pre = false;
                    }
                    "a" => {
                        let href = link_hrefs.pop().unwrap_or_default();
                        out.push_str(&format!("]({href})"));
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(t)) => {
                let text = t.unescape().unwrap_or_default();
                if in_pre {
                    out.push_str(&text);
                } else {
                    append_inline_text(&mut out, &text);
                }
            }
            Ok(Event::CData(t)) => {
                out.push_str(&String::from_utf8_lossy(t.as_ref()));
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    normalize_blank_lines(out.trim())
}

/// Read an attribute's value by local name, unescaped; empty when absent.
fn attr_value(e: &quick_xml::events::BytesStart, key: &[u8]) -> String {
    for attr in e.attributes().flatten() {
        if local_name(attr.key.local_name().as_ref()).as_bytes() == key {
            let raw = String::from_utf8_lossy(&attr.value);
            return quick_xml::escape::unescape(&raw)
                .map(|c| c.into_owned())
                .unwrap_or_else(|_| raw.into_owned());
        }
    }
    String::new()
}

/// Append inline text, collapsing internal whitespace runs to single spaces so
/// ENML's pretty-printing indentation doesn't bleed into the Markdown.
fn append_inline_text(out: &mut String, text: &str) {
    let mut prev_space = out.ends_with(['\n', ' ']) || out.is_empty();
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
}

/// Ensure `out` ends with a newline (start of a fresh block), unless it's empty.
fn ensure_newline(out: &mut String) {
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
}

/// Emit `# ` … `###### ` for a heading level on a fresh line.
fn start_heading(out: &mut String, level: usize) {
    ensure_newline(out);
    out.push_str(&"#".repeat(level));
    out.push(' ');
}

/// Emit the marker for a list item, indented by nesting depth and numbered for
/// ordered lists.
fn start_list_item(out: &mut String, lists: &mut [List]) {
    ensure_newline(out);
    let depth = lists.len().saturating_sub(1);
    out.push_str(&"  ".repeat(depth));
    match lists.last_mut() {
        Some(List::Ordered(n)) => {
            out.push_str(&format!("{n}. "));
            *n += 1;
        }
        _ => out.push_str("- "),
    }
}

/// Collapse 3+ consecutive newlines to a single blank line.
fn normalize_blank_lines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut newlines = 0;
    for ch in s.chars() {
        if ch == '\n' {
            newlines += 1;
            if newlines <= 2 {
                out.push('\n');
            }
        } else {
            newlines = 0;
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_enex_time() {
        assert_eq!(
            parse_enex_time("20240131T091500Z"),
            "2024-01-31T09:15:00+00:00"
        );
        assert_eq!(parse_enex_time("garbage"), "");
    }

    #[test]
    fn enml_basic_formatting() {
        let md = enml_to_markdown("<en-note><div>Hello <b>world</b></div></en-note>");
        assert_eq!(md, "Hello **world**");
    }

    #[test]
    fn enml_list_and_todo() {
        let md = enml_to_markdown(
            "<en-note><ul><li>one</li><li>two</li></ul><div><en-todo checked=\"true\"/>done</div></en-note>",
        );
        assert!(md.contains("- one"), "got: {md}");
        assert!(md.contains("- two"), "got: {md}");
        assert!(md.contains("- [x] done"), "got: {md}");
    }

    #[test]
    fn enml_link() {
        let md = enml_to_markdown("<en-note><a href=\"https://x.y\">site</a></en-note>");
        assert_eq!(md, "[site](https://x.y)");
    }

    #[test]
    fn parses_note_envelope() {
        let xml = r#"<en-export>
          <note>
            <title>My Note</title>
            <content><![CDATA[<en-note><div>Body text</div></en-note>]]></content>
            <created>20240101T000000Z</created>
            <tag>work</tag>
            <tag>ideas</tag>
          </note>
        </en-export>"#;
        let notes = parse_enex(xml).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "My Note");
        assert_eq!(notes[0].tags, vec!["work", "ideas"]);
        assert!(notes[0].content.contains("Body text"));
        assert_eq!(notes[0].created, "2024-01-01T00:00:00+00:00");
    }
}
