//! The whole IPC surface: 28 commands (PLAN.md §2.3 rule 8 caps it at 30).
//!
//! Every command is `async` and does its filesystem work inside
//! `spawn_blocking`, so a slow OneDrive hydration blocks one pool thread and
//! nothing else (rule 6). None of them holds the state lock across IO: they
//! copy the vault root out of the state and then work on their own. The one
//! lock that is held across IO is `board_read`'s per-board lock, which only a
//! second read of the same board ever waits for.
//!
//! The materialize-off guard is *not* applied here. These are explicit user
//! actions running under the default policy, which is exactly what §2.3 rule 7
//! requires; the guarded paths (`walk`, `search`, `relink`) apply it inside
//! `novalis_core` for the duration of their own work.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use novalis_core::boards::{self, CardChange, Column, NewCard, Position};
use novalis_core::cache::Cache;
use novalis_core::migrate;
use novalis_core::notes::relink::{relink_many, RelinkOptions, RelinkSpec};
use novalis_core::search::{self, SearchHit};
use novalis_core::settings::Settings;
use novalis_core::util::{hostname, local_now};
use novalis_core::vault::archive;
use novalis_core::vault::cloud::{self, vault_kind};
use novalis_core::vault::fs::{self, DirEntry, EntryKind, Precondition};
use novalis_core::vault::path::{
    file_name_of, is_hidden, is_note_name, join_rel, nfc, normalize_rel, rel_of, stem_of,
    vault_note_rel, vault_rel,
};
use novalis_core::vault::walk::walk_files;
use novalis_core::{CoreError, PathReason};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::dto::*;
use crate::error::{IpcError, IpcResult};
use crate::file_types::Kind;
use crate::i18n::{resolve_locale, Catalog};
use crate::state::{AppState, BoardRead, MenuShape};
use crate::{cache, file_types, menu, watcher};

/// Hits are posted in groups: a 10k-note vault otherwise sends 10k messages
/// and the UI thread spends the whole search doing React updates.
const SEARCH_BATCH: usize = 64;

// ---------------------------------------------------------------- helpers

/// Run blocking filesystem work off the UI-facing async runtime.
async fn blocking<T, F>(f: F) -> IpcResult<T>
where
    F: FnOnce() -> IpcResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| IpcError::internal(format!("worker thread failed: {e}")))?
}

/// Sort a directory listing the way the tree shows it: folders first, then
/// name ascending (PLAN.md §4.2). Hidden entries and symlinks never appear.
fn visible_entries(root: &Path, folder: &str) -> IpcResult<Vec<EntryDto>> {
    let dir = vault_rel(root, folder)?;
    let mut entries: Vec<DirEntry> = fs::list_dir(&dir)?
        .into_iter()
        .filter(|e| !e.is_hidden() && e.kind != EntryKind::Symlink && e.kind != EntryKind::Other)
        .collect();
    entries.sort_by(|a, b| {
        let dir_a = a.kind == EntryKind::Dir;
        let dir_b = b.kind == EntryKind::Dir;
        dir_b.cmp(&dir_a).then_with(|| a.name.cmp(&b.name))
    });
    // A directory directly under `boards/` is a board only if it holds a valid
    // `board.json`; anything else there is an ordinary folder (PLAN.md §5.5).
    let in_boards_dir = folder == boards::BOARDS_DIR;
    // Conflict-copy detection belongs to the core, which owns the four naming
    // patterns; the UI used to guess with a narrower regex of its own, so its
    // count and `novalis doctor`'s disagreed. One directory listing is exactly
    // the context the classifier needs: it asks whether the original sibling
    // is present.
    let names: std::collections::HashSet<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    Ok(entries
        .iter()
        .map(|entry| {
            let slug = if in_boards_dir
                && entry.kind == EntryKind::Dir
                && boards::is_board_dir(&dir.join(&entry.name))
            {
                Some(entry.name.clone())
            } else {
                None
            };
            let conflict_of = if entry.kind == EntryKind::Dir {
                None
            } else {
                novalis_core::vault::cloud::conflict_copy_candidate(
                    &entry.name,
                    |sibling| names.contains(sibling),
                    Some(hostname().as_str()),
                )
                .map(|(original, _kind)| join_rel(folder, &original))
            };
            EntryDto::from_dir_entry(folder, entry, slug, conflict_of)
        })
        .collect())
}

/// Read a vault root without touching any shell state: metadata, the board
/// list and the root listing. Safe to run on a pool thread.
fn scan_vault(root: &Path) -> IpcResult<VaultOpenDto> {
    let meta = std::fs::metadata(root).map_err(|e| CoreError::from_io(root, e))?;
    if !meta.is_dir() {
        return Err(IpcError::bad_request("vault path is not a directory"));
    }
    let board_refs = boards::list_boards(root)
        .unwrap_or_default()
        .iter()
        .map(BoardRefDto::from)
        .collect();
    Ok(VaultOpenDto {
        vault: VaultDto {
            root: root.to_string_lossy().to_string(),
            name: root
                .file_name()
                .map(|n| nfc(&n.to_string_lossy()))
                .unwrap_or_default(),
            kind: vault_kind(root).into(),
            boards: board_refs,
            legacy: root.join(migrate::LEGACY_CONFIG).is_file()
                && migrate::migrated_stamp(root).is_none(),
        },
        tree: visible_entries(root, "")?,
    })
}

/// Install a scanned vault: start its watcher and remember it as `lastVault`.
fn attach_vault(app: &AppHandle, state: &AppState, root: PathBuf) -> IpcResult<()> {
    // The cache actor first: the watcher asks it to rescan, and its first scan
    // runs on its own thread so opening a vault never waits for it.
    let cache = cache::spawn(app.clone(), state.cache_dir(), root.clone());
    let handle = watcher::spawn(
        app.clone(),
        root.clone(),
        state.own_writes.clone(),
        cache.rescan(),
    )
    .map_err(|e| IpcError::internal(format!("watcher: {e}")))?;
    state.set_vault(Some(root.clone()), Some(handle), Some(cache));

    let mut settings = state.settings();
    settings.last_vault = Some(root.to_string_lossy().to_string());
    settings.save(&state.settings_path())?;
    state.set_settings(settings);
    Ok(())
}

