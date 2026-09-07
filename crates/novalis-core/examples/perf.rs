//! The core half of the PLAN.md §11.3 budgets, measured rather than asserted.
//!
//! Usage: `cargo run --release -p novalis-core --example perf -- <vault> <cache-dir>`
//!
//! Prints one JSON object on stdout: what was measured, and — just as
//! important — what was not. `perf.yml` feeds it to `scripts/perf-budget.mjs`,
//! which compares the measured rows against `docs/BUDGET.json` and fails the
//! job on a breach.
//!
//! Only the two budgets that can honestly be measured from the core are here.
//! Everything about the app (first paint, keystroke latency, RSS, note-open
//! times) needs the shell running with instrumentation that does not exist
//! yet; those rows are listed under `unmeasured` so a green run can never be
//! read as full coverage.
//!
//! Timing uses `std::time::Instant` rather than a benchmarking framework: a new
//! dependency needs an owner decision (CLAUDE.md), and a coarse gate at 2x the
//! budget does not need statistical machinery.

use std::path::PathBuf;
use std::time::Instant;

use novalis_core::cache::Cache;
use novalis_core::search::{search, SearchQuery};

/// Time-to-first-hit samples. The scan is parallel and IO-bound, so a handful
/// of runs after a warm-up is enough to separate "well inside budget" from
/// "over it", which is all this gate decides.
const SEARCH_RUNS: usize = 20;

/// Rows this harness cannot measure, with the reason. Kept next to the numbers
/// so the JSON is self-describing.
const UNMEASURED: &[(&str, &str)] = &[
    (
        "firstPaintMs",
        "needs the shell and --exit-after-first-frame (Spike C)",
    ),
    ("treeInteractive10kNotesMs", "needs the shell"),
    ("idleRssMb", "needs the shell; per-process split is Spike C"),
    ("openNote100KbP95Ms", "needs the shell"),
    ("openNote1MbMs", "needs the shell"),
    ("openNote5MbPlainMs", "needs the shell"),
    ("openNote50MbPlainMs", "needs the shell"),
    (
        "keystrokeP50Ms",
        "needs CodeMirror in the webview (Spike C)",
    ),
    (
        "keystrokeP95Ms",
        "needs CodeMirror in the webview (Spike C)",
    ),
    (
        "watcherBurst1000FilesMaxTreeUpdates",
        "needs the shell watcher",
    ),
    ("watcherBurstUiThreadMs", "needs the shell"),
    ("dmgMb", "measured on the release artifact, not here"),
];

fn percentile(sorted: &[u128], p: f64) -> u128 {
    if sorted.is_empty() {
        return 0;
    }
    // Nearest-rank: with 20 samples p95 is the 19th, which is what a coarse
    // gate should use — no interpolation to argue about.
    let rank = ((p / 100.0) * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)]
}

fn main() {
    let mut args = std::env::args().skip(1);
    let vault = PathBuf::from(args.next().expect("usage: perf <vault> <cache-dir>"));
    let cache_dir = PathBuf::from(args.next().expect("usage: perf <vault> <cache-dir>"));

    // A fresh cache directory, so this measures the cold scan the budget names
    // rather than a no-op second pass.
    let mut cache = Cache::open(&cache_dir, &vault).expect("open the cache");
    let started = Instant::now();
    let report = cache.incremental_scan().expect("scan the vault");
    let scan_ms = started.elapsed().as_millis();

    let query = SearchQuery {
        // A term the generated vault carries throughout, so the scan reaches
        // every folder rather than stopping at the first match.
        query: "the".into(),
        regex: false,
        case_sensitive: false,
        folder: None,
        tag: None,
        limit: None,
        snippets: true,
        all_files: false,
    };

    // One warm-up so the measured runs are not paying for cold page cache.
    let mut sink = |_: novalis_core::search::SearchHit| true;
    let _ = search(&vault, &query, None, &mut sink);

    let mut first_hit_ms: Vec<u128> = Vec::with_capacity(SEARCH_RUNS);
    for _ in 0..SEARCH_RUNS {
        let start = Instant::now();
        let mut first: Option<u128> = None;
        let mut on_hit = |_: novalis_core::search::SearchHit| {
            if first.is_none() {
                first = Some(start.elapsed().as_millis());
            }
            true
        };
        search(&vault, &query, None, &mut on_hit).expect("search the vault");
        first_hit_ms.push(first.unwrap_or_else(|| start.elapsed().as_millis()));
    }
    first_hit_ms.sort_unstable();

    let unmeasured = UNMEASURED
        .iter()
        .map(|(k, why)| format!("    {{ \"budget\": \"{k}\", \"why\": \"{why}\" }}"))
        .collect::<Vec<_>>()
        .join(",\n");

    println!(
        concat!(
            "{{\n",
            "  \"notesIndexed\": {},\n",
            "  \"measured\": {{\n",
            "    \"incrementalScan10kNotesMs\": {},\n",
            "    \"searchFirstResults10kNotesP95Ms\": {}\n",
            "  }},\n",
            "  \"searchSamples\": {{ \"runs\": {}, \"minMs\": {}, \"p50Ms\": {}, \"maxMs\": {} }},\n",
            "  \"unmeasured\": [\n{}\n  ]\n",
            "}}"
        ),
        report.scanned,
        scan_ms,
        percentile(&first_hit_ms, 95.0),
        SEARCH_RUNS,
        first_hit_ms.first().copied().unwrap_or(0),
        percentile(&first_hit_ms, 50.0),
        first_hit_ms.last().copied().unwrap_or(0),
        unmeasured,
    );
}
