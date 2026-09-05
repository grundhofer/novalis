//! Vault walk: readdir + lstat only, hidden names and symlinks skipped,
//! never canonicalize, never read bodies. Shared by the cache, search,
//! relink and migrate.

use std::path::Path;

use crate::error::CoreResult;
use crate::vault::fs::{list_dir, EntryKind};
use crate::vault::path::{is_hidden, is_note_name, join_rel};

/// One file found by [`walk_files`]; `path` is vault-relative and NFC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalkedFile {
    pub path: String,
    pub size: u64,
    pub mtime_ns: i64,
    pub cloud_only: bool,
}

/// Every regular file below `root` (hidden names and symlinks skipped),
/// sorted by path.
pub fn walk_files(root: &Path) -> CoreResult<Vec<WalkedFile>> {
    let mut out = Vec::new();
    let mut stack: Vec<String> = vec![String::new()];
    while let Some(folder) = stack.pop() {
        let dir = if folder.is_empty() {
            root.to_path_buf()
        } else {
            root.join(&folder)
        };
        for e in list_dir(&dir)? {
            if is_hidden(&e.name) {
                continue;
            }
            match e.kind {
                EntryKind::Dir => stack.push(join_rel(&folder, &e.name)),
                EntryKind::File => out.push(WalkedFile {
                    path: join_rel(&folder, &e.name),
                    size: e.size,
                    mtime_ns: e.mtime_ns,
                    cloud_only: e.cloud_only,
                }),
                _ => {}
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Only the `.md` notes of [`walk_files`].
pub fn walk_notes(root: &Path) -> CoreResult<Vec<WalkedFile>> {
    let mut files = walk_files(root)?;
    files.retain(|f| is_note_name(&f.path));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walk_skips_hidden_and_symlinks_and_sorts() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        std::fs::create_dir_all(root.join("b/.hidden")).unwrap();
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::fs::write(root.join("z.md"), "").unwrap();
        std::fs::write(root.join("a/y.md"), "").unwrap();
        std::fs::write(root.join("a/notes.txt"), "").unwrap();
        std::fs::write(root.join("b/.hidden/x.md"), "").unwrap();
        std::fs::write(root.join(".secret.md"), "").unwrap();
        std::os::unix::fs::symlink(root.join("z.md"), root.join("link.md")).unwrap();
        let all: Vec<String> = walk_files(&root)
            .unwrap()
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert_eq!(all, vec!["a/notes.txt", "a/y.md", "z.md"]);
        let notes: Vec<String> = walk_notes(&root)
            .unwrap()
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert_eq!(notes, vec!["a/y.md", "z.md"]);
    }
}
