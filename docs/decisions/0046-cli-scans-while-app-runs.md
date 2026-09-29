# 46. The CLI scans before every read, also while the app runs

Date: 2026-09-29

## Status

Accepted. Replaces the heartbeat skip of PLAN.md §9.1 and D7: index-backed
CLI reads run the incremental scan first whether or not the desktop app is
live. The heartbeat stays and keeps its meaning in `index --status`. No new
command, field, setting or dependency.

## Context

PLAN.md §9.1 let the CLI skip its own scan while the app's
`watcher_alive_at` heartbeat was younger than 10 s, trusting the app's
cache actor to keep the rows current. That actor rescans a vault only
after the watcher has been quiet for `SETTLE` (750 ms), plus the watcher's
100 ms debounce, plus the scan itself. A CLI read issued right after a CLI
write therefore served the rows from before the write.

Found in the File Provider checklist run, session 2, 2026-09-29, with the
release app open on `OneDrive-Persönlich/novalis-test`: `novalis edit
--set-body` followed at once by `novalis links` returned the previous
body's links 5 times out of 5, and the right ones two seconds later; a
note created a moment earlier showed no links at all. The output said
`stale: false`. The same sequence on a vault the app was not watching was
always fresh. Write-then-verify is exactly what the agent skill tells an
agent to do after `mv` or `relink`, so this was a silent wrong result, which
the owner's rule for the 1.0 checklist (2026-09-23) puts before 1.0.

The question, as asked on 2026-09-29: "Befund 3 lässt sich am einfachsten
beheben, indem die CLI geänderte Dateien immer selbst neu einliest. Das
ändert aber das Verhalten aus PLAN §9.1 und braucht dein Ja." The owner's
answer:

> ja, mach 1-3 wie vorgeschlagen

## Decision

- **Every index-backed read scans first.** `Ctx::index` runs
  `Cache::incremental_scan` unless `--no-index` was passed, regardless of
  the heartbeat. The scan stats every note and reads only the bodies whose
  `(mtime, size)` changed or whose `cloud_only` flipped, so what the CLI just
  wrote is read once and the rest is a stat.
- **`indexSource` keeps its values and changes its sense.** `"app"` now
  means the app's heartbeat is younger than 10 s — the app is live on this
  vault and keeps the cache current too — and `"scan"` means it is not.
  Neither value says a scan was skipped any more; `stale` alone says whether
  this invocation refreshed the rows (`--no-index`, or a busy cache).
- **Two writers, one lock.** The app's actor and a CLI process can now both
  write the cache while the app runs. The cache is WAL with a 5 s
  `busy_timeout`, and `incremental_scan` does all its file reads before it
  opens its write transaction, whose first statement is a write, so a
  second writer waits on SQLite's lock rather than failing on a stale
  snapshot. Both derive their rows from the files; if a file changes between
  the two reads, the writer that commits second can leave a row for the
  older content, and the next scan — by either — corrects it, because every
  scan compares the row's `(mtime, size)` against the file. A CLI that
  waits past 5 s serves the existing rows behind the `stale_index` warning,
  as before.
- **Not changed:** the heartbeat itself, the app's actor, `--no-index`,
  `index --rebuild` (still exit 6 while the app holds the lock).

## Consequences

- A CLI read costs the incremental scan also while the app runs — the
  cost it already paid whenever the app was closed, budgeted in PLAN.md
  §11.3 at 1.5 s for 10k notes (measured with `just perf` for this change;
  numbers in the PR).
- PLAN.md D7, the §5.2 shell line and §9.1, the agent skill's reference and
  the comments in `apps/desktop/src-tauri/src/cache.rs` say so.
- Test: a CLI integration test stamps a live heartbeat into the cache, edits
  a note and reads its links in the next invocation.
