# Keymap

The complete v1 keymap (ADR-0008). Hard-coded, no rebinding UI, no user keymap
file. PLAN.md §7.4 is the source; this table is the contract.

**Parity test:** the keymap-parity test
(`apps/desktop/src-tauri/tests/keymap_parity.rs`) parses the table between the
two HTML comment markers and compares it with the app's keymap table
(`apps/desktop/ui/src/lib/keymap.ts`): same set of `Chord` strings, same
`Command` id per chord, same `Scope`. A chord in code that is missing here fails
CI, and so does a row without a binding. Two `Command` values are markers rather
than ids: `unbound` asserts the chord is *not* bound anywhere, and `system`
asserts the same for a chord macOS or the Tauri predefined menu item owns — the
app neither binds nor dispatches it.

**Chord notation** (canonical, machine-readable):

- Modifiers in this order, joined by `+`: `Ctrl`, `Alt`, `Shift`, `Cmd`, then the key.
- `+` is the separator because no binding uses the `+` key; `Cmd+=` is the
  unshifted `=` key (the "plus" key on US and German layouts).
- Keys: letters upper-case, digits, punctuation literal (`= - [ ] \ / ,`),
  named keys `Up Down Left Right Enter Delete Escape`.
- The `Glyphs` column is the macOS display form (⌃ ⌥ ⇧ ⌘) used in menus.

**Scopes:** `global` (works everywhere in the window), `editor` (focus in the
text editor), `editor:markdown` (editor with a Markdown document),
`editor:code` (editor with a non-Markdown document), `tree` (focus in the
sidebar tree), `board` (focus in the board pane).

