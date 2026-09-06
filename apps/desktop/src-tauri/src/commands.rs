//! The whole IPC surface: 22 commands (PLAN.md §2.3 rule 8 caps it at 25).
//!
//! Every command is `async` and does its filesystem work inside
//! `spawn_blocking`, so a slow OneDrive hydration blocks one pool thread and
//! nothing else (rule 6). None of them holds a lock across IO: they copy the
//! vault root out of the state and then work on their own.
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
use novalis_core::notes::relink::{relink_many, RelinkOptions, RelinkSpec};
use novalis_core::search::{self, SearchHit};
use novalis_core::settings::Settings;
use novalis_core::util::{hostname, local_now};
use novalis_core::vault::cloud::vault_kind;
use novalis_core::vault::fs::{self, DirEntry, EntryKind, Precondition};
use novalis_core::vault::path::{
    is_note_name, join_rel, nfc, normalize_rel, rel_of, stem_of, vault_note_rel, vault_rel,
};
use novalis_core::vault::walk::walk_notes;
use novalis_core::CoreError;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::dto::*;
use crate::error::{IpcError, IpcResult};
use crate::i18n::{resolve_locale, Catalog};
use crate::state::{AppState, MenuShape};
use crate::{cache, menu, watcher};

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
            EntryDto::from_dir_entry(folder, entry, slug)
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

fn read_ui_state(path: &Path) -> UiStateDto {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
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

fn board_snapshot(root: &Path, slug: String) -> IpcResult<BoardDto> {
    let doc = boards::read_board(root, &slug)?;
    let (cards, cloud_only) = boards::list_cards_lenient(root, &slug)?;
    let cards = cards
        .iter()
        .filter(|c| !c.card.is_deleted())
        .map(|c| CardDto::from(&c.card))
        .collect();
    Ok(BoardDto::new(slug, &doc.board, cards, cloud_only))
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

/// Every note in the vault, vault-relative and sorted.
///
/// Quick-open (`Cmd+P`), the `[[`-completion source and the board's "Link
/// Note…" all need the whole list, and the tree only knows the folders the
/// user has opened. `walk_notes` runs under the materialize-off guard and
/// stats only, so a 10k-note cloud vault costs no downloads.
#[tauri::command]
#[specta::specta]
pub async fn list_notes(state: State<'_, AppState>) -> IpcResult<Vec<String>> {
    let root = state.require_vault()?;
    blocking(move || {
        Ok(walk_notes(&root)?
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
        // Explicit open under the default IO policy: a cloud-only note is
        // downloaded here on purpose (§4.5 "downloaded on open").
        let content = fs::read_file(&abs)?;
        Ok(FileDto::new(rel, content))
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

#[tauri::command]
#[specta::specta]
pub async fn create_note(
    state: State<'_, AppState>,
    folder: String,
    name: String,
) -> IpcResult<EntryDto> {
    let root = state.require_vault()?;
    blocking(move || {
        let name = nfc(name.trim());
        let name = if is_note_name(&name) {
            name
        } else {
            format!("{name}.md")
        };
        let rel = normalize_rel(&join_rel(&folder, &name))?;
        let abs = vault_note_rel(&root, &rel)?;
        create_note_file(&abs)?;
        Ok(EntryDto::from_stat(rel, &fs::stat(&abs)?, None))
    })
    .await
}

/// `RENAME_EXCL` create: an existing note is never clobbered (§2.3 rule 4).
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
        fs::trash(&abs)?;
        own.lock().unwrap_or_else(|e| e.into_inner()).forget(&rel);
        Ok(())
    })
    .await
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
        let report = search::search(&root, &core_query, cache.as_ref(), &mut on_hit)?;
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
        let Ok(cache) = Cache::open(&cache_dir, &root) else {
            return Ok(BacklinksDto {
                notes: Vec::new(),
                indexed: false,
            });
        };
        Ok(BacklinksDto {
            notes: cache
                .backlinks(&rel)?
                .into_iter()
                .map(|row| BacklinkDto {
                    title: stem_of(&row.src).to_string(),
                    line: row.line as u32,
                    path: row.src,
                })
                .collect(),
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
/// cloud-only card files are reported, never read (§8.2).
#[tauri::command]
#[specta::specta]
pub async fn board_read(state: State<'_, AppState>, slug: String) -> IpcResult<BoardDto> {
    let root = state.require_vault()?;
    blocking(move || board_snapshot(&root, normalize_rel(&slug)?)).await
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
) -> IpcResult<BoardDto> {
    let root = state.require_vault()?;
    blocking(move || {
        let slug = normalize_rel(&slug)?;
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
                },
            )?,
            CardOpDto::Retitle { id, title } => {
                boards::update_card(&root, &slug, &id, &CardChange::Title(title), None)?
            }
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
    patch.apply(&mut settings);
    settings.save(&state.settings_path())?;
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
    ui_state: UiStateDto,
) -> IpcResult<()> {
    refresh_menu(&app, &state, &state.settings(), &ui_state);
    let path = state.ui_state_path();
    blocking(move || {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::from_io(parent, e))?;
        }
        let mut bytes = serde_json::to_vec_pretty(&ui_state).map_err(CoreError::from)?;
        bytes.push(b'\n');
        fs::write_atomic(&path, &bytes, None)?;
        Ok(())
    })
    .await
}
