# 21. A context menu on tree rows, and "Show in Finder"

Date: 2026-09-16

## Status

Accepted. Adds a UI surface no mockup had (a native context menu on the
tree), one command with no chord (`tree.reveal`, in the File menu and the
palette), and two IPC commands (`reveal`, `tree_context_menu`; 27 of the 30
PLAN.md §2.3 rule 8 allows).

## Context

Trash for notes and folders has been in the app since #100 — `Cmd+Delete`
on the selected row, File ▸ Move to Trash, the palette — but nothing on
the row itself said so. After #113 the owner wrote:

> ich will noch eine delete funktion für ordner und notizen. außerdem ein
> open in finder per rechtsklick?

Asked "Kontextmenü (Rechtsklick) auf Baumzeilen — welche Einträge?"
(several answers allowed; the first three recommended):

> Im Finder zeigen, In den Papierkorb legen, Umbenennen, Neue Notiz / Neuer
> Ordner hier

Asked where "Im Finder zeigen" should also be reachable:

> Auch Ablage-Menü und Palette

## Decision

- **A right-click on a tree row pops a native context menu**, built by the
  shell (`menu::tree_context`) from the catalog like the menu bar, shown
  with Tauri's `ContextMenu::popup` at the pointer. Its entries are File
  menu items with the File menu's ids — `tree.reveal`, `tree.rename`,
  `tree.trash`, a separator, `file.newNote`, `tree.newFolder` — so a click
  arrives in the UI as the same `MenuAction` a menu-bar click does and runs
  the same command. The UI selects the row before asking
  (`openTreeContextMenu`), which is what makes "here" and "this" mean the
  row under the pointer: the commands act on the selection as `Enter` and
  `Cmd+Delete` do. Nothing new is written in React; no CSS, no strings
  beyond one.
- **A board row gets "Show in Finder" only.** Its rename and delete live in
  the board pane (ADR-0006); a tree-side trash of `boards/<slug>` would be a
  second way to delete a board with a different confirmation, and was not
  asked for.
- **`tree.reveal` shows the row in the Finder** — `open -R <path>`, the
  system opener; no plugin, no dependency, and nothing leaves the machine
  (docs/PRIVACY.md unchanged). In the File menu below Move to Trash and in
  the palette, both under `menu.file.revealInFinder` ("Show in Finder" /
  "Im Finder zeigen"), the one new string. No chord: the owner did not ask
  for one and `Cmd+Alt+R`-style Finder chords collide with nothing worth
  reserving now (ADR-0008). Like the app, macOS only; the Linux build
  answers with an error.
- **Two new IPC commands**: `reveal(path)` and `tree_context_menu(board)`,
  the 26th and 27th under the cap of 30.
- **Not built:** a context menu on tabs, cards or the editor; multi-select
  in the tree; "Move to…"; Finder's "Duplicate"; a chord for reveal.

## Consequences

- `docs/KEYMAP.md` gains the right-click row in its mouse-gesture table and
  `tree.reveal` is listed under "Not listed" as a command without a chord.
  PLAN.md §2.3 rule 8 counts 27. `MENU_KEYS` carries the new key, so the
  i18n parity test covers it.
- The one trap of a native popup — AppKit wants menus built and shown on the
  main thread — is handled the way `refresh_menu` handles the menu bar:
  `run_on_main_thread`.
- Reveal reaches the file system through `/usr/bin/open` rather than an
  AppKit call; if the path is ever wanted without a subprocess,
  `NSWorkspace.activateFileViewerSelecting` is the replacement and this ADR
  the place to say so.

**Amended 2026-09-23** — ADR-0032: `tree_context_menu(board)` became
`context_menu(target)`, one command for the tree's menu and the card's; the
count stays where it was.