<!-- keymap-table:start -->
| Chord | Glyphs | Command | Scope | Origin |
|---|---|---|---|---|
| `Cmd+Z` | ⌘Z | `edit.undo` | editor | Apple standard |
| `Shift+Cmd+Z` | ⇧⌘Z | `edit.redo` | editor | Apple standard |
| `Cmd+F` | ⌘F | `find.open` | editor | Apple standard |
| `Cmd+G` | ⌘G | `find.next` | editor | Apple standard |
| `Shift+Cmd+G` | ⇧⌘G | `find.previous` | editor | Apple standard |
| `Cmd+S` | ⌘S | `file.save` | global | Apple standard (flushes autosave now, D19) |
| `Cmd+N` | ⌘N | `file.newNote` | global | Apple standard |
| `Cmd+O` | ⌘O | `vault.open` | global | Apple standard |
| `Cmd+W` | ⌘W | `tab.close` | global | Apple standard (never blocks, D19) |
| `Cmd+Q` | ⌘Q | `system` | global | Apple standard; the macOS Quit item (never blocks, D19) |
| `Cmd+B` | ⌘B | `markdown.bold` | editor:markdown | Apple standard; wraps in `**` |
| `Cmd+I` | ⌘I | `markdown.italic` | editor:markdown | Apple standard; wraps in `_` |
| `Ctrl+Cmd+F` | ⌃⌘F | `system` | global | Apple standard; the macOS Full Screen item |
| `Cmd+,` | ⌘, | `unbound` | global | No preferences window (ADR-0004) |
| `Cmd+E` | ⌘E | `unbound` | global | Reserved for the v1.1 read-only preview (PLAN.md §4.4) |
| `Cmd+P` | ⌘P | `quickOpen.open` | global | §4.5: quick-open, no Print |
| `Shift+Cmd+P` | ⇧⌘P | `palette.open` | global | Sublime |
| `Ctrl+G` | ⌃G | `editor.gotoLine` | editor | Sublime |
| `Cmd+D` | ⌘D | `editor.selectNextOccurrence` | editor | Sublime |
| `Shift+Cmd+L` | ⇧⌘L | `editor.selectAllOccurrences` | editor | Sublime |
| `Alt+Cmd+F` | ⌥⌘F | `find.replace` | editor | Sublime |
| `Shift+Cmd+F` | ⇧⌘F | `search.vault` | global | Sublime |
| `Cmd+/` | ⌘/ | `editor.toggleComment` | editor:code | Sublime |
| `Ctrl+Shift+Up` | ⌃⇧↑ | `editor.addCursorAbove` | editor | Sublime |
| `Ctrl+Shift+Down` | ⌃⇧↓ | `editor.addCursorBelow` | editor | Sublime |
| `Ctrl+Cmd+Up` | ⌃⌘↑ | `editor.moveLineUp` | editor | Sublime |
| `Ctrl+Cmd+Down` | ⌃⌘↓ | `editor.moveLineDown` | editor | Sublime |
| `Shift+Cmd+D` | ⇧⌘D | `editor.duplicateLine` | editor | Sublime |
| `Ctrl+Shift+K` | ⌃⇧K | `editor.deleteLine` | editor | Sublime |
| `Shift+Cmd+[` | ⇧⌘[ | `tab.previous` | global | Sublime / macOS |
| `Shift+Cmd+]` | ⇧⌘] | `tab.next` | global | Sublime / macOS |
| `Cmd+1` | ⌘1 | `tab.goto.1` | global | Sublime |
| `Cmd+2` | ⌘2 | `tab.goto.2` | global | Sublime |
| `Cmd+3` | ⌘3 | `tab.goto.3` | global | Sublime |
| `Cmd+4` | ⌘4 | `tab.goto.4` | global | Sublime |
| `Cmd+5` | ⌘5 | `tab.goto.5` | global | Sublime |
| `Cmd+6` | ⌘6 | `tab.goto.6` | global | Sublime |
| `Cmd+7` | ⌘7 | `tab.goto.7` | global | Sublime |
| `Cmd+8` | ⌘8 | `tab.goto.8` | global | Sublime |
| `Cmd+9` | ⌘9 | `tab.goto.9` | global | Sublime |
| `Shift+Cmd+T` | ⇧⌘T | `tab.reopenClosed` | global | Sublime / macOS |
| `Cmd+[` | ⌘[ | `nav.back` | global | macOS |
| `Cmd+]` | ⌘] | `nav.forward` | global | macOS |
| `Cmd+K` | ⌘K | `markdown.link` | editor:markdown | §4.5: insert/wrap Markdown link |
| `Cmd+Enter` | ⌘↩ | `markdown.toggleCheckbox` | editor:markdown | §4.3 |
| `Cmd+\` | ⌘\ | `sidebar.toggle` | global | old novalis |
| `Shift+Cmd+B` | ⇧⌘B | `board.toggle` | global | §4.5 |
| `Cmd+=` | ⌘= | `view.fontLarger` | global | macOS; writes `editor.fontSize` |
| `Cmd+-` | ⌘- | `view.fontSmaller` | global | macOS; writes `editor.fontSize` |
| `Cmd+0` | ⌘0 | `view.fontReset` | global | macOS; writes `editor.fontSize` |
| `Enter` | ↩ | `tree.rename` | tree | Finder |
| `Cmd+Delete` | ⌘⌫ | `tree.trash` | tree | Finder |
| `Shift+Cmd+N` | ⇧⌘N | `tree.newFolder` | global | Finder |
<!-- keymap-table:end -->

## Mouse gestures (not part of the parity table)

| Gesture | Effect | Scope |
|---|---|---|
| `Alt`-click | Add a cursor at the click position | editor |
| `Cmd`-click on a link | Follow the wikilink or Markdown link | editor:markdown |
| Click on `[ ]` / `[x]` | Toggle the task checkbox (the only click that writes into a note) | editor:markdown |
| Click on a card | Open the linked note in a tab (D21) | board |
| Click on a board item in the tree | Show the board pane | tree |

## Not listed

- PLAN.md §7.4 groups `Shift+Cmd+N` (new folder) under "Tree" together with
  `Enter` and `Cmd+Delete`. Here its scope is `global`, because it is backed by
  the File ▸ New Folder menu item and menu items fire regardless of focus; the
  folder is created next to the tree selection, or in the vault root when
  nothing is selected. `Enter` and `Cmd+Delete` stay `tree`-scoped: both collide
  with editor defaults (newline, delete-to-line-start).
- System-provided edit keys (`Cmd+A/C/V/X`, `Cmd+H`, `Cmd+M`, arrows, word and
  line movement, `Escape`) come from macOS and WKWebView and are neither bound
  nor overridden by the app; the parity test ignores them. `Cmd+Q` and
  `Ctrl+Cmd+F` are listed with `system` instead of a command id for the same
  reason: they are Tauri's predefined Quit and Full Screen menu items, which act
  without emitting a `menu-action`, so binding them in the app's keymap would
  only risk swallowing them.
- Keys inside the find bar, the palette and dialogs (`Enter`, `Escape`, arrows)
  are the components' own defaults, not app bindings.
