# 18. Files move by drag and drop in the tree

Date: 2026-09-15

## Status

Accepted. Files only: folders are drop targets, not yet draggable (see
Consequences).

## Context

PLAN.md §2.2 dropped "manual tree order": the tree sorts folders first by
name and files by name or by modified time (§4.2, ADR-0012), and nothing is
reordered by hand. The board pane has moved cards by drag since ADR-0006; the
tree had no drag at all, so a note reached another folder only through File ▸
Rename, which renames in place. Testing the sidebar branch on 2026-09-15, the
owner wrote:

> ich möchte die dateien, genau wie die boards per drag and drop verschieben
> können.

Asked "Dateien und Ordner im Baum per Drag & Drop verschieben (Ziel:
Ordnerzeile oder Wurzel; Links werden umgeschrieben wie bei Umbenennen)?":

> Ja (Recommended)

## Decision

- **A file row can be dragged onto a folder row or onto the tree's empty
  space**; the folder is the target, the empty space is the vault root. The
  move is the existing `rename` command (§2.3 rule 8; no new IPC):
  `RENAME_EXCL`, so a name clash in the target is an error and nothing is
  clobbered. For a note, the wikilinks and card `notes[]` references that
  pointed at it are rewritten as File ▸ Rename rewrites them (`relink_many`,
  each file under its read-time precondition, conflicts and cloud-only files
  reported, §5.3 step 6). A non-note file (PDF, image, code) moves without a
  link rewrite, as File ▸ Rename does.
- **Folders are drop targets, not draggable.** A directory move needs a
  directory-aware relink — card `notes[]` paths under the moved folder and
  the relative Markdown links inside the moved notes rewritten in one pass —
  which `novalis-core` does not have. That is the open follow-up; until then
  a folder is renamed in place and does not move.
- **Board rows are neither.** The root-level rows ADR-0012 draws for board
  folders cannot be dragged and take no drop: a board's cards move on the
  board, and a note is not moved into a board folder by accident.
- **The order stays the sort's.** PLAN.md §2.2's "manual tree order" stays
  dropped: a drop moves a file between folders, it does not reorder rows, and
  the §4.2 sort places the moved file.

## Consequences

- `docs/KEYMAP.md` gains a mouse-gesture row (`tree` scope). No shortcut, no
  menu item, no setting, no dependency: the WebView's own drag events over
  the existing command.
- A drop is File ▸ Rename with the target chosen by the mouse: the same
  result (`rewritten`, `cardsUpdated`, `conflicts`, `cloudOnlySkipped`), the
  same follow-up for the open tab and the dirty buffer.
- Links inside the moved note are not rewritten: a relative Markdown link
  (`[text](../x.md)`, ADR-0017's `![](attachments/a.png)`) keeps its text and
  breaks if the move changes its base. The same gap File ▸ Rename has today,
  and part of the directory-aware relink above.
- Open: folder drag, once the core has a directory-aware relink; it gets its
  own record when built. Dropping onto a board row, reordering rows, dragging
  a file out of the app to the Finder: not part of this decision.
