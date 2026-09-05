# 0006 — Kanban store: one folder per board, one JSON file per card

**Status:** accepted · **Date:** 2026-09-05 · **Decider:** Sebastian Grundhöfer

## Context

The old app kept Kanban state as `@status(...)` tokens inside note lines and rewrote notes on every column move, which violates the rewrite's "never rewrite untouched bytes" rule. Sync clients copy files, not records: one JSON file per board turns every concurrent edit into a vendor conflict copy the app would have to parse and merge, and SQLite in a synced folder is documented to corrupt. Google Drive's policy on dot-folders could not be verified, and the old watcher and sync manifest skipped dot-paths, so `.novalis/kanban/` is not a safe home. Two devices editing different cards offline must never conflict in any sync client.

## Decision

- Layout: `<vault>/boards/<slug>/board.json` + `cards/<ULID>.json` + `conflicts/`. A folder is a board only if it holds a valid `board.json`; other files under `boards/` are ordinary notes and `doctor` reports `.md` files inside a board folder.
- `board.json`: `{format, name, columns:[{id, name}], updated}`; card: `{id, title, column, order, notes:[vault-relative paths], created, updated}` plus an optional `deleted` tombstone timestamp. Pretty-printed, sorted keys, trailing newline, atomic writes with the read-time precondition, temp names never `.lock`, unknown keys round-trip untouched, `updated` bumped only by user or CLI edits.
- Identity and order: card id = ULID; column id = stable slug with a separate display name; `order` = fractional-index string, sort `(order, id)`; only the moved card is ever re-keyed. A card whose column no longer exists shows in the first column with a marker.
- Conflicts (Mode 1): a sibling in `cards/` whose parsed `id` equals an existing card is a conflict copy; identical bytes → trashed without a `conflicts/` entry; otherwise whole-card last-writer-wins on `updated` (tie → bytewise larger content), the winner's bytes written verbatim, the loser moved to `conflicts/<id>-<updated>.json` with `RENAME_EXCL`, one-line notice. `board.json` conflicts union the columns.
- Approved extras (§4.4): soft-delete tombstones (`deleted`, purged after 30 days on the next write of that board's card set, no timer); several boards per vault (switcher appears only with more than one board). Configurable = board name + column list. No further card fields.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| `.novalis/kanban/*.json` | Dot-folder sync unverified for Google Drive; old watcher and manifest skipped dot-paths |
| One JSON file per board | Every concurrent edit becomes a vendor conflict copy to parse and merge |
| Tokens in note bodies (old app) | Rewrites notes the user did not edit; the Kanban must be its own data (Rule 10) |
| SQLite inside the vault | Documented corruption under sync clients |
| Extra card fields (description, due, tags, colour, WIP limits, swimlanes) | Each is a schema addition; owner said no |
| Hard delete without tombstone | A card edited on one device and deleted on another is resurrected by the sync client |

## Consequences

- Board folders appear in the tree as one "board" item; `board.json` and `cards/*.json` are excluded from the note cache.
- Rename/move rewrites card `notes[]` together with note links (ADR-0005); `card ls --note <note>` answers "which cards link here" and the backlinks list shows them.
- Fixture generator and tests cover conflict siblings, identical-bytes siblings, tombstones, orphaned columns and unknown keys.
- The Google Drive Spike D checks `boards/` behaviour; the fallback (PLAN.md §14) is a single `board.json` with card-level LWW for Drive vaults.

**Owner approval:** 2026-09-05 — "section 4 please make your recommedations" (docs/DECISIONS.md: "Kanban soft-delete tombstones: yes", "Several boards per vault: yes", "Kanban extra card fields: no", "Kanban placement: pane in the same window", "Card click: opens the linked note in a tab").

## Sources

PLAN.md D6, D17, D21, §4.4, §8.1–§8.5, §14 · docs/DECISIONS.md · docs/research/2026-09-05-kanban.md (R7), 2026-09-05-sync.md
