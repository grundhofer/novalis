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
  named keys `Up Down Left Right Enter Delete Escape Home End PageUp PageDown`.
- The `Glyphs` column is the macOS display form (⌃ ⌥ ⇧ ⌘) used in menus.

**Scopes:** `global` (works everywhere in the window), `editor` (focus in the
text editor), `editor:markdown` (editor with a Markdown document),
`editor:code` (editor with a non-Markdown document), `tree` (focus in the
sidebar tree), `board` (focus in the board pane), `viewer` (focus in the PDF
pane, ADR-0025; it takes focus when it opens, and a click on the page gives
it back).

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
| `Cmd+J` | ⌘J | `file.todayNote` | global | Go ▸ Today's Note (ADR-0026) |
| `Cmd+O` | ⌘O | `vault.open` | global | Apple standard |
| `Cmd+W` | ⌘W | `tab.close` | global | Apple standard (never blocks, D19) |
| `Cmd+Q` | ⌘Q | `app.quit` | global | Apple standard; saves every open buffer first, then quits — never blocks: after 2 s it quits anyway (D19) |
| `Cmd+B` | ⌘B | `markdown.bold` | editor:markdown | Apple standard; wraps in `**` |
| `Cmd+I` | ⌘I | `markdown.italic` | editor:markdown | Apple standard; wraps in `_` |
| `Ctrl+Cmd+F` | ⌃⌘F | `system` | global | Apple standard; the macOS Full Screen item |
| `Cmd+,` | ⌘, | `unbound` | global | No preferences window (ADR-0004) |
| `Cmd+E` | ⌘E | `note.togglePreview` | global | The read-only preview of the open note (PLAN.md §4.4, ADR-0020) — of a CSV or TSV its table, of an SVG its picture (ADR-0025); the button at the tab strip's end does the same |
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
| `Left` | ← | `viewer.previousPage` | viewer | Preview.app (ADR-0025) |
| `Right` | → | `viewer.nextPage` | viewer | Preview.app (ADR-0025) |
| `PageUp` | ⇞ | `viewer.pageUp` | viewer | Preview.app; one page back while the viewer shows one page (ADR-0025) |
| `PageDown` | ⇟ | `viewer.pageDown` | viewer | Preview.app; one page on while the viewer shows one page (ADR-0025) |
| `Home` | ↖ | `viewer.firstPage` | viewer | Preview.app (ADR-0025) |
| `End` | ↘ | `viewer.lastPage` | viewer | Preview.app (ADR-0025) |
<!-- keymap-table:end -->

## Mouse gestures (not part of the parity table)

| Gesture | Effect | Scope |
|---|---|---|
| `Alt`-click | Add a cursor at the click position | editor |
| `Cmd`-click on a link | Follow the wikilink or Markdown link | editor:markdown |
| Click on `[ ]` / `[x]` | Toggle the task checkbox (the only click that writes into a note) | editor:markdown |
| Click on a card | Open the linked note in a tab (D21); a card without a note opens its description (ADR-0030) | board |
| Click on a board item in the tree | Show the board pane | tree |
| Drag a file row onto a folder row or the tree's empty space | Move the file there (rename with relink, ADR-0018) | tree |
| Drag a board row after another board row or onto the tree's empty space | Reorder the boards (writes `order` to `board.json`, ADR-0019) | tree |
| Right-click on a row | The row's context menu: Show in Finder, Rename, Move to Trash, New Note, New Folder — a board row Show in Finder only (ADR-0021) | tree |
| Drag a tab onto another tab or the strip's empty end | Put it in that tab's place, or last; the order `Cmd+1…9` counts (ADR-0028) | tab strip |
| Drag a note row from the tree onto a column or a card | A new card titled by the note and linked to it, last in the column or after the card (ADR-0030) | board |
| Drag a card from the board pane onto a board row | Move the card to that board, last in its first column (ADR-0019) | board |
| `Cmd+V` with an image on the clipboard · drop image files onto the editor | Save the image under `attachments/` next to the note and insert `![](…)` (ADR-0017) | editor:markdown |
| Click on the image | Toggle between fitting the pane and 1:1, keeping the clicked point under the pointer (ADR-0025) | viewer (image, comic page) |
| Pinch on the trackpad · `Ctrl`+wheel | Zoom around the pointer; a plain wheel scrolls (ADR-0025) | viewer (image, comic page) |
| Click on an embedded image | Open the image in the viewer; an image inside a link follows the link, an SVG is not opened (ADR-0025) | preview (`Cmd+E`) |

