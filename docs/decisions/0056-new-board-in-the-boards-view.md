# 0056 — „Neues Board …“ in the boards view

**Status:** accepted · **Date:** 2026-11-15 · **Decider:** Sebastian Grundhöfer

**Amended by:** ADR-0057 (2026-11-15) — the button stands above the boards, in a head row outside their scrolling list, no longer after the last board.

## Context

ADR-0054 made the pinned „Boards“ tab the place where every board is kept. A new board could still only be made from the File menu („Neues Board …“) or the palette; the view itself offered nothing, and its empty state only pointed at the menu (DAT-07, „no button of its own“ since ADR-0048). The owner, trying v1.4.0, did not find a way to add a board there.

## Decision

- The boards view ends with a secondary „Neues Board …“ (`sb-secondary-action--compact`, as „Spalte hinzufügen“ in a board's head), after the last board, under the same hairline that divides the boards. It runs the File menu's command: the same name dialog, then the view scrolls to the new board.
- The empty state („Noch kein Board“) carries the same button; its sentence no longer names the File menu.
- The File menu entry and the palette command stay. The action zone keeps „Neue Notiz“ as the window's one primary (ADR-0048); the new button is secondary, so there is still one primary.

No setting, no shortcut, no dependency, no new IPC command.

## Consequences

- Amends ADR-0048's „the empty state's own button goes“ for the boards view only.
- i18n `board.newBoardAction`; `board.noBoardText` reworded in both catalogs.

**Owner approval:** 2026-11-15 — „alter verwalter, denkst du nicht in der board ansicht, sollte eine solche aktion angeboten werden?“

## Sources

ADR-0048 · ADR-0054
