//! Storage for user-defined AI prompt templates, kept as `.md` files. The file
//! name (without extension) is the display name; the contents are the prompt.
//! Each template is either **global** (app config dir — every vault) or
//! **vault** (`<vault>/.novalis/ai-prompts/`, synced with the vault via git like
//! `config.json`). Plain files the user can open, edit, and share. These
//! functions operate on an already-resolved directory; the caller picks it.

use std::path::{Path, PathBuf};

use novalis_core::models::{AiTemplate, AiTemplateScope};
use novalis_core::vault::config::CONFIG_DIR;

use crate::engine::CommandError;

/// Sub-directory name used under both the app config dir and a vault's
/// `.novalis/`.
pub const SUBDIR: &str = "ai-prompts";

/// The per-vault templates directory.
pub fn vault_dir(vault: &Path) -> PathBuf {
    vault.join(CONFIG_DIR).join(SUBDIR)
}

/// Turn a display name into a safe single-segment file name (no path parts).
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Templates in `dir`, each tagged with `scope`. Missing folder → empty list.
pub fn list(dir: &Path, scope: AiTemplateScope) -> Result<Vec<AiTemplate>, CommandError> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let name = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or(file_name)
            .to_string();
        let body = std::fs::read_to_string(&path).unwrap_or_default();
        out.push(AiTemplate {
            id: file_name.to_string(),
            name,
            body,
            scope,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Create or overwrite the template named `name` with `body` in `dir`.
pub fn save(dir: &Path, name: &str, body: &str) -> Result<(), CommandError> {
    std::fs::create_dir_all(dir)
        .map_err(|e| CommandError::internal(format!("create ai-prompts dir: {e}")))?;
    let path = dir.join(format!("{}.md", sanitize(name)));
    std::fs::write(&path, body).map_err(|e| CommandError::internal(format!("write template: {e}")))
}

/// Delete the template with file name `id` in `dir`. No-op if already gone.
pub fn delete(dir: &Path, id: &str) -> Result<(), CommandError> {
    // Only ever touch a bare file name inside the templates dir (no traversal).
    let Some(file) = Path::new(id).file_name().and_then(|n| n.to_str()) else {
        return Ok(());
    };
    let path = dir.join(file);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(CommandError::internal(format!("delete template: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fresh unique dir under the OS temp dir (same no-dev-deps pattern as
    /// `crate::commands::tests`).
    fn tmp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("novalis-tpl-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn save_creates_a_template_and_list_round_trips_it() {
        let root = tmp_dir();
        let dir = root.join("ai-prompts"); // exercise the create_dir_all path
        save(&dir, "Meeting Notes", "Summarize {selection}").unwrap();

        let listed = list(&dir, AiTemplateScope::Vault).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "Meeting Notes.md");
        assert_eq!(listed[0].name, "Meeting Notes");
        assert_eq!(listed[0].body, "Summarize {selection}");
        assert_eq!(listed[0].scope, AiTemplateScope::Vault);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn save_sanitizes_hostile_names_into_the_dir() {
        let dir = tmp_dir();
        save(&dir, "../escape", "x").unwrap();
        save(&dir, "..", "y").unwrap();
        save(&dir, "a/b\\c:d", "z").unwrap();

        // Everything must land INSIDE dir; nothing above it.
        let entries: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(entries.iter().all(|n| n.ends_with(".md")));
        // "../escape" → path separators stripped, dots trimmed.
        assert!(entries.iter().any(|n| n.contains("escape")));
        // ".." sanitizes to the fallback name rather than a parent reference.
        assert!(entries.iter().any(|n| n == "untitled.md"));
        assert!(!dir.parent().unwrap().join("escape.md").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_ignores_traversal_in_hostile_ids() {
        let root = tmp_dir();
        let dir = root.join("ai-prompts");
        std::fs::create_dir_all(&dir).unwrap();
        // A sibling file OUTSIDE the templates dir that hostile ids aim at.
        let victim = root.join("victim.md");
        std::fs::write(&victim, "precious").unwrap();

        delete(&dir, "../victim.md").unwrap();
        assert!(
            victim.exists(),
            "relative traversal must not escape the dir"
        );

        delete(&dir, victim.to_str().unwrap()).unwrap();
        assert!(
            victim.exists(),
            "an absolute id must not delete outside the dir"
        );

        delete(&dir, "..").unwrap();
        assert!(root.exists(), "an id without a file name is a no-op");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_removes_only_the_named_template_and_tolerates_missing_ones() {
        let dir = tmp_dir();
        save(&dir, "keep", "k").unwrap();
        save(&dir, "gone", "g").unwrap();

        delete(&dir, "gone.md").unwrap();
        assert!(!dir.join("gone.md").exists());
        assert!(dir.join("keep.md").exists());

        // Already gone → still Ok (idempotent).
        delete(&dir, "gone.md").unwrap();

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_skips_non_markdown_and_sorts_case_insensitively() {
        let dir = tmp_dir();
        save(&dir, "beta", "2").unwrap();
        save(&dir, "Alpha", "1").unwrap();
        std::fs::write(dir.join("notes.txt"), "not a template").unwrap();

        let listed = list(&dir, AiTemplateScope::Global).unwrap();
        let names: Vec<&str> = listed.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "beta"]);

        // A missing directory lists as empty rather than erroring.
        assert!(list(&dir.join("missing"), AiTemplateScope::Global)
            .unwrap()
            .is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
