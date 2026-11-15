# 0054 — Boards for projects: every board in one view, filtered, sorted, with more on a card

**Status:** accepted; parts 1, 2 and 3a built, 3b to come (see Consequences) · **Date:** 2026-11-15 · **Decider:** Sebastian Grundhöfer

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

**Part 2 — filter and card sort, per board (built):**

- **„Filter“ in each board's head**, a compact secondary action with the filter icon, opens a menu: „Suchen …“, „Spalten“ (a check row per column), „Zuletzt geändert“ (any time, today, 7, 30 or 90 days), „Sortierung“ (manual, title, last changed, created), „Reihenfolge umkehren“ and „Zurücksetzen“. The last shown column cannot be hidden. While anything is on, a line under the head says what („2 Filter · sortiert nach Titel, umgekehrt“) and offers „Zurücksetzen“. The search field stands in that line, because a text field is no menu row. Escape in it clears the search and closes the field.
- **Stored:** `view.hiddenColumns`, `view.changedWithin` (`today`, `7d`, `30d`, `90d`), `view.sort` (`title`, `updated`, `created`; absent is manual) and `view.sortReversed` in `board.json`. The span and the sort are kept as text in the core, so a value a later version adds still reads; this build shows it as none and drops it on its next write of the view.
- **The search is the session's only**, per board, never in `board.json`.
- **Card sort for the whole board:** title A to Z with numbers by value („Aufgabe 2“ before „Aufgabe 10“), last change and creation newest first. Each can be reversed, and ties keep the manual order. Under any sort but manual a card cannot be dropped at a place in its own column; dropped into another column it goes last.
- The card fields of part 3 join the filter when they exist.

**Part 3 — new card fields** (PLAN.md §8.2, in the card file, in the CLI's card JSON as new keys only): labels, a due date, a priority, an assignee. They show on the card, are filterable, and due date and priority are sortable.

**Part 3a — the fields (built):**

- **One dialog „Karte bearbeiten“** with the title, the description, the labels, the due day, the priority and the assignee. It opens from „Bearbeiten …“ in the card's „Mehr“ and its context menu, and from a click on a card without a note. „Umbenennen“ and „Beschreibung bearbeiten“ go: their dialogs and three strings. Only the fields that changed are written, each its own field change (§2.3 rule 10).
- **Labels** are typed comma-separated, and each is kept once regardless of case. On the card each shows as sebaro's category (spec/01 §1.9), the word with a dot in the tone **the user chose for it**: under the field each label has a select of the six tones (Tanne, Jade, Taube, Veilchen, Messing, Malve) or none. The tone holds for the label on this board, as `view.labelTones` in `board.json`. A label without a tone shows its word only.
- **Priority** is Hoch, Mittel, Niedrig or none. On the card „Priorität Hoch“ is sebaro's warning status, and the others are grey words.
- **Due day** is the system's date field. On the card it shows as „fällig 20. Nov.“ (the year only when it is not this one). Before today it is the warning status „überfällig · …“.
- **Assignee** is a free name. The field offers the names already on this board.
- **Card file:** `labels`, `due`, `priority`, `assignee`, each absent while empty (§8.2). Due and priority are checked in the core. Priority is text, so a step a later version adds still reads (and shows as none).
- **CLI:** `card ls` and the card shapes carry the four keys when set, nothing else changes. Setting them from the CLI is not part of this.

**Part 3b — to come:** filter by label, priority, assignee and due („überfällig / heute / diese Woche / ohne Datum“), and sort by due day (earliest first) and by priority.

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
- The CLI is unchanged in parts 1 and 2: `view` is in the file, and `novalis board show` does not print it.
- Part 2: `board_write` takes the whole known view (`BoardViewDto`) in place of part 1's `collapsed`. The core's `set_view` changes it on the file's view, so unknown keys stay. `BoardDto.view` replaces `collapsed`. One icon more in the app's set (`filter`). 23 catalog strings. `MoreMenu` can show a word and an icon as its button and switch choices each on its own (`menuitemcheckbox`). A column's count is the count of the cards it shows, and a column whose cards the filter all hides says „Keine Karte passt zum Filter.“ A new card that does not pass the filter is written but not shown.

**Owner approval:** 2026-11-15. The ask is quoted in Context. The answers to the questions the same day, verbatim as chosen: „Alle untereinander, einklappbar (Recommended)“; filters „Text (Titel + Beschreibung), Spalten ausblenden, Neue Kartenfelder, Zuletzt geändert“; sortable „Karten in den Spalten, Die Boards untereinander“; stored „In board.json (Recommended)“; card fields „Labels, Fälligkeit, Verantwortlich, Priorität“; cut „Mehrere PRs nacheinander (Recommended)“; tab „Ein Reiter „Boards“ (Recommended)“; order „Wie im Baum, per Ziehen (Recommended)“; height „Bis Fensterhöhe, Spalten scrollen (Recommended)“; collapsed „Kopfzeile mit Zählern (Recommended)“. Part 2, the same day: place „Knopf „Filter“ im Kopf (Recommended)“; search text stored „Nein, nur solange die App läuft (Recommended)“; spans „Feste Stufen (Recommended)“; card sort „Für das ganze Board (Recommended)“. Part 3, the same day: editing „Ein Dialog „Karte bearbeiten“ (Recommended)“; priority „Hoch / Mittel / Niedrig / keine (Recommended)“; labels „Farbige Chips“, then, told that sebaro's category wants a tone the user chose, „Ton pro Label wählbar (Recommended)“; due „Datum + „überfällig“ (Recommended)“.

## Sources

PLAN.md §8 · ADR-0019 · ADR-0050 · ADR-0051 #19, #35 · ADR-0053
