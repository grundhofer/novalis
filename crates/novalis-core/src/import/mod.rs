//! Importers that bring third-party note archives into the vault as plain
//! Markdown + YAML frontmatter, so switchers from Notion and Evernote land in a
//! form the query engine, wikilinks, and tasks already understand.
//!
//! Every importer writes into its own subfolder under `Imported/` and never
//! overwrites an existing vault file: name collisions are resolved by appending
//! a numeric suffix (see [`unique_path`]). The caller reindexes afterwards.

pub mod enex;
pub mod notion;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::CoreResult;
use crate::vault::fs::{vault_rel, write_atomic};

/// Summary of a single import run, surfaced to the UI.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    /// Vault-relative folder the import landed in (e.g. `Imported/Notion`).
    pub folder: String,
    /// Markdown notes written.
    pub notes_imported: u32,
    /// Database rows expanded into their own note (Notion CSV → one note/row).
    pub database_rows: u32,
    /// Non-note assets (images, PDFs) copied alongside the notes.
    pub assets_copied: u32,
    /// Files skipped (unsupported/empty/unreadable) — count matches `warnings`.
    pub skipped: u32,
    /// Human-readable warnings worth surfacing (one per skipped item).
    pub warnings: Vec<String>,
}

/// Sanitize one path segment for safe use as a vault file/dir name: drop the
/// characters that are illegal on common filesystems and collapse whitespace.
/// Never returns an empty string (falls back to `Untitled`).
pub(crate) fn sanitize_segment(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        "Untitled".to_string()
    } else {
        collapsed
    }
}

/// Resolve `rel` under `vault`, appending ` (2)`, ` (3)`, … before the
/// extension until the path is free — both on disk and against `taken` (paths
/// this run has already claimed but not yet written). Guards against escaping
/// the vault. Returns the absolute path and its vault-relative form.
pub(crate) fn unique_path(
    vault: &Path,
    rel: &str,
    taken: &mut HashSet<String>,
) -> CoreResult<(PathBuf, String)> {
    let (stem, ext) = split_ext(rel);
    let mut candidate = rel.to_string();
    let mut n = 2;
    loop {
        let abs = vault_rel(vault, &candidate)?;
        if !abs.exists() && !taken.contains(&candidate) {
            taken.insert(candidate.clone());
            return Ok((abs, candidate));
        }
        candidate = match &ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        n += 1;
    }
}

/// Split a `path/to/name.ext` into (`path/to/name`, `Some(ext)`), or
/// (`path`, `None`) when the final segment has no extension.
fn split_ext(rel: &str) -> (String, Option<String>) {
    let (dir, file) = match rel.rsplit_once('/') {
        Some((d, f)) => (Some(d), f),
        None => (None, rel),
    };
    match file.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => {
            let stem = match dir {
                Some(d) => format!("{d}/{s}"),
                None => s.to_string(),
            };
            (stem, Some(e.to_string()))
        }
        _ => (rel.to_string(), None),
    }
}

/// Ensure a note body starts on its own line under the frontmatter fence (and
/// is empty when there is no body at all).
pub(crate) fn body_with_leading_newline(body: &str) -> String {
    if body.is_empty() {
        String::new()
    } else if body.starts_with('\n') {
        body.to_string()
    } else {
        format!("\n{body}")
    }
}

/// Write `contents` to a fresh, collision-free path under `vault` and mark it
/// taken. Creates parent directories. Returns the vault-relative path written.
pub(crate) fn write_unique(
    vault: &Path,
    rel: &str,
    contents: &str,
    taken: &mut HashSet<String>,
) -> CoreResult<String> {
    let (abs, rel) = unique_path(vault, rel, taken)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    write_atomic(&abs, contents)?;
    Ok(rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_illegal_and_collapses() {
        assert_eq!(sanitize_segment("a/b:c*?"), "a b c");
        assert_eq!(sanitize_segment("  spaced   out  "), "spaced out");
        assert_eq!(sanitize_segment("///"), "Untitled");
    }

    #[test]
    fn unique_path_appends_suffix_on_collision() {
        let tmp = tempfile::tempdir().unwrap();
        let vault = tmp.path();
        let mut taken = HashSet::new();
        let (_, first) = unique_path(vault, "Imported/Note.md", &mut taken).unwrap();
        assert_eq!(first, "Imported/Note.md");
        let (_, second) = unique_path(vault, "Imported/Note.md", &mut taken).unwrap();
        assert_eq!(second, "Imported/Note (2).md");
    }

    #[test]
    fn unique_path_rejects_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let mut taken = HashSet::new();
        assert!(unique_path(tmp.path(), "../evil.md", &mut taken).is_err());
    }
}
