# 37. Search: from the selection, from a tag, recent files, headings

Date: 2026-09-23

## Status

Accepted. Changes what `Shift+Cmd+F` starts with, adds a mouse gesture
(`Cmd`-click on a tag chip), a palette mode and entry (Go to Heading…,
`@`), and one field in `state.json` (`recentFiles`). No new chord, no new
string (the two used were in the catalog, unused), no IPC command, no
setting.

## Context

Searching for what the cursor is on took copy and paste; a `#tag` chip
looked like a link and did nothing; an empty `Cmd+P` listed the vault in
path order; a heading in a long note was found only among every command
and note in the palette. The owner answered the feature-gap question on
2026-09-20 (`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, each with its own ADR in the pull request that builds it,
to `search-prefill-selection`, `search-tag-chip-click`,
`search-palette-recent` and `search-goto-symbol-prefix` (rows A26, B21, B5
and B20 of `docs/research/2026-09-20-feature-gaps.md`). One ADR covers the
four: they are one pull request.

## Decision

- **`Shift+Cmd+F` starts from the selection** — the editor's, or the
  rendered note's — when it is one line of at most 100 characters, selected
  in the field so typing replaces it. Otherwise the field is empty, as
  before. (`Cmd+F` already did this, from CodeMirror.)
- **`Cmd`-click on a `#tag` chip** in the editor opens the vault search
  filtered by that tag, the filter the palette's tag entries set. The
  preview has no tag chips (pulldown-cmark knows no tags) and is unchanged.
- **Recent files first in an empty `Cmd+P`**: the ten files most recently
  made current, newest first, marked "Recently opened", then the rest —
  the file already current left out, so Enter goes somewhere else. Kept in
  `state.json` as `recentFiles` (disposable state, ADR-0012; not a
  setting), reset when another vault is opened, following renames.
- **Go to Heading…** (`palette.gotoHeading`, the catalog's existing
  label) opens the palette on the open note's headings alone — from its
  text, so it works in the preview too; listed for a Markdown file. `@` as
  the first character in `Cmd+P` or `Shift+Cmd+P` switches to the same
  list; the `@` is not matched.
- **Not built:** `Cmd+R` and a Go menu item for headings (the research
  said no), a tag click in the preview, recent vaults.

## Consequences

- `UiStateDto` gains `recentFiles` (bindings regenerated); `docs/KEYMAP.md`
  gains the chip gesture and the notes on `Shift+Cmd+F` and headings.
- Tests cover the seed and its limits, the headings overlay, the recent
  list (order, cap, rename), the palette's recent-first pool and `@`, and
  finding the chip under a position.
