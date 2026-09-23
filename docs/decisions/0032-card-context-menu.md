# 32. A context menu on cards

Date: 2026-09-23

## Status

Accepted. Adds a native context menu on board cards and one catalog string
(`board.moveToColumn`). The IPC command `tree_context_menu(board)` is
generalised to `context_menu(target)` instead of adding a new one, so the
count stays at 28 of the 30 PLAN.md §2.3 rule 8 allows. No setting, no
dependency.

## Context

A card's actions were hover buttons, and a card changed columns only by
drag. The owner's own form for such actions is the right-click ("open in
finder per rechtsklick?", ADR-0021). The owner answered the feature-gap
question on 2026-09-20 (`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `kanban-card-context-menu` — "a
context menu on cards with a Column submenu, `tree_context_menu`
generalised, 27 stays 27" (row B11 of
`docs/research/2026-09-20-feature-gaps.md`; the count was 27 when written
and is 28 since `read_packed`, ADR-0023).

## Decision

- **Right-click on a card pops a native menu** built by the shell from the
  catalog like the tree's (ADR-0021): Open Note (only for a card with a
  note), Rename, Edit Description, Delete Card, a separator, and **Move to
  Column ▸** with one item per column of the board, the card's own column
  shown disabled. The submenu is left out for a board of one column.
- The labels are the pane's existing strings (`board.openNote`,
  `menu.file.rename`, `board.editDescription`, `board.deleteCard`) plus
  `board.moveToColumn`.
- **One IPC command for both menus**: `context_menu(target)` with
  `target = {kind: "tree", board} | {kind: "card", columns, column,
  hasNote}`. The ids of the card menu are `card.openNote`, `card.rename`,
  `card.editDescription`, `card.delete` and `card.moveToColumn:<column id>`;
  the UI remembers which card it asked for and runs the same functions the
  hover buttons run (`lib/cardActions.ts`), against the card as it is when
  the click arrives — a card gone by then is left alone. A move puts the
  card last in the column.
- **Not built:** Move to Board ▸ (the drag onto a board row exists,
  ADR-0019, and a second path was not asked for), a chord, a menu on the
  column header.

## Consequences

- `MENU_KEYS` carries the five labels, so the i18n test checks them;
  `docs/KEYMAP.md` has the gesture row; ADR-0021 is amended for the rename
  of its command.
- `cardActions.test.ts` covers the request and the dispatch; the native
  popup itself is checked by hand in the app.
