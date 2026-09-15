# 12. Sidebar controls

Date: 2026-09-14

## Status

Accepted.

## Context

On 2026-09-14 the owner opened the app and could not do from the sidebar
what the plan says the app does. Creating a note or a folder, showing the
board and changing the settings all existed — as File and View menu items,
as chords (`Cmd+N`, `Shift+Cmd+N`, `Shift+Cmd+B`) and as palette entries —
but nothing in the window pointed at them. The board pane, which the L4
mockup shows as a first-class view, had no handle at all; the tree legend
"Name / Modified" looked like a sort control and was not one; and the
"daily notes" feature of the old app had been dropped with the rest of
PLAN.md §2.2, so there was no place for a quick note of the day.

The owner asked for exactly that: a simple, good improvement of the controls
on the left, without causing problems. Four questions were put to them the
same day, each with the smallest form recommended.

## Decision

Four things, all of which re-expose commands and command ids that already
exist. No new chord, no new menu item, no new IPC command, no new setting.

1. **A control row beside the vault name** with three buttons: New Note
   (`Cmd+N`), New Folder (`Shift+Cmd+N`) and the board toggle
   (`Shift+Cmd+B`). Each fires the existing command id (`file.newNote`,
   `tree.newFolder`, `board.toggle`) through the same dispatcher the menu and
   the keymap use. Both create commands put the new file or folder inside a
   selected folder and beside a selected file, which is what
   `docs/KEYMAP.md` says of `Shift+Cmd+N`.

2. **The tree legend becomes the sort control.** "Name" sorts files by name
   ascending (the §4.2 default); "Modified" sorts them by modification time,
   newest first. Folders always come first and always by name — the owner
   asked for that explicitly. The choice is kept as `treeSort` in
   `state.json`: disposable state next to the sidebar width, **not a fifth
   setting** under ADR-0004, because losing it costs one click.

3. **A "Today's Note" row above the tree** and a palette command
   (`file.todayNote`). Both open `journal/YYYY-MM-DD.md` (local date) and
   create it empty when it is missing. The folder name and the file name are
   hard-coded; there is no template, no second panel and no "Today view".
   The `journal` folder lists every day like any other folder in the tree.
   This strikes "daily notes" from the §2.2 not-list; "Today view" and
   "templates" stay dropped.

4. **The four settings appear in the command palette**: Appearance (system,
   light, dark), Language (system, German, English) and Check Spelling While
   Typing, beside the three font-size entries that were already there. They
   run the same command ids the View and Edit menus already dispatch
   (`settings.appearance.*`, `settings.language.*`, `settings.spellcheck`).
   The owner did **not** select the fourth option offered, a settings button
   in the sidebar; its description had said the entries reach the palette
   either way, and that is what ships. There is still no preferences window
   and `Cmd+,` stays unbound (ADR-0004, ADR-0008).

The owner's words, 2026-09-14:

> aktuell kann ich keine neuen markdown files oder andere unterstützte
> formate erstellen. diese funktion sollte bestehen. es sollte links auch
> eine sektion gebeb um schnelle tägliche notizen anzuzeigen.
> Den kanban mode sehe ich auch nicht.
> es sollte ein icon um die settings zu öffnen.
> außerdem benötigen wir ein sortiericon für die notizen, die ordner immer
> alphabetisch anzeigen.
> bitte lass uns eine einfache aber gute verbesserung links in der steuerung
> vornehmen ohne probleme zu verursachen.

and, asked "Welche Steuerelemente sollen in die Sidebar?" with four options:

> Neue Notiz / Neuer Ordner (Recommended), Board-Knopf (Recommended),
> Sortierung über die Spaltenköpfe (Recommended)

(the fourth option, "Einstellungen-Knopf", was not selected); and, asked
"Tagesnotizen: welche Form?":

> Eine Zeile Heute oben im Baum (Recommended)

whose option text was "Klick öffnet die heutige Notiz, legt sie an, wenn sie
fehlt. Der Ordner journal im Baum zeigt alle Tage. Auch als Palettenbefehl.
Kleinste Form, kein zweites Panel." and whose question fixed the file as
"journal/JJJJ-MM-TT.md, leer angelegt, keine Vorlage".

## Consequences

- PLAN.md §2.2 loses "daily notes" from the not-list with a pointer here;
  §4.2's tree-sort row names the legend as the place the file order is
  chosen and the `journal/` convention.
- `docs/SETTINGS.md` says in prose that `treeSort` is state, not a setting;
  the settings table and the `Settings` struct are untouched, so the parity
  test stays as it is. ADR-0004's consequence "each setting has exactly one
  place where it is changed" is amended to "one persisted place; the palette
  is a second launcher for the same command ids".
- `docs/KEYMAP.md` is untouched inside the parity table. Its "Not listed"
  prose about `Shift+Cmd+N` now describes the placement both create
  commands share.
- Recorded here without an ADR of their own, because they are mockup
  fidelity and defects rather than features: board folders are drawn as
  root-level tree rows carrying the board's display name, as the approved L2
  and L4 frames show, instead of nested under a `boards/` folder; opening a
  note in the editor (tree, `Cmd+P`, `Cmd+N`, a tab, `Cmd+[`/`]`) hides the
  board pane the way a card click already did (the D21 reading: one pane at
  a time); the "Modified" column is patched after the app's own saves
  instead of waiting for the watcher; and the main window is granted
  `core:window:allow-start-dragging`, without which every press on the
  custom title bar rejected into the fatal overlay instead of moving the
  window.
- What this does not add: a fifth setting, a preferences window, a template,
  a "Today view", a configurable journal folder. Each of those is a feature
  under the minimalism rule and would need its own yes.

**Amended 2026-09-15** — the owner, testing: "bitte noch settings button icon
ermöglichen". A button in the sidebar foot opens the command palette on the
four settings alone (`settings.open`); no window, `Cmd+,` stays unbound. The
"not selected" above is superseded by that sentence; `docs/DECISIONS.md`
carries the day's record.
