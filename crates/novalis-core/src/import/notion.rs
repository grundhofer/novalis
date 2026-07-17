//! Notion "Export" (Markdown & CSV) importer.
//!
//! A Notion export is a `.zip` in which every page is already Markdown, but the
//! shape is hostile to any other tool: file and directory names carry a trailing
//! 32-hex-char page id (`Roadmap 1a2b…ff.md`), intra-export links are
//! `%20`-encoded relative paths to those hashed filenames, and every database is
//! a flat `.csv` next to a folder of per-row Markdown pages.
//!
//! This importer undoes all of that:
//! * strips the id suffix from every path segment,
//! * rewrites intra-export `.md`/`.csv` links to `[[Wikilinks]]` and asset links
//!   to the cleaned relative path (copying the asset there),
//! * expands each database `.csv` into one note per row with the columns as
//!   typed YAML frontmatter properties — merging in the row page's body when the
//!   export shipped one — so the database works in the query engine immediately.
//!
//! Everything lands under `Imported/Notion/`; nothing existing is overwritten
//! (collisions get a ` (2)` suffix via [`super::unique_path`]).

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;

use crate::error::{CoreError, CoreResult};
use crate::models::NoteFrontmatter;
use crate::vault::frontmatter::serialize_frontmatter;

use super::{body_with_leading_newline, sanitize_segment, write_unique, ImportSummary};

/// Root subfolder (vault-relative) every Notion import is written into.
pub const IMPORT_ROOT: &str = "Imported/Notion";

/// Import a Notion export `.zip` at `zip_path` into `vault`. Returns a summary
/// of what was written. Does not reindex — the caller does that once.
pub fn import(zip_path: &Path, vault: &Path) -> CoreResult<ImportSummary> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|e| CoreError::BadRequest(format!("not a readable .zip: {e}")))?;

    // Pass 1: collect the entry list and slurp the small text payloads
    // (Markdown + CSV). Binary assets are streamed out later, by name.
    let mut md_bodies: HashMap<String, String> = HashMap::new();
    let mut csv_bodies: HashMap<String, String> = HashMap::new();
    let mut asset_paths: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| CoreError::BadRequest(format!("corrupt zip entry: {e}")))?;
        if entry.is_dir() {
            continue;
        }
        let name = normalize_entry_name(entry.name());
        if name.is_empty() || is_ignored(&name) {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".md") {
            let mut s = String::new();
            let _ = entry.read_to_string(&mut s);
            md_bodies.insert(name, s);
        } else if lower.ends_with(".csv") {
            let mut s = String::new();
            let _ = entry.read_to_string(&mut s);
            csv_bodies.insert(name, s);
        } else {
            asset_paths.push(name);
        }
    }

    // Index every Markdown page by its containing folder + cleaned stem, so a
    // database row can adopt the body of its matching row page.
    let mut pages_by_folder: HashMap<String, HashMap<String, String>> = HashMap::new();
    for path in md_bodies.keys() {
        let (dir, file) = split_parent(path);
        let stem = clean_last_segment(file).0.to_ascii_lowercase();
        pages_by_folder
            .entry(dir.to_string())
            .or_default()
            .insert(stem, path.clone());
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut summary = ImportSummary {
        folder: IMPORT_ROOT.to_string(),
        ..Default::default()
    };
    let mut taken: HashSet<String> = HashSet::new();
    let mut consumed: HashSet<String> = HashSet::new();

    // ── Databases (CSV → one note per row) ──────────────────────────────────
    for (base, csv_path) in group_databases(&csv_bodies) {
        // Mark every CSV variant for this database consumed so we don't also
        // treat the plain (non-`_all`) copy as its own database.
        for c in csv_bodies.keys() {
            if database_base(c) == base {
                consumed.insert(c.clone());
            }
        }
        let rows = parse_csv(&csv_bodies[&csv_path]);
        let Some((header, data)) = rows.split_first() else {
            continue;
        };
        if header.is_empty() {
            continue;
        }
        let folder_rel = clean_rel(&base);
        let pages = pages_by_folder.get(&base);
        for row in data {
            let raw_title = row.first().map(String::as_str).unwrap_or("").trim();
            let title = sanitize_segment(raw_title);
            let mut fm = NoteFrontmatter {
                title: Some(title.clone()),
                created: now.clone(),
                modified: now.clone(),
                ..Default::default()
            };
            let mut props = serde_json::Map::new();
            for (col, value) in header.iter().skip(1).zip(row.iter().skip(1)) {
                let value = value.trim();
                if col.trim().is_empty() || value.is_empty() {
                    continue;
                }
                props.insert(col.trim().to_string(), typed_value(value));
            }
            fm.extra = serde_json::Value::Object(props);

            // Adopt the matching row page's body when the export shipped one.
            let body = pages
                .and_then(|m| {
                    m.get(
                        &clean_last_segment(&format!("{raw_title}.md"))
                            .0
                            .to_ascii_lowercase(),
                    )
                })
                .map(|page_path| {
                    consumed.insert(page_path.clone());
                    rewrite_links(&md_bodies[page_path])
                })
                .unwrap_or_default();
            let content = serialize_frontmatter(&fm, &body_with_leading_newline(&body));

            let rel = format!("{IMPORT_ROOT}/{folder_rel}/{title}.md");
            write_unique(vault, &rel, &content, &mut taken)?;
            summary.database_rows += 1;
            summary.notes_imported += 1;
        }
    }

    // ── Standalone Markdown pages (not adopted by a database) ────────────────
    for (path, body) in &md_bodies {
        if consumed.contains(path) {
            continue;
        }
        let rel = format!("{IMPORT_ROOT}/{}", clean_rel(path));
        match write_unique(vault, &rel, &rewrite_links(body), &mut taken) {
            Ok(_) => summary.notes_imported += 1,
            Err(e) => {
                summary.skipped += 1;
                summary.warnings.push(format!("{path}: {e}"));
            }
        }
    }

    // ── Assets (images, PDFs, …) ─────────────────────────────────────────────
    for path in &asset_paths {
        let rel = format!("{IMPORT_ROOT}/{}", clean_rel(path));
        match copy_asset(&mut archive, path, vault, &rel, &mut taken) {
            Ok(()) => summary.assets_copied += 1,
            Err(e) => {
                summary.skipped += 1;
                summary.warnings.push(format!("{path}: {e}"));
            }
        }
    }

    Ok(summary)
}

