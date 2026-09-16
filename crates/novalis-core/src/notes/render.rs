//! The read-only preview (ADR-0020): a note's body as HTML.
//!
//! CommonMark + the GFM pieces the editor knows (PLAN.md §7.2: tables, task
//! lists, strikethrough), footnotes, and `[[wikilinks]]`. The YAML frontmatter
//! is not part of the body. Raw HTML in the note is shown as text: the preview
//! only ever contains markup this function wrote, so the WebView can insert it
//! as it is, and nothing a note carries can turn into a script, a frame or a
//! form.

use pulldown_cmark::{html, CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

use crate::notes::frontmatter;

/// The tag a block opens with, for the blocks that carry a source position.
fn opening(tag: &Tag<'_>) -> Option<&'static str> {
    match tag {
        Tag::Paragraph => Some("p"),
        Tag::Heading { level, .. } => Some(match level {
            HeadingLevel::H1 => "h1",
            HeadingLevel::H2 => "h2",
            HeadingLevel::H3 => "h3",
            HeadingLevel::H4 => "h4",
            HeadingLevel::H5 => "h5",
            HeadingLevel::H6 => "h6",
        }),
        Tag::Item => Some("li"),
        _ => None,
    }
}

fn closing(tag: &TagEnd) -> Option<&'static str> {
    match tag {
        TagEnd::Paragraph => Some("p"),
        TagEnd::Heading(level) => Some(match level {
            HeadingLevel::H1 => "h1",
            HeadingLevel::H2 => "h2",
            HeadingLevel::H3 => "h3",
            HeadingLevel::H4 => "h4",
            HeadingLevel::H5 => "h5",
            HeadingLevel::H6 => "h6",
        }),
        TagEnd::Item => Some("li"),
        _ => None,
    }
}

/// Render `text` (a whole note, frontmatter included) to an HTML fragment.
///
/// Paragraphs, headings and list items carry `data-pos="start-end"`: the
/// block's span in the note text as UTF-16 code units (JavaScript's string
/// indices), frontmatter included, so the preview can map a selection back
/// to the source it came from and wrap it there (ADR-0020, amended).
pub fn to_html(text: &str) -> String {
    let body = frontmatter::body(text);
    let base = text.len() - body.len();
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_WIKILINKS;
    // Byte offsets into `text` → UTF-16 units. Blocks come in order and the
    // note is small, so a running count is cheap enough.
    let units = |byte: usize| text[..byte].encode_utf16().count();
    let events =
        Parser::new_ext(body, options)
            .into_offset_iter()
            .map(|(event, range)| match event {
                Event::Html(raw) | Event::InlineHtml(raw) => Event::Text(raw),
                Event::Start(ref tag) => match opening(tag) {
                    Some(name) => Event::Html(CowStr::from(format!(
                        "<{name} data-pos=\"{}-{}\">",
                        units(base + range.start),
                        units(base + range.end)
                    ))),
                    None => event,
                },
                Event::End(ref tag) => match closing(tag) {
                    Some(name) => Event::Html(CowStr::from(format!("</{name}>\n"))),
                    None => event,
                },
                other => other,
            });
    let mut out = String::with_capacity(body.len() * 2);
    html::push_html(&mut out, events);
    out
}

#[cfg(test)]
mod tests {
    use super::to_html;

    #[test]
    fn renders_gfm_and_skips_the_frontmatter() {
        let html = to_html("---\ntitle: T\n---\n# H\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~ [[Other Note|see]]\n");
        assert!(!html.contains("title: T"));
        assert!(html.contains("<h1 data-pos=\"17-21\">H</h1>"), "{html}");
        assert!(html.contains("type=\"checkbox\""));
        assert!(html.contains("<table>"));
        assert!(html.contains("<del>gone</del>"));
        // Percent-encoded like any destination; the UI decodes before it
        // resolves the note.
        assert!(html.contains("href=\"Other%20Note\""));
        assert!(html.contains(">see</a>"));
    }

    /// The spans count UTF-16 units of the whole text, frontmatter included,
    /// so a JavaScript `slice` of the buffer lands on the block.
    #[test]
    fn block_positions_are_utf16_offsets_into_the_whole_note() {
        let text = "---\nt: ä\n---\nÄ **b**\n\n- 😀 x\n";
        let html = to_html(text);
        let js: Vec<u16> = text.encode_utf16().collect();
        let slice = |s: usize, e: usize| String::from_utf16(&js[s..e]).unwrap();
        let pos = |tag: &str| -> (usize, usize) {
            let i = html.find(&format!("<{tag} data-pos=\"")).unwrap() + tag.len() + 12;
            let end = html[i..].find('"').unwrap();
            let (a, b) = html[i..i + end].split_once('-').unwrap();
            (a.parse().unwrap(), b.parse().unwrap())
        };
        let (s, e) = pos("p");
        assert_eq!(slice(s, e), "Ä **b**\n");
        // An item's span starts at its marker; the preview searches the
        // selected text inside the span, so the marker does no harm.
        let (s, e) = pos("li");
        assert_eq!(slice(s, e), "- 😀 x\n");
    }

    #[test]
    fn raw_html_becomes_text() {
        let html = to_html("<script>alert(1)</script>\n\nx <b>y</b>\n");
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("&lt;b&gt;y&lt;/b&gt;"));
    }

    #[test]
    fn fenced_code_keeps_its_language_for_the_preview() {
        let html = to_html("```mermaid\ngraph TD; A-->B\n```\n");
        assert!(html.contains("<code class=\"language-mermaid\">"));
        assert!(html.contains("A--&gt;B"));
    }
}
