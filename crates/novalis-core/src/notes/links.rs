//! Link extraction and resolution (PLAN.md §7.2).
//!
//! Forms: `[[target]]`, `[[target|label]]`, `[[target#heading]]` and
//! Markdown `[text](relative.md)`. Extraction is a byte-exact scanner (the
//! rewriter needs the exact span of the target text); fenced code, inline
//! code and the frontmatter block are skipped. Resolution is by file stem,
//! case-insensitive after NFC; `folder/stem` disambiguates duplicates.

use std::collections::{BTreeMap, HashMap};
use std::ops::Range;

use serde::{Deserialize, Serialize};

use crate::notes::frontmatter;
use crate::util::percent_decode;
use crate::vault::path::{fold, folder_of, join_rel, nfc, resolve_relative, stem_of};

/// Which syntax a link used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkForm {
    Wiki,
    WikiLabel,
    WikiHeading,
    Markdown,
}

impl LinkForm {
    pub fn as_str(self) -> &'static str {
        match self {
            LinkForm::Wiki => "wiki",
            LinkForm::WikiLabel => "wiki_label",
            LinkForm::WikiHeading => "wiki_heading",
            LinkForm::Markdown => "markdown",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "wiki" => Some(LinkForm::Wiki),
            "wiki_label" => Some(LinkForm::WikiLabel),
            "wiki_heading" => Some(LinkForm::WikiHeading),
            "markdown" => Some(LinkForm::Markdown),
            _ => None,
        }
    }
}

/// One link occurrence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    /// The target text, NFC, without `#heading`/`|label`; Markdown targets
    /// are percent-decoded and keep their relative path.
    pub target: String,
    pub heading: Option<String>,
    pub label: Option<String>,
    pub form: LinkForm,
    /// 1-based line of the link start.
    pub line: usize,
    /// Byte range of the raw target text inside the note (for rewriting).
    pub span: Range<usize>,
}

/// Mask inline code spans on one line with spaces so their brackets are
/// ignored. Backtick runs of any length pair with an equal run.
fn mask_inline_code(line: &str) -> String {
    let bytes = line.as_bytes();
    let mut masked = line.to_string().into_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'`' {
            let mut run = 0;
            while i + run < bytes.len() && bytes[i + run] == b'`' {
                run += 1;
            }
            // Find the closing run of the same length.
            let mut j = i + run;
            let mut close = None;
            while j < bytes.len() {
                if bytes[j] == b'`' {
                    let mut r2 = 0;
                    while j + r2 < bytes.len() && bytes[j + r2] == b'`' {
                        r2 += 1;
                    }
                    if r2 == run {
                        close = Some(j);
                        break;
                    }
                    j += r2;
                } else {
                    j += 1;
                }
            }
            match close {
                Some(c) => {
                    for b in &mut masked[i..c + run] {
                        if !b.is_ascii_whitespace() {
                            *b = b' ';
                        }
                    }
                    i = c + run;
                }
                None => i += run,
            }
        } else {
            i += 1;
        }
    }
    // Only ASCII bytes were replaced, so this stays valid UTF-8.
    String::from_utf8(masked).unwrap_or_else(|_| line.to_string())
}

fn is_fence(line: &str) -> bool {
    let t = line.trim_start();
    (line.len() - t.len()) <= 3 && (t.starts_with("```") || t.starts_with("~~~"))
}

/// Extract every link in `text` (frontmatter, fenced code and inline code
/// skipped), in document order.
pub fn extract(text: &str) -> Vec<Link> {
    let body_start = match frontmatter::block_span(text) {
        Some(span) => span.block_end,
        None => 0,
    };
    let lines_before = text[..body_start].matches('\n').count();
    let mut out = Vec::new();
    let mut in_fence = false;
    let mut offset = body_start;
    for (i, raw_line) in text[body_start..].split_inclusive('\n').enumerate() {
        let line_no = lines_before + i + 1;
        let line = raw_line.strip_suffix('\n').unwrap_or(raw_line);
        let line = line.strip_suffix('\r').unwrap_or(line);
        if is_fence(line) {
            in_fence = !in_fence;
            offset += raw_line.len();
            continue;
        }
        if !in_fence {
            let masked = mask_inline_code(line);
            extract_wiki(&masked, offset, line_no, &mut out);
            extract_markdown(&masked, offset, line_no, &mut out);
        }
        offset += raw_line.len();
    }
    out.sort_by_key(|l| l.span.start);
    out
}