/// Copy one binary asset out of the archive to a fresh path under `vault`.
fn copy_asset(
    archive: &mut zip::ZipArchive<std::io::BufReader<std::fs::File>>,
    name: &str,
    vault: &Path,
    rel: &str,
    taken: &mut HashSet<String>,
) -> CoreResult<()> {
    let mut entry = archive
        .by_name(name)
        .map_err(|e| CoreError::BadRequest(format!("missing zip entry: {e}")))?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes)?;
    let (abs, _) = super::unique_path(vault, rel, taken)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&abs, &bytes)?;
    Ok(())
}

/// Normalize a zip entry name: forward slashes, no leading slash, no `./`.
fn normalize_entry_name(name: &str) -> String {
    name.replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

/// Skip macOS/Notion cruft that isn't part of the note set.
fn is_ignored(name: &str) -> bool {
    name.starts_with("__MACOSX/")
        || name
            .split('/')
            .any(|seg| seg == ".DS_Store" || seg.starts_with("._"))
}

/// Split `a/b/c.md` into (`a/b`, `c.md`); a bare `c.md` yields (``, `c.md`).
fn split_parent(path: &str) -> (&str, &str) {
    match path.rsplit_once('/') {
        Some((dir, file)) => (dir, file),
        None => ("", path),
    }
}

/// Split a filename into (id-stripped stem, lowercase extension). A name with
/// no recognizable extension yields (`whole name id-stripped`, "").
fn clean_last_segment(file: &str) -> (String, String) {
    match file.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && is_ext(ext) => (
            sanitize_segment(&strip_notion_id(stem)),
            ext.to_ascii_lowercase(),
        ),
        _ => (sanitize_segment(&strip_notion_id(file)), String::new()),
    }
}

