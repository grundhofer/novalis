# 35. A note from a card, a card from a selection

Date: 2026-09-23

## Status

Accepted. Adds an entry to the card context menu (ADR-0032), a palette
command, and three catalog strings. No IPC command, no setting, no
dependency.

## Context

After ADR-0030 a note became a card by a drop; the other direction — a
card that should become a note, a line in a note that should become a
card — still took the long way round. The owner answered the feature-gap
question on 2026-09-20 (`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `kanban-card-to-note` and
`kanban-card-from-selection` (rows B40 and B41 of
`docs/research/2026-09-20-feature-gaps.md`). B41 asked that the owner
confirm the one-way semantics; this ADR states them.

## Decision

- **Create Note from Card**, in the card's context menu. It creates an
  empty note named by the card's title — `/`, `\` and `:` become `-`, a
  leading dot goes — links it to the card and opens it. Empty, not
  `# <title>` as the research sketched: a note's title is its name (D22),
  and every other new note starts empty. It lands where `Cmd+N` would put
  it, but never among the boards (a selected board row would otherwise put
  it in `boards/`, which `doctor` reports); a note of that name already
  there is linked instead of a second one being made. **Deviation from the
  research's form:** it proposed a palette command acting on "the last
  clicked card"; the context menu that ADR-0032 added since knows its card
  without that hidden state.
- **New Card from Selection** (`board.cardFromSelection`), a palette
  command, listed while a note is open and a board is active or the only
  one. The title is the first non-empty line of the selection — or the
  cursor's line — without a list marker, task box or heading hashes; the
  card links the note and goes last in the first column; a toast says on
  which board. In the preview the document's selection is used.
- **One way, once:** the note is never written and nothing ties the text
  to the card afterwards — no token, no back-reference. §2.2 and D18 reject
  parsing tasks out of notes, and §2.3 rule 10 forbids writing a note to
  update a card; a single copy on an explicit command is neither.
- **Not built:** the rest of a selection as the description (the `add` op
  has no description, it would be a second write), a board picker, chords.

## Consequences

- `MENU_KEYS` carries `board.createNote`; `docs/KEYMAP.md` names both.
- `commands.test.ts` covers the two name helpers, the note from a card and
  the card from a selection.