fn extract_wiki(line: &str, offset: usize, line_no: usize, out: &mut Vec<Link>) {
    let mut from = 0;
    while let Some(start) = line[from..].find("[[") {
        let open = from + start + 2;
        let Some(len) = line[open..].find("]]") else {
            break;
        };
        let inner = &line[open..open + len];
        from = open + len + 2;
        if inner.contains("[[") || inner.is_empty() {
            continue;
        }
        let (target_part, label) = match inner.find('|') {
            Some(i) => (&inner[..i], Some(inner[i + 1..].to_string())),
            None => (inner, None),
        };
        let (target_raw, heading) = match target_part.find('#') {
            Some(i) => (&target_part[..i], Some(target_part[i + 1..].to_string())),
            None => (target_part, None),
        };
        let trimmed = target_raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lead = target_raw.len() - target_raw.trim_start().len();
        let span_start = offset + open + lead;
        let form = if label.is_some() {
            LinkForm::WikiLabel
        } else if heading.is_some() {
            LinkForm::WikiHeading
        } else {
            LinkForm::Wiki
        };
        out.push(Link {
            target: nfc(trimmed),
            heading: heading.map(|h| h.trim().to_string()),
            label: label.map(|l| l.trim().to_string()),
            form,
            line: line_no,
            span: span_start..span_start + trimmed.len(),
        });
    }
}

fn extract_markdown(line: &str, offset: usize, line_no: usize, out: &mut Vec<Link>) {
    let bytes = line.as_bytes();
    let mut from = 0;
    while let Some(rel) = line[from..].find("](") {
        let close_bracket = from + rel;
        let dest_start = close_bracket + 2;
        from = dest_start;
        // Walk back to the matching `[`, honouring nesting.
        let mut depth = 0i32;
        let mut open = None;
        let mut k = close_bracket;
        while k > 0 {
            k -= 1;
            match bytes[k] {
                b']' => depth += 1,
                b'[' => {
                    if depth == 0 {
                        open = Some(k);
                        break;
                    }
                    depth -= 1;
                }
                _ => {}
            }
        }
        let Some(open) = open else { continue };
        if open > 0 && bytes[open - 1] == b'!' {
            continue; // image
        }
        if open > 0 && bytes[open - 1] == b'[' {
            continue; // part of a wikilink
        }
        // Destination: up to the matching `)`, allowing balanced parens.
        let mut depth = 0i32;
        let mut end = None;
        let mut j = dest_start;
        while j < bytes.len() {
            match bytes[j] {
                b'(' => depth += 1,
                b')' => {
                    if depth == 0 {
                        end = Some(j);
                        break;
                    }
                    depth -= 1;
                }
                _ => {}
            }
            j += 1;
        }
        let Some(end) = end else { continue };
        let dest_full = &line[dest_start..end];
        from = end + 1;
        // Strip an optional title and angle brackets.
        let mut dest = dest_full.trim();
        let mut dest_off = dest_full.len() - dest_full.trim_start().len();
        if let Some(i) = dest.find([' ', '\t']) {
            dest = &dest[..i];
        }
        if dest.starts_with('<') && dest.ends_with('>') && dest.len() >= 2 {
            dest = &dest[1..dest.len() - 1];
            dest_off += 1;
        }
        if dest.is_empty()
            || dest.contains("://")
            || dest.starts_with("mailto:")
            || dest.starts_with('#')
        {
            continue;
        }
        let (path_part, heading) = match dest.find('#') {
            Some(i) => (&dest[..i], Some(dest[i + 1..].to_string())),
            None => (dest, None),
        };
        let decoded = percent_decode(path_part);
        if !decoded.to_lowercase().ends_with(".md") {
            continue;
        }
        let span_start = offset + dest_start + dest_off;
        out.push(Link {
            target: nfc(&decoded),
            heading: heading.map(|h| percent_decode(&h)),
            label: Some(line[open + 1..close_bracket].to_string()),
            form: LinkForm::Markdown,
            line: line_no,
            span: span_start..span_start + path_part.len(),
        });
    }
}

