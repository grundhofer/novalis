# 34. Deleting a board

Date: 2026-09-23

## Status

Accepted. Adds a destructive action to the board pane and gives the tree's
existing Move to Trash on a board row the same confirmation. Two catalog
strings. No IPC command (the existing `trash`), no setting, no dependency.

## Context

Nothing designed deleted a board: the pane had no action, the CLI has no
`board rm`, and ADR-0021 assumed "rename and delete live in the board
pane". Yet `Cmd+Delete` (or File ▸ Move to Trash) on a selected board row
already trashed `boards/<slug>` by accident of the file path: the
confirmation named the slug like a file, and the pane kept showing the
deleted board. The owner answered the feature-gap question on 2026-09-20
(`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `kanban-delete-board` — "delete board
as a designed action" (row B52 of
`docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **Delete Board** in the board pane's header, beside Add Column, and the
  board's tree row through Move to Trash (`Cmd+Delete`, File menu,
  palette): one function, one confirmation — "Board {name} goes to the
  Trash with all its cards. The notes they link to are not touched."
- The whole `boards/<slug>/` folder goes to the macOS Trash (PLAN.md
  "never delete, always trash"): `board.json`, `cards/`, `conflicts/`. The
  Trash is the undo; a cloud-only folder is refused by the core as for any
  file. The notes the cards link to are not touched (§2.3 rule 10).
- Afterwards the board is off the list, out of the pane if it was shown,
  and `activeBoard` is cleared so `state.json` does not bring it back.
- **Not built:** `board rm` in the CLI, a card count in the confirmation
  (it would need the board read, which resolves conflicts as a side
  effect, §8.4), tombstones for boards.

## Consequences

- The tree's context menu for a board row is unchanged (Show in Finder
  only, ADR-0021); the delete is in the pane and behind `Cmd+Delete`.
- `commands.test.ts` covers the tree route, the confirmation and the
  clean-up. The trash itself is the existing, tested `trash` command.