/// Whether `ext` looks like a real file extension (1–5 ASCII alphanumerics) as
/// opposed to a dotted word inside a title.
fn is_ext(ext: &str) -> bool {
    (1..=5).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Clean a whole relative path: id-strip + sanitize each segment, preserving the
/// final segment's extension. Percent-encoded input is decoded first.
fn clean_rel(path: &str) -> String {
    let decoded = percent_decode(path);
    let segs: Vec<&str> = decoded.split('/').filter(|s| !s.is_empty()).collect();
    let last = segs.len().saturating_sub(1);
    segs.iter()
        .enumerate()
        .map(|(i, seg)| {
            if i == last {
                let (stem, ext) = clean_last_segment(seg);
                if ext.is_empty() {
                    stem
                } else {
                    format!("{stem}.{ext}")
                }
            } else {
                sanitize_segment(&strip_notion_id(seg))
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Strip a Notion 32-hex-char id suffix (` <hex>` or a bare `<hex>`) off a
/// single name segment. Returns the input unchanged if it has no such suffix.
fn strip_notion_id(stem: &str) -> String {
    let n = stem.len();
    if n < 32 {
        return stem.to_string();
    }
    let tail = &stem[n - 32..];
    if !tail.chars().all(|c| c.is_ascii_hexdigit()) {
        return stem.to_string();
    }
    let head = &stem[..n - 32];
    // Require the id to be its own token: a space before it, or the whole
    // segment being the id — so we never clip a legitimate 32-char word.
    if head.is_empty() {
        String::new()
    } else if let Some(rest) = head.strip_suffix(' ') {
        rest.to_string()
    } else {
        stem.to_string()
    }
}

/// The database-folder base for a CSV path: strip `.csv`, then a trailing
/// `_all` (Notion exports both `DB.csv` and `DB_all.csv` next to the `DB/`
/// row-page folder). Result is the folder's original (hashed) path.
fn database_base(csv_path: &str) -> String {
    let stem = csv_path.strip_suffix(".csv").unwrap_or(csv_path);
    stem.strip_suffix("_all").unwrap_or(stem).to_string()
}

/// Group CSVs by their database folder, choosing the `_all` variant (all rows)
/// when Notion shipped both. Returns folder-base → chosen CSV path.
fn group_databases(csv_bodies: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut chosen: HashMap<String, String> = HashMap::new();
    for path in csv_bodies.keys() {
        let base = database_base(path);
        let prefer = path
            .strip_suffix(".csv")
            .is_some_and(|s| s.ends_with("_all"));
        match chosen.get(&base) {
            Some(existing) if !prefer && existing != path => {}
            _ => {
                // Keep the `_all` variant if we've already seen it.
                let existing_is_all = chosen
                    .get(&base)
                    .and_then(|p| p.strip_suffix(".csv"))
                    .is_some_and(|s| s.ends_with("_all"));
                if !existing_is_all {
                    chosen.insert(base.clone(), path.clone());
                }
            }
        }
    }
    let mut out: Vec<(String, String)> = chosen.into_iter().collect();
    out.sort();
    out
}

/// Rewrite intra-export Markdown links. `.md`/`.csv` targets become
/// `[[Wikilinks]]`; asset targets are re-pointed at their cleaned relative path;
/// external links (`http:`, `mailto:`, `#…`) are left untouched.
fn rewrite_links(md: &str) -> String {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        // (!)? [text] (target)  — target has no spaces (Notion %20-encodes).
        regex::Regex::new(r"(!?)\[([^\]]*)\]\(([^)\s]+)\)").unwrap()
    });
    re.replace_all(md, |caps: &regex::Captures| {
        let bang = &caps[1];
        let text = &caps[2];
        let target = &caps[3];
        if is_external(target) {
            return caps[0].to_string();
        }
        let no_anchor = target.split('#').next().unwrap_or(target);
        let decoded = percent_decode(no_anchor);
        let (_, ext) = clean_last_segment(split_parent(&decoded).1);
        if bang.is_empty() && (ext == "md" || ext == "csv") {
            let title = clean_last_segment(split_parent(&decoded).1).0;
            if text.eq_ignore_ascii_case(&title) || text.is_empty() {
                format!("[[{title}]]")
            } else {
                format!("[[{title}|{text}]]")
            }
        } else {
            let cleaned = encode_spaces(&clean_rel(no_anchor));
            format!("{bang}[{text}]({cleaned})")
        }
    })
    .into_owned()
}

/// Whether a link target points outside the export (or is a bare anchor).
fn is_external(target: &str) -> bool {
    target.starts_with('#')
        || target.starts_with("mailto:")
        || target.starts_with("tel:")
        || target.starts_with("data:")
        || {
            // scheme://… — a colon before the first slash.
            match (target.find(':'), target.find('/')) {
                (Some(c), Some(s)) => c < s,
                (Some(_), None) => true,
                _ => false,
            }
        }
}

/// Decode `%XX` escapes in a URL path. Leaves malformed escapes verbatim; does
/// not touch `+` (Notion encodes spaces as `%20`, not `+`).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Percent-encode only spaces, so a cleaned asset path is a valid Markdown link
/// target. Our sanitizer has already removed every other problematic char.
fn encode_spaces(s: &str) -> String {
    s.replace(' ', "%20")
}

/// Coerce a CSV cell to a typed JSON scalar: integers and floats become numbers
/// (only when they round-trip exactly, so codes like `007` stay text);
/// everything else stays a string.
fn typed_value(s: &str) -> serde_json::Value {
    let t = s.trim();
    if let Ok(n) = t.parse::<i64>() {
        if n.to_string() == t {
            return serde_json::Value::Number(n.into());
        }
    }
    if let Ok(f) = t.parse::<f64>() {
        if f.is_finite() && f.to_string() == t {
            if let Some(num) = serde_json::Number::from_f64(f) {
                return serde_json::Value::Number(num);
            }
        }
    }
    serde_json::Value::String(t.to_string())
}

/// Parse RFC 4180 CSV text into rows of fields (handles quoted fields with
/// embedded commas, newlines, and `""` escapes). A trailing blank line is
/// ignored.
fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            match c {
                '"' => {
                    if chars.peek() == Some(&'"') {
                        field.push('"');
                        chars.next();
                    } else {
                        in_quotes = false;
                    }
                }
                _ => field.push(c),
            }
        } else {
            match c {
                '"' => in_quotes = true,
                ',' => {
                    row.push(std::mem::take(&mut field));
                }
                '\r' => {}
                '\n' => {
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                }
                _ => field.push(c),
            }
        }
    }
    // Flush a final field/row that wasn't newline-terminated.
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    // Drop a trailing empty row from a file ending in a newline.
    if rows.last().is_some_and(|r| r.len() == 1 && r[0].is_empty()) {
        rows.pop();
    }
    // Strip a UTF-8 BOM off the first cell.
    if let Some(first) = rows.first_mut().and_then(|r| r.first_mut()) {
        if let Some(stripped) = first.strip_prefix('\u{feff}') {
            *first = stripped.to_string();
        }
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_notion_id_suffix() {
        assert_eq!(
            strip_notion_id("Roadmap 1a2b3c4d5e6f78901234567890abcdef"),
            "Roadmap"
        );
        // Whole segment is an id (empty title).
        assert_eq!(strip_notion_id("1a2b3c4d5e6f78901234567890abcdef"), "");
        // Not preceded by a space → left alone.
        assert_eq!(strip_notion_id("Note"), "Note");
    }

    #[test]
    fn clean_rel_strips_ids_and_keeps_ext() {
        assert_eq!(
            clean_rel("Parent%20abcdef1234567890abcdef1234567890/Child%20fedcba0987654321fedcba0987654321.md"),
            "Parent/Child.md"
        );
    }

    #[test]
    fn rewrite_md_link_to_wikilink() {
        let md = "See [Sub Page](Sub%20Page%20abcdef1234567890abcdef1234567890.md).";
        assert_eq!(rewrite_links(md), "See [[Sub Page]].");
    }

    #[test]
    fn rewrite_link_with_differing_text_keeps_alias() {
        let md = "[click here](Target%20abcdef1234567890abcdef1234567890.md)";
        assert_eq!(rewrite_links(md), "[[Target|click here]]");
    }

    #[test]
    fn rewrite_leaves_external_and_rewrites_asset() {
        assert_eq!(rewrite_links("[x](https://a.b/c)"), "[x](https://a.b/c)");
        assert_eq!(
            rewrite_links("![](Page%20abcdef1234567890abcdef1234567890/img.png)"),
            "![](Page/img.png)"
        );
    }

    #[test]
    fn csv_parses_quoted_fields() {
        let rows = parse_csv("Name,Note\n\"a, b\",\"line1\nline2\"\nc,d\n");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1], vec!["a, b", "line1\nline2"]);
        assert_eq!(rows[2], vec!["c", "d"]);
    }

    #[test]
    fn typed_value_coerces_numbers_only() {
        assert_eq!(typed_value("42"), serde_json::json!(42));
        assert_eq!(typed_value("3.5"), serde_json::json!(3.5));
        assert_eq!(typed_value("007"), serde_json::json!("007"));
        assert_eq!(typed_value("Done"), serde_json::json!("Done"));
    }

    /// Build a minimal Notion export `.zip` on disk and return its path.
    fn write_fixture_zip(dir: &Path) -> std::path::PathBuf {
        use std::io::Write;
        let zip_path = dir.join("export.zip");
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);

        let mut add = |name: &str, body: &str| {
            zip.start_file(name, opts).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        };
        // A top-level page linking to a database row page and the database itself.
        add(
            "My Page 0123456789abcdef0123456789abcdef.md",
            "# My Page\nSee [Buy milk](Tasks%200123456789abcdef0123456789abcde1/Buy%20milk%20fedcba9876543210fedcba9876543210.md) in [Tasks](Tasks%200123456789abcdef0123456789abcde1.csv).\n",
        );
        // The database CSV (typed columns) and one matching row page.
        add(
            "Tasks 0123456789abcdef0123456789abcde1.csv",
            "Name,Status,Priority\nBuy milk,Todo,2\nWrite report,Done,1\n",
        );
        add(
            "Tasks 0123456789abcdef0123456789abcde1/Buy milk fedcba9876543210fedcba9876543210.md",
            "# Buy milk\nRemember the oat milk.\n",
        );
        zip.finish().unwrap();
        zip_path
    }

    #[test]
    fn end_to_end_strips_ids_rewrites_links_and_maps_csv_properties() {
        use crate::index::{properties, schema, search};

        let tmp = tempfile::tempdir().unwrap();
        let zip_path = write_fixture_zip(tmp.path());
        let vault = tmp.path().join("vault");
        std::fs::create_dir_all(&vault).unwrap();

        let summary = import(&zip_path, &vault).unwrap();
        assert_eq!(summary.database_rows, 2);
        assert_eq!(summary.notes_imported, 3, "2 rows + the standalone page");

        // Hex id suffix stripped from file/dir names.
        let page = std::fs::read_to_string(vault.join("Imported/Notion/My Page.md")).unwrap();
        // Intra-export .md/.csv links rewritten to wikilinks.
        assert!(page.contains("[[Buy milk]]"), "page: {page}");
        assert!(page.contains("[[Tasks]]"), "page: {page}");

        // CSV → one note per row, with the row page's body adopted.
        let row = std::fs::read_to_string(vault.join("Imported/Notion/Tasks/Buy milk.md")).unwrap();
        assert!(row.contains("Status: Todo"), "row: {row}");
        assert!(row.contains("Priority: 2"), "row: {row}");
        assert!(row.contains("Remember the oat milk."), "row: {row}");
        // The unmatched row still becomes a note (no page body).
        assert!(vault.join("Imported/Notion/Tasks/Write report.md").exists());

        // Reindex and confirm the columns land as typed properties in the engine.
        let db = schema::open_db(&tmp.path().join("notes.db")).unwrap();
        search::build_index(&db, &vault).unwrap();
        let props = properties::properties_for(&db, "Imported/Notion/Tasks/Buy milk.md").unwrap();
        let priority = props
            .iter()
            .find(|p| p.key == "Priority")
            .expect("Priority indexed");
        assert_eq!(
            priority.value,
            crate::models::PropertyValue::Number(Some(2.0))
        );
        let status = props
            .iter()
            .find(|p| p.key == "Status")
            .expect("Status indexed");
        assert_eq!(
            status.value,
            crate::models::PropertyValue::Text("Todo".to_string())
        );
    }
}