pub(crate) fn read_ui_state(path: &Path) -> UiStateDto {
    let Ok(text) = std::fs::read_to_string(path) else {
        return UiStateDto::default();
    };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return UiStateDto::default();
    };
    // The file is parsed as a whole and a failure resets all of it — tabs,
    // sidebar, board — so a `treeSort` this build does not know (a later
    // build's, or a hand edit) is dropped first and reads as the default.
    // (`serde(other)` on the enum would do the same, but specta refuses it
    // on an externally tagged enum, and `deserialize_with` splits the DTO
    // into two wire types.)
    if let Some(state) = value.as_object_mut() {
        let unknown = state
            .get("treeSort")
            .is_some_and(|sort| serde_json::from_value::<TreeSortDto>(sort.clone()).is_err());
        if unknown {
            state.remove("treeSort");
        }
    }
    serde_json::from_value(value).unwrap_or_default()
}

/// Write `state.json` atomically. `quit` is a request, not state: it never
/// reaches the file.
pub(crate) fn write_ui_state(path: &Path, ui_state: &UiStateDto) -> Result<(), CoreError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CoreError::from_io(parent, e))?;
    }
    let mut value = serde_json::to_value(ui_state).map_err(CoreError::from)?;
    if let Some(fields) = value.as_object_mut() {
        fields.remove("quit");
    }
    let mut bytes = serde_json::to_vec_pretty(&value).map_err(CoreError::from)?;
    bytes.push(b'\n');
    fs::write_atomic(path, &bytes, None)?;
    Ok(())
}

/// Rebuild the native menu, but only when something it shows has changed.
///
/// Every caller is an `async` command, so this runs on a worker thread, and
/// AppKit requires the application menu to be replaced on the main thread. The
/// rebuild is handed there explicitly rather than relying on the platform layer
/// to forward it.
fn refresh_menu(app: &AppHandle, state: &AppState, settings: &Settings, ui_state: &UiStateDto) {
    let shape = MenuShape {
        language: settings.language,
        appearance: settings.appearance,
        spellcheck: settings.spellcheck,
        sidebar_visible: ui_state.sidebar_visible,
        board_visible: ui_state.board_visible,
    };
    if !state.menu_needs_rebuild(shape) {
        return;
    }
    let catalog = Catalog::load(resolve_locale(settings.language));
    let settings = settings.clone();
    let flags = menu::MenuFlags {
        sidebar_visible: ui_state.sidebar_visible,
        board_visible: ui_state.board_visible,
    };
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = menu::install(&handle, &catalog, &settings, flags);
    });
}

/// A board and its cards as they are on disk. A read, nothing else: what the
/// files say is what the pane shows, and a file the reader cannot use is named
/// in `unreadable` rather than dropped.
fn board_snapshot(root: &Path, slug: String) -> IpcResult<BoardDto> {
    let doc = boards::read_board(root, &slug)?;
    cards_snapshot(root, slug, &doc.board)
}

/// The card half of [`board_snapshot`], for a caller that has read `board.json`
/// already.
fn cards_snapshot(root: &Path, slug: String, board: &boards::Board) -> IpcResult<BoardDto> {
    let (cards, cloud_only, unreadable) = boards::list_cards_lenient(root, &slug)?;
    let cards = cards
        .iter()
        .filter(|c| !c.card.is_deleted())
        .map(|c| CardDto::from(&c.card))
        .collect();
    let mut dto = BoardDto::new(slug, board, cards, cloud_only);
    dto.unreadable = unreadable;
    Ok(dto)
}

// ---------------------------------------------------------------- 1. bootstrap

/// Everything the first paint needs, in one call (PLAN.md §2.3 rule 8).
/// The tree is the root listing only; sub-folders are fetched by `list_dir`
/// when they open, so first paint never waits for a walk (rule 1).
#[tauri::command]
#[specta::specta]
pub async fn bootstrap(app: AppHandle, state: State<'_, AppState>) -> IpcResult<BootstrapDto> {
    let settings = state.settings();
    let ui_state = read_ui_state(&state.ui_state_path());
    let locale = resolve_locale(settings.language).to_string();

    let mut vault = None;
    let mut tree = Vec::new();
    if let Some(root) = settings.last_vault.as_deref().map(PathBuf::from) {
        let scan_root = root.clone();
        // A vault that moved or lives on an unmounted volume must not stop the
        // app from starting: the UI shows the "open a vault" empty state.
        if let Ok(open) = blocking(move || scan_vault(&scan_root)).await {
            if attach_vault(&app, &state, root).is_ok() {
                vault = Some(open.vault);
                tree = open.tree;
            }
        }
    }

    Ok(BootstrapDto {
        settings: SettingsDto::from(&settings),
        vault,
        tree,
        last_open: ui_state,
        locale,
        perf: std::env::var("NOVALIS_PERF").ok().filter(|v| !v.is_empty()),
    })
}

// ---------------------------------------------------------------- 2. vault

