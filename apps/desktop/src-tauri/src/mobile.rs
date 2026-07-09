//! Mobile lifecycle sync. There is no file watcher and no background thread on
//! mobile (both are `#[cfg(desktop)]`), so external changes and outbound pushes
//! ride the Activity lifecycle instead:
//!
//! - **onResume** (`WindowEvent::Resumed`): re-scan the vault from disk (a sync
//!   peer may have changed files while backgrounded) and pull.
//! - **onPause** (`WindowEvent::Suspended`): commit locally, then a bounded
//!   best-effort push — the app may be killed while backgrounded, so pending
//!   edits must be secured now.
//!
//! Both mirror the desktop quit-commit posture: local commit is unconditional
//! and network is bounded and detached (safe to abandon — see [`crate::bg`]).

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use novalis_core::index::search;
use novalis_core::{git, vault::config};

use crate::bg::run_with_timeout;

/// Upper bound on a lifecycle sync's network wait. Shorter than the quit
/// timeout: the OS gives a suspending app little time before it may be frozen.
const LIFECYCLE_SYNC_TIMEOUT: Duration = Duration::from_secs(4);

fn vault_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let state = app.state::<crate::engine::AppEngine>();
    let guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
    guard.as_ref().map(|e| e.vault_path.clone())
}

/// onResume: rebuild the index from disk (no watcher on mobile) and, if a
/// remote is configured, pull once. Emits `reindexed-event` so the UI
/// refreshes. Runs detached so it never blocks the resuming activity.
pub fn on_resume(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(vault) = vault_path(&app) else {
            return;
        };
        // Re-scan first: pick up anything a sync peer wrote while backgrounded.
        let state = app.state::<crate::engine::AppEngine>();
        let scanned = state.with(|e| search::build_index(&e.db, &e.vault_path));
        match scanned {
            Ok(()) => {
                let _ = app.emit("reindexed-event", ());
            }
            Err(e) => log::warn!("resume rescan failed: {e:?}"),
        }
        // Then pull (best-effort, bounded). A merge/conflict is surfaced by
        // the same event path the background sync uses on desktop.
        run_sync(&vault, "resume");
    });
}

/// onPause: secure pending edits before the OS may freeze/kill the app —
/// local commit (always), then a bounded best-effort push. Runs detached.
pub fn on_suspend(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(vault) = vault_path(&app) else {
            return;
        };
        let prefs = match config::try_read_preferences(&vault) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("suspend commit: unreadable preferences, skipping: {e}");
                return;
            }
        };
        if !prefs.git.enabled {
            return;
        }
        // Local commit FIRST and unconditionally (sync fetches before it
        // commits, so a hung remote must not cost the commit).
        match git::ensure_repo(&vault)
            .and_then(|()| git::commit_all(&vault, &prefs.git.author_name, &prefs.git.author_email))
        {
            Ok(Some(c)) => log::info!("git suspend-commit {}", &c.id[..7.min(c.id.len())]),
            Ok(None) => {}
            Err(e) => log::warn!("git suspend-commit failed: {e}"),
        }
        run_sync(&vault, "suspend");
    });
}

/// Shared bounded push. Reads prefs + token freshly; every failure only logs.
fn run_sync(vault: &std::path::Path, when: &str) {
    if !git::has_remote(vault) {
        return;
    }
    let Ok(prefs) = config::try_read_preferences(vault) else {
        return;
    };
    if !prefs.git.enabled {
        return;
    }
    let token = crate::commands::read_git_token(vault);
    let vault = vault.to_path_buf();
    let name = prefs.git.author_name.clone();
    let email = prefs.git.author_email.clone();
    match run_with_timeout(LIFECYCLE_SYNC_TIMEOUT, move || {
        git::sync(&vault, &name, &email, token.as_deref())
    }) {
        Some(Ok(out)) => log::info!("git {when}-sync: {:?}", out.kind),
        Some(Err(e)) => log::warn!("git {when}-sync failed: {e}"),
        None => log::warn!("git {when}-sync did not finish in time — completes on next resume"),
    }
}
