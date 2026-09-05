# 0003 — App identifier, keychain service and app-data directory

**Status:** accepted · **Date:** 2026-09-05 · **Decider:** Sebastian Grundhöfer

## Context

The old app registered itself as `com.novalis.desktop` / `app.novalis` and keeps a `settings.json` with `recentVaults` and a 763-line preferences model in its app-data directory. Reusing that identifier would inherit those files, share the Launch Services identity, and block running old and new app side by side while a vault is migrated (PLAN.md D15). The owner does not control the `novalis` domain, so a reverse-DNS name under the GitHub Pages domain is the honest choice. Old app-data must survive untouched so the legacy app keeps working until the user deletes it.

## Decision

- Bundle identifier: **`io.github.grundhofer.novalis`**.
- Keychain service name: **`io.github.grundhofer.novalis`** (unused in v1; reserved for Sync Mode 2).
- App-data directory: **`~/Library/Application Support/io.github.grundhofer.novalis/`**, created fresh, holding `settings.json` (ADR-0004), `state.json` and `cache/<vaultkey>-s<schema>.sqlite` (PLAN.md §5.5).
- The old app-data directories and keychain items are never read, written or deleted by the new app. The only legacy file the new app reads is the vault-side `.novalis/config.json`, once, for `novalis migrate` (PLAN.md D23, §10).

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Reuse `com.novalis.desktop` / `app.novalis` | Inherits `settings.json` and `recentVaults`, shares Launch Services identity, prevents side-by-side use during migration |
| Import the old settings on first launch | 763-line model of which four keys survive (ADR-0004); an importer for four values is not worth a code path that touches old state |
| An identifier under a domain the owner does not own (`app.novalis`) | Not verifiable, collides with whoever owns it |

## Consequences

- Old and new app run side by side; the user deletes the old app-data and keychain entries by hand when done (the legacy release note says so).
- Launch Services sees a new app: file associations, if any are ever added, start from zero.
- The `vaultkey` cache naming (first 16 hex of SHA-256 over the NFC-normalized absolute vault path) lives under the new directory; caches are disposable.
- `tauri.conf.json` `identifier`, the keychain service constant and the app-data path derive from one constant; a test asserts they agree.

**Owner approval:** 2026-09-05 — "section 4 please make your recommedations" (docs/DECISIONS.md, "Owner answers of 2026-09-05"), adopting PLAN.md D15 and the §10 "Identifier" bullet as recommended.

## Sources

PLAN.md D15, §5.5, §10, D23 · docs/DECISIONS.md · docs/research/2026-09-05-critique.md (identifier finding)