/// The one dialog the app opens. Returns `None` when the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn open_vault_dialog(app: AppHandle) -> IpcResult<Option<String>> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| IpcError::internal(format!("dialog: {e}")))?;
    Ok(picked.map(|p| p.to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn open_vault(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> IpcResult<VaultOpenDto> {
    let root = PathBuf::from(path);
    let scan_root = root.clone();
    let open = blocking(move || scan_vault(&scan_root)).await?;
    attach_vault(&app, &state, root)?;
    Ok(open)
}

// ---------------------------------------------------------------- 3. tree

#[tauri::command]
#[specta::specta]
pub async fn list_dir(state: State<'_, AppState>, path: String) -> IpcResult<Vec<EntryDto>> {
    let root = state.require_vault()?;
    blocking(move || {
        let folder = if path.is_empty() {
            String::new()
        } else {
            normalize_rel(&path)?
        };
        visible_entries(&root, &folder)
    })
    .await
}

/// Every regular file in the vault, vault-relative and sorted — not only
/// notes (ADR-0022): quick-open lists every file the tree would, and the
/// `[[`-completion source keeps the `.md` among them. The UI applies the
/// file-type table; the shell hands over the walk, because the table's name
/// patterns are the UI's to run. The tree only knows the folders the user
/// has opened. `walk_files` runs under the materialize-off guard and stats
/// only, so a 10k-note cloud vault costs no downloads.
#[tauri::command]
#[specta::specta]
pub async fn list_files(state: State<'_, AppState>) -> IpcResult<Vec<String>> {
    let root = state.require_vault()?;
    blocking(move || {
        Ok(walk_files(&root)?
            .into_iter()
            .map(|file| file.path)
            .collect())
    })
    .await
}

// ---------------------------------------------------------------- 4. files

#[tauri::command]
#[specta::specta]
pub async fn read_file(state: State<'_, AppState>, path: String) -> IpcResult<FileDto> {
    let root = state.require_vault()?;
    blocking(move || {
        let rel = normalize_rel(&path)?;
        let abs = vault_rel(&root, &rel)?;
        // Explicit open: a cloud-only note is downloaded here on purpose
        // (§4.5 "downloaded on open"), with a deadline (§2.3 rule 7). A binary
        // file is read no further than the NUL that decides it.
        download_for_open(&abs, &rel)?;
        Ok(FileDto::from_read(rel, fs::read_text(&abs)?))
    })
    .await
}

/// How long an explicit open waits for a cloud-only file (§2.3 rule 7).
const OPEN_DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// A cloud-only file is downloaded before it is read, for at most
/// [`OPEN_DOWNLOAD_TIMEOUT`]: the read itself would block on the File
/// Provider without end, and an offline Mac would leave the click, or the
/// session restore at launch, waiting forever. The stat decides without
/// downloading anything.
fn download_for_open(abs: &Path, rel: &str) -> IpcResult<()> {
    if !fs::stat(abs)?.cloud_only {
        return Ok(());
    }
    match cloud::materialize_within(abs, OPEN_DOWNLOAD_TIMEOUT) {
        Some(result) => Ok(result?),
        None => Err(IpcError::materialize_timeout(rel)),
    }
}

/// Read a file the viewer shows as it is — a PDF or an image (ADR-0015).
/// Same explicit-open rule as `read_file`: a cloud-only file is downloaded
/// here on purpose. Anything above [`HUGE_FILE_BYTES`] is refused rather
/// than sent through the IPC as one string.
#[tauri::command]
#[specta::specta]
pub async fn read_blob(state: State<'_, AppState>, path: String) -> IpcResult<BlobDto> {
    use base64::Engine;
    let root = state.require_vault()?;
    blocking(move || {
        let rel = normalize_rel(&path)?;
        let abs = vault_rel(&root, &rel)?;
        download_for_open(&abs, &rel)?;
        let size = fs::stat(&abs)?.size;
        if size > HUGE_FILE_BYTES {
            return Err(IpcError::bad_request(format!(
                "{rel} is {size} bytes; the viewer stops at {HUGE_FILE_BYTES}"
            )));
        }
        let (bytes, pre) = fs::read_bytes(&abs)?;
        Ok(BlobDto {
            path: rel,
            base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            size: pre.size.to_string(),
        })
    })
    .await
}

/// Read inside a container the viewer shows one part at a time — an EPUB or
/// a CBZ (ADR-0023). With `entries` empty this is the container's table of
/// contents; otherwise it is those entries' bytes, all of them in this one
/// call, because a chapter and the twenty images it references are one user
/// action and rule 8 gives it one round trip, not twenty-one.
///
/// Same explicit-open rule as `read_blob`: a cloud-only book is downloaded
/// here on purpose. The core caps each entry; this caps what one call may
/// put through the IPC as base64, for the same reason `read_blob` does.
#[tauri::command]
#[specta::specta]
pub async fn read_packed(
    state: State<'_, AppState>,
    path: String,
    entries: Vec<String>,
) -> IpcResult<PackedDto> {
    use base64::Engine;
    let root = state.require_vault()?;
    blocking(move || {
        let rel = normalize_rel(&path)?;
        let abs = vault_rel(&root, &rel)?;
        if entries.is_empty() {
            return Ok(PackedDto {
                path: rel,
                entries: archive::list(&abs)?
                    .into_iter()
                    .map(|e| PackedEntryDto {
                        name: e.name,
                        size: e.size.to_string(),
                    })
                    .collect(),
                parts: Vec::new(),
            });
        }
        // NFC like every path at ingress (§2.3 rule 4): the core spells the
        // container's own entry names that way, so a caller that composed
        // its name differently still finds the entry.
        let wanted: Vec<String> = entries.iter().map(|e| nfc(e)).collect();
        let parts = archive::read(&abs, &wanted)?;
        let total: u64 = parts.iter().map(|p| p.bytes.len() as u64).sum();
        if total > HUGE_FILE_BYTES {
            return Err(IpcError::bad_request(format!(
                "{rel} would send {total} bytes at once; the viewer stops at {HUGE_FILE_BYTES}"
            )));
        }
        Ok(PackedDto {
            path: rel,
            entries: Vec::new(),
            parts: parts
                .into_iter()
                .map(|p| PackedPartDto {
                    name: p.name,
                    base64: base64::engine::general_purpose::STANDARD.encode(p.bytes),
                })
                .collect(),
        })
    })
    .await
}

/// The read-only preview of a note (ADR-0020): the text the editor holds,
/// frontmatter and all, as an HTML fragment the preview pane inserts as it
/// is (raw HTML in the note comes back as text — `notes::render`).
#[tauri::command]
#[specta::specta]
pub async fn render_markdown(text: String) -> IpcResult<String> {
    blocking(move || Ok(novalis_core::notes::render::to_html(&text))).await
}

/// The types a pasted or dropped attachment may have: the tier-D image types
/// of PLAN.md §7.3 (ADR-0017) and PDF (ADR-0041), lower-case — what the app
/// opens read-only itself.
const ATTACHMENT_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "pdf"];

/// Write an image or PDF the user pasted or dropped into a note (ADR-0017,
/// ADR-0041) or dropped on the tree from the Finder, under
/// `folder/name`, never over an existing file (`RENAME_EXCL`), parents
/// created. Only the §7.3 image types, and nothing above [`HUGE_FILE_BYTES`].
#[tauri::command]
#[specta::specta]
pub async fn write_blob(
    state: State<'_, AppState>,
    folder: String,
    name: String,
    base64: String,
) -> IpcResult<EntryDto> {
    use base64::Engine;
    let root = state.require_vault()?;
    blocking(move || {
        let name = nfc(name.trim());
        let ext = name
            .rfind('.')
            .filter(|&i| i > 0)
            .map(|i| name[i + 1..].to_ascii_lowercase())
            .unwrap_or_default();
        if !ATTACHMENT_EXTENSIONS.contains(&ext.as_str()) {
            return Err(IpcError::bad_request(format!(
                "{name}: not an attachment type"
            )));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(base64)
            .map_err(|e| IpcError::bad_request(format!("{name}: {e}")))?;
        if bytes.len() as u64 > HUGE_FILE_BYTES {
            return Err(IpcError::bad_request(format!(
                "{name} is {} bytes; attachments stop at {HUGE_FILE_BYTES}",
                bytes.len()
            )));
        }
        let rel = normalize_rel(&join_rel(&folder, &name))?;
        let abs = creatable_file_rel(&root, &rel)?;
        fs::create_atomic(&abs, &bytes)?;
        Ok(EntryDto::from_stat(rel, &fs::stat(&abs)?, None))
    })
    .await
}

/// Save. `expected` is the precondition captured when the buffer was loaded or
/// last written; a mismatch is a `conflict` and the target is left untouched,
/// so the UI can write the buffer to a conflict copy (§5.3 step 3).
#[tauri::command]
#[specta::specta]
pub async fn write_file(
    state: State<'_, AppState>,
    path: String,
    text: String,
    expected: Option<PreconditionDto>,
) -> IpcResult<PreconditionDto> {
    let root = state.require_vault()?;
    let own = state.own_writes.clone();
    blocking(move || {
        let rel = normalize_rel(&path)?;
        let abs = vault_rel(&root, &rel)?;
        let expected: Option<Precondition> = expected
            .as_ref()
            .map(PreconditionDto::to_core)
            .transpose()?;
        let pre = fs::write_atomic(&abs, text.as_bytes(), expected.as_ref())?;
        own.lock()
            .unwrap_or_else(|e| e.into_inner())
            .record(&rel, &pre);
        Ok(PreconditionDto::from(pre))
    })
    .await
}

/// Write the buffer to `<name> (conflict <host> <YYYY-MM-DD HHMM>).<ext>` next
/// to the target and return the new vault-relative path. Never clobbers
/// (§5.3 step 3).
#[tauri::command]
#[specta::specta]
pub async fn write_conflict_copy(
    state: State<'_, AppState>,
    path: String,
    text: String,
) -> IpcResult<String> {
    let root = state.require_vault()?;
    blocking(move || {
        let rel = normalize_rel(&path)?;
        let abs = vault_rel(&root, &rel)?;
        let copy = fs::write_conflict_copy(&abs, text.as_bytes(), &hostname(), &local_now())?;
        rel_of(&root, &copy).ok_or_else(|| IpcError::internal("conflict copy left the vault"))
    })
    .await
}

/// The file name a typed name becomes (ADR-0014). An extension the editor
/// opens ([`file_types::is_creatable_ext`], PLAN.md §7.3 tiers A–C) is kept
/// as typed, case-insensitively — except `.md`, which is written lower-case
/// whatever was typed, because the core recognises a note by exactly `.md`
/// (`is_note_name`) and `Todo.MD` would otherwise be a file no search, link
/// or cache ever sees. Any other extension, or none, gets `.md`: "v1.2"
/// becomes "v1.2.md".
fn creatable_name(name: &str) -> String {
    let ext = match name.rfind('.') {
        Some(i) if i > 0 => name[i + 1..].to_ascii_lowercase(),
        _ => String::new(),
    };
    if ext == "md" {
        format!("{}.md", &name[..name.len() - 3])
    } else if file_types::is_creatable_ext(&ext) {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}

/// Create an empty file in the vault: a note (`.md`) or, when the typed name
/// carries a §7.3 extension, that file type (ADR-0014). Both go through the
/// same guards as `vault_note_rel` minus the `.md` requirement; nothing hidden
/// and nothing outside the vault is ever created.
#[tauri::command]
#[specta::specta]
pub async fn create_note(
    state: State<'_, AppState>,
    folder: String,
    name: String,
) -> IpcResult<EntryDto> {
    let root = state.require_vault()?;
    blocking(move || {
        let name = creatable_name(&nfc(name.trim()));
        let rel = normalize_rel(&join_rel(&folder, &name))?;
        let abs = if is_note_name(file_name_of(&rel)) {
            vault_note_rel(&root, &rel)?
        } else {
            creatable_file_rel(&root, &rel)?
        };
        create_note_file(&abs)?;
        Ok(EntryDto::from_stat(rel, &fs::stat(&abs)?, None))
    })
    .await
}

/// `vault_rel` plus the invariants `vault_note_rel` enforces for notes,
/// without the `.md` one: non-empty, no hidden component.
fn creatable_file_rel(root: &Path, rel: &str) -> IpcResult<PathBuf> {
    let invalid = |reason| CoreError::InvalidPath {
        path: rel.to_string(),
        reason,
    };
    if rel.is_empty() {
        return Err(invalid(PathReason::Empty).into());
    }
    if rel.split('/').any(is_hidden) {
        return Err(invalid(PathReason::Hidden).into());
    }
    Ok(vault_rel(root, rel)?)
}

/// `RENAME_EXCL` create: an existing file is never clobbered (§2.3 rule 4).
fn create_note_file(abs: &Path) -> IpcResult<()> {
    fs::create_atomic(abs, b"")?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn create_folder(
    state: State<'_, AppState>,
    folder: String,
    name: String,
) -> IpcResult<EntryDto> {
    let root = state.require_vault()?;
    blocking(move || {
        let rel = normalize_rel(&join_rel(&folder, &nfc(name.trim())))?;
        let abs = vault_rel(&root, &rel)?;
        if std::fs::symlink_metadata(&abs).is_ok() {
            return Err(CoreError::AlreadyExists { path: rel }.into());
        }
        std::fs::create_dir_all(&abs).map_err(|e| CoreError::from_io(&abs, e))?;
        Ok(EntryDto::from_stat(rel, &fs::stat(&abs)?, None))
    })
    .await
}

/// Rename or move, then rewrite the links that pointed at the old name.
///
/// `vault::fs::rename` handles the case-only and normalization-only twins and
/// never clobbers; `relink_many` runs under the materialize-off guard and
/// writes each note under its read-time precondition, reporting what it had to
/// skip (§5.3 step 6).
#[tauri::command]
#[specta::specta]
pub async fn rename(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> IpcResult<RenameResultDto> {
    let root = state.require_vault()?;
    blocking(move || {
        let from_rel = normalize_rel(&from)?;
        let to_rel = normalize_rel(&to)?;
        let from_abs = vault_rel(&root, &from_rel)?;
        let to_abs = vault_rel(&root, &to_rel)?;
        fs::rename(&from_abs, &to_abs)?;

        let mut result = RenameResultDto {
            path: to_rel.clone(),
            rewritten: Vec::new(),
            cards_updated: 0,
            conflicts: Vec::new(),
            cloud_only_skipped: Vec::new(),
        };
        if is_note_name(&from_rel) && is_note_name(&to_rel) {
            let spec = RelinkSpec::new(stem_of(&from_rel), &to_rel).with_old_path(&from_rel);
            let report = relink_many(&root, &[spec], &RelinkOptions { dry_run: false })?;
            result.rewritten = report.rewritten.into_iter().map(|f| f.path).collect();
            result.cards_updated = report.cards_updated.len() as u32;
            result.conflicts = report.conflicts;
            result.cloud_only_skipped = report.cloud_only_skipped;
        }
        Ok(result)
    })
    .await
}

/// Move to the Trash with `NsFileManager` (no prompt, no entitlement — the
/// §4.5 decision). A cloud-only file is refused rather than materialized.
#[tauri::command]
#[specta::specta]
pub async fn trash(state: State<'_, AppState>, path: String) -> IpcResult<()> {
    let root = state.require_vault()?;
    let own = state.own_writes.clone();
    blocking(move || {
        let rel = normalize_rel(&path)?;
        let abs = vault_rel(&root, &rel)?;
        // Checklist B9, 2026-09-17: a dataless note on Drive left the vault
        // once although the core refuses one. Until that run is explained the
        // dev build says what it saw and what it did, on stderr, where
        // `cargo tauri dev` shows it. Not in a release build.
        #[cfg(debug_assertions)]
        let seen = fs::stat(&abs).map(|st| st.cloud_only);
        let outcome = fs::trash(&abs);
        #[cfg(debug_assertions)]
        eprintln!("trash {rel}: cloud_only={seen:?} -> {outcome:?}");
        outcome?;
        own.lock().unwrap_or_else(|e| e.into_inner()).forget(&rel);
        Ok(())
    })
    .await
}

/// Show `path` in the Finder, selected in its folder (ADR-0021): `open -R`,
/// the system's own opener, no plugin and nothing leaves the machine. The
/// path is checked against the vault like every other; macOS only, as the
/// app is (PLAN.md §4.5) — the Linux build answers with an error.
#[tauri::command]
#[specta::specta]
pub async fn reveal(state: State<'_, AppState>, path: String) -> IpcResult<()> {
    let root = state.require_vault()?;
    blocking(move || {
        let rel = normalize_rel(&path)?;
        let abs = vault_rel(&root, &rel)?;
        #[cfg(target_os = "macos")]
        {
            let status = std::process::Command::new("/usr/bin/open")
                .arg("-R")
                .arg(&abs)
                .status()
                .map_err(|e| CoreError::from_io(&abs, e))?;
            if !status.success() {
                return Err(CoreError::internal(format!("open -R exited with {status}")).into());
            }
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = abs;
            Err(CoreError::internal("reveal is macOS only").into())
        }
    })
    .await
}

/// A native context menu popped at the pointer (ADR-0021, ADR-0032). The
/// tree's entries are File menu items with the File menu's ids, so a click
/// arrives in the UI as the same `MenuAction` a menu-bar click does and runs
/// the same command against the row the UI selected before asking; a board
/// row gets "Show in Finder" only. A card's entries act on the card the UI
/// remembered before asking.
#[tauri::command]
#[specta::specta]
pub async fn context_menu(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, AppState>,
    target: ContextMenuDto,
) -> IpcResult<()> {
    let settings = state.settings();
    let catalog = Catalog::load(resolve_locale(settings.language));
    // AppKit wants menus built and shown on the main thread, as `refresh_menu`
    // does for the menu bar.
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let built = match &target {
            ContextMenuDto::Tree { board } => menu::tree_context(&handle, &catalog, *board),
            ContextMenuDto::Card {
                columns,
                column,
                has_note,
            } => {
                let columns: Vec<(String, String)> = columns
                    .iter()
                    .map(|c| (c.id.clone(), c.name.clone()))
                    .collect();
                menu::card_context(&handle, &catalog, &columns, column, *has_note)
            }
        };
        if let Ok(built) = built {
            use tauri::menu::ContextMenu;
            let _ = built.popup(window);
        }
    })
    .map_err(|e| CoreError::internal(e.to_string()))?;
    Ok(())
}

// ---------------------------------------------------------------- 5. search

/// Vault-wide search, streamed over a channel. A newer search supersedes an
/// older one: the running scan sees the generation change and stops, so there
/// is no cancel command and no way to leak a worker.
#[tauri::command]
#[specta::specta]
pub async fn search(
    state: State<'_, AppState>,
    query: SearchQueryDto,
    on_event: Channel<SearchEventDto>,
) -> IpcResult<SearchReportDto> {
    let root = state.require_vault()?;
    let counter: Arc<AtomicU64> = state.search_counter();
    let generation = counter.fetch_add(1, Ordering::SeqCst) + 1;
    let core_query = search::SearchQuery::from(&query);
    let cache_dir = state.cache_dir();

    blocking(move || {
        let mut buffer: Vec<SearchHitDto> = Vec::with_capacity(SEARCH_BATCH);
        let mut stopped = false;
        let mut on_hit = |hit: SearchHit| {
            buffer.push(SearchHitDto::from(hit));
            if buffer.len() >= SEARCH_BATCH {
                let hits = std::mem::take(&mut buffer);
                if on_event.send(SearchEventDto::Hits { hits }).is_err() {
                    stopped = true;
                    return false;
                }
            }
            if counter.load(Ordering::SeqCst) != generation {
                stopped = true;
                return false;
            }
            true
        };
        // The cache is opened only for a tag-filtered search; a plain scan
        // does not need it and must not wait on it.
        let cache = if core_query.tag.is_some() {
            Cache::open(&cache_dir, &root).ok()
        } else {
            None
        };
        // Under "All files" the core walks every regular file; only what the
        // tree lists and opens as text is read or counted, so the limit is
        // not spent on hits in a `node_modules` the user never sees
        // (ADR-0022 point 5, amended 2026-09-21).
        let keep = |path: &str| matches!(file_types::kind_of(path), Some(Kind::Note | Kind::Text));
        let report = search::search_where(&root, &core_query, cache.as_ref(), &keep, &mut on_hit)?;
        if !buffer.is_empty() {
            let _ = on_event.send(SearchEventDto::Hits { hits: buffer });
        }
        let out = SearchReportDto::new(report, stopped);
        let _ = on_event.send(SearchEventDto::Done {
            report: out.clone(),
        });
        Ok(out)
    })
    .await
}

/// Every tag in the vault with its note count, most used first.
///
/// Reads the cache on its own short-lived connection rather than through the
/// actor: the database is WAL and the actor's scan does its file reads before
/// it opens a write transaction, so a reader never waits on a scan.
#[tauri::command]
#[specta::specta]
pub async fn tags(state: State<'_, AppState>) -> IpcResult<TagListDto> {
    let root = state.require_vault()?;
    let cache_dir = state.cache_dir();
    let indexed = state.cache_indexed();
    blocking(move || {
        let Ok(cache) = Cache::open(&cache_dir, &root) else {
            return Ok(TagListDto {
                tags: Vec::new(),
                indexed: false,
            });
        };
        Ok(TagListDto {
            tags: cache
                .tags()?
                .into_iter()
                .map(|(tag, count)| TagCountDto {
                    tag,
                    count: count as u32,
                })
                .collect(),
            indexed,
        })
    })
    .await
}

/// The notes and cards that link to `path` (§4.4, approved for v1).
#[tauri::command]
#[specta::specta]
pub async fn backlinks(state: State<'_, AppState>, path: String) -> IpcResult<BacklinksDto> {
    let root = state.require_vault()?;
    let cache_dir = state.cache_dir();
    let indexed = state.cache_indexed();
    blocking(move || {
        let rel = normalize_rel(&path)?;
        // Cards first: they are read from the board files, so they do not need
        // the cache and are correct even during the first scan.
        let cards = boards::cards_linking(&root, &rel)
            .unwrap_or_default()
            .into_iter()
            .map(|(board, card)| BacklinkCardDto {
                board: board.slug,
                board_name: board.name,
                id: card.id,
                title: card.title,
            })
            .collect();
        let Ok(cache) = Cache::open(&cache_dir, &root) else {
            return Ok(BacklinksDto {
                notes: Vec::new(),
                cards,
                indexed: false,
            });
        };
        let rows = cache.backlinks(&rel)?;
        let snippets = search::link_snippets(&root, &rows)?;
        Ok(BacklinksDto {
            notes: rows
                .into_iter()
                .zip(snippets)
                .map(|(row, snippet)| BacklinkDto {
                    title: stem_of(&row.src).to_string(),
                    line: row.line as u32,
                    path: row.src,
                    snippet,
                })
                .collect(),
            cards,
            indexed,
        })
    })
    .await
}

// ---------------------------------------------------------------- 6. boards

#[tauri::command]
#[specta::specta]
pub async fn board_list(state: State<'_, AppState>) -> IpcResult<Vec<BoardRefDto>> {
    let root = state.require_vault()?;
    blocking(move || {
        Ok(boards::list_boards(&root)?
            .iter()
            .map(BoardRefDto::from)
            .collect())
    })
    .await
}

/// A board and its cards in one read. Tombstoned cards are dropped here;
/// cloud-only card files are reported, never read (§8.2). The first read of a
/// board after the vault was opened also resolves its `board.json` and card
/// conflicts (§8.4) and says so in `resolved_columns` and
/// `resolved_conflicts`; only that read writes, every later one carries
/// false and 0.
#[tauri::command]
#[specta::specta]
pub async fn board_read(state: State<'_, AppState>, slug: String) -> IpcResult<BoardDto> {
    let slug = normalize_rel(&slug)?;
    // Why the first read and not every read: a read that writes on every
    // refresh re-triggers itself through the watcher, which is the sweep
    // PLAN.md §2.3 rule 12 forbids — and the refresh it caused had nothing
    // left to report, so the notice was gone before anyone saw it. Why not
    // every board at open: the same rule. A copy that arrives after a board's
    // first read shows in `unreadable` until the vault is opened again.
    let BoardRead { root, first, lock } = state.begin_board_read(&slug)?;
    let work_slug = slug.clone();
    let result = blocking(move || {
        let slug = work_slug;
        // A second read of this board while the first is still renaming
        // would otherwise list a `cards/` directory with the loser already
        // parked and the winner not yet in place. A poisoned lock only means
        // an earlier read panicked; there is nothing half-written to protect.
        let _board = lock.lock().unwrap_or_else(|e| e.into_inner());
        // `board.json` first, because its columns decide which cards are
        // orphans below; the resolver parses the canonical file before it
        // moves anything, so a board that cannot be read is still not tidied.
        // It used to exist and be called by nothing, which is how a column
        // added on the other device stayed in a `board-<host>.json` nobody
        // read.
        let resolved_board = first.then(|| boards::resolve_board_conflicts(&root, &slug));
        // A failure after either tidy-up (one card file the listing cannot
        // read) still returns the error and loses the count — the files are
        // under `conflicts/` regardless, and a count cannot ride on an error.
        let doc = boards::read_board(&root, &slug)?;
        let resolved = first.then(|| boards::resolve_card_conflicts(&root, &slug));
        let mut board = cards_snapshot(&root, slug, &doc.board)?;
        // A board that cannot be tidied is still a board, so neither failure
        // is fatal — but it is said, not swallowed. The first one is the one
        // that is said.
        match resolved_board {
            Some(Ok(report)) => board.resolved_columns = !report.resolved.is_empty(),
            Some(Err(e)) => board.resolve_error = Some(e.into()),
            None => {}
        }
        match resolved {
            Some(Ok(report)) => board.resolved_conflicts = report.resolved.len() as u32,
            Some(Err(e)) if board.resolve_error.is_none() => board.resolve_error = Some(e.into()),
            _ => {}
        }
        Ok(board)
    })
    .await;
    if first && result.is_err() {
        state.forget_board_read(&slug);
    }
    result
}

/// Create `boards/<slug>/board.json`. The board starts without columns: column
/// names are user text and the UI owns the catalog, so the shell never invents
/// one.
#[tauri::command]
#[specta::specta]
pub async fn board_create(
    state: State<'_, AppState>,
    slug: String,
    name: String,
) -> IpcResult<BoardRefDto> {
    let root = state.require_vault()?;
    blocking(move || {
        let slug = normalize_rel(&slug)?;
        if slug.contains('/') {
            return Err(IpcError::bad_request("board slug must be one path segment"));
        }
        let board = boards::create_board(&root, &slug, &name, Vec::new())?;
        Ok(BoardRefDto {
            slug,
            name: board.name,
            order: board.order,
        })
    })
    .await
}

/// The two configurable things about a board: its name and its column list
/// (§8.5). Columns go through `set_columns`, which re-reads and replays on a
/// conflict, so two devices reordering columns never lose one.
#[tauri::command]
#[specta::specta]
pub async fn board_write(
    state: State<'_, AppState>,
    slug: String,
    name: Option<String>,
    columns: Option<Vec<ColumnDto>>,
    place: Option<PositionDto>,
) -> IpcResult<BoardDto> {
    let root = state.require_vault()?;
    blocking(move || {
        let slug = normalize_rel(&slug)?;
        // Where the board sits among the boards (ADR-0019): the key is
        // computed here from its neighbours, never sent by the UI.
        if let Some(place) = place {
            boards::move_board(&root, &slug, &position(place))?;
        }
        if let Some(columns) = columns {
            let columns: Vec<Column> = columns
                .into_iter()
                .map(|c| Column {
                    id: c.id,
                    name: c.name,
                })
                .collect();
            boards::set_columns(&root, &slug, columns)?;
        }
        if let Some(name) = name {
            // One retry: `set_columns` above may have bumped the document we
            // are about to write, and so may another device.
            for attempt in 0..2 {
                let doc = boards::read_board(&root, &slug)?;
                let mut board = doc.board.clone();
                board.name = name.clone();
                match boards::write_board(&root, &slug, &board, &doc.precondition) {
                    Ok(_) => break,
                    Err(CoreError::Conflict { .. }) if attempt == 0 => continue,
                    Err(e) => return Err(e.into()),
                }
            }
        }
        board_snapshot(&root, slug)
    })
    .await
}

fn position(p: PositionDto) -> Position {
    match p {
        PositionDto::First => Position::First,
        PositionDto::Last => Position::Last,
        PositionDto::After { id } => Position::After(id),
    }
}

/// The one write the board pane makes. Every variant is a single replayable
/// field change, which is why a conflicting board never raises a banner
/// (§5.3 step 5).
#[tauri::command]
#[specta::specta]
pub async fn card_write(
    state: State<'_, AppState>,
    slug: String,
    op: CardOpDto,
) -> IpcResult<CardDto> {
    let root = state.require_vault()?;
    blocking(move || {
        let slug = normalize_rel(&slug)?;
        let card = match op {
            CardOpDto::Add {
                title,
                column,
                notes,
                position: pos,
            } => boards::add_card(
                &root,
                &slug,
                NewCard {
                    title,
                    column,
                    notes,
                    position: position(pos),
                    description: None,
                },
            )?,
            CardOpDto::Retitle { id, title } => {
                boards::update_card(&root, &slug, &id, &CardChange::Title(title), None)?
            }
            CardOpDto::SetDescription { id, description } => boards::update_card(
                &root,
                &slug,
                &id,
                &CardChange::Description(description),
                None,
            )?,
            CardOpDto::Move {
                id,
                column,
                position: pos,
            } => boards::update_card(
                &root,
                &slug,
                &id,
                &CardChange::Move {
                    column,
                    position: position(pos),
                },
                None,
            )?,
            CardOpDto::LinkNote { id, path } => boards::update_card(
                &root,
                &slug,
                &id,
                &CardChange::AddNote(normalize_rel(&path)?),
                None,
            )?,
            CardOpDto::UnlinkNote { id, path } => boards::update_card(
                &root,
                &slug,
                &id,
                &CardChange::RemoveNote(normalize_rel(&path)?),
                None,
            )?,
            CardOpDto::Remove { id } => boards::remove_card(&root, &slug, &id)?,
            CardOpDto::MoveToBoard { id, board } => {
                boards::move_card_to_board(&root, &slug, &id, &normalize_rel(&board)?)?
            }
        };
        Ok(CardDto::from(&card))
    })
    .await
}

// ---------------------------------------------------------------- 7. settings

/// Change one or more of the four settings (PLAN.md §4.1). Writes
/// `settings.json` atomically and rebuilds the native menu so its check marks
/// and the Language/Appearance submenus match.
#[tauri::command]
#[specta::specta]
pub async fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatchDto,
) -> IpcResult<SettingsDto> {
    let mut settings: Settings = state.settings();
    let spellcheck_before = settings.spellcheck;
    patch.apply(&mut settings);
    settings.save(&state.settings_path())?;
    if settings.spellcheck != spellcheck_before {
        crate::spelling::seed(settings.spellcheck);
    }
    state.set_settings(settings.clone());
    refresh_menu(
        &app,
        &state,
        &settings,
        &read_ui_state(&state.ui_state_path()),
    );
    Ok(SettingsDto::from(&settings))
}

/// Persist the disposable half of the UI state (open tabs, sidebar, board).
/// It lives in `<app-data>/state.json` and is deliberately not documented in
/// `docs/SETTINGS.md` (PLAN.md §4.1).
#[tauri::command]
#[specta::specta]
pub async fn state_save(
    app: AppHandle,
    state: State<'_, AppState>,
    mut ui_state: UiStateDto,
) -> IpcResult<()> {
    let quit = ui_state.quit;
    // The window's place is the shell's to know (`window.rs`).
    ui_state.window = state.window().or(ui_state.window);
    if !quit {
        refresh_menu(&app, &state, &state.settings(), &ui_state);
    }
    let path = state.ui_state_path();
    let written = blocking(move || Ok(write_ui_state(&path, &ui_state)?)).await;
    // The UI's last word before quitting (D19): the buffers are on disk, and
    // a state file that could not be written is no reason to stay open.
    if quit {
        app.exit(0);
    }
    written
}

#[cfg(test)]
mod tests {
    use super::{creatable_file_rel, creatable_name, scan_vault};

    /// feature-gaps A32: the old app's `.novalis/config.json` without a
    /// `migrated` stamp in `vault.json` is a legacy vault; the stamp ends it.
    #[test]
    fn a_vault_the_old_app_wrote_is_legacy_until_migrated() {
        let root = std::env::temp_dir().join(format!("novalis-legacy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".novalis")).unwrap();
        assert!(!scan_vault(&root).unwrap().vault.legacy, "a plain folder");

        std::fs::write(root.join(".novalis/config.json"), "{}").unwrap();
        assert!(
            scan_vault(&root).unwrap().vault.legacy,
            "the old app's config"
        );

        std::fs::write(
            root.join(".novalis/vault.json"),
            r#"{"format":1,"migrated":"2026-09-22T12:00:00Z"}"#,
        )
        .unwrap();
        assert!(!scan_vault(&root).unwrap().vault.legacy, "migrated");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// ADR-0014: a §7.3 extension is kept, `.md` is normalised, anything
    /// else gets `.md` appended.
    #[test]
    fn typed_extensions_are_kept_and_md_is_lower_cased() {
        for (typed, created) in [
            ("Meine Notiz", "Meine Notiz.md"),
            ("notes.txt", "notes.txt"),
            ("Notes.TXT", "Notes.TXT"),
            ("config.json", "config.json"),
            ("Todo.MD", "Todo.md"),
            ("Todo.Md", "Todo.md"),
            ("v1.2", "v1.2.md"),
            ("clip.wav", "clip.wav.md"),
            ("archive.tar.gz", "archive.tar.gz.md"),
            (".env", ".env.md"),
            ("a.b/c.txt", "a.b/c.txt"),
        ] {
            assert_eq!(creatable_name(typed), created, "typed {typed:?}");
        }
    }

    /// The core's binary verdict on the wire (ADR-0022): no text, no hash,
    /// read-only; a text read is what `new` makes of it.
    #[test]
    fn a_binary_read_crosses_ipc_without_text_or_hash() {
        use crate::dto::FileDto;
        use novalis_core::vault::fs::{FileContent, TextRead};
        let binary = FileDto::from_read(
            "core.dump".into(),
            TextRead::Binary {
                size: 6 * 1024 * 1024,
                mtime_ns: 7,
            },
        );
        assert!(binary.binary);
        assert_eq!(binary.text, "");
        assert_eq!(binary.precondition.hash, "");
        assert_eq!(binary.precondition.mtime_ns, "7");
        assert!(binary.utf8 && binary.plain_mode && !binary.huge);
        let content = FileContent {
            text: "hi".into(),
            mtime_ns: 1,
            size: 2,
            hash: "h".into(),
            utf8: true,
        };
        assert_eq!(
            FileDto::from_read("a.md".into(), TextRead::Text(content.clone())),
            FileDto::new("a.md".into(), content)
        );
    }

    /// The non-note guard refuses what `vault_note_rel` refuses, minus the
    /// `.md` rule: a hidden component and the empty path.
    #[test]
    fn creatable_file_rel_refuses_hidden_and_empty() {
        let root = std::env::temp_dir();
        for rel in [".env.txt", "sub/.hidden/notes.txt", ""] {
            let err = creatable_file_rel(&root, rel).expect_err(rel);
            assert_eq!(err.code, "invalid_path", "{rel:?}");
        }
        assert!(creatable_file_rel(&root, "sub/notes.txt").is_ok());
    }

    /// One field this build does not understand must not throw away the
    /// tabs and the board with it.
    #[test]
    fn unknown_tree_sort_reads_as_the_default_and_keeps_the_rest() {
        let dir = std::env::temp_dir().join(format!("novalis-state-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        std::fs::write(
            &path,
            r#"{"openTabs":["a.md"],"activeTab":"a.md","boardVisible":true,"activeBoard":"atlas","treeSort":"size"}"#,
        )
        .unwrap();
        let state = super::read_ui_state(&path);
        assert_eq!(state.open_tabs, vec!["a.md".to_string()]);
        assert_eq!(state.active_board.as_deref(), Some("atlas"));
        assert_eq!(state.tree_sort, super::TreeSortDto::Name);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
