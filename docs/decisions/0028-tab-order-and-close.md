# 28. Tabs: reorder by drag, Close Other Tabs, Close All Tabs

Date: 2026-09-23

## Status

Accepted. Adds a mouse gesture on the tab strip and two palette commands
with four catalog strings. No chord, no menu item, no tab context menu, no
IPC command, no setting.

## Context

The tab order is what `Cmd+1…9` counts and what `state.json` restores, yet
it was fixed by the order of opening; and since the session restore reopens
every tab, closing them one by one with `Cmd+W` was the only way back to a
clean window. The owner answered the feature-gap question on 2026-09-20
(`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, each with its own ADR in the pull request that builds it,
to `texteditor-tab-reorder-drag` and `texteditor-tab-close-others` (rows
B18 and B33 of `docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **A tab dragged onto another takes that tab's place**; dropped on the
  strip's empty end it goes last. The drag carries its own type
  (`application/x-novalis-tab`, beside the ADR-0019 board and card types),
  so the tree and the editor ignore a tab dropped on them. The tab under
  the pointer wears the accent fill the tree's drop target wears. The order
  is the tabs array `state.json` already keeps. No drag out of the window,
  no pinning.
- **Close Other Tabs** (`tab.closeOthers`, keeps the current tab) and
  **Close All Tabs** (`tab.closeAll`): palette entries only, each closing
  one tab at a time through the same `close` as `Cmd+W` — every buffer is
  flushed (D19) and every tab lands on the reopen-closed stack.
- **Not built:** a tab context menu (ADR-0021 lists it as not built), a
  chord or File menu item for the two commands, pinned tabs.

## Consequences

- `docs/KEYMAP.md` gains the drag row in the mouse-gesture table and names
  the two chordless commands; `tabs.test.ts` covers `move`,
  `closeOthers` and `closeAll`. jsdom cannot drag, so the gesture itself
  is checked by hand in the app.
