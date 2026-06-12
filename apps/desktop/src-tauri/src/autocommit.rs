//! Background auto-committer (Git sync P1). A per-vault thread that commits
//! pending changes every `git.auto_commit_secs` while git sync is enabled.
//!
//! Lifecycle mirrors the file watcher: the thread is tagged with the
//! generation issued at vault-open (the same [`crate::watcher::WATCH_GEN`]
//! counter) and exits as soon as another vault open bumps it. Prefs are
//! re-read from the vault every tick, so toggling the setting in the UI
//! takes effect without restarting anything.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use novalis_core::git;
use novalis_core::vault::config;

/// Floor for the configured interval — protects against a hand-edited
/// config.json committing on every tick.
const MIN_INTERVAL_SECS: u64 = 30;
/// How often the thread wakes to check generation + elapsed interval.
const TICK: Duration = Duration::from_secs(10);

/// Spawn the auto-commit thread for `vault`, tagged with `generation`.
pub fn start(vault: PathBuf, generation: u64) {
    std::thread::spawn(move || {
        let mut last_attempt = Instant::now();
        loop {
            std::thread::sleep(TICK);
            if crate::watcher::WATCH_GEN.load(Ordering::SeqCst) != generation {
                break;
            }
            let prefs = config::read_preferences(&vault);
            if !prefs.git.enabled {
                continue;
            }
            let interval = u64::from(prefs.git.auto_commit_secs).max(MIN_INTERVAL_SECS);
            if last_attempt.elapsed() < Duration::from_secs(interval) {
                continue;
            }
            last_attempt = Instant::now();
            let result = git::ensure_repo(&vault).and_then(|()| {
                git::commit_all(&vault, &prefs.git.author_name, &prefs.git.author_email)
            });
            match result {
                Ok(Some(c)) => {
                    log::info!(
                        "git auto-commit {}: {}",
                        &c.id[..7.min(c.id.len())],
                        c.message
                    )
                }
                Ok(None) => {}
                Err(e) => log::warn!("git auto-commit failed: {e}"),
            }
        }
        log::info!("git auto-committer for {} stopped", vault.display());
    });
}