/// Outcome of resolving one link target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    Resolved(String),
    Ambiguous(Vec<String>),
    Unresolved,
}

impl Resolution {
    pub fn path(&self) -> Option<&str> {
        match self {
            Resolution::Resolved(p) => Some(p),
            _ => None,
        }
    }
}

/// The set of note paths, indexed for stem resolution.
#[derive(Debug, Default, Clone)]
pub struct StemIndex {
    /// fold(stem) → NFC paths with that stem, sorted.
    by_stem: HashMap<String, Vec<String>>,
    /// fold(path) → NFC path.
    by_path: HashMap<String, String>,
}

impl StemIndex {
    pub fn build<I, S>(paths: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut idx = StemIndex::default();
        for p in paths {
            idx.insert(p.as_ref());
        }
        for v in idx.by_stem.values_mut() {
            v.sort();
            v.dedup();
        }
        idx
    }

    pub fn insert(&mut self, path: &str) {
        let path = nfc(path);
        let key = fold(&path);
        if self.by_path.contains_key(&key) {
            return;
        }
        self.by_stem
            .entry(fold(stem_of(&path)))
            .or_default()
            .push(path.clone());
        self.by_path.insert(key, path);
    }

    pub fn remove(&mut self, path: &str) {
        let path = nfc(path);
        let key = fold(&path);
        if self.by_path.remove(&key).is_some() {
            let stem = fold(stem_of(&path));
            if let Some(v) = self.by_stem.get_mut(&stem) {
                v.retain(|p| fold(p) != key);
                if v.is_empty() {
                    self.by_stem.remove(&stem);
                }
            }
        }
    }

    pub fn contains(&self, path: &str) -> bool {
        self.by_path.contains_key(&fold(path))
    }

    pub fn len(&self) -> usize {
        self.by_path.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_path.is_empty()
    }

    /// All paths, sorted.
    pub fn paths(&self) -> Vec<String> {
        let mut v: Vec<String> = self.by_path.values().cloned().collect();
        v.sort();
        v
    }

    /// Resolve a wikilink target (`stem`, `folder/stem`, optionally with a
    /// `.md` suffix) case-insensitively.
    pub fn resolve_wiki(&self, target: &str) -> Resolution {
        let mut key = fold(target.trim());
        if let Some(k) = key.strip_suffix(".md") {
            key = k.to_string();
        }
        if key.is_empty() {
            return Resolution::Unresolved;
        }
        if key.contains('/') {
            let want = format!("{key}.md");
            if let Some(p) = self.by_path.get(&want) {
                return Resolution::Resolved(p.clone());
            }
            let suffix = format!("/{want}");
            let mut hits: Vec<String> = self
                .by_path
                .iter()
                .filter(|(k, _)| k.ends_with(&suffix))
                .map(|(_, v)| v.clone())
                .collect();
            hits.sort();
            return match hits.len() {
                0 => Resolution::Unresolved,
                1 => Resolution::Resolved(hits.remove(0)),
                _ => Resolution::Ambiguous(hits),
            };
        }
        match self.by_stem.get(&key) {
            None => Resolution::Unresolved,
            Some(v) if v.len() == 1 => Resolution::Resolved(v[0].clone()),
            Some(v) => Resolution::Ambiguous(v.clone()),
        }
    }

