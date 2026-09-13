//! Shell state: the open vault, the settings, the watcher and the record of
//! our own writes.
//!
//! There is no global lock over filesystem work (PLAN.md §2.3 rule 6): the
//! state mutex is held only long enough to read or replace a small value, never
//! across IO. Commands take a `PathBuf` copy of the vault root and then work
//! outside the lock. The per-board locks in `board_locks` are the one scoped
//! exception: `board_read` holds a board's lock for its filesystem work, so
//! only a second read of that same board waits.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

use novalis_core::settings::{Appearance, Language, Settings};
use novalis_core::vault::fs::Precondition;

use crate::cache::CacheHandle;
use crate::error::{IpcError, IpcResult};
use crate::watcher::WatcherHandle;

/// `(mtime_ns, size)` of a write we made ourselves, keyed by vault-relative
/// path. The watcher drops an event that matches one (PLAN.md §5.3 step 4);
/// the editor's own hash comparison is the second half of the same rule and
/// lives in the UI.
#[derive(Debug, Default)]
pub struct OwnWrites(HashMap<String, (i64, u64)>);

impl OwnWrites {
    pub fn record(&mut self, path: &str, pre: &Precondition) {
        self.0.insert(path.to_string(), (pre.mtime_ns, pre.size));
        // The map only ever holds paths this process wrote and never saw an
        // event for. A stuck entry would suppress one real external change, so
        // keep it small rather than unbounded.
        if self.0.len() > 512 {
            self.0.clear();
        }
    }

    /// True when `(mtime_ns, size)` is exactly what we last wrote there. The
    /// entry is consumed: a second, external write to the same values (same
    /// nanosecond and size) is vanishingly unlikely and would only cost one
    /// silent reload.
    pub fn take_if_ours(&mut self, path: &str, mtime_ns: i64, size: u64) -> bool {
        match self.0.get(path) {
            Some(&(m, s)) if m == mtime_ns && s == size => {
                self.0.remove(path);
                true
            }
            _ => false,
        }
    }

    pub fn forget(&mut self, path: &str) {
        self.0.remove(path);
    }
}

#[derive(Debug)]
struct Inner {
    vault: Option<PathBuf>,
    settings: Settings,
    watcher: Option<WatcherHandle>,
    cache: Option<CacheHandle>,
    /// What the menu bar was last built for. `state_save` runs on a 400 ms
    /// debounce while the user moves things, and rebuilding a whole menu bar
    /// that often is both wasteful and visible.
    menu_shape: Option<MenuShape>,
    /// Board slugs read since this vault was opened. The first read of a board
    /// is the one that resolves its card conflicts (PLAN.md §8.4); every later
    /// read only looks.
    read_boards: HashSet<String>,
    /// One lock per board, held by `board_read` while it works, so a read of a
    /// board waits for that board's tidy-up and sees the files before or after
    /// it, never a `cards/` directory between two renames. Only reads of the
    /// same board wait; rule 6 keeps every other command out of it.
    board_locks: HashMap<String, Arc<Mutex<()>>>,
}

/// What `board_read` needs from the state, taken in one step.
pub struct BoardRead {
    pub root: PathBuf,
    /// True the first time this board is read since the vault was opened.
    pub first: bool,
    /// Held for the read's whole filesystem work; see `Inner::board_locks`.
    pub lock: Arc<Mutex<()>>,
}

/// Everything the native menu's labels and check marks depend on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MenuShape {
    pub language: Language,
    pub appearance: Appearance,
    pub spellcheck: bool,
    pub sidebar_visible: bool,
    pub board_visible: bool,
}

/// Managed state, one per app.
#[derive(Debug)]
pub struct AppState {
    inner: Mutex<Inner>,
    /// Shared with the watcher thread.
    pub own_writes: Arc<Mutex<OwnWrites>>,
    /// Bumped by every new search; a running scan stops when it is no longer
    /// the newest. Cheaper than a cancel command and impossible to leak.
    search_generation: Arc<AtomicU64>,
    config_dir: PathBuf,
}

