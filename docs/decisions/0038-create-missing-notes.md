# 38. Creating a note that is not there yet

Date: 2026-09-23

## Status

Accepted. Adds a quick-open row, what a `Cmd`-click on an unresolved
`[[link]]` does, and a look for such links. No new string (the catalog's
`editor.completion.newNote` was unused), no IPC command, no setting, no
chord.

## Context

A name typed in `Cmd+P` that matched nothing did nothing; a `[[link]]`
written before its note existed looked like any other link and did nothing
on `Cmd`-click. The owner answered the feature-gap question on 2026-09-20
(`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `search-create-from-quick-open` and
`pkm-create-note-from-missing-wikilink` ("create a note from the
quick-open query and from a ⌘-click on an unresolved `[[link]]`,
unresolved links drawn dimmed"; rows B1 and B2 of
`docs/research/2026-09-20-feature-gaps.md`, one ADR with three ways in, as
the research suggested).

## Decision

- **Quick-open offers "Create "…""** as its last row when the typed name
  is no note's — a note in another case counts as existing — and could be
  a link target (no `#`, `|`, brackets, `^` or `@`). Enter or a click
  creates it where `Cmd+N` would (inside the selected folder, beside the
  selected file, else the root), a typed extension making that file
  (ADR-0014), and opens it. Only in quick-open, not in the palette.
- **`Cmd`-click on a `[[link]]` that resolves to nothing** opens the New
  Note dialog with the link's name filled in, in the folder of the note it
  is written in. Nothing is written before OK, so PLAN.md §4.3's "the only
  click that writes" (the task box) still holds.
- **Unresolved links are drawn dimmed and dashed** in the editor
  (`--ds-color-fg-subtle`), re-checked when the vault's note list changes.
  `[[#heading]]` names the note it is in and is never unresolved.
- **Not built:** a "Create" entry in `[[` completion (the research called
  it optional), unresolved links marked in the preview.

## Consequences

- `docs/KEYMAP.md`'s `Cmd`-click row says what an unresolved link does.
- Tests: the Create row and its absence for an existing name, a `#` name
  and in other modes; the pre-filled dialog; the decoration and its
  refresh.