    /// Resolve a Markdown link destination relative to the linking note.
    pub fn resolve_markdown(&self, from_path: &str, target: &str) -> Resolution {
        let Some(joined) = resolve_relative(folder_of(from_path), target) else {
            return Resolution::Unresolved;
        };
        match self.by_path.get(&fold(&joined)) {
            Some(p) => Resolution::Resolved(p.clone()),
            None => Resolution::Unresolved,
        }
    }

    pub fn resolve(&self, from_path: &str, link: &Link) -> Resolution {
        match link.form {
            LinkForm::Markdown => self.resolve_markdown(from_path, &link.target),
            _ => self.resolve_wiki(&link.target),
        }
    }

    /// The shortest unambiguous wikilink text for `path`: the stem when
    /// unique, else the shortest `folder/stem` suffix that is unique, else
    /// the full path without `.md`.
    pub fn link_target_for(&self, path: &str) -> String {
        let path = nfc(path);
        let stem = stem_of(&path).to_string();
        let dupes = self.by_stem.get(&fold(&stem)).map(|v| v.len()).unwrap_or(0);
        if dupes <= 1 {
            return stem;
        }
        let parts: Vec<&str> = path.split('/').collect();
        for n in 2..=parts.len() {
            let candidate = parts[parts.len() - n..].join("/");
            let candidate = candidate
                .strip_suffix(".md")
                .unwrap_or(&candidate)
                .to_string();
            if matches!(self.resolve_wiki(&candidate), Resolution::Resolved(ref p) if fold(p) == fold(&path))
            {
                return candidate;
            }
        }
        path.strip_suffix(".md").unwrap_or(&path).to_string()
    }

