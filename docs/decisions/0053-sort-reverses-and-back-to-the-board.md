# 0053 — A second press reverses the sort; a note opened from a card leads back to the board

**Status:** accepted · **Date:** 2026-11-15 · **Decider:** Sebastian Grundhöfer

## Context

The tree's sort choice (ADR-0012, ADR-0051 #95) had fixed directions: name ascending, modified newest first, and a second press on the chosen switch did nothing. A note opened from a board card hid the board; the way back was the board's pinned tab (ADR-0050, ADR-0051 #35), which the owner did not see as one. Back/Forward does not know the board (ADR-0050).

The owner asked for both on 2026-11-15, as the first of a series of board changes that ADR-0054 will record.

## Decision

1. **Sort direction.** A press on the switch that is already chosen reverses its direction: name runs Z to A, modified oldest first. A press on the other switch chooses it in its usual direction. The direction is state, not a setting: `treeSortReversed` in `state.json` beside `treeSort` (`UiStateDto`, `serde(default)`, so an older file reads as not reversed). The arrow on the chosen switch shows the direction it sorts in, its hidden word says ascending or descending, and its tooltip says that a press reverses the order. Folders stay first; by name they follow the direction too, since a folder has a name to order by, while by modified they stay A to Z as before (a folder has no modification time worth ordering by, ADR-0012).
2. **Back to the board.** Opening a card's note from the board (a click on the card, its note's name on it, „Notiz öffnen“ in its menus, „Notiz aus Karte erstellen“) remembers that note and the board it came from, for the session. While that note is current and the board is hidden, the title bar shows „Zurück zu <Board>“, the compact text action with `arrow-left` that the settings view already uses there (ADR-0051 #1). A press shows that board again. The settings view's own „Zurück“ takes precedence while it shows. Opening another card's note replaces the memory; a restart forgets it.

No setting, no menu item, no shortcut, no IPC command, no dependency. Two catalog strings (`tree.sortReverse`, `board.backTo`), one `state.json` key.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Two more `treeSort` values (`nameDesc`, `modifiedAsc`) | Mixes the order and its direction in one key; an older build would read either as unknown and drop it to „name“ |
| The board in Back/Forward history | ADR-0050 keeps the board out of history; the history would need a second kind of entry |
| The back button in the note's tool row | Not every opened file has a tool row (viewers, a PDF); the title bar already holds the one other „Zurück“ |

## Consequences

- `UiStateDto` has one more key; the bindings are regenerated.
- The back button is only there for a note opened from the board in this session; a note opened from the tree, ⌘P or a link has none, and a restart drops it.

**Owner approval:** 2026-11-15 — „ein zweiter klick auf geändert oder name sortiert anders herum.“ and „wenn man auf die board karten draufklickt und sich die notiz öffnet, dann sollte man per button zurück auf das board springen können.“ The details (direction kept in `state.json`, folders first, the button in the title bar) were put to the owner the same day as the default, without objection.

## Sources

ADR-0012 · ADR-0050 · ADR-0051 #1, #35, #95
