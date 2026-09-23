# 40. A file dragged from the tree into a note becomes a link

Date: 2026-09-23

## Status

Accepted. Changes what a drop of a tree row on the editor does. No string,
no IPC command, no setting, no menu item.

## Context

A file row dragged from the tree carries its vault path as `text/plain`
(ADR-0018); dropped on a note, CodeMirror inserted that path as text —
`journal/2026-09-20.md` in the middle of a sentence. In every vault app a
note dropped on a note is a link. The owner answered the feature-gap
question on 2026-09-20 (`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `export-drop-note-inserts-wikilink`
(row A27 of `docs/research/2026-09-20-feature-gaps.md`).

## Decision

- A tree file row carries a private type, `application/x-novalis-entry`,
  beside its `text/plain` path, so outside text that happens to look like a
  path is never mistaken for a row.
- Dropped on a Markdown note (not read-only), it inserts at the drop point:
  `[[stem]]` for a note — `[[folder/stem]]` when another note has the same
  stem, the form that resolves back to it — `![](path)` for an image, and
  `[file name](path)` for anything else, the path relative to the note and
  encoded per segment. The research sketched `[name](path)` for images too;
  an image is embedded here because that is what an image link in a note
  is for (ADR-0017 writes pasted images the same way).
- A note dropped on itself inserts nothing. Other drops are unchanged.

## Consequences

- `docs/KEYMAP.md` gains the gesture row.
- Tests: the three link forms, the stem clash, the relative encoding, and
  the drop inserting the link instead of the path.