    /// Stems shared by more than one note (`doctor`).
    pub fn duplicates(&self) -> BTreeMap<String, Vec<String>> {
        self.by_stem
            .iter()
            .filter(|(_, v)| v.len() > 1)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    /// Notes whose stem contains `#` or `|` and so can never be a wikilink
    /// target (`doctor`).
    pub fn unlinkable(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .by_path
            .values()
            .filter(|p| stem_of(p).contains(['#', '|']))
            .cloned()
            .collect();
        v.sort();
        v
    }
}

/// Build the vault-relative path of a new note next to `folder`.
pub fn note_path(folder: &str, stem: &str) -> String {
    join_rel(folder, &format!("{stem}.md"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_all_forms_with_lines_and_spans() {
        let text = "---\ntitle: T\nlink: \"[[not a link]]\"\n---\nSee [[Atlas Overview]] and [[Harbor Overview|the tool]].\n\nAlso [[Notes on: Walden#Chapter 2]] and [read](../reading/walden.md#top) plus [x](Slow%20Software.md \"t\").\n`[[in code]]` ![img](a.md) [ext](https://x.md) [[  spaced  ]]\n```\n[[fenced]]\n```\n[[Atlas Overview]]\n";
        let links = extract(text);
        let summary: Vec<(String, LinkForm, usize)> = links
            .iter()
            .map(|l| (l.target.clone(), l.form, l.line))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("Atlas Overview".into(), LinkForm::Wiki, 5),
                ("Harbor Overview".into(), LinkForm::WikiLabel, 5),
                ("Notes on: Walden".into(), LinkForm::WikiHeading, 7),
                ("../reading/walden.md".into(), LinkForm::Markdown, 7),
                ("Slow Software.md".into(), LinkForm::Markdown, 7),
                ("spaced".into(), LinkForm::Wiki, 8),
                ("Atlas Overview".into(), LinkForm::Wiki, 12),
            ]
        );
        for l in &links {
            let raw = &text[l.span.clone()];
            match l.form {
                LinkForm::Markdown => assert_eq!(
                    percent_decode(raw),
                    l.target,
                    "span must cover the raw target"
                ),
                _ => assert_eq!(raw, l.target),
            }
        }
        assert_eq!(links[1].label.as_deref(), Some("the tool"));
        assert_eq!(links[2].heading.as_deref(), Some("Chapter 2"));
        assert_eq!(links[3].heading.as_deref(), Some("top"));
        assert_eq!(links[3].label.as_deref(), Some("read"));
    }

    #[test]
    fn inline_code_masking_handles_runs() {
        assert_eq!(mask_inline_code("a `b` c"), "a     c");
        assert_eq!(mask_inline_code("``x ` y`` z"), "          z");
        assert_eq!(mask_inline_code("no close ` here"), "no close ` here");
        assert!(extract("`[[a]]` [[b]]").iter().all(|l| l.target == "b"));
    }

    #[test]
    fn resolves_by_stem_case_insensitively_with_folder_disambiguation() {
        let idx = StemIndex::build([
            "index.md",
            "reading/index.md",
            "research/Local-First Software.md",
            "projects/Atlas Overview.md",
            "Über.md",
        ]);
        assert_eq!(
            idx.resolve_wiki("local-first software"),
            Resolution::Resolved("research/Local-First Software.md".into())
        );
        assert_eq!(
            idx.resolve_wiki("Local-First Software.md").path(),
            Some("research/Local-First Software.md")
        );
        assert_eq!(
            idx.resolve_wiki("index"),
            Resolution::Ambiguous(vec!["index.md".into(), "reading/index.md".into()])
        );
        assert_eq!(
            idx.resolve_wiki("reading/index").path(),
            Some("reading/index.md")
        );
        assert_eq!(
            idx.resolve_wiki("Reading/Index").path(),
            Some("reading/index.md")
        );
        assert_eq!(idx.resolve_wiki("missing"), Resolution::Unresolved);
        assert_eq!(idx.resolve_wiki("U\u{0308}ber").path(), Some("Über.md"));
        assert_eq!(
            idx.resolve_markdown(
                "projects/Atlas Overview.md",
                "../research/Local-First%20Software.md"
                    .replace("%20", " ")
                    .as_str()
            ),
            Resolution::Resolved("research/Local-First Software.md".into())
        );
        assert_eq!(
            idx.resolve_markdown("projects/x.md", "../../out.md"),
            Resolution::Unresolved
        );
        assert_eq!(
            idx.link_target_for("projects/Atlas Overview.md"),
            "Atlas Overview"
        );
        assert_eq!(idx.link_target_for("reading/index.md"), "reading/index");
        assert_eq!(
            idx.link_target_for("index.md"),
            "index.md".trim_end_matches(".md")
        );
        let d = idx.duplicates();
        assert_eq!(
            d.get("index").unwrap(),
            &vec!["index.md".to_string(), "reading/index.md".to_string()]
        );
        assert!(idx.unlinkable().is_empty());
        let idx2 = StemIndex::build(["a#b.md", "c|d.md", "ok.md"]);
        assert_eq!(idx2.unlinkable(), vec!["a#b.md", "c|d.md"]);
    }

    #[test]
    fn root_index_link_target_is_the_stem_when_it_resolves_uniquely() {
        // Two `index.md`: root one gets `index.md`-less suffix path "index"?
        // The root path has no folder, so the only unambiguous form is the
        // full path without extension, which equals the stem; that form
        // resolves ambiguously, so the full path is returned instead.
        let idx = StemIndex::build(["index.md", "reading/index.md"]);
        assert_eq!(idx.link_target_for("index.md"), "index");
        assert_eq!(idx.link_target_for("reading/index.md"), "reading/index");
    }

    #[test]
    fn insert_and_remove_keep_the_index_consistent() {
        let mut idx = StemIndex::build(["a/x.md"]);
        idx.insert("b/x.md");
        assert!(matches!(idx.resolve_wiki("x"), Resolution::Ambiguous(_)));
        idx.remove("a/x.md");
        assert_eq!(idx.resolve_wiki("x").path(), Some("b/x.md"));
        idx.remove("b/x.md");
        assert!(idx.is_empty());
        assert_eq!(idx.resolve_wiki("x"), Resolution::Unresolved);
    }
}
