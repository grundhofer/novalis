# 42. A moved note keeps its relative links; `doctor` checks attachments

Date: 2026-09-23

## Status

Accepted. Closes the follow-up ADR-0018 left open ("links inside the moved
note are not rewritten") and adds a `doctor` check. No IPC command, no
setting, no dependency; the CLI contract grows add-only (`doctor`'s
`paths`, one more `relinked` entry on `mv`).

## Context

Paste three screenshots into a note (ADR-0017), drag the note to another
folder (ADR-0018), and all three are broken: `![](attachments/…)` is
relative to the note, and nothing rewrote it — silently, since the link
index reads only links to notes. The owner answered the feature-gap
question on 2026-09-20 (`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to
`reliability-move-rewrites-relative-links` ("relative links rewritten on
move, the core form") and `export-doctor-attachments` ("with a `doctor`
attachments check"; rows B9 and B30 of
`docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **The core rebases a moved note's own relative destinations** in
  `relink_many`, before the vault-wide pass: every `[text](dest)` and
  `![alt](dest)` in it — attachment, note or any file, skipping code,
  frontmatter, URLs, `mailto:` and `#anchors` — is resolved from the old
  folder and written relative to the new one, under the note's read-time
  precondition. A destination that climbs out of the vault is left alone;
  a rename within one folder changes nothing. The app's moves and
  `novalis mv` share it; `--no-relink` skips it with the rest.
- **The app reloads what the move rewrote**: an open buffer with nothing
  unsaved takes the new text at once; otherwise the watcher would take the
  shell's own write for a sync conflict and raise the banner.
- **`doctor` gains `attachments`**: links from notes to an image or PDF
  that is not on disk, and files in an `attachments/` folder that no note
  links to — counted in `detail`, named in a new optional `paths` field.
  Every readable note is read (the cache indexes only note links);
  cloud-only notes are not read, so an attachment only they link to
  counts as unlinked.
- **Not built:** moving attachments along with a note, rebasing inside
  notes of a moved folder (folders do not move, ADR-0018), `doctor --fix`.

## Consequences

- The core's Markdown link scanner gains a second mode
  (`extract_destinations`) beside `extract`, which keeps reading links to
  notes only. ADR-0018 is amended; PLAN.md §9.2 and `reference.md` say both.
- Tests: the core rebase (images, notes, angle brackets, fences, URLs,
  anchors, idempotence, a same-folder rename); `doctor`'s check on a vault
  with a missing and an unlinked attachment; the UI reload after a move.
