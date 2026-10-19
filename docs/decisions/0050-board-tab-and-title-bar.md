# 0050 — The board is a tab; the title bar loses the palette badge

**Status:** accepted · **Date:** 2026-10-19 · **Decider:** Sebastian Grundhöfer

## Context

The owner looked at the sebaro pilot (ADR-0048) in the real window. Three things in it did not work for them. An open board covered the editor with no tab to say so, so the strip still showed a note as current. The title bar's `⇧⌘P` badge read as a second way into the settings beside the sidebar's settings button. And a column's "New Card" sat after the last card, so it scrolled out of sight on a long column and, drawn dashed in a faint colour, hardly showed. They also asked whether the board's buttons match the sebaro concept.

## Decision

| Question | Decision |
|---|---|
| Open board | A tab in the tab strip like a note's: the one open board, first in the strip, with the board icon and the board's name. It is current while the board pane shows (the 3 px place line). The note tabs are not current then. Clicking it shows the board, its × or `⌘W` closes it, and Close All Tabs closes it too. The breadcrumb reads vault / board |
| Palette badge | The `⇧⌘P` button in the title bar goes. The palette keeps its chord and its menu item, and the settings keep the sidebar's settings button |
| New Card | In a foot under each column's cards, outside their scrolling list, so it stays visible however many cards the column holds |
| Look of New Card and New Column | Both are the sebaro secondary action (spec/02 §1.2): a 1 px strong outline, text colour, the title weight, with the plus icon. They stay secondary: lime is the one primary action of a view, "New Note" in the action zone (sebaro D39) |

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Several boards open as tabs at once | One board pane at a time is the existing model (`activeBoard`); more tabs would need a new store shape and a new `state.json` shape |
| Keep the badge and remove the sidebar's settings button | Owner: "ich möchte es unten links behalten und oben rechts entfernen" |
| Make New Card the board's lime primary | Owner: "New Note" is the primary action in every view (ADR-0048) |

## Consequences

- `state.json` is unchanged: the board tab is `activeBoard` plus `boardVisible`. The board tab is not draggable, `⌃⇥` does not step onto it, and it is not in back/forward history.
- ADR-0007 named the badge the signature component; that sentence no longer holds (amended there).

**Owner approval:** 2026-10-19 — "ein offenes board sollte auch wie ein offenes dokument angezeigt werden in der dokumentleiste. aktuell überblendet das einfach alles. wir haben aktuell auch einstellungen zwei mal. ich möchte es unten links behalten und oben rechts entfernen. das neue notiz in einer spalte oder neue karte wie es auch heißt, sollte immer am unteren rand sichtbar bleiben, auch wenn so viele karten auf dem board sind das gescrolled werden muss. auch die schaltfLächen neue spalte und neue karte sind visuell nicht sehr aufällig. entspricht das so unserem Konzept?"

## Sources

ADR-0007 · ADR-0048 · D21 · sebaroDesign `systems/sebaro/spec/02-components.md` §1.1–1.2, `DECISIONS.md` D39
