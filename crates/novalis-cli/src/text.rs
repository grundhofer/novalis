//! Body arithmetic for `edit`: line offsets, Markdown sections and a diff.
//!
//! Every operation splices byte ranges of the original text instead of
//! re-joining lines, so line endings, a BOM and trailing whitespace outside
//! the edited range survive untouched (PLAN.md §5.5).

/// One line of a text, without its terminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Line<'a> {
    pub text: &'a str,
    /// Byte offset of the first character.
    pub start: usize,
    /// Byte offset just past the last character, before `\r\n` or `\n`.
    pub end: usize,
    /// Byte offset of the next line's start (== text length at the end).
    pub next: usize,
}

/// Split into lines, keeping every byte accounted for. A trailing newline
/// does not produce an extra empty line.
pub fn lines_of(s: &str) -> Vec<Line<'_>> {
    let mut out = Vec::new();
    let mut start = 0usize;
    for (i, _) in s.match_indices('\n') {
        let mut end = i;
        if end > start && s.as_bytes()[end - 1] == b'\r' {
            end -= 1;
        }
        out.push(Line {
            text: &s[start..end],
            start,
            end,
            next: i + 1,
        });
        start = i + 1;
    }
    if start < s.len() {
        out.push(Line {
            text: &s[start..],
            start,
            end: s.len(),
            next: s.len(),
        });
    }
    out
}

/// The line ending inserted text should use: CRLF only when the text already
/// has one.
pub fn line_ending(s: &str) -> &'static str {
    if s.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// A Markdown ATX heading level (`#` … `######`), ignoring `#tags`.
pub fn heading_level(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('#') {
        return None;
    }
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    if hashes > 6 {
        return None;
    }
    let rest = &trimmed[hashes..];
    if rest.is_empty() || rest.starts_with(' ') || rest.starts_with('\t') {
        Some(hashes)
    } else {
        None
    }
}

/// One heading and the span of the text it owns: from the line after the
/// heading to the line before the next heading of the same or higher level
/// (PLAN.md §9.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Section {
    /// 1-based line number of the heading inside the body.
    pub line: usize,
    pub level: usize,
    /// Byte range of the section body, heading excluded.
    pub body_start: usize,
    pub body_end: usize,
}

/// Every section whose heading line equals `wanted` after trimming.
/// Headings inside fenced code blocks are ignored.
pub fn find_sections(body: &str, wanted: &str) -> Vec<Section> {
    let wanted = wanted.trim();
    let lines = lines_of(body);
    let fenced = fenced_lines(&lines);
    let heads: Vec<(usize, usize)> = lines
        .iter()
        .enumerate()
        .filter(|(i, _)| !fenced[*i])
        .filter_map(|(i, l)| heading_level(l.text).map(|lvl| (i, lvl)))
        .collect();
    let mut out = Vec::new();
    for (pos, (idx, level)) in heads.iter().enumerate() {
        if lines[*idx].text.trim() != wanted {
            continue;
        }
        let body_start = lines[*idx].next;
        let body_end = heads[pos + 1..]
            .iter()
            .find(|(_, l)| *l <= *level)
            .map(|(i, _)| lines[*i].start)
            .unwrap_or(body.len());
        out.push(Section {
            line: idx + 1,
            level: *level,
            body_start,
            body_end: body_end.max(body_start),
        });
    }
    out
}

/// Which lines sit inside a ``` or ~~~ fence.
fn fenced_lines(lines: &[Line<'_>]) -> Vec<bool> {
    let mut out = vec![false; lines.len()];
    let mut fence: Option<char> = None;
    for (i, l) in lines.iter().enumerate() {
        let t = l.text.trim_start();
        let marker = t.chars().next().filter(|c| *c == '`' || *c == '~');
        let run = marker
            .map(|m| t.chars().take_while(|c| *c == m).count())
            .unwrap_or(0);
        match (fence, marker) {
            (None, Some(m)) if run >= 3 => {
                fence = Some(m);
                out[i] = true;
            }
            (Some(open), Some(m)) if m == open && run >= 3 => {
                fence = None;
                out[i] = true;
            }
            (Some(_), _) => out[i] = true,
            _ => {}
        }
    }
    out
}

/// Make `insert` a block that can be spliced at `at`: it ends with a line
/// ending, and gets one in front unless it already starts a line.
pub fn block_at(text: &str, at: usize, insert: &str, eol: &str) -> String {
    let mut out = String::new();
    let starts_line = at == 0 || text[..at].ends_with('\n');
    if !starts_line {
        out.push_str(eol);
    }
    out.push_str(insert.trim_end_matches(['\n', '\r']));
    out.push_str(eol);
    out
}

/// A single-hunk unified diff, computed by trimming the common prefix and
/// suffix. Enough for the `--dry-run` output of one structured edit.
pub fn unified_diff(before: &str, after: &str) -> String {
    let a: Vec<&str> = before.split('\n').collect();
    let b: Vec<&str> = after.split('\n').collect();
    let mut head = 0;
    while head < a.len() && head < b.len() && a[head] == b[head] {
        head += 1;
    }
    let mut tail = 0;
    while tail < a.len() - head
        && tail < b.len() - head
        && a[a.len() - 1 - tail] == b[b.len() - 1 - tail]
    {
        tail += 1;
    }
    let a_mid = &a[head..a.len() - tail];
    let b_mid = &b[head..b.len() - tail];
    if a_mid.is_empty() && b_mid.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "@@ -{},{} +{},{} @@\n",
        head + 1,
        a_mid.len(),
        head + 1,
        b_mid.len()
    );
    for l in a_mid {
        out.push('-');
        out.push_str(l);
        out.push('\n');
    }
    for l in b_mid {
        out.push('+');
        out.push_str(l);
        out.push('\n');
    }
    out
}

