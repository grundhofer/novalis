# Keymap

The complete v1 keymap (ADR-0008, amended by ADR-0051 for sebaro's fixed
chords). Hard-coded, no rebinding UI, no user keymap file. PLAN.md §7.4 is the
source; this table is the contract.

**Parity test:** the keymap-parity test
(`apps/desktop/src-tauri/tests/keymap_parity.rs`) parses the table between the
two HTML comment markers and compares it with the app's keymap table
(`apps/desktop/ui/src/lib/keymap.ts`): same set of `Chord` strings, same
`Command` id per chord, same `Scope`. A chord in code that is missing here fails
CI, and so does a row without a binding. Three commands have two chords: the
palette is `Cmd+K` and, as before, `Shift+Cmd+P` (ADR-0051), and Back /
Forward are `Cmd+Left` / `Cmd+Right` and, where a text field keeps those,
`Ctrl+Cmd+Left` / `Ctrl+Cmd+Right` (ADR-0051 #36); the test allows these
second chords by name and no other. Two `Command` values are markers rather
than ids: `unbound` asserts the chord is *not* bound anywhere, and `system`
asserts the same for a chord macOS or the Tauri predefined menu item owns — the
app neither binds nor dispatches it.

**The `sebaro` column** names the row of sebaro's fixed shortcut table
(spec/02 §4.19, DSK-09; the names are sebaro's German ones) that a chord
fulfils, or `system` for a chord macOS keeps that the row only does the
system's own action with (Quit, Full Screen). A chord of a fixed row names it
whatever the row binds, so the `unbound` rows say what their free chord is
kept for. The parity test compares the column with `SEBARO_FIXED` in
`keymap.ts`, the app's copy of sebaro's rows, which also decides what a
control marks as its own shortcut (`data-sb-own-shortcut`). sebaro's
`tools/check_shortcuts.py --keymap docs/KEYMAP.md --unbound unbound --unbound
system` reads the column; what it still reports is in
`docs/sebaro-luecken.md` S.

**Chord notation** (canonical, machine-readable):

- Modifiers in this order, joined by `+`: `Ctrl`, `Alt`, `Shift`, `Cmd`, then the key.
- `+` is the separator, so the plus and minus keys are the named keys `Plus`
  and `Minus`. They are the one exception to physical keys: the app reads them
  as characters (`+` or `=`, `-` or `−`, Shift ignored), because „+“ is a key
  of its own on the German layout, where US has `]`, and `⇧=` on the US one
  (spec/09 §13.1, ADR-0051). Every other chord is the key's position
  (`event.code`).
- Keys: letters upper-case, digits, punctuation literal (`[ ] / ,`), named
  keys `Up Down Left Right Enter Backspace Escape Home End PageUp PageDown Tab
  Plus Minus F6`. `Backspace` is ⌫ (sebaro's name, spec/07 §4.8); ⌦ (fn ⌫)
  is in no chord, so `Cmd`+⌦ does nothing.
- The `Glyphs` column is the macOS display form (⌃ ⌥ ⇧ ⌘) used in menus.
  `Home`, `End`, `PageUp` and `PageDown` have no glyph in sebaro's fonts and
  are shown as words in the page's language („Pos1“, „Ende“, „Bild auf“,
  „Bild ab“; sebaro D102 (12), spec/07 §4.8).

**Scopes:** `global` (works everywhere in the window), `editor` (focus in the
text editor), `editor:markdown` (editor with a Markdown document),
`editor:code` (editor with a non-Markdown document), `tree` (focus in the
sidebar tree), `board` (focus in the board pane), `viewer` (focus in the PDF
pane, ADR-0025; it takes focus when it opens, and a click on the page gives
it back).

<!-- keymap-table:start -->
| Chord | Glyphs | Command | Scope | sebaro | Origin |
|---|---|---|---|---|---|
| `Cmd+Z` | ⌘Z | `edit.undo` | editor | Widerrufen / Wiederholen | Apple standard |
| `Shift+Cmd+Z` | ⇧⌘Z | `edit.redo` | editor | Widerrufen / Wiederholen | Apple standard |
| `Cmd+F` | ⌘F | `find.open` | editor | Suchen in der Ansicht | Apple standard |
| `Cmd+G` | ⌘G | `find.next` | editor |  | Apple standard |
| `Shift+Cmd+G` | ⇧⌘G | `find.previous` | editor |  | Apple standard |
| `Cmd+S` | ⌘S | `file.save` | global |  | Apple standard (flushes autosave now, D19) |
| `Cmd+N` | ⌘N | `file.newNote` | global | Hauptaktion des Bereichs | Apple standard |
| `Cmd+J` | ⌘J | `file.todayNote` | global |  | File ▸ Today's Note (ADR-0026) |
| `Cmd+O` | ⌘O | `vault.open` | global | Öffnen | Apple standard |
| `Cmd+W` | ⌘W | `tab.close` | global | Reiter oder Fenster schließen | Apple standard (never blocks, D19) |
| `Cmd+Q` | ⌘Q | `app.quit` | global | `system` | Apple standard; saves every open buffer first, then quits — never blocks: after 2 s it quits anyway (D19) |
| `Cmd+B` | ⌘B | `markdown.bold` | editor:markdown |  | Apple standard; wraps in `**` |
| `Cmd+I` | ⌘I | `markdown.italic` | editor:markdown |  | Apple standard; wraps in `_` |
| `Ctrl+Cmd+F` | ⌃⌘F | `system` | global | `system` | Apple standard; the macOS Full Screen item |
| `Cmd+,` | ⌘, | `settings.open` | global | Einstellungen | sebaro's fixed chord (DSK-09, DSK-02, ADR-0051 #1): the settings view in the content area, also the app menu's „Einstellungen …“, the palette and the sidebar's place „Einstellungen“; `Escape` or `Cmd+W` leaves it for the place before |
| `Cmd+E` | ⌘E | `note.togglePreview` | global |  | The read-only preview of the open note (PLAN.md §4.4, ADR-0020) — of a CSV or TSV its table, of an SVG its picture (ADR-0025); the preview tool beside the tab strip does the same (ADR-0051 #16), and so does View ▸ Preview, a check item that is checked while the current tab shows its preview and off for a tab without one (ADR-0051 #43) |
| `Cmd+P` | ⌘P | `quickOpen.open` | global |  | §4.5: quick-open, no Print |
| `Cmd+K` | ⌘K | `palette.open` | global | Befehlspalette | sebaro's fixed palette chord (D84, DSK-09, ADR-0051); pressed again it closes the palette (spec/02 §4.16) |
| `Shift+Cmd+P` | ⇧⌘P | `palette.open` | global |  | Sublime; the palette's second chord (ADR-0051) |
| `Ctrl+G` | ⌃G | `editor.gotoLine` | editor |  | Sublime |
| `Cmd+D` | ⌘D | `editor.selectNextOccurrence` | editor |  | Sublime |
| `Shift+Cmd+L` | ⇧⌘L | `editor.selectAllOccurrences` | editor |  | Sublime |
| `Alt+Cmd+F` | ⌥⌘F | `find.replace` | editor |  | Sublime |
| `Shift+Cmd+F` | ⇧⌘F | `search.vault` | global |  | Sublime |
| `Cmd+/` | ⌘/ | `editor.toggleComment` | editor:code |  | Sublime |
| `Ctrl+Shift+Up` | ⌃⇧↑ | `editor.addCursorAbove` | editor |  | Sublime |
| `Ctrl+Shift+Down` | ⌃⇧↓ | `editor.addCursorBelow` | editor |  | Sublime |
| `Ctrl+Cmd+Up` | ⌃⌘↑ | `editor.moveLineUp` | editor |  | Sublime |
| `Ctrl+Cmd+Down` | ⌃⌘↓ | `editor.moveLineDown` | editor |  | Sublime |
| `Shift+Cmd+D` | ⇧⌘D | `editor.duplicateLine` | editor |  | Sublime |
| `Ctrl+Shift+K` | ⌃⇧K | `editor.deleteLine` | editor |  | Sublime |
| `Ctrl+Shift+Tab` | ⌃⇧⇥ | `tab.previous` | global | Nächster / vorheriger Reiter | sebaro's fixed chord (DSK-09, ADR-0051); the note tabs only, never the board tab (ADR-0050) |
| `Ctrl+Tab` | ⌃⇥ | `tab.next` | global | Nächster / vorheriger Reiter | sebaro's fixed chord (DSK-09, ADR-0051); the note tabs only, never the board tab (ADR-0050) |
| `Cmd+1` | ⌘1 | `tab.goto.1` | global |  | Sublime |
| `Cmd+2` | ⌘2 | `tab.goto.2` | global |  | Sublime |
| `Cmd+3` | ⌘3 | `tab.goto.3` | global |  | Sublime |
| `Cmd+4` | ⌘4 | `tab.goto.4` | global |  | Sublime |
| `Cmd+5` | ⌘5 | `tab.goto.5` | global |  | Sublime |
| `Cmd+6` | ⌘6 | `tab.goto.6` | global |  | Sublime |
| `Cmd+7` | ⌘7 | `tab.goto.7` | global |  | Sublime |
| `Cmd+8` | ⌘8 | `tab.goto.8` | global |  | Sublime |
| `Cmd+9` | ⌘9 | `tab.goto.9` | global |  | Sublime |
| `Shift+Cmd+T` | ⇧⌘T | `tab.reopenClosed` | global |  | Sublime / macOS |
| `Cmd+Left` | ⌘← | `nav.back` | global | Zurück / Vor | sebaro's fixed chord (D102 (14), spec/02 §4.19, ADR-0051 #36; was `Cmd+[`): outside a text field. A text field keeps it — the editor (CodeMirror's line start), the find bar, any input — and there `Ctrl+Cmd+Left` goes back; a dialog and the palette keep their keys anyway (below). The page's own, like `Cmd+Backspace`: Window ▸ Back has no accelerator, which could take the key from the text fields (spec/09 §13.1) |
| `Cmd+Right` | ⌘→ | `nav.forward` | global | Zurück / Vor | sebaro's fixed chord (D102 (14), spec/02 §4.19, ADR-0051 #36; was `Cmd+]`): outside a text field, which keeps it for the line's end; there `Ctrl+Cmd+Right`. The page's own; Window ▸ Forward has no accelerator (spec/09 §13.1) |
| `Ctrl+Cmd+Left` | ⌃⌘← | `nav.back` | global | Zurück / Vor | sebaro's fixed chord in a text field (D102 (14), ADR-0051 #36); it goes back everywhere, the editor included. The page's own |
| `Ctrl+Cmd+Right` | ⌃⌘→ | `nav.forward` | global | Zurück / Vor | sebaro's fixed chord in a text field (D102 (14), ADR-0051 #36); it goes forward everywhere, the editor included. The page's own |
| `F6` | F6 | `area.next` | global | Nächster / vorheriger Bereich | sebaro's fixed chord (DSK-09, spec/02 §4.20, ADR-0051): the next area — title bar, sidebar (its overlay while open in a narrow window), content, backlinks, action zone, round, hidden ones skipped — back to where focus was there; also Window ▸ Next Area and the palette |
| `Shift+F6` | ⇧F6 | `area.previous` | global | Nächster / vorheriger Bereich | sebaro's fixed chord (DSK-09, spec/02 §4.20, ADR-0051): the previous area; also Window ▸ Previous Area and the palette |
| `Shift+Cmd+K` | ⇧⌘K | `markdown.link` | editor:markdown |  | §4.5: insert/wrap Markdown link; moved from `Cmd+K`, bound in the editor over CodeMirror's own Delete Line (ADR-0051) |
| `Cmd+Enter` | ⌘↩ | `markdown.toggleCheckbox` | editor:markdown |  | §4.3 |
| `Ctrl+Cmd+S` | ⌃⌘S | `sidebar.toggle` | global | Seitenleiste ein und aus | sebaro's fixed chord (DSK-09, ADR-0051); `Cmd+\` needed ⌥ on the German layout; also the title bar's sidebar tool (DSK-04, ADR-0051 #5), which announces it in `aria-keyshortcuts`. Below 722 px of window width it opens and closes the sidebar's overlay over the content without moving focus: it is View ▸ Sidebar's accelerator and counts as the menu (spec/02 §4.17, ADR-0051 #48); the tool and the palette move focus into it |
| `Shift+Cmd+B` | ⇧⌘B | `board.toggle` | global |  | §4.5 |
| `Cmd+Plus` | ⌘+ | `view.fontLarger` | global | Schrift größer / kleiner | sebaro's fixed chord (DSK-09, ADR-0051); writes `editor.fontSize`; the page's own, the menu item has no accelerator (spec/09 §13.1) |
| `Cmd+Minus` | ⌘− | `view.fontSmaller` | global | Schrift größer / kleiner | sebaro's fixed chord (DSK-09, ADR-0051); writes `editor.fontSize`; the page's own, the menu item has no accelerator (spec/09 §13.1) |
| `Cmd+0` | ⌘0 | `view.fontReset` | global |  | macOS; writes `editor.fontSize` |
| `Cmd+Backspace` | ⌘⌫ | `tree.trash` | tree | Löschen | Finder; sebaro's fixed Delete chord (DSK-09) |
| `Alt+Cmd+N` | ⌥⌘N | `tree.newFolder` | global |  | ADR-0051 (was `Shift+Cmd+N`) |
| `Shift+Cmd+N` | ⇧⌘N | `unbound` | global | Neues Fenster | sebaro's New Window (DSK-09); novalis has one window, so it stays free (ADR-0051) |
| `Alt+Cmd+I` | ⌥⌘I | `unbound` | global | Inspektor ein und aus | sebaro's Inspector (DSK-09); novalis has none, the backlinks stay under the editor (ADR-0051 #8), so it stays free; a debug build's web inspector takes it (spec/02 §4.19) |
| `Left` | ← | `viewer.previousPage` | viewer |  | Preview.app (ADR-0025) |
| `Right` | → | `viewer.nextPage` | viewer |  | Preview.app (ADR-0025) |
| `PageUp` | Page Up | `viewer.pageUp` | viewer |  | Preview.app; one page back while the viewer shows one page (ADR-0025) |
| `PageDown` | Page Down | `viewer.pageDown` | viewer |  | Preview.app; one page on while the viewer shows one page (ADR-0025) |
| `Home` | Home | `viewer.firstPage` | viewer |  | Preview.app (ADR-0025) |
| `End` | End | `viewer.lastPage` | viewer |  | Preview.app (ADR-0025) |
<!-- keymap-table:end -->

## Mouse gestures (not part of the parity table)

| Gesture | Effect | Scope |
|---|---|---|
| `Alt`-click | Add a cursor at the click position | editor |
| `Cmd`-click on a link | Follow the wikilink or Markdown link — a web or mail link opens in the default browser or mail app (ADR-0044); a `[[link]]` to no note (drawn text-muted without a line, ADR-0051 #17) opens New Note with its name (ADR-0038) | editor:markdown |
| `Cmd`-click on a `#tag` | Open the vault search filtered by that tag (ADR-0037; drawn in the link style since ADR-0051) | editor:markdown |
| Click on `[ ]` / `[x]` | Toggle the task checkbox (the only click that writes into a note) | editor:markdown, preview (`Cmd+E`, ADR-0039) |
| Click on a card | Open the linked note in a tab (D21); a card without a note opens its description (ADR-0030) | board |
| Click on a board item in the tree | Show the board pane | tree |
| Drag a file row onto a folder row or the tree's empty space | Move the file there (rename with relink, ADR-0018) | tree |
| Drag a board row after another board row or onto the tree's empty space | Reorder the boards (writes `order` to `board.json`, ADR-0019) | tree |
| Right-click on a row | The row's context menu: Show in Finder, Open in Default App (ADR-0043), Rename, Move To… (a file row, ADR-0051), Move to Trash, New Note, New Folder — a board row Show in Finder only (ADR-0021) | tree |
| Drag a tab onto another tab or the strip's empty end | Put it in that tab's place, or last; the order `Cmd+1…9` counts (ADR-0028) | tab strip |
| Click on a tab's × · middle click on a tab | Close the tab; the × is the pointer's only (D94), the keyboard closes with `Delete` or `Cmd+W` (spec/02 §4.21). The board's tab is pinned: no ×, and neither closes it (ADR-0051 #35) | tab strip |
| Drag a file row from the tree into a note | Insert a link where it lands: `[[note]]` for a note, `![](path)` for an image, `[name](path)` otherwise, relative to the note (ADR-0040) | editor:markdown |
| Drag a note row from the tree onto a column or a card | A new card titled by the note and linked to it, last in the column, or before the card from its upper half and after it from its lower half (ADR-0030, ADR-0051 #42) | board |
| Drag a card onto a card or a column | Move it there: before the card from its upper half, after it from its lower half, last on the column's free space (spec/02 §4.22, ADR-0051 #42) | board |
| Right-click on a card | The card's context menu, in the order of the card's „Mehr“ menu: Open Note (with a note), Rename, Edit Description, Link Note… (ADR-0051 #41), Create Note from Card (ADR-0035), Move to Column ▸ the board's other columns (ADR-0032), then Delete Card last after a separator (AKT-10, ADR-0051 #19) | board |
| Drag a card from the board pane onto a board row | Move the card to that board, last in its first column (ADR-0019) | board |
| `Cmd+V` with an image or a PDF on the clipboard · drop image or PDF files onto the editor | Save it under `attachments/` next to the note and insert `![](…)` — for a PDF a plain `[name](…)` link (ADR-0017, ADR-0041) | editor:markdown |
| Drop image or PDF files from the Finder on a folder row or the tree's empty space | Copy them there under their own names, never over a file; other types are refused with a note (ADR-0041) | tree |
| Click on the image | Toggle between fitting the pane and 1:1, keeping the clicked point under the pointer (ADR-0025) | viewer (image, comic page) |
| Pinch on the trackpad · `Ctrl`+wheel | Zoom around the pointer; a plain wheel scrolls (ADR-0025) | viewer (image, comic page) |
| Click on an embedded image | Open the image in the viewer; an image inside a link follows the link, an SVG is not opened (ADR-0025) | preview (`Cmd+E`) |

## Not listed

- PLAN.md §7.4 groups new folder (`Alt+Cmd+N`, `Shift+Cmd+N` until ADR-0051)
  under "Tree" together with `Enter` (rename until ADR-0051) and
  `Cmd+Backspace`. Here its scope is
  `global`, because it is backed by
  the File ▸ New Folder menu item and menu items fire regardless of focus. It
  and `Cmd+N` place the new folder or file the same way: inside a selected
  folder, beside a selected file, or in the vault root when nothing is
  selected (ADR-0012; the sidebar's tools fire the same two command ids and
  announce the chords in `aria-keyshortcuts` and their tooltips, as the board
  tool does `Shift+Cmd+B` and the place Today's Note `Cmd+J`).
  `Cmd+Backspace` stays `tree`-scoped: it collides with the editor's
  delete-to-line-start.
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
  are the components' own defaults, not app bindings. In the palette, Quick
  Open and the vault search the arrows go round (spec/02 §4.16); every other
  key stays inside them except the chords of `palette.open`,
  `quickOpen.open` and `search.vault`, which switch to that overlay.
- A failure reason in the action zone (ADR-0051) ends with the next key that
  is not a modifier alone (`Escape` among them), the next pointer press or the
  next menu item; the key is not taken and still does what it does.
- A toast at the top of the action zone (ADR-0051 #14, sebaro EBE-05)
  closes with `Escape` from anywhere: it has no action, so focus is never
  inside it. The key is not taken either; an open palette or the editor
  still gets its own `Escape`.
- The settings view (`Cmd+,`, ADR-0051 #1, spec/02 §4.24): `Escape`
  anywhere in it — not in a text field, a menu, the palette or a dialog —
  leaves it for the place before, as „Zurück zu <Ort>“ in the title bar and
  `Cmd+W` do, and the focus goes back to where it was when the view opened.
  It is the view's key, like the tree's, and not a parity row. While the view
  shows, the editor's menu items are off (it covers the editor), and
  `Cmd+W` leaves the view before it closes a tab.
- In the read-only preview (`Cmd+E`, ADR-0020 amended 2026-09-16) there is no
  editor on screen, so the `editor`-scoped chords are routed to the rendered
  note instead: `Cmd+F` opens a find bar over the rendered text, `Cmd+G` and
  `Shift+Cmd+G` move between its matches, `Escape` closes it; `Cmd+B` and
  `Cmd+I` toggle `**` / `_` around the selected text in the note's source, in
  the block it was rendered from. When that selection cannot be placed (it
  spans blocks, markup splits it, it occurs more than once in the block, or it
  is empty) the tab switches to the editor rather than guessing; every other
  editor chord (`Shift+Cmd+K`, `Cmd+Enter`, `Ctrl+G`, `Cmd+D`, …) switches to the
  editor too, so the chord lands where it applies — it is not replayed there.
  The table above is unchanged: same ids, same scopes. `note.togglePreview`
  is not only a note's (ADR-0025): a `.csv` or `.tsv` shows as a read-only
  table and an `.svg` as its picture, and there every editor chord switches
  back to the text.
- `tree.reveal` (Show in Finder, ADR-0021) has no chord: it is a File menu
  item, a palette entry and a context-menu entry, and acts on the selected
  row or, with none, the active tab.
- `window.close` (Window ▸ Close Window) has no chord: closing the one
  window quits, on the same save-first path as its close button and `Cmd+Q`
  (D19). It replaced the predefined Close Window, which carried a second
  `Cmd+W` beside File ▸ Close; `Cmd+W` closes the current tab and, with
  none or with the board's pinned tab current, does nothing (ADR-0051 #35).
- `tab.closeOthers` and `tab.closeAll` (Close Other Tabs, Close All Tabs,
  ADR-0028) have no chord and no menu item: they are palette entries.
  "Others" keeps the current tab; both leave the board's pinned tab
  (ADR-0051 #35).
- `editor.sortLines`, `editor.joinLines` and `view.toggleInvisibles` (Sort
  Lines, Join Lines, Show/Hide Invisibles, ADR-0029) have no chord and no
  menu item: they are palette entries. Sublime's `Cmd+J` is Today's Note
  here (ADR-0026).
- `board.newCard` (New Card, ADR-0030) has no chord: it is a palette entry,
  listed only while a board is active or the vault has exactly one.
- `board.cardFromSelection` (New Card from Selection, ADR-0035) has no
  chord: a palette entry, listed while a note is open and a board is
  active or the only one.
- The tree's own keys, when a row has focus (NAV-11, spec/02 §4.14,
  ADR-0051 #12): they move focus and never open anything — `Up`/`Down`
  the next / previous row, `Home`/`End` the first / last, `Right` opens a
  folder or steps into it, `Left` closes it or steps to its parent, letters
  jump to the next row whose name starts with them (typed within 500 ms;
  the same letter again goes on to the next such row). `Enter` or `Space`
  opens the row as a click does, and so does `Cmd+Down` (Finder). The tree
  is one tab stop: the focused row, else the chosen one. Like the
  palette's arrows they are the widget's keys, not app chords, and the
  parity table does not list them; `Cmd+Backspace` in the table stays trash.
  Tree commands — Rename, Move To…, Move to Trash, Show in Finder — act on
  the focused row while the tree has the keyboard (or focus is in no area:
  the palette, a dialog, a native menu), else on the chosen row, else on
  the active tab. The chosen row is one per tree: the row last clicked or
  opened, or the tab made current.
- `tree.rename` (Rename) has no chord since ADR-0051 #12: File ▸ Rename,
  the tree's context menu and the palette. `tree.moveTo` (Move To…,
  DSK-11, spec/02 §4.22, ADR-0051 #5) has none either: Edit ▸ Move To…,
  the context menu of a file row and the palette, listed there for a file
  that can move. It picks the folder in quick-open — the vault root, every
  folder a listed file lies in and every folder the tree has listed — and
  moves the file as a drop does (ADR-0018, ADR-0042); the moved row is
  scrolled into view and becomes the tree's tab stop, and takes focus only
  when Move To… was given from the tree. With the sidebar hidden, a toast
  names the folder. Folders do not move.
- `Shift+Cmd+F` over a one-line selection of at most 100 characters opens
  the vault search with it, selected (ADR-0037); otherwise empty, as
  before. `palette.gotoHeading` (Go to Heading…) has no chord: a palette
  entry for a Markdown file; `@` as the first character in `Cmd+P` or
  `Shift+Cmd+P` does the same.
- `tree.openDefault` (Open in Default App), `file.copyPath` (Copy Path) and
  `file.copyLink` (Copy Link to Note), ADR-0043, have no chord: palette
  entries, the first also in the tree's context menu. `backlinks.toggle`
  is also View ▸ Backlinks (a check item), without a chord.
- The tab strip's own keys, when a tab has focus (spec/02 §4.21, DSK-10,
  ADR-0051 #21): `Left` / `Right` choose and focus the previous / next tab,
  round, `Home` / `End` the first / last, the board's tab included;
  `Delete` (fn ⌫ on a Mac keyboard without one) closes the focused tab
  except the board's pinned one (ADR-0051 #35),
  and focus goes to the tab that became current, else to the sentence that
  says how to open a note. The strip is one tab stop: the current tab, else
  the first. They are the widget's keys, like the tree's, and not parity
  rows; `Cmd+W` in the table closes the current tab from anywhere.
  `tab.moveEarlier` / `tab.moveLater` (Window ▸ Move Tab Left / Right,
  „Reiter nach vorn / hinten“; spec/02 §4.21, sebaro D102 (5)) have no
  chord: the way to reorder the tabs without dragging, also palette entries
  where the current tab can move that way. The current tab moves one place;
  the board's tab stays first (ADR-0050).
- The sidebar's divider (spec/02 §4.23, ADR-0051), when it has focus:
  `Left` / `Right` move it by 8 px, with `Shift` by 32 px, `Home` / `End`
  give the smallest / largest width (200 / 360 px), `Enter` collapses and
  restores the sidebar; a double click gives back the start width (240 px).
  They are the widget's keys, like the tree's, and not parity rows.
  `sidebar.width.min`, `sidebar.width.start` and `sidebar.width.max` (View ▸
  Sidebar Width ▸ Narrow · Normal · Wide) have no chord: menu items and
  palette entries, the way to a width without dragging.
- The sidebar's overlay in a window under 722 px (spec/02 §4.17, DSK-04):
  `Escape` inside it or on the title bar's sidebar tool closes it and gives
  focus back to the tool; a press outside closes it too. Like the divider's
  keys, a widget's key and not a parity row.
- ADR-0051 took sebaro's fixed chords (DSK-09) and dropped `Cmd+\` (sidebar),
  `Shift+Cmd+[` / `Shift+Cmd+]` (tabs), `Cmd+=` / `Cmd+-` (font size,
  now `Cmd+Plus` / `Cmd+Minus`) and, with #36, `Cmd+[` / `Cmd+]` (Back /
  Forward, now `Cmd+Left` / `Cmd+Right`, in a text field `Ctrl+Cmd+Left` /
  `Ctrl+Cmd+Right`; `[` and `]` need ⌥ on the German keyboard); no command
  lost its chord. The arrows are the same key on every layout, so reading
  the key's position (`event.code`) and sebaro's characters agree. `Shift+Cmd+K` is
  CodeMirror's own Delete Line: the editor binds Insert Link ahead of it, and
  Delete Line stays `Ctrl+Shift+K`.
- `Alt+Cmd+G` is CodeMirror's own chord for Go to Line (its search keymap,
  there before ADR-0051): it opens the same panel as `Ctrl+G`
  (`editor.gotoLine`), which is the one the table lists.