## Not listed

- PLAN.md §7.4 groups `Shift+Cmd+N` (new folder) under "Tree" together with
  `Enter` and `Cmd+Delete`. Here its scope is `global`, because it is backed by
  the File ▸ New Folder menu item and menu items fire regardless of focus. It
  and `Cmd+N` place the new folder or file the same way: inside a selected
  folder, beside a selected file, or in the vault root when nothing is
  selected (ADR-0012; the sidebar buttons fire the same two command ids).
  `Enter` and `Cmd+Delete` stay `tree`-scoped: both collide with editor
  defaults (newline, delete-to-line-start).
- System-provided edit keys (`Cmd+A/C/V/X`, `Cmd+H`, `Cmd+M`, arrows, word and
  line movement, `Escape`) come from macOS and WKWebView and are neither bound
  nor overridden by the app outside the PDF pane (whose `viewer` rows are in
  the table); the parity test ignores them. `Ctrl+Cmd+F` is listed with
  `system` instead of a command id for the same reason: it is Tauri's
  predefined Full Screen menu item, which acts without emitting a
  `menu-action`, so binding it in the app's keymap would only risk swallowing
  it. `Cmd+Q` was the predefined Quit until 2026-09-22 and is now the app's
  own `app.quit` item: the predefined one terminated at once, before the
  last second of typing was saved. Closing the window takes the same path.
- Keys inside the find bar, the palette and dialogs (`Enter`, `Escape`, arrows)
  are the components' own defaults, not app bindings.
- In the read-only preview (`Cmd+E`, ADR-0020 amended 2026-09-16) there is no
  editor on screen, so the `editor`-scoped chords are routed to the rendered
  note instead: `Cmd+F` opens a find bar over the rendered text, `Cmd+G` and
  `Shift+Cmd+G` move between its matches, `Escape` closes it; `Cmd+B` and
  `Cmd+I` toggle `**` / `_` around the selected text in the note's source, in
  the block it was rendered from. When that selection cannot be placed (it
  spans blocks, markup splits it, it occurs more than once in the block, or it
  is empty) the tab switches to the editor rather than guessing; every other
  editor chord (`Cmd+K`, `Cmd+Enter`, `Ctrl+G`, `Cmd+D`, …) switches to the
  editor too, so the chord lands where it applies — it is not replayed there.
  The table above is unchanged: same ids, same scopes. `note.togglePreview`
  is not only a note's (ADR-0025): a `.csv` or `.tsv` shows as a read-only
  table and an `.svg` as its picture, and there every editor chord switches
  back to the text.
- `tree.reveal` (Show in Finder, ADR-0021) has no chord: it is a File menu
  item, a palette entry and a context-menu entry, and acts on the selected
  row or, with none, the active tab.
- `tab.closeOthers` and `tab.closeAll` (Close Other Tabs, Close All Tabs,
  ADR-0028) have no chord and no menu item: they are palette entries.
  "Others" keeps the current tab.
- `editor.sortLines`, `editor.joinLines` and `view.toggleInvisibles` (Sort
  Lines, Join Lines, Show/Hide Invisibles, ADR-0029) have no chord and no
  menu item: they are palette entries. Sublime's `Cmd+J` is Today's Note
  here (ADR-0026).
- `board.newCard` (New Card, ADR-0030) has no chord: it is a palette entry,
  listed only while a board is active or the vault has exactly one.
