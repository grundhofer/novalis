# 0002 — No update check, no auto-update

**Status:** accepted · **Date:** 2026-09-05 · **Decider:** Sebastian Grundhöfer

## Context

The old README promised "no telemetry, no analytics, no crash reporting, and no update check" and told users how to verify it (no such dependency in `Cargo.toml` or `package.json`, no `updater` block in `tauri.conf.json`). Tauri's updater plugin would add one outbound call at launch, a signing-key custody problem, and it only works with signed builds, which are deferred for the coming year (ADR-0010). Sync Mode 1 (PLAN.md §5.6) contains no network code at all, so the outbound-connection table in `docs/PRIVACY.md` is empty. The main `homebrew/cask` tap rejects un-notarized artefacts and applies notability criteria this repository does not meet (verified, PLAN.md §4.5).

## Decision

v1 ships no update check and no updater. The update path is the GitHub Releases page; optionally a personal Homebrew tap `grundhofer/homebrew-novalis` carries the unsigned cask (installed with `--no-quarantine` or opened via right-click ▸ Open). `docs/PRIVACY.md` keeps the old promise word for word, and CI keeps it honest: a parity check greps the workspace for HTTP clients (`reqwest` and friends) and fails when one appears without an ADR number (PLAN.md §11.5). Any future outbound connection needs its own ADR and its own row in the privacy table.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Tauri updater plugin | +1 network call at every launch, update-signing key custody, and it needs signed builds (ADR-0010 defers those) |
| Opt-in "check for updates on launch" | Two gated items at once: a new setting (ADR-0004 allow-list) and a new network call |
| `homebrew/cask` main tap | Rejects un-notarized artefacts; notability criteria not met (verified) |
| Sparkle-style feed via the app | Same network call, plus a second update mechanism to maintain next to GitHub Releases |

## Consequences

- Users learn about releases from GitHub (watch ▸ releases, the releases Atom feed) or `brew upgrade` on the personal tap; release notes must be self-contained (`docs/RELEASING.md`).
- App/CLI version skew is reported locally by `novalis doctor`, never by a network check (PLAN.md §9.2).
- The `docs/PRIVACY.md` ↔ HTTP-client grep parity check is part of `just check`; a new outbound call without an ADR fails CI.
- When Sync Mode 2 (PLAN.md §5.7) is approved, it gets its own ADR and its own privacy rows; this ADR still forbids an update check.

**Owner approval:** 2026-09-05 — "section 4 please make your recommedations" (docs/DECISIONS.md, "Owner answers of 2026-09-05"), adopting the PLAN.md §4.5 row "Auto-update: None (keep the old promise: no update check)".

## Sources

PLAN.md §4.5, §11.4, §11.5 · docs/DECISIONS.md (Product and platform, "Auto-update") · old repository `README.md` "Privacy & network" · Homebrew cask acceptance criteria (verified 2026-09-05, PLAN.md §4.5)
