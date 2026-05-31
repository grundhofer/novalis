//! Soft-delete: notes are moved into `<data_dir>/trash/` with a `.meta`
//! sidecar recording their original vault-relative path, so they can be
//! restored. Trash lives in app-data, never in the synced vault.

use std::path::Path;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{CoreError, CoreResult};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub original_path: String,
    pub trashed_at: String,
    pub filename: String,
}

/// Move a note to the trash directory inside `data_dir`.
pub fn trash_note(vault: &Path, data_dir: &Path, relative: &str) -> CoreResult<()> {
    let abs = vault.join(relative);
    if !abs.exists() {
        return Err(CoreError::NotFound(format!("Note not found: {relative}")));
    }

    let trash_dir = data_dir.join("trash");
    std::fs::create_dir_all(&trash_dir)?;

    let now = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = abs
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let trash_id = format!("{now}_{filename}");
    let trash_file = trash_dir.join(&trash_id);
    let meta_file = trash_dir.join(format!("{trash_id}.meta"));

    std::fs::rename(&abs, &trash_file)?;
    std::fs::write(&meta_file, relative)?;

    log::info!("trashed {relative} -> {trash_id}");
    Ok(())
}

/// Move an entire folder (and its contents) to trash. The whole subtree is
/// relocated under a single trash id; the `.meta` sidecar stores the original
/// vault-relative folder path so it can be restored as a unit.
pub fn trash_folder(vault: &Path, data_dir: &Path, relative: &str) -> CoreResult<()> {
    let abs = vault.join(relative);
    if !abs.exists() {
        return Err(CoreError::NotFound(format!("Folder not found: {relative}")));
    }

    let trash_dir = data_dir.join("trash");
    std::fs::create_dir_all(&trash_dir)?;

    let now = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let name = abs
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let trash_id = format!("{now}_{name}");
    let trash_path = trash_dir.join(&trash_id);
    let meta_file = trash_dir.join(format!("{trash_id}.meta"));

    // `rename` moves the whole subtree atomically (same filesystem).
    std::fs::rename(&abs, &trash_path)?;
    std::fs::write(&meta_file, relative)?;

    log::info!("trashed folder {relative} -> {trash_id}");
    Ok(())
}

/// List all items in the trash, newest first.
pub fn list_trash(data_dir: &Path) -> CoreResult<Vec<TrashItem>> {
    let trash_dir = data_dir.join("trash");
    if !trash_dir.exists() {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();

    for entry in std::fs::read_dir(&trash_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip .meta files — read them alongside the main file.
        if name.ends_with(".meta") {
            continue;
        }

        let meta_path = trash_dir.join(format!("{name}.meta"));
        let original_path = if meta_path.exists() {
            std::fs::read_to_string(&meta_path).unwrap_or_default()
        } else {
            name.clone()
        };

        // Parse timestamp from the id (first 15 chars: YYYYMMDD_HHMMSS).
        let trashed_at = if name.len() >= 15 {
            name[..15].to_string()
        } else {
            String::new()
        };

        items.push(TrashItem {
            id: name.clone(),
            original_path,
            trashed_at,
            filename: name,
        });
    }

    items.sort_by(|a, b| b.trashed_at.cmp(&a.trashed_at));
    Ok(items)
}

/// Restore a trashed note to its original location. Returns the restored path.
pub fn restore_note(vault: &Path, data_dir: &Path, trash_id: &str) -> CoreResult<String> {
    let trash_dir = data_dir.join("trash");
    let trash_file = trash_dir.join(trash_id);
    let meta_file = trash_dir.join(format!("{trash_id}.meta"));

    if !trash_file.exists() {
        return Err(CoreError::NotFound(format!(
            "Trash item not found: {trash_id}"
        )));
    }

    let original_path = if meta_file.exists() {
        std::fs::read_to_string(&meta_file)?
    } else {
        trash_id.to_string()
    };

    let restore_to = vault.join(&original_path);
    if let Some(parent) = restore_to.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::rename(&trash_file, &restore_to)?;

    if meta_file.exists() {
        let _ = std::fs::remove_file(&meta_file);
    }

    log::info!("restored {trash_id} -> {original_path}");
    Ok(original_path)
}

/// Permanently delete all items in the trash. Returns count of notes deleted.
pub fn empty_trash(data_dir: &Path) -> CoreResult<usize> {
    let trash_dir = data_dir.join("trash");
    if !trash_dir.exists() {
        return Ok(0);
    }

    let mut count = 0;
    for entry in std::fs::read_dir(&trash_dir)? {
        let entry = entry?;
        let is_meta = entry.file_name().to_string_lossy().ends_with(".meta");
        // Trashed folders are directories (see `trash_folder`); notes/meta are files.
        if entry.file_type()?.is_dir() {
            std::fs::remove_dir_all(entry.path())?;
        } else {
            std::fs::remove_file(entry.path())?;
        }
        if !is_meta {
            count += 1;
        }
    }

    log::info!("emptied trash: {count} items permanently deleted");
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dirs() -> (std::path::PathBuf, std::path::PathBuf) {
        let base =
            std::env::temp_dir().join(format!("novalis-trash-test-{}", uuid::Uuid::new_v4()));
        let vault = base.join("vault");
        let data = base.join("data");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        (vault, data)
    }

    #[test]
    fn trash_folder_moves_subtree_and_restores_as_unit() {
        let (vault, data) = temp_dirs();
        std::fs::create_dir_all(vault.join("Projects/Sub")).unwrap();
        std::fs::write(vault.join("Projects/a.md"), "a").unwrap();
        std::fs::write(vault.join("Projects/Sub/b.md"), "b").unwrap();

        trash_folder(&vault, &data, "Projects").unwrap();
        assert!(
            !vault.join("Projects").exists(),
            "folder should leave the vault"
        );

        let items = list_trash(&data).unwrap();
        assert_eq!(items.len(), 1, "trashed folder is a single entry");
        assert_eq!(items[0].original_path, "Projects");

        let restored = restore_note(&vault, &data, &items[0].id).unwrap();
        assert_eq!(restored, "Projects");
        assert!(vault.join("Projects/a.md").exists());
        assert!(vault.join("Projects/Sub/b.md").exists());

        std::fs::remove_dir_all(vault.parent().unwrap()).ok();
    }

    #[test]
    fn empty_trash_removes_trashed_folders() {
        let (vault, data) = temp_dirs();
        std::fs::create_dir_all(vault.join("Archive")).unwrap();
        std::fs::write(vault.join("Archive/note.md"), "x").unwrap();
        std::fs::write(vault.join("loose.md"), "y").unwrap();

        trash_folder(&vault, &data, "Archive").unwrap();
        trash_note(&vault, &data, "loose.md").unwrap();

        // 2 items (a directory + a file); empty_trash must handle both.
        let count = empty_trash(&data).unwrap();
        assert_eq!(count, 2);
        assert_eq!(list_trash(&data).unwrap().len(), 0);

        std::fs::remove_dir_all(vault.parent().unwrap()).ok();
    }
}
