# 41. PDFs as attachments; Finder files dropped on the tree

Date: 2026-09-23

## Status

Accepted. Amends ADR-0017 (attachments were images only). Widens the
shell's `write_blob` allow-list by `pdf`, adds a drop target on the tree,
and two catalog strings (a plural pair). No IPC command, no setting, no
dependency.

## Context

A PDF could not be pasted or dropped into a note, although the app opens
PDFs itself; and a file from the Finder could only land in the vault
through the Finder. The owner answered the feature-gap question on
2026-09-20 (`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, in one ADR amending ADR-0017, to
`export-attach-non-image-files` ("PDFs as attachments by drop or ⌘V") and
`macos-finder-drop-into-tree` ("files from the Finder dropped on a folder
row"; rows B39 and B37 of `docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **PDF is an attachment type** beside the §7.3 images: pasted or dropped
  on a note it is written to `attachments/` under the ADR-0017 name
  pattern and linked as `[name](attachments/…)` — a link, not an embed; a
  click opens it in the viewer. Only PDF: a text file dropped on a note
  still inserts its content, as before.
- **Images and PDFs dropped from the Finder on a folder row** — or on the
  tree's empty space, the vault root — are copied there under their own
  names; a taken name gets ` 2`, ` 3` … before the extension, never an
  overwrite (`RENAME_EXCL`). Anything else is not copied, and one toast
  says how many files were refused. A copy, never a move; no folders.
- The 50 MB cap of `write_blob` stays.
- **Not built:** other file types as attachments, rewriting attachment
  links when a note moves (that is ADR-0042's), a drop on a board row.

## Consequences

- `docs/KEYMAP.md`'s attachment row names PDF; a tree row for the Finder
  drop. ADR-0017 is amended.
- Tests: the PDF link form, the copy's naming and refusal, the tree's drop
  with a refused file. The Finder drag itself was not driven by hand —
  synthetic drags from the Finder did not reach it in this session — so
  that WKWebView hands a Finder drop to the tree is inferred from the
  editor's image drop (ADR-0017), which takes the same path.
