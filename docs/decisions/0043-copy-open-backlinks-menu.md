# 43. Copy Path, Copy Link, Open in Default App, View ▸ Backlinks

Date: 2026-09-23

## Status

Accepted. Adds three palette commands, a tree context-menu entry, a View
menu item and six catalog strings. The IPC command `reveal(path)` is
generalised to `system_open(target)` rather than adding one, so the count
stays at 28 of 30. No chord, no setting, no dependency, nothing leaves the
machine from novalis (docs/PRIVACY.md unchanged).

## Context

Nothing in the app could put a note's path or link on the clipboard, hand a
file to the app macOS would open it with, or show the backlinks pane from a
menu — it was reachable only by a palette entry. The owner answered the
feature-gap question on 2026-09-20 (`docs/DECISIONS.md`, "Answered
2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `export-copy-path`,
`export-copy-wikilink` ("in the palette"), `export-open-in-default-app`
("in the context menu and the palette") and `pkm-backlinks-pane-menu`
("View ▸ Backlinks"; rows B23, B24, B8 and B17 of
`docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **Copy Path** (`file.copyPath`): the selected row's — else the active
  tab's — absolute path. **Copy Link to Note** (`file.copyLink`): a note's
  `[[…]]`, the shortest form that resolves back to it (the one a drop
  inserts, ADR-0040). Palette only: the palette's Enter is the gesture the
  web clipboard needs, which a native menu click does not give. A toast
  says what was copied. A board row copies nothing.
- **Open in Default App** (`tree.openDefault`): the file in the app macOS
  picks for its type (`/usr/bin/open`), from the tree's context menu (not
  for a board row) and the palette.
- **One command for macOS's opener**: `system_open(target)` with
  `{kind: "reveal"}` (Show in Finder, ADR-0021) or `{kind: "default"}`; the
  path is checked against the vault and absolute, so never an option.
- **View ▸ Show/Hide Backlinks** runs the existing `backlinks.toggle`; the
  label names the state, like Show/Hide Board, and the menu is rebuilt
  when it changes. No chord.
- **Not built:** copy commands in a context menu (they would need a native
  clipboard write), a File menu item for Open in Default App.

## Consequences

- `MENU_KEYS` carries the new labels; `docs/KEYMAP.md` names the commands;
  ADR-0021 is amended for the renamed command.
- Tests: reveal and open-default through `system_open`, a board row
  refused, both copies and the toast.