impl AppState {
    pub fn new(config_dir: PathBuf, settings: Settings) -> Self {
        AppState {
            inner: Mutex::new(Inner {
                vault: None,
                settings,
                watcher: None,
                cache: None,
                menu_shape: None,
                read_boards: HashSet::new(),
                board_locks: HashMap::new(),
            }),
            own_writes: Arc::new(Mutex::new(OwnWrites::default())),
            search_generation: Arc::new(AtomicU64::new(0)),
            config_dir,
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // A poisoned lock means another command panicked while holding it.
        // Nothing here is a half-updated invariant (three plain fields), so
        // recovering is strictly better than taking the whole app down.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn settings_path(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    pub fn ui_state_path(&self) -> PathBuf {
        self.config_dir.join("state.json")
    }

    pub fn settings(&self) -> Settings {
        self.lock().settings.clone()
    }

    pub fn set_settings(&self, settings: Settings) {
        self.lock().settings = settings;
    }

    pub fn vault(&self) -> Option<PathBuf> {
        self.lock().vault.clone()
    }

    /// The open vault root, or `no_vault`.
    pub fn require_vault(&self) -> IpcResult<PathBuf> {
        self.vault().ok_or_else(IpcError::no_vault)
    }

    /// Replace the vault and its watcher in one step; the previous watcher is
    /// dropped (which stops its thread) before the new one is installed.
    pub fn set_vault(
        &self,
        root: Option<PathBuf>,
        watcher: Option<WatcherHandle>,
        cache: Option<CacheHandle>,
    ) {
        let mut inner = self.lock();
        // Both old handles are dropped before the new ones are installed, so
        // the previous vault's threads stop first.
        inner.watcher = None;
        inner.cache = None;
        inner.vault = root;
        inner.watcher = watcher;
        inner.cache = cache;
        inner.read_boards.clear();
        inner.board_locks.clear();
    }

    /// The open vault root, whether this is the first read of `slug` since it
    /// was opened, and the board's own lock. The first read resolves the
    /// board's card conflicts (§8.4) and reports what it did; a board whose
    /// resolution failed is not retried until the next open, so the failure is
    /// said once rather than on every refresh. All three under one lock:
    /// taken separately, a vault switch in between would mark a board of the
    /// new vault for a read of the old one.
    pub fn begin_board_read(&self, slug: &str) -> IpcResult<BoardRead> {
        let mut inner = self.lock();
        let root = inner.vault.clone().ok_or_else(IpcError::no_vault)?;
        let first = inner.read_boards.insert(slug.to_string());
        let lock = inner
            .board_locks
            .entry(slug.to_string())
            .or_default()
            .clone();
        Ok(BoardRead { root, first, lock })
    }

    /// Undo `begin_board_read`'s mark when that read failed, so the next read
    /// tries again. Resolving is idempotent, so this is safe whether the
    /// failure came before or after the tidy-up.
    pub fn forget_board_read(&self, slug: &str) {
        self.lock().read_boards.remove(slug);
    }

    /// The directory the cache database lives in: app-data, never the vault.
    pub fn cache_dir(&self) -> PathBuf {
        self.config_dir.join("cache")
    }

    /// False while the cache is still indexing, or could not be opened.
    pub fn cache_indexed(&self) -> bool {
        self.lock().cache.as_ref().is_some_and(|c| c.indexed())
    }

    /// True when the menu has to be rebuilt for `shape`, which is then
    /// recorded as the shape it is built for.
    pub fn menu_needs_rebuild(&self, shape: MenuShape) -> bool {
        let mut inner = self.lock();
        if inner.menu_shape == Some(shape) {
            return false;
        }
        inner.menu_shape = Some(shape);
        true
    }

    /// The search generation counter, cloned into the worker so the scan can
    /// notice that a newer search replaced it without borrowing the state.
    pub fn search_counter(&self) -> Arc<AtomicU64> {
        self.search_generation.clone()
    }
}

/// Load settings, tolerating a settings file that a future version wrote.
///
/// `Settings::load` rejects unknown keys by design (PLAN.md §2.3 rule 11) —
/// that is what makes the parity test meaningful. At *runtime* refusing to
/// start over one stray key would be worse than starting with defaults, so the
/// failure is reported to the UI as a banner instead, and nothing is written
/// back until the user changes a setting.
pub fn load_settings(path: &Path) -> (Settings, Option<IpcError>) {
    match Settings::load(path) {
        Ok(settings) => (settings, None),
        Err(err) => (Settings::default(), Some(err.into())),
    }
}

#[cfg(test)]
mod tests {
    use super::AppState;
    use novalis_core::settings::Settings;
    use std::path::PathBuf;
    use std::sync::Arc;

    #[test]
    fn a_board_is_first_read_once_per_open_vault() {
        let state = AppState::new(PathBuf::new(), Settings::default());
        assert!(state.begin_board_read("plan").is_err(), "no vault open");
        state.set_vault(Some(PathBuf::from("/vault-a")), None, None);
        let first = state.begin_board_read("plan").unwrap();
        assert_eq!(first.root, PathBuf::from("/vault-a"));
        assert!(first.first);
        let again = state.begin_board_read("plan").unwrap();
        assert!(!again.first);
        assert!(state.begin_board_read("other").unwrap().first);
        // A read that failed gives the mark back.
        state.forget_board_read("plan");
        assert!(state.begin_board_read("plan").unwrap().first);
        // Opening a vault starts afresh, even the same path.
        state.set_vault(Some(PathBuf::from("/vault-a")), None, None);
        assert!(state.begin_board_read("plan").unwrap().first);
    }

    // Pins one lock per board. That `board_read` holds it across its
    // filesystem work is in `commands.rs` and has no test: it would need a
    // board on disk and two pool threads racing a slowed-down resolution.
    #[test]
    fn reads_of_one_board_share_a_lock_and_other_boards_do_not() {
        let state = AppState::new(PathBuf::new(), Settings::default());
        state.set_vault(Some(PathBuf::from("/vault-a")), None, None);
        let a = state.begin_board_read("plan").unwrap();
        let b = state.begin_board_read("plan").unwrap();
        let other = state.begin_board_read("other").unwrap();
        assert!(Arc::ptr_eq(&a.lock, &b.lock));
        assert!(!Arc::ptr_eq(&a.lock, &other.lock));
    }
}
