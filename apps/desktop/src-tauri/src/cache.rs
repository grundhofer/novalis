//! One cache actor per open vault: the shell's only writer to the SQLite
//! index.
//!
//! The database lives in app-data and never inside the vault (PLAN.md §5.6
//! rule 7): a WAL file under a sync client corrupts. The path is the one
//! `novalis-cli` computes, so the app and the CLI share a single file and the
//! CLI can skip its own scan while this heartbeat is fresh (§9.1).
//!
//! Readers do not go through the actor. `Cache::incremental_scan` finishes
//! every file read before it opens its write transaction, and the connection
//! is WAL, so a short-lived read connection on another thread is safe while a
//! scan runs. The actor exists to keep writes single and off the UI thread,
//! not to serialize reads.
//!
//! The scan owns a dedicated OS thread because the materialize-off guard is
//! per thread (§5.6 rule 7); leaving it set on a pooled thread would leak the
//! policy into unrelated work.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use novalis_core::cache::Cache;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;
use tauri_specta::Event;

/// Half of `novalis_core::cache::WATCHER_MAX_AGE`, so a live app always looks
/// alive to a CLI that checks between two beats.
const HEARTBEAT: Duration = Duration::from_secs(5);

/// How long the vault has to be quiet before a rescan runs. A rename storm
/// from a sync client arrives as many batches; this coalesces them into one.
const SETTLE: Duration = Duration::from_millis(750);

/// Emitted after every completed scan, so the panels that read the cache
/// refetch when there is something new rather than on a timer (§2.3 rule 12
/// forbids polling).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct CacheUpdated {
    /// False when the cache could not be opened or scanned; the tag filter and
    /// the backlinks list then say so instead of showing an empty result.
    pub indexed: bool,
}

enum Msg {
    Rescan,
    Stop,
}

/// Ask for a rescan. Cloned into the watcher, which has no other business
/// with the cache.
#[derive(Debug, Clone)]
pub struct Rescan(SyncSender<Msg>);

impl Rescan {
    /// Coalescing by construction: the channel holds one slot, so a request
    /// made while one is already queued is dropped rather than queued again.
    pub fn request(&self) {
        let _ = self.0.try_send(Msg::Rescan);
    }
}

#[derive(Debug)]
pub struct CacheHandle {
    tx: SyncSender<Msg>,
    indexed: Arc<AtomicBool>,
}

impl CacheHandle {
    pub fn rescan(&self) -> Rescan {
        Rescan(self.tx.clone())
    }

    pub fn indexed(&self) -> bool {
        self.indexed.load(Ordering::SeqCst)
    }
}

impl Drop for CacheHandle {
    fn drop(&mut self) {
        // Never joined: a scan already running finishes against the old
        // vault's own cache file, which the next vault never opens.
        let _ = self.tx.try_send(Msg::Stop);
    }
}

/// Start the actor and return immediately. The first scan runs on the new
/// thread, so opening a vault never waits for it.
pub fn spawn(app: AppHandle, cache_dir: PathBuf, root: PathBuf) -> CacheHandle {
    let (tx, rx) = sync_channel::<Msg>(1);
    let indexed = Arc::new(AtomicBool::new(false));
    let flag = indexed.clone();
    let _ = std::thread::Builder::new()
        .name("novalis-cache".into())
        .spawn(move || run(app, cache_dir, root, rx, flag));
    CacheHandle { tx, indexed }
}

fn run(
    app: AppHandle,
    cache_dir: PathBuf,
    root: PathBuf,
    rx: std::sync::mpsc::Receiver<Msg>,
    indexed: Arc<AtomicBool>,
) {
    // An unopenable cache is not fatal: search still works without it, and the
    // panels that need it report `indexed: false`.
    let Ok(mut cache) = Cache::open(&cache_dir, &root) else {
        let _ = CacheUpdated { indexed: false }.emit(&app);
        return;
    };

    let mut ok = cache.incremental_scan().is_ok();
    indexed.store(ok, Ordering::SeqCst);
    // The heartbeat starts only after the first scan: while it runs the rows
    // are incomplete, and a CLI that saw a live heartbeat would serve them.
    let mut beat = Instant::now();
    if ok {
        let _ = cache.touch_watcher();
    }
    let _ = CacheUpdated { indexed: ok }.emit(&app);

    let mut due: Option<Instant> = None;
    loop {
        let wait = due
            .map(|d| d.saturating_duration_since(Instant::now()))
            .unwrap_or(HEARTBEAT)
            .min(HEARTBEAT);
        match rx.recv_timeout(wait) {
            Ok(Msg::Rescan) => due = Some(Instant::now() + SETTLE),
            Ok(Msg::Stop) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }

        if due.is_some_and(|d| Instant::now() >= d) {
            due = None;
            ok = cache.incremental_scan().is_ok();
            indexed.store(ok, Ordering::SeqCst);
            if ok {
                let _ = cache.touch_watcher();
                beat = Instant::now();
            }
            let _ = CacheUpdated { indexed: ok }.emit(&app);
        } else if ok && beat.elapsed() >= HEARTBEAT {
            let _ = cache.touch_watcher();
            beat = Instant::now();
        }
    }
}
