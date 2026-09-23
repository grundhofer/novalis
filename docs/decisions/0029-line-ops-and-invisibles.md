# 29. Sort Lines, Join Lines and Show Invisibles

Date: 2026-09-23

## Status

Accepted. Adds three palette commands (one of them a toggle with two
labels) and six catalog strings. No chord, no menu item, no setting, no
IPC command, no dependency — `highlightWhitespace` and
`highlightTrailingWhitespace` ship in `@codemirror/view`, which is already
in the lock.

## Context

`@codemirror/commands` has no sort or join, and nothing in the editor
could show why a list does not nest (a tab against spaces) or why a line
does not break (one trailing space instead of two). The owner answered the
feature-gap question on 2026-09-20 (`docs/DECISIONS.md`, "Answered
2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, each with its own ADR in the pull request that builds it,
to `texteditor-line-ops` (Sort and Join only; upper/lower/unique/reverse
were a no) and `texteditor-show-invisibles` (rows B35 and B51 of
`docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **Sort Lines** (`editor.sortLines`): the lines each selection covers, or
  the whole document when nothing is selected — a selection ending at a
  line's start does not take that line. `Intl.Collator` with base
  sensitivity and numeric order: case and accents are ignored, `item 9`
  sorts before `item 10`; stable, so equal lines keep their order. Joined
  with the file's own line break.
- **Join Lines** (`editor.joinLines`): the lines a selection covers become
  one; a cursor joins its line with the next. The first line keeps its
  indentation and the last its trailing whitespace; each part in between
  is trimmed, empty ones dropped, one space between the rest.
- **Show / Hide Invisibles** (`view.toggleInvisibles`): a session flag in
  the UI store, not a setting and not in `state.json`; the palette label
  names the state, like the backlinks toggle. While on, spaces are dots,
  tabs a thin rule across their width, trailing whitespace the warning
  fill. CodeMirror's own rules hard-code `#aaa`, an SVG with `#888` and
  `#ff332255`; the editor theme overrides all three with `--ds-*` tokens
  and CSS gradients — no image. The view is rebuilt on the toggle, the way
  the spellcheck setting rebuilds it; cursor and scroll are kept
  (`lib/positions.ts`). Nothing is ever trimmed: two trailing spaces are a
  Markdown line break.
- **Not built:** chords (Sublime's `F5`, `Cmd+J` — the latter is Today's
  Note, ADR-0026), menu items, case/unique/reverse operations,
  trim-on-save.

## Consequences

- `docs/KEYMAP.md` names the three chordless commands under "Not listed".
- `editor/commands.test.ts` covers both line commands, `setup.test.ts`
  that the marks come and go with the flag and leave the text alone.
