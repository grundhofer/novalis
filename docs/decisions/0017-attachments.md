# 17. Attachments: pasted and dropped images land in `attachments/` next to the note

Date: 2026-09-15

## Status

Accepted. Reverses the "no (later)" of PLAN.md §4.4 "Image paste/drop into
notes"; ADR-0004's four settings stand.

## Context

PLAN.md §4.4 said no to image paste because it "needs an attachments-folder
policy = a setting", and ADR-0004 fixes the settings at four. Testing the
sidebar branch on 2026-09-15, the owner wrote:

> ist es außerdem möglich screenshots bzw. bilddateien in diesen abzulegen?
> am besten per command v etc

Asked "Bilder/Screenshots in Notizen: welcher Umfang?", with the policy fixed
in the question itself (a folder `attachments/` next to the note, the file
named after the note and the time, a `![](...)` link, a 24th IPC command, an
ADR):

> ⌘V aus der Zwischenablage (Recommended), Bilddateien aus dem Finder auf die
> Notiz ziehen

Fixing the policy is what makes this possible without a fifth setting: the
folder, the name and the link form are hard-coded the way the §4.2 defaults
are.

## Decision

- **⌘V with an image on the clipboard, or image files dropped onto the
  editor**, write the file to `attachments/` next to the note — a sibling
  folder of the note, created when missing. Hard-coded like the PLAN.md §4.2
  defaults; no setting, no folder picker.
- **The file is named `<note stem>-YYYYMMDD-HHMMSS.<ext>`** in local time,
  `-2`, `-3` … on a clash. The question had shown `<Notiz> <Datum Zeit>.png`;
  the hyphenated form is chosen so the stamp needs no percent-escapes. A stem
  with a space or a parenthesis is percent-encoded in the link and decoded
  again when the link is followed.
- **The editor inserts `![](attachments/<name>)` at the cursor**: a plain
  CommonMark image link. `![[…]]` embeds stay out (§7.2). ⌘-click on such a
  link opens the file in the viewer (ADR-0015). Nothing is shown inline in
  the editor — decorated source mode, D3 — the ⌘E preview will, when it
  ships (§4.4, v1.1).
- **Only the §7.3 image types**: `png`, `jpg`, `jpeg`, `gif`, `webp`. `svg`
  is text in the editor (§7.3) and is not written as an attachment.
- **One new IPC command, `write_blob(folder, name, base64) -> EntryDto`**,
  the 24th of the 25 PLAN.md §2.3 rule 8 allows. It refuses any other
  extension and anything above 50 MB (the §4.2 warning threshold, the same
  `HUGE_FILE_BYTES` the viewer stops at), creates parent folders, and never
  overwrites: `create_atomic` is a temp file plus `RENAME_EXCL`, so a clash
  is an `already_exists` error rather than a clobber, and the UI takes the
  next suffix.

## Consequences

- PLAN.md §4.4's row reads "yes (ADR-0017): ⌘V and drop, hard-coded
  attachments/ next to the note, no setting". No attachments setting, no
  name template, no preferences window (ADR-0004).
- `docs/KEYMAP.md` gains a mouse-gesture row; ⌘V itself is a system edit key
  and stays outside the parity table.
- One command of the 25 remains after `read_blob` (ADR-0015) and
  `write_blob`.
- An attachment is a vault file like any other: the tree lists it (tier D,
  ADR-0015), rename and trash apply, the sync client carries it. Renaming the
  note alone keeps `![](attachments/…)` valid, because the folder is a
  sibling; moving the note to another folder (File ▸ Rename, or a drop in the
  tree, ADR-0018) leaves the attachments behind and does not rewrite the
  relative links inside the moved note — the same gap every relative
  Markdown link has today, and part of the directory-aware relink ADR-0018
  names as open.
- Not added: pasting non-image files, inline images in the editor, resizing
  or conversion, the `![[…]]` embed syntax, a configurable folder.
