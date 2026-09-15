//! The read-only preview (ADR-0020): a note's body as HTML.
//!
//! CommonMark + the GFM pieces the editor knows (PLAN.md §7.2: tables, task
//! lists, strikethrough), footnotes, and `[[wikilinks]]`. The YAML frontmatter
//! is not part of the body. Raw HTML in the note is shown as text: the preview
//! only ever contains markup this function wrote, so the WebView can insert it
//! as it is, and nothing a note carries can turn into a script, a frame or a
//! form.

use pulldown_cmark::{html, Event, Options, Parser};

use crate::notes::frontmatter;

/// Render `text` (a whole note, frontmatter included) to an HTML fragment.
pub fn to_html(text: &str) -> String {
    let body = frontmatter::body(text);
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_WIKILINKS;
    let events = Parser::new_ext(body, options).map(|event| match event {
        Event::Html(raw) | Event::InlineHtml(raw) => Event::Text(raw),
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
        assert!(html.contains("<h1>H</h1>"));
        assert!(html.contains("type=\"checkbox\""));
        assert!(html.contains("<table>"));
        assert!(html.contains("<del>gone</del>"));
        // Percent-encoded like any destination; the UI decodes before it
        // resolves the note.
        assert!(html.contains("href=\"Other%20Note\""));
        assert!(html.contains(">see</a>"));
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