/// A 1-based inclusive `A:B` range over `text`, as a byte range.
pub fn line_range(text: &str, spec: &str) -> Option<(usize, usize)> {
    let (a, b) = spec.split_once(':')?;
    let a: usize = a.trim().parse().ok()?;
    let b: usize = b.trim().parse().ok()?;
    if a == 0 || b < a {
        return None;
    }
    let lines = lines_of(text);
    if lines.is_empty() || a > lines.len() {
        return Some((text.len(), text.len()));
    }
    let start = lines[a - 1].start;
    let end = lines[(b - 1).min(lines.len() - 1)].next;
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_cover_every_byte() {
        for s in ["", "a", "a\n", "a\nb", "a\r\nb\r\n", "\n\n"] {
            let lines = lines_of(s);
            let mut at = 0;
            for l in &lines {
                assert_eq!(l.start, at);
                at = l.next;
            }
            assert_eq!(at, s.len(), "{s:?}");
        }
    }

    #[test]
    fn crlf_lines_keep_their_carriage_return_out_of_the_text() {
        let lines = lines_of("a\r\nb\r\n");
        assert_eq!(lines[0].text, "a");
        assert_eq!(lines[1].text, "b");
        assert_eq!(line_ending("a\r\nb\r\n"), "\r\n");
        assert_eq!(line_ending("a\nb\n"), "\n");
    }

    #[test]
    fn headings_need_a_space_so_tags_are_not_headings() {
        assert_eq!(heading_level("# Title"), Some(1));
        assert_eq!(heading_level("### Deep"), Some(3));
        assert_eq!(heading_level("#tag"), None);
        assert_eq!(heading_level("####### too deep"), None);
        assert_eq!(heading_level("text"), None);
    }

    #[test]
    fn a_section_runs_to_the_next_heading_of_the_same_or_higher_level() {
        let body = "# A\nintro\n\n## B\nb1\nb2\n\n### C\nc1\n\n## D\nd1\n";
        let s = find_sections(body, "## B");
        assert_eq!(s.len(), 1);
        assert_eq!(
            &body[s[0].body_start..s[0].body_end],
            "b1\nb2\n\n### C\nc1\n\n"
        );
        let d = find_sections(body, "## D");
        assert_eq!(&body[d[0].body_start..d[0].body_end], "d1\n");
    }

    #[test]
    fn duplicate_headings_are_all_reported() {
        let body = "## H\none\n\n## H\ntwo\n";
        let s = find_sections(body, "## H");
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].line, 1);
        assert_eq!(s[1].line, 4);
    }

    #[test]
    fn headings_inside_a_fence_are_not_sections() {
        let body = "## Real\n```\n## Fake\n```\ntail\n";
        assert!(find_sections(body, "## Fake").is_empty());
        assert_eq!(find_sections(body, "## Real").len(), 1);
    }

    #[test]
    fn a_block_gets_the_separators_it_needs() {
        assert_eq!(block_at("a\n", 2, "x", "\n"), "x\n");
        assert_eq!(block_at("a", 1, "x", "\n"), "\nx\n");
        assert_eq!(block_at("a\n", 2, "x\n\n", "\n"), "x\n");
    }

    #[test]
    fn the_diff_names_only_the_changed_lines() {
        let d = unified_diff("a\nb\nc\n", "a\nB\nc\n");
        assert!(d.contains("-b"), "{d}");
        assert!(d.contains("+B"), "{d}");
        assert!(!d.contains("-a"), "{d}");
        assert_eq!(unified_diff("a\n", "a\n"), "");
    }

    #[test]
    fn line_ranges_are_one_based_and_inclusive() {
        let t = "one\ntwo\nthree\n";
        let (s, e) = line_range(t, "2:3").unwrap();
        assert_eq!(&t[s..e], "two\nthree\n");
        let (s, e) = line_range(t, "1:1").unwrap();
        assert_eq!(&t[s..e], "one\n");
        assert!(line_range(t, "0:1").is_none());
        assert!(line_range(t, "3:2").is_none());
        assert!(line_range(t, "nope").is_none());
    }
}
