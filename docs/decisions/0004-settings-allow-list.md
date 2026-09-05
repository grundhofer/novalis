# 0004 — Settings allow-list: four keys, no preferences window

**Status:** accepted · **Date:** 2026-09-05 · **Decider:** Sebastian Grundhöfer

## Context

The old app carried a 763-line preferences model and 34 feature flags; the brief for the rewrite says "ask before adding any setting or feature". PLAN.md §4.1 proposed exactly four persisted settings and listed everything else as hard-coded defaults (§4.2) or transient palette commands. A `Settings` struct with `deny_unknown_fields` and a parity test against `docs/SETTINGS.md` makes the allow-list enforceable in CI rather than by review. Window geometry, open tabs and the sidebar width are state, not settings, and live in a free-form `state.json`.

## Decision

`settings.json` (path per ADR-0003) contains exactly:

| Key | Values | Default | Changed via |
|---|---|---|---|
| `version` | integer schema stamp | `1` | code only |
| `language` | `system` · `de` · `en` | `system` | View ▸ Language (fallback; macOS per-app language is primary) |
| `appearance` | `system` · `light` · `dark` | `system` | View ▸ Appearance |
| `editor.fontSize` | integer (CSS px) | `16` | `Cmd-=` / `Cmd--` / `Cmd-0` |
| `spellcheck` | boolean | `true` | Edit ▸ Spelling ▸ Check Spelling While Typing |
| `lastVault` | absolute path or `null` (state, not a setting) | `null` | Open Vault… |

No preferences window; `Cmd-,` stays unbound (ADR-0008). The hard-coded defaults of PLAN.md §4.2 are accepted as written. The `Settings` struct uses `deny_unknown_fields`; `docs/SETTINGS.md` is the documented table and the parity test fails CI when struct and table differ. Adding a key requires a new ADR with a quoted owner yes, a row in `docs/SETTINGS.md`, and both catalog strings for its UI.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| `style` key (switch design at runtime) | One style is chosen at design time (ADR-0007); tokens swap at build time |
| `vaults[]` / recent vaults list | Multi-vault is a feature beyond the brief (§4.4: no) |
| `sync.mode` / `sync.folder` | Meaningless in Mode 1; Mode 2 gets its own ADR |
| Preferences window with the four items | Chrome the brief avoids; two drop-downs and a checkbox fit in menus |
| Per-file-type autosave rules | A hidden setting; D19 fixes autosave for all types at 1,000 ms |
| Folder colours, manual tree order, feature flags | Dropped with the old app (PLAN.md §2.2) |

## Consequences

- CI fails on an undocumented key in either direction (struct without doc row, doc row without struct field).
- Menus and shortcuts are the only settings UI; each setting has exactly one place where it is changed.
- `language: system` relies on macOS per-app language selection working inside a Tauri bundle (ASSUMED; Spike C verifies; the View ▸ Language menu is the fallback).
- `state.json` is free-form, never documented in `SETTINGS.md`, and may be deleted at any time.

**Owner approval:** 2026-09-05 — "section 4 please make your recommedations" (docs/DECISIONS.md, "Settings (§4.1) — all four approved": `language` yes, `appearance` yes, `editor.fontSize` yes, `spellcheck` yes; "No preferences window").

## Sources

PLAN.md §4.1, §4.2, §5.5, D12, §11.5 · docs/DECISIONS.md · docs/SETTINGS.md
