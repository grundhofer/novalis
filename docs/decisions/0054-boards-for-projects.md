# 0054 — Boards for projects: every board in one view, filtered, sorted, with more on a card

**Status:** accepted; built in parts (see Consequences) · **Date:** 2026-11-15 · **Decider:** Sebastian Grundhöfer

## Context

The owner wants to manage their projects visibly with the boards. Several boards already existed (`boards/<slug>/`, PLAN.md §8.1), but the view showed one at a time, chosen in a select in its head (ADR-0050, ADR-0051 #35). Cards carry a title, a description, linked notes and two dates (§8.2), nothing to filter or sort by, and the only configuration of a board was its name and its columns (§8.5).

The owner's words on 2026-11-15: „wir müssen die board funktionalität aufbohren, damit wir die projekte damit für mich sichtbar verwalten können. sprich wir benötigen mehr als ein board. am ehesten untereinander, filter und sortierbar in der board ansicht, jeweils konfigurierbar.“ Three rounds of questions followed the same day. Every recommended option was taken, plus every filter and every card field offered.

## Decision

**The view (part 1, built with this ADR).**

1. **Every board, one under the other**, in one scrolling view. Each board is a section with its own head: the disclosure, its name, its counts, „Spalte hinzufügen …“ and its „Mehr“. The select in the head goes.
2. **The tab is „Boards“.** The pinned tab (ADR-0051 #35) stands for the view, and the title bar's place reads vault › Boards. Opening a board (its tree row, the palette, a `novalis://` link, a backlink, „Zurück zu <Board>“ from ADR-0053) shows the view, scrolls to that board and expands it. That board becomes the current one, which the palette's card commands and `activeBoard` in `state.json` mean.
3. **Order as in the tree** (ADR-0019): the boards stand in the order of their `order` keys, then by name. A board's head is dragged above or below another board to move it. A drop writes the same key as a drag in the tree, and there is no separate sort switch.
4. **Height:** a board is as tall as its longest column, never taller than the view. A longer column scrolls in itself and keeps „Neue Karte“ in sight (ADR-0050).
5. **Collapsed:** a board collapses to its head. The head then counts per column („To Do 4 · Doing 2 · Done 9“) and keeps its „Mehr“. The state is kept in its `board.json`.

**Configuration lives in `board.json`** under a new optional key `view`, synced with the vault, so it holds on every device. The key is absent while everything in it has its default, so an untouched board stays byte-identical. Keys a later version adds round-trip untouched. The shell writes it through `board_write` (a new optional argument, no new IPC command, still 29 of 30). Part 1 brings `view.collapsed`.

**Part 2 — filter and card sort, per board, in `view`:**

- Filters: text (title and description), columns hidden, cards changed in the last N days, and the card fields of part 3.
- Card sort within a column: manual (the drag order, as now), by title, by last change, by creation. Any sort but manual turns off the drag within a column; a drag into another column still works.

**Part 3 — new card fields** (PLAN.md §8.2, in the card file, in the CLI's card JSON as new keys only): labels, a due date, a priority, an assignee. They show on the card, are filterable, and due date and priority are sortable.

The details of parts 2 and 3 that the owner was not asked about yet (where the filter sits in the head, the priority's steps, how labels look, the due date's form) are asked before each part is built.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Only the chosen boards in the view | Owner chose all, collapsible |
| One board, a faster switcher | Owner chose all boards one under the other |
| The tab named after the last board opened | The view shows all of them; owner chose „Boards“ |
| A sort switch for the boards (manual / A–Z) in `.novalis/vault.json` | Owner chose the tree's order and dragging |
| Every board at full height, the page scrolling | „Neue Karte“ would scroll out of sight, which ADR-0050 fixed |
| View settings in `state.json` | Local to one Mac; owner chose `board.json` |
| One large PR | Owner chose four PRs in a row: ADR-0053, then parts 1, 2 and 3 |

## Consequences

- Part 1: `Board` in the core has `view: Option<BoardView>` (`collapsed`, unknown keys kept), and `set_collapsed` re-reads and replays like `set_columns`. `BoardDto` carries `collapsed`. The UI's board store keeps every board read (`docs`), not only the current one. A card write goes to the board holding the card, and a watcher batch re-reads the boards it touched. Three catalog strings (`board.all`, `board.collapse`, `board.expand`), and `board.switcher` goes.
- A collapse writes `board.json` and bumps `updated` (a user edit, §8.2). Two devices collapsing differently resolve like any other `board.json` conflict (§8.4).
- Moving a card between two boards in the view by dragging is not part of this: a card dropped on another board's column does nothing, and the tree's board rows still take a card (ADR-0019).
- Moving a board needs the pointer, as its row in the tree does. There is no keyboard way to move a board (no menu item was asked for).
- The CLI is unchanged in part 1: `view` is in the file, and `novalis board show` does not print it.

**Owner approval:** 2026-11-15. The ask is quoted in Context. The answers to the questions the same day, verbatim as chosen: „Alle untereinander, einklappbar (Recommended)“; filters „Text (Titel + Beschreibung), Spalten ausblenden, Neue Kartenfelder, Zuletzt geändert“; sortable „Karten in den Spalten, Die Boards untereinander“; stored „In board.json (Recommended)“; card fields „Labels, Fälligkeit, Verantwortlich, Priorität“; cut „Mehrere PRs nacheinander (Recommended)“; tab „Ein Reiter „Boards“ (Recommended)“; order „Wie im Baum, per Ziehen (Recommended)“; height „Bis Fensterhöhe, Spalten scrollen (Recommended)“; collapsed „Kopfzeile mit Zählern (Recommended)“.

## Sources

PLAN.md §8 · ADR-0019 · ADR-0050 · ADR-0051 #19, #35 · ADR-0053
