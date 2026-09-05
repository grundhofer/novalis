//! One watcher per open vault, one batch event per debounce window.
//!
//! PLAN.md §2.3 rule 5: FSEvents (never kqueue, which opens a descriptor per
//! file and hydrates cloud-only files), 100 ms debounce, rename stitching, and
//! exactly one `fs-batch` per window so the UI patches its in-memory tree
//! instead of refetching. Rule 4/§5.3 step 4: an event that matches a write we
//! made ourselves is dropped here.
//!
//! Nothing in this file reads a file body, so a cloud-only placeholder is
//! never materialized by the watcher.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer_opt, DebouncedEvent, Debouncer, RecommendedCache};
use novalis_core::boards;
use novalis_core::vault::fs::{stat, EntryKind};
use novalis_core::vault::path::rel_of;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;

use crate::dto::EntryDto;
use crate::state::OwnWrites;

/// PLAN.md §4.2.
const DEBOUNCE: Duration = Duration::from_millis(100);

// FSEvents is pinned explicitly instead of taking `RecommendedWatcher`: on
// macOS they are the same type today, and this line is what keeps them the
// same tomorrow. Linux is built by CI but does not ship (PLAN.md §4.5).
#[cfg(target_os = "macos")]
type VaultWatcher = notify::FsEventWatcher;
#[cfg(not(target_os = "macos"))]
type VaultWatcher = notify::RecommendedWatcher;

/// A stitched rename, both sides vault-relative.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FsRename {
    pub from: String,
    pub to: String,
}

/// One debounce window's worth of changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct FsBatch {
    pub added: Vec<EntryDto>,
    pub modified: Vec<EntryDto>,
    pub removed: Vec<String>,
    pub renamed: Vec<FsRename>,
}

impl FsBatch {
    fn is_empty(&self) -> bool {
        self.added.is_empty()
            && self.modified.is_empty()
            && self.removed.is_empty()
            && self.renamed.is_empty()
    }
}

/// Dropping this stops the watcher thread.
#[derive(Debug)]
pub struct WatcherHandle {
    _debouncer: Debouncer<VaultWatcher, RecommendedCache>,
}

/// Names the watcher never reports: dot-files and `.novalis/` (our own marker
/// and the legacy config), editor temp files, and the hidden temp file
/// `write_atomic` renames into place.
fn ignored(rel: &str) -> bool {
    rel.split('/')
        .any(|part| part.starts_with('.') || part.starts_with('~') || part.ends_with(".tmp"))
}

/// Build a tree row for a path that still exists, plus the raw
/// `(mtime_ns, size)` the self-write check compares. `stat` is `lstat` only,
/// so a cloud-only placeholder stays dataless.
fn entry_of(root: &Path, rel: &str) -> Option<(EntryDto, i64, u64)> {
    let abs = root.join(rel);
    let st = stat(&abs).ok()?;
    if st.kind == EntryKind::Symlink {
        return None;
    }
    let board_slug = if st.kind == EntryKind::Dir {
        rel.strip_prefix(&format!("{}/", boards::BOARDS_DIR))
            .filter(|slug| !slug.contains('/') && boards::is_board_dir(&abs))
            .map(str::to_string)
    } else {
        None
    };
    Some((
        EntryDto::from_stat(rel.to_string(), &st, board_slug),
        st.mtime_ns,
        st.size,
    ))
}

fn to_batch(root: &Path, own: &Arc<Mutex<OwnWrites>>, events: Vec<DebouncedEvent>) -> FsBatch {
    let mut batch = FsBatch {
        added: Vec::new(),
        modified: Vec::new(),
        removed: Vec::new(),
        renamed: Vec::new(),
    };
    let mut own = own.lock().unwrap_or_else(|e| e.into_inner());

    for event in events {
        let rels: Vec<String> = event
            .paths
            .iter()
            .filter_map(|p| rel_of(root, p))
            .filter(|rel| !rel.is_empty() && !ignored(rel))
            .collect();
        if rels.is_empty() {
            continue;
        }
        match event.kind {
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if rels.len() == 2 => {
                own.forget(&rels[0]);
                own.forget(&rels[1]);
                batch.renamed.push(FsRename {
                    from: rels[0].clone(),
                    to: rels[1].clone(),
                });
                if let Some((entry, _, _)) = entry_of(root, &rels[1]) {
                    batch.modified.push(entry);
                }
            }
            EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                for rel in rels {
                    match entry_of(root, &rel) {
                        Some((entry, _, _)) => batch.added.push(entry),
                        None => batch.removed.push(rel),
                    }
                }
            }
            EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                for rel in rels {
                    own.forget(&rel);
                    batch.removed.push(rel);
                }
            }
            _ => {
                for rel in rels {
                    match entry_of(root, &rel) {
                        // §5.3 step 4: our own write, already reflected in the
                        // editor and the tree — drop it.
                        Some((_, mtime_ns, size)) if own.take_if_ours(&rel, mtime_ns, size) => {}
                        Some((entry, _, _)) => batch.modified.push(entry),
                        None => batch.removed.push(rel),
                    }
                }
            }
        }
    }

    // FSEvents coalesces per directory, so the same path can appear twice in
    // one window. The UI applies the batch as a patch; duplicates would make it
    // do the same work twice.
    batch.added.sort_by(|a, b| a.path.cmp(&b.path));
    batch.added.dedup_by(|a, b| a.path == b.path);
    batch.modified.sort_by(|a, b| a.path.cmp(&b.path));
    batch.modified.dedup_by(|a, b| a.path == b.path);
    batch.removed.sort();
    batch.removed.dedup();
    // A path that was recreated inside the same window is an add, not a remove.
    batch
        .removed
        .retain(|rel| !batch.added.iter().any(|e| &e.path == rel));
    batch
        .modified
        .retain(|e| !batch.added.iter().any(|a| a.path == e.path));
    batch
}

/// Start watching `root`. The returned handle must stay alive; dropping it
/// stops the watcher.
pub fn spawn(
    app: AppHandle,
    root: PathBuf,
    own: Arc<Mutex<OwnWrites>>,
) -> notify::Result<WatcherHandle> {
    let emit_root = root.clone();
    let handler = move |result: notify_debouncer_full::DebounceEventResult| {
        let events = match result {
            Ok(events) => events,
            // A watcher error (a folder vanished, the queue overflowed) is not
            // actionable in the UI and must not kill the thread: the next
            // window recovers. Nothing is logged — no telemetry, no log file.
            Err(_) => return,
        };
        let batch = to_batch(&emit_root, &own, events);
        if !batch.is_empty() {
            let _ = batch.emit(&app);
        }
    };

    let mut debouncer = new_debouncer_opt::<_, VaultWatcher, RecommendedCache>(
        DEBOUNCE,
        None,
        handler,
        RecommendedCache::new(),
        notify::Config::default(),
    )?;
    debouncer.watch(&root, RecursiveMode::Recursive)?;
    Ok(WatcherHandle {
        _debouncer: debouncer,
    })
}

#[cfg(test)]
mod tests {
    use super::ignored;

    #[test]
    fn hidden_and_temp_paths_are_ignored() {
        assert!(ignored(".novalis/vault.json"));
        assert!(ignored("notes/.DS_Store"));
        assert!(ignored("notes/.note.md.tmp"));
        assert!(ignored("notes/~lock"));
        assert!(!ignored("notes/Wochenrückblick.md"));
        assert!(!ignored("boards/kanban/board.json"));
    }
}
