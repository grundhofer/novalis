# 30. Kanban: a note becomes a card, any note links, New Card anywhere

Date: 2026-09-23

## Status

Accepted. Adds a drop target (a board column takes a note from the tree),
a picker overlay, a palette command, and changes what a click on a card
without a note does. No IPC command, no setting, no dependency, no new
string; one string (`board.linkNoteNeedsNote`) goes.

## Context

Turning a note into a card took five steps (New Card, retype the title,
open the note, back to the board, Link Note…), and Link Note… could only
link the note in the active tab — disabled otherwise. A click on a card
without a note, the usual state right after New Card, did nothing. The
owner answered the feature-gap question on 2026-09-20 (`docs/DECISIONS.md`,
"Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, each with its own ADR in the pull request that builds it,
to `kanban-note-to-card`, `kanban-link-note-picker`,
`kanban-new-card-palette` and `kanban-card-click-without-note` (rows A18,
B4, B26 and B49 of `docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **A note dropped on a column becomes a card**: titled by the note's
  stem, linked to it, last in the column — or after the card it was
  dropped on — through the existing `add` op. Only a tree row's
  `text/plain` path that is a listed note makes one; a card (its own
  type), a tab (ADR-0028), a folder or a PDF makes nothing. Nothing is
  moved: ADR-0018/0019 forbid a file drop on a board *row* in the tree,
  which would move the note; a drop on a *column* creates a card.
- **Link Note… opens a note picker**: the quick-open list over the notes,
  the active note first (so Enter alone links it, as the button did), the
  card's own links left out; placeholder "Link Note…". The button is
  always enabled; `board.linkNoteNeedsNote` is deleted.
- **New Card in the palette** (`board.newCard`, the existing label): the
  column button's dialog; the card goes last in the first column of the
  active board, or of the vault's only board, and the pane is not shown.
  Listed only when there is such a board. A board without columns is shown
  instead, since the card has nowhere to go.
- **A click on a card without a note opens its description** in the
  existing dialog. D21 ("the card opens the linked note") decided the
  click for a card with a note and is unchanged.
- **Not built:** "Add to Board" on a tree row, a board picker for New
  Card, a chord.

## Consequences

- `docs/KEYMAP.md`: the card-click row names the new case, a row for the
  note drop, `board.newCard` under "Not listed".
- Tests: the picker's pool and hand-back (`Palette.test.tsx`), the drop
  and its refusals and the click (`BoardPane.test.tsx`), when New Card is
  listed (`commands.test.ts`). jsdom cannot drag; the drop is checked by
  hand in the app.
