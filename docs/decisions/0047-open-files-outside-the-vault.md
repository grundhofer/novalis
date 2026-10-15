# 47. Files from outside the vault open, and are edited, where they are

Date: 2026-10-15

## Status

Accepted. Amends ADR-0045: a file macOS hands over that the open vault does
not list opens in a tab of its own instead of a toast, and Open With offers
novalis for every extension the file-type table lists. No IPC command (still
28), no setting, no dependency, nothing outbound; one catalog string
replaced.

## Context

ADR-0045 made Open With, a Dock drop and `open -a novalis` reach the app,
but only for `md`, `markdown` and `txt`, and only for a file of the open
vault; anything else was a toast. The owner asked on 2026-10-15 why novalis
does not open supported files outside the vault ("wieso öffnet novalis keine
unterstützten dateien außerhlb des vaults?"), was shown the three ways
(switch vaults, a single-file tab, more file associations), and chose the
single-file tab, editable, not restored after a restart:

> auch bearbeiten.

> nicht wiederherstellen und auch bearbeiten umsetzeb

and, asked whether Open With should offer every type novalis opens, as an
alternate app and never the default:

> Ja, alle Typen (Recommended)

The obstacle was never the editor. Every file command took only a
vault-relative path through `vault_rel`, which is what keeps a page that
renders untrusted Markdown, EPUB or DOCX from reading `~/.ssh`; a command
that took any absolute path would remove that boundary.

## Decision

- **A grant, not a path.** The shell keeps the absolute paths macOS handed
  over in `RunEvent::Opened` (only of a type `file_types::kind_of` lists),
  plus the conflict copies it writes beside them. `read_file`, `read_blob`,
  `read_packed`, `write_file`, `write_conflict_copy`, `trash` and
  `system_open` take such a path as it was granted, and every other path
  through `vault_rel` as before. The page cannot add to the list. It lives
  in memory and ends with the app.
  A granted file that is a symlink is read, written and watched through the
  file it names, so a save never swaps the link for a copy.
- **The tab is keyed by the absolute path**, which no vault path ever is
  (`isExternal`). It edits, autosaves and resolves conflicts exactly like a
  vault file (§5.3, conflict copy beside the file); "keep mine" keeps the
  disk version as a copy first, as in a local vault.
- **Changes on disk** are seen through a second FSEvents stream over the
  folders of the open files, one level deep, reported as the same `fs-batch`
  under the tab's path — `modified` or `removed`, never `added`.
- **What such a tab does not have:** a tree row, rename, Move to Trash,
  backlinks, links into the vault (only web and mail links and its own
  headings are followed), a card from it, pasted images (`attachments/` is
  the vault's), images relative to it in the preview (nothing beside it was
  granted), a place in `state.json`. Show in Finder, Open in Default App and
  Copy Path work.
- **Not restored.** `state.json` leaves these tabs out, so a restart closes
  them; the grant would be gone anyway, and a grant written to disk could be
  forged by anything that writes `state.json`.
- **Open With** declares every extension of `file_types.rs` as rank
  Alternate — a text type with role Editor, a viewer type with role Viewer;
  a cargo test keeps `tauri.conf.json` equal to the table. Rows keyed by a
  whole name (`Makefile`, `README`) have no extension to declare and open
  through `open -a` only.
- **Not built:** switching vaults for such a file, a viewer tab closing when
  its file is deleted (the watcher follows text files, which `read_file`
  reads), relative links and images beside the file.

## Consequences

- The vault boundary holds for every path the page invents; what is
  reachable outside it is exactly what the user handed over in the Finder.
- The title bar's breadcrumb and the window title name such a file by its
  own folder, not the vault.
- Like ADR-0045 this exists only in a bundle (`just app`). Tests: the grant
  and the folder watcher in the shell, the association parity, the UI's
  routing, the tree and `state.json` leaving such tabs out. Checked in the
  built app with `open -a` on a scratch vault, 2026-10-15: a cold launch by
  a Markdown file outside the vault, typing and autosave in place, an
  atomic replace from outside (seen by the watcher; the clean buffer whose
  last write was ours gets the replaced-by-sync banner, as in the vault),
  a vault file by the same route, ⌘Q and a restart restoring only the vault
  tab, and a PDF from outside in the viewer. The test bundle was
  unregistered from LaunchServices afterwards. Not checked: Finder's Open
  With list for the new types, and whether macOS asks for folder access
  when saving in `~/Downloads`, `~/Desktop` or `~/Documents`.
- The `app.openOutsideVault` toast became `app.openUnsupported`: being
  outside the vault is no longer a reason to refuse.
