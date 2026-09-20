# novalis — the UI surface as a user experiences it today

Read-only analysis of `/Users/sgrundhoefer/Projects/novalis` at `main` (`aeead36`, 2026-09-19).
Everything below is **verified in code** unless marked *inferred*. Paths are repo-relative;
`ui/` means `apps/desktop/ui/src/`, `shell/` means `apps/desktop/src-tauri/src/`.

Method: read `ui/App.tsx`, every `ui/components/*.tsx`, `ui/stores/*.ts`, `ui/lib/*.ts`,
`ui/editor/*.ts(x)`, `ui/styles/*.css` (selectors only), `i18n/en.json`, `shell/menu.rs`,
`shell/commands.rs`, `shell/dto.rs`, `shell/lib.rs`, `crates/novalis-core/src/notes/render.rs`,
`crates/novalis-core/src/search/mod.rs`, `docs/KEYMAP.md`, `docs/SETTINGS.md`, `PLAN.md` §2.2/§4.4/§7,
ADR-0012. Unused-catalog-key claims come from `grep -F '"<key>"'` over `ui/src` and `shell/src`
excluding `*.test.*` (0 hits = unused by the shipped UI).

---

## 0. Window layout (what is on screen)

`ui/App.tsx:298-379`:

```
┌ TitleBar (38 px, breadcrumb  ·  ⇧⌘P badge) ─────────────────────────────┐
│ Sidebar (256 px, if visible) │ main:                                     │
│  head: vault name + 3 tools  │   TabStrip (+ eye toggle)                 │
│  legend: Name | Modified     │   CloudHint (once)                        │
│  "Today's Note" row          │   Banner (per-doc)                        │
│  virtualized tree            │   BoardPane | empty-state | Viewer |      │
│  foot: gear · cloud/conflict │   Preview | Editor                        │
│                              │   Backlinks pane (under the editor)       │
└ StatusBar ─────────────────────────────────────────────────────────────────┘
overlays: Palette (quickOpen | palette | settings) · SearchPanel · Prompt · Toast
```

- Exactly one pane in `main` at a time: board **or** empty state **or** viewer **or** preview **or**
  editor (`App.tsx:311-345`). No split view (D21).
- One window only (`tauri.conf.json:13-25`, `minWidth 720`, `titleBarStyle Overlay`); no
  `WebviewWindowBuilder` anywhere in `shell/`.
- Sidebar width is state (`ui/stores/ui.ts:72,179`) but **no component ever calls
  `setSidebarWidth`** (grep: only the store defines it) → the sidebar is not resizable by the user;
  it is 256 px unless `state.json` is hand-edited.
- State persisted to `state.json` (debounced 400 ms, `App.tsx:228-261`): open tabs, active tab,
  sidebar visible/width, board visible, backlinks visible, cloudHintShown, activeBoard, treeSort.
  Preview mode per tab is session-only (`ui/stores/ui.ts:79-83`).

---

## 1. Sidebar (`ui/components/Sidebar.tsx`)

### 1.1 Head (`Sidebar.tsx:139-193`)
- Vault name (`vault.name` = folder basename, `shell/commands.rs:123-126`). Not clickable.
- Three ghost buttons (ADR-0012), each `dispatchCommand`:
  - `+` → `file.newNote` (`:143-151`), tooltip "New Note ⌘N".
  - folder glyph → `tree.newFolder` (`:152-160`), tooltip "New Folder ⇧⌘N".
  - board glyph → `board.toggle` (`:161-170`), label flips Show/Hide Board, `aria-pressed`.
- Legend = sort switch (`:173-192`): two buttons "Name" / "Modified" → `setTreeSort("name"|"modified")`.
  Only files follow the sort; folders are always first and by name
  (`ui/stores/vault.ts:148-155`). "Modified" = newest first.

### 1.2 The "Today's Note" row (`Sidebar.tsx:195-198`)
- A single button above the virtualized tree, label `tree.todayNote` ("Today's Note"),
  `onClick → dispatchCommand("file.todayNote")`.
- What it does (`ui/lib/commands.ts:60-88`):
  1. `JOURNAL_FOLDER = "journal"` hard-coded (`:60`); stem = local `YYYY-MM-DD` (`:66-69`,
     deliberately not UTC).
  2. Calls `createNote("journal", stem)` → shell `create_note` → `create_atomic(abs, b"")`
     (`shell/commands.rs:545-563, 599-602`): **the file is created empty, no template**.
  3. `already_exists` is swallowed (`:82-86`); anything else throws.
  4. Reloads root (if `journal/` was not listed yet) and `journal/`, refreshes the note list,
     opens the tab (`:76-87`).
- **There is no other journal affordance.** Verified absent:
  - no "yesterday"/"tomorrow"/"previous day"/"next day" command (REGISTRY `commands.ts:217-273`
    has only `file.todayNote`); no chord for it either (`ui/lib/keymap.ts:23-79` has no
    `file.todayNote`).
  - no list of journal entries beyond the ordinary `journal/` folder in the tree
    (ADR-0012 `docs/decisions/0012-sidebar-controls.md:45-51`: "The `journal` folder lists every day
    like any other folder"; "no second panel and no 'Today view'").
  - no calendar widget (`fixtures/demo-vault/calendar/` is just a folder of meeting notes;
    "calendar" is on the §2.2 not-list, `PLAN.md:58`).
  - no native menu item for Today (`shell/menu.rs` never references `file.todayNote`; MENU_KEYS
    `:37-95` lacks `tree.todayNote`). It exists only as the sidebar row and the palette entry
    (`commands.ts:324`).
  - the journal folder name and the date format are not configurable (ADR-0012 consequences,
    `0012-sidebar-controls.md:115-117`).

### 1.3 Tree rows (`Sidebar.tsx:200-322`, rows from `ui/stores/vault.ts:181-207`)
- Virtualized (`@tanstack/react-virtual`, `ROW_HEIGHT 28`, `:40, 86-91`).
- Row anatomy (`:305-317`): active marker · chevron · `entry.name` (full file name **with**
  extension; not the frontmatter title) · optional "online only" badge with tooltip
  (`:308-312`) · meta: "Board" for a board row, else `formatDay(mtime)` for files
  (`:313-317`; "today" / "yesterday" / short date, `ui/i18n.ts:56-65`). Folders show no meta,
  no child count (`tree.folderItems` unused), no size (`entry.size` never rendered).
- Click (`:93-106`): board row → `setActiveBoard` + `load`; folder → toggle expand (lazy
  `list_dir`); file → `tabs.open`.
- Boards are drawn as synthetic root-level rows **after** all folders/files, named by board
  display name (`vault.ts:157-173, 202-205`); the `boards/<slug>` directories are hidden from the
  tree (`:190-195`).
- Only supported types are drawn (`vault.ts:150`, `ui/lib/fileTypes.ts:53-58`):
  `CREATABLE_EXTENSIONS` (`fileTypes.ts:14-18`: md markdown txt text json map yaml yml toml xml
  svg html htm css js mjs cjs jsx ts mts cts tsx py rs sh bash zsh ini conf cfg properties env
  swift csv tsv log) + `Dockerfile LICENSE Makefile` + view types `pdf png jpg jpeg gif webp`.
  Anything else (`.go`, `.java`, `.c`, `.rb`, `.sql`, `.docx`, `.mp3`, …) is **invisible**.
- Hidden entries, symlinks, "other" kinds never listed (`shell/commands.rs:63-68`).
- Right-click (`:254-257`) → `openTreeContextMenu` → native menu (`shell/menu.rs:513-539`):
  **Show in Finder · Rename · Move to Trash · ─ · New Note · New Folder**; a board row gets
  **Show in Finder only**.
- Drag & drop (`:258-303`, ADR-0018/0019):
  - file row drags (`text/plain` = path); folder row or the tree's empty space accepts →
    `moveEntry` = rename into that folder (core relinks). **Folders cannot be dragged**
    (`draggable = !entry.dir || isBoard`, `:227`; `moveEntry` refuses dirs, `commands.ts:126-127`).
  - board row drags (`application/x-novalis-board`); dropping on another board row places it
    after; on empty space → last.
  - a card dragged from the board pane onto a board row moves it to that board.
- No keyboard navigation of the tree: rows are `tabIndex={-1}` with no `onKeyDown` (`:249-252`).
  `Enter` → `tree.rename` and `Cmd+Delete` → `tree.trash` are handled globally outside the editor
  (`App.tsx:196-205`, keymap scope `tree`).
- No filter/search box in the sidebar (no `<input>` in `Sidebar.tsx`). No "collapse all".
  No multi-select. No favourites/pins.
- Empty vault: the tree is simply empty (`tree.empty` "This vault has no files yet." exists in
  the catalog but is unused).

### 1.4 Foot (`Sidebar.tsx:324-346`)
- Gear button → `settings.open` (palette on the four settings, ADR-0012 amendment).
- Text hints with a dot: "{n} notes online only" and "{n} conflict copies" (`cloudCounts`,
  `vault.ts:215-232`). **Not clickable**; there is no conflict-resolution panel
  (`status.conflicts.*` keys unused).

---

## 2. Tabs and title bar

### 2.1 TabStrip (`ui/components/TabStrip.tsx`)
- One `.tab` per open path: label = `stemOf(path)` (`:47`, file name without extension, never the
  frontmatter title), dirty dot when `doc.dirty` (`:48`), close `×` (`:49-58`). Middle-click
  closes (`:39-44`). Click activates (`:45`).
- Viewer tabs (PDF/image) have no doc, so never a dirty dot.
- The **eye toggle** (`:68-79`, ADR-0020) sits outside the scrolling strip, only when the active
  tab `isNote` (`.md`); tooltip "View"/"Edit"; `aria-pressed`; dispatches `note.togglePreview`
  (same as `Cmd+E`).
- Verified absent: tab drag-reorder (no `draggable`), tab context menu (no `onContextMenu`),
  "close others/all/right", pinning, tab overflow menu, tab tooltips with the full path.
- Tab model (`ui/stores/tabs.ts`): `open` appends (no dedupe by position), `close` picks the
  neighbour (`:76-93`), reopen-closed stack of 20 (`:17, 100-105`), `next/previous` wrap
  (`:107-119`), `goto(1..9)` (`:121-124`), history of 100 for back/forward (`:18, 126-146`).
  Activating a tab saves the previous one first (`:62`) and hides the board (`:73`, D21).
- Session restore: last tabs re-opened in the background at boot, then the active one
  (`App.tsx:121-137`).

### 2.2 TitleBar (`ui/components/TitleBar.tsx`)
- Custom 38 px drag region; macOS traffic lights drawn over the left inset.
- Breadcrumb `vault ▸ folder ▸ … ▸ stem` (`:23-42`): **plain spans, not clickable**, last segment
  styled `current`.
- Right: a `kbd` button showing `⇧⌘P` → opens the command palette (`:43-50`). (The task said
  "⌘K badge": it is the palette chord `Shift+Cmd+P`; `Cmd+K` is Insert Link.)

### 2.3 Navigation
- `Cmd+[` / `Cmd+]` → `nav.back`/`nav.forward` over the activation history (`tabs.ts:126-146`);
  also Go ▸ Back/Forward in the native menu (`shell/menu.rs:471-482`). Back/forward re-opens a tab
  that was closed in between (`:133, 144`).

---

## 3. Palette (`ui/components/Palette.tsx`) — three modes, one component

Modes (`:42-48`): `quickOpen` (`Cmd+P`), `palette` (`Shift+Cmd+P`), `settings` (sidebar gear /
`settings.open`). Placeholders: "Open a note by name" / "Type a command or search notes" /
"Appearance, language, spelling, font size".

### 3.1 Quick-open scope (`:63-70`)
Pool = every path from `list_notes` (**`.md` only**: `shell/commands.rs:320-330` →
`walk_notes` → `is_note_name`, `crates/novalis-core/src/vault/walk.rs:52-54`) **plus boards**.
So `.txt`, `.json`, `.pdf`, images etc. are **not** quick-openable; they must be clicked in the
tree. Label = stem, meta = folder (`:82-93, 167-173`). Fuzzy ranking `ui/lib/fuzzy.ts`
(subsequence, smart-case, limit 60 in the palette `:95`). No "recently opened" section
(`palette.section.recent` unused), no "create note '<query>'" when nothing matches
(`palette.noResults` only; Enter on no results is a no-op, `:141`).

### 3.2 Palette mode pool (`:71-79`)
`[commands…, headings of the active editor document, notes…, boards…]`. Headings come from a
regex over the CodeMirror doc (`ui/editor/commands.ts:129-138`) — **only while the editor is
mounted**; in preview mode `editorHeadings()` returns `[]` (bridge is null when the editor is
unmounted, `Editor.tsx:92-94`). Selecting a heading → `goToEditorLine` (`Palette.tsx:121-123`).

### 3.3 Every palette command (from `ui/lib/commands.ts:314-360`, labels from `i18n/en.json`)

| # | id | label (en) | chord | settings subset |
|---|---|---|---|---|
| 1 | `quickOpen.open` | Quick Open… | ⌘P | |
| 2 | `search.vault` | Find in Vault… | ⇧⌘F | |
| 3 | `file.newNote` | New Note | ⌘N | |
| 4 | `file.todayNote` | Today's Note | — | |
| 5 | `tree.newFolder` | New Folder | ⇧⌘N | |
| 6 | `board.new` | New Board | — | |
| 7 | `settings.open` | Settings… | — | |
| 8 | `vault.open` | Open Vault… | ⌘O | |
| 9 | `file.save` | Save | ⌘S | |
| 10 | `tree.rename` | Rename | (Enter, tree) | |
| 11 | `tree.trash` | Move to Trash | (⌘⌫, tree) | |
| 12 | `tree.reveal` | Show in Finder | — | |
| 13 | `sidebar.toggle` | Toggle Sidebar | ⌘\ | |
| 14 | `board.toggle` | Toggle Board | ⇧⌘B | |
| 15 | `note.togglePreview` | Toggle Preview | ⌘E | |
| 16 | `backlinks.toggle` | Show Backlinks / Hide Backlinks (state-dependent, `:337-341`) | — | |
| 17 | `editor.gotoLine` | Go to Line… | ⌃G | |
| 18 | `find.open` | Find… | ⌘F | |
| 19 | `find.replace` | Find and Replace… | ⌥⌘F | |
| 20 | `markdown.bold` | Bold | ⌘B | |
| 21 | `markdown.italic` | Italic | ⌘I | |
| 22 | `markdown.link` | Insert Link | ⌘K | |
| 23 | `markdown.toggleCheckbox` | Toggle Checkbox | ⌘↩ | |
| 24 | `view.fontLarger` | Increase Font Size | ⌘= | ✓ |
| 25 | `view.fontSmaller` | Decrease Font Size | ⌘- | ✓ |
| 26 | `view.fontReset` | Reset Font Size | ⌘0 | ✓ |
| 27 | `settings.appearance.system` | Appearance: System | — | ✓ |
| 28 | `settings.appearance.light` | Appearance: Light | — | ✓ |
| 29 | `settings.appearance.dark` | Appearance: Dark | — | ✓ |
| 30 | `settings.language.system` | Language: System | — | ✓ |
| 31 | `settings.language.de` | Language: Deutsch | — | ✓ |
| 32 | `settings.language.en` | Language: English | — | ✓ |
| 33 | `settings.spellcheck` | Check Spelling While Typing | — | ✓ |

Other command ids exist in `REGISTRY` but are not palette entries: `tab.close`, `tab.reopenClosed`,
`tab.next`, `tab.previous`, `nav.back`, `nav.forward`, `palette.open`, `tab.goto.1..9`
(`commands.ts:225-230, 232, 271-273`). Editor-only ids reachable by chord/menu but not the palette:
`edit.undo/redo`, `find.next/previous`, `editor.selectNextOccurrence`,
`editor.selectAllOccurrences`, `editor.addCursorAbove/Below`, `editor.moveLineUp/Down`,
`editor.duplicateLine`, `editor.deleteLine`, `editor.toggleComment` (`ui/editor/commands.ts:103-126`).

### 3.4 Catalog entries that promise palette commands which do **not** exist (verified 0 uses)
`palette.cmd.filterByTag` ("Filter by Tag…"), `palette.cmd.gotoHeading` ("Go to Heading…" — the
headings are inlined instead), `palette.cmd.switchBoard` ("Switch Board…" — boards are inlined),
`palette.cmd.showCloudOnly`, `palette.cmd.showConflictCopies`, `palette.cmd.downloadCloudOnly`,
`palette.section.tags`, `palette.section.recent`, `palette.foot.openInNewTab`. There is **no tags
section and no tag filter in the palette**; tags surface only in the search panel (§5).

### 3.5 Keyboard (`:138-149`)
Esc closes, Enter runs, ↑/↓ move; mouse hover selects, click runs. No `Cmd+Enter` "open in new
tab"/background open. Footer shows navigate / open|run / close hints (`:179-183`).

---

## 4. Search panel `Shift+Cmd+F` (`ui/components/SearchPanel.tsx`)

- Same scrim/palette chrome. Input (`:111-121`) debounced 180 ms (`:27, 99-102`), streamed hits
  over a Tauri `Channel` in batches of 64 (`shell/commands.rs:44, 741-794`), capped at 400
  (`:28`).
- Options: **Match Case** toggle (`:122-129`), **Regex** toggle (`:130-137`), a **Tag** filter
  text field with a `<datalist>` of every tag + count from the cache (`:138-154`; tags come
  from `shell/commands.rs:797-822`, cache = frontmatter `tags:` + inline `#tags`,
  `crates/novalis-core/src/notes/frontmatter.rs:273-280`), "Clear filters" button when a tag is
  set (`:155-164`).
- Query sent (`:79-93`): `folder: null`, `allFiles: false`, `limit: 400`. Consequences (verified
  in core `crates/novalis-core/src/search/mod.rs:185-188`): **only `.md` notes are searched**;
  there is **no folder filter** in the UI (`editor.search.filterFolder` key unused, DTO supports
  it: `shell/dto.rs:426`); no whole-word option (the DTO has none).
- No `path:`/`tag:` **query syntax** parsing — the query string goes verbatim (literal or regex).
- Results (`:167-185`): one row per hit = snippet (the matching line) + path as meta. Click →
  `close()` then `tabs.open(hit.path)` — **the line number is discarded** (`hit.line` is only used
  in the React key `:175`), so the note opens at the top, not at the hit. No keyboard navigation
  of results (only `Escape` is handled, `:117-120`); no grouping by file; no match highlighting
  inside the snippet; no result count per file.
- Footer (`:188-194`): "{n} results", "{n} notes not searched (online only)", "Showing the first
  400 results".
- **No replace across files** (§7.1 lists "multi-file replace" under LATER; nothing in the shell
  writes from a search).

---

## 5. Backlinks pane and tags

### 5.1 Backlinks (`ui/components/Backlinks.tsx`)
- Toggled by `backlinks.toggle` (palette only — no menu item, no chord; `keymap.ts` has none).
  Rendered under the editor/preview, never beside the board (`App.tsx:346-352`); capped at a third
  of the pane height (`ui/styles/backlinks.css:1-3`).
- Header: "Backlinks" + "{n} notes · {m} cards" (`:83-90`). Empty: "No note or card links here yet."
- Note rows (`:95-106`): glyph · `note.title` (frontmatter title or stem, from the cache) ·
  snippet (the linking line) or path. Click → open the note at that line, resolved against the
  live text (`:31-46`, `ui/lib/editorBridge.ts:68-84`); works in preview too.
- Card rows (`:108-121`): title · board name. Click → `setActiveBoard(card.board)` **only**
  (`:113-115`). *Inferred, not run:* since no `useBoard.load(slug)` is called here (compare
  `Sidebar.tsx:96-99`, `Palette.tsx:114-117`), the board pane will show whichever board was last
  loaded (or the empty "New Board" state) rather than the card's board when it differs. Probable
  defect.
- Refreshes on `cache-updated` (`:67-68`); cache-backed, so notes appear only after the first scan.
- No "unlinked mentions", no outgoing-links list, no graph.

### 5.2 Tags
- Surface #1: the editor colours inline `#tags` as chips (`ui/editor/markdownExt.ts:46-73`,
  `ui/editor/theme.ts:118-127`) and completes them from **the current buffer only**
  (`ui/editor/setup.ts:132-147`: scans `context.state.doc`, not the vault).
- Surface #2: the search panel's Tag filter with the vault-wide datalist (§4).
- **Not present**: a tag list/panel, tag counts anywhere visible except the datalist (the count is
  in the DTO but the `<option>` renders only `entry.tag`, `SearchPanel.tsx:151-153`), clicking a
  tag chip in the editor (no handler; `linkAt` only knows `WikiLink` and `URL`,
  `ui/editor/decorations.ts:185-199`), frontmatter `tags:` editing UI, tag rename.

---

## 6. Status bar (`ui/components/StatusBar.tsx:26-53`)

Left (only when the active tab has a text doc):
- "{n} words" (whitespace split of the whole buffer, `:18-22`), "{n} characters" (`doc.text.length`),
  "Read-only" (non-UTF-8), "Plain" (≥ 5 MB), and a warning "Autosaving to {conflict copy path}".

Right:
- "Vault in {provider}" with a dot when the vault is under `~/Library/CloudStorage`
  (`vault.kind === "fileProvider"`, provider parsed from the path, `ui/lib/paths.ts:79-84`);
  "Vault in a Google Drive mirror folder" for `mirrored`; nothing for `local`.
- "{n} online only", "{n} conflict copies" (warn) — plain text, not clickable.

**Verified absent**: cursor position (`status.position` "Ln {{line}}, Col {{column}}" is in the
catalog but never rendered; nothing subscribes to CodeMirror's selection for the bar), selection
count (`status.selected` unused), cursor count (`status.cursors` unused), file type/language
name, encoding, line ending, reading time, save state indicator other than the tab dot, download
progress (`status.downloading` unused). For viewer tabs the left side is empty.

---

## 7. Board pane (`ui/components/BoardPane.tsx`)

- Shown by `board.toggle` (⇧⌘B, sidebar glyph, View menu) or by clicking a board row. Takes the
  whole main pane; opening any note hides it (`tabs.ts:73`).
- No board loaded → a single **"New Board"** button (`:35-43`).
- Header (`:147-204`): board name as a button → rename dialog; "{n} columns · {m} cards"; a native
  `<select>` **board switcher only when more than one board exists** (`:170-186`); **Add Column**.
- Notice strip (`:211-234`): conflict-resolution notice ("{n} cards had conflicting changes…",
  "column list had conflicting changes…") with Dismiss; "{n} card files could not be read".
- Columns (`:236-304`): name, count, hover-revealed actions ← → (move, disabled at ends),
  Rename, × Delete (confirm dialog; cards become orphans shown in the first column with a
  "column missing" marker, `:116-131, 404-406`).
- Cards (`:307-430`): title, description as **plain text** (`:338-340`, Markdown deliberately not
  rendered), hover actions: Rename, ≡ Edit Description (multiline dialog, ⌘↩ submits), Link Note…
  (links the **currently active note**; disabled when none or already linked, `:372-389`), ×
  Delete (confirm). Linked notes listed by stem with an unlink ×. Click on the card body opens
  `card.notes[0]` in a tab (`:60-64`); a card with no note does nothing on click.
- "New Card" button at the bottom of each column (`:432-453`) → title dialog.
- Drag: card within/between columns (drop on a card = after it, on empty column space = last,
  `:133-143`); card onto a board row in the sidebar moves boards.
- Busy indicator "Loading…" and "{n} online-only notes were skipped" (`:464-469`).
- **Verified absent**: due dates, labels/colours, WIP limits, swimlanes, card search/filter,
  archive/done semantics, per-card Markdown rendering, keyboard shortcuts inside the board (keymap
  scope `board` has zero bindings), card detail view, checklist inside a card, sorting.

---

## 8. Preview `Cmd+E` (`ui/components/Preview.tsx`, `crates/novalis-core/src/notes/render.rs`)

- Only for `.md` (`commands.ts:239-244`); rendered from the **buffer** (unsaved edits show),
  debounced 150 ms (`Preview.tsx:43, 221-246`). Read-only pane; a restart reopens every note in
  the editor (`ui.ts:79-83`).
- Renderer options (`render.rs:56-60`): CommonMark + **tables, task lists, strikethrough,
  footnotes, wikilinks**. Frontmatter stripped (`:54`). Raw HTML → escaped text (`:68`).
  Paragraphs/headings/list items carry `data-pos` for source mapping (`:69-80`).
- Task-list checkboxes are rendered `disabled` — **not toggleable in preview**
  (`ui/styles/preview.css:110-116`).
- Images: relative `src` fetched via `read_blob` into `blob:` URLs (`Preview.tsx:270-282`).
- ```` ```mermaid ```` fences → SVG via lazily loaded mermaid 12 (`:284-307`; theme follows
  appearance). **Other code fences are plain `<pre><code class="language-x">` — no syntax
  highlighting in the preview** (no highlight library in `apps/desktop/ui/package.json`; grep
  for hljs/prism/shiki: 0). No math (KaTeX absent), no callouts, no heading anchors/TOC, no
  heading ids.
- Links (`:412-436`): `#fragment` scrolls to an element with that id (footnotes); a **URL with a
  scheme shows the toast "External links are not opened by novalis."** (`:429-433`; no opener
  plugin in the shell); relative paths → `followLink` (note/PDF/image in a tab).
- Find bar (`:441-480`): `Cmd+F` opens an input over the pane; substring, case-insensitive, no
  regex (`:109-113`); "{i} of {n}" / "No matches"; ‹ › buttons, Enter / ⇧Enter, `Cmd+G`/`⇧⌘G`,
  Esc closes.
- `Cmd+B` / `Cmd+I` bridge (`:382-401`, `ui/lib/previewEdit.ts`): wraps the selected text in the
  **source** when the selection is inside one block and unique there; otherwise the tab flips back
  to the editor (`commands.ts:287-300`). Every other editor chord (⌘K, ⌘↩, ⌃G, ⌘D…) also flips to
  the editor without replaying.
- Backlink/jump targets scroll the source block into view and light it for 1.2 s (`:171-184`).
- No print, no export (HTML/PDF), no zoom other than the global font size, no scroll sync
  (there is only one pane).

---

## 9. Viewer (`ui/components/Viewer.tsx`, `PdfViewer.tsx`)

- Tier-D files (`pdf png jpg jpeg gif webp`) open read-only via `read_blob` (base64; refused
  above 50 MB, `shell/commands.rs:354-377`).
- Image: a single `<img>` (`Viewer.tsx:59`); no zoom, no pan, no rotate, no metadata.
- PDF bar (`PdfViewer.tsx:113-174`): ‹ Previous · page `<input type=number>` · "of {n}" · Next ›
  · − · "{percent} %" · + · **Fit width** (default). One page at a time on a canvas with a
  selectable text layer. Zoom 25 %–600 % in ×1.25 steps (`:22-24`). No continuous scroll of all
  pages, no thumbnails/outline, no text search inside the PDF, no rotation, no annotation
  (ADR-0016), no keyboard paging.
- The eye toggle and `Cmd+E` are absent for viewer tabs; status bar left side is empty.

---

## 10. Editor (`ui/editor/*`)

### 10.1 Assembly (`ui/editor/setup.ts:152-231`)
Base for every text file: history, drawSelection, dropCursor, multiple selections +
rectangular selection + crosshair cursor, active-line highlight, selection-match highlight,
bracket matching, indentOnInput, indent unit (4 spaces for py/rs/swift/sh/bash/zsh, else 2,
`:64-74`), CodeMirror `search({top:true})` panel, `defaultKeymap`+`searchKeymap`+`historyKeymap`
+`completionKeymap`+`indentWithTab`, `Mod-s` save, spellcheck attribute from the setting
(autocorrect/autocapitalize off). Prose types (`md markdown txt text`) get **soft wrap and no
line numbers**; everything else (and csv/tsv) gets **line numbers, no wrap** (`:64-74, 192-193`).
Above 5 MB (`shell/dto.rs:19`) → plain mode: no language, no decorations, no closeBrackets
(`:195-196`). Non-UTF-8 → read-only (`ui/stores/editorSave.ts:104`).

### 10.2 Markdown-specific (`setup.ts:76-93, 203-228`)
- Grammar: `@codemirror/lang-markdown` GFM base + YAML frontmatter + two inline parsers
  (`[[wikilink]]`, `#tag`, `ui/editor/markdownExt.ts`). Fenced code blocks resolve their grammar
  lazily from `@codemirror/language-data` (`:82-86`) → **code fences inside notes are
  syntax-highlighted in the editor**.
- *Inferred from the library default* (`@codemirror/lang-markdown@6.5.2`, `addKeymap = true`,
  `pasteURLAsLink = true` in `node_modules/@codemirror/lang-markdown/dist/index.js:407,423`):
  Enter continues list/quote markup, Backspace deletes markup, pasting a URL over a selection makes
  a link.
- Decorations, line level (`ui/editor/decorations.ts:22-91`): heading lines sized (H1 1.55em, H2
  1.24em, H3 1.1em; H4–H6 share H3, `:22-24`, `theme.ts:78-80`), blockquote lines (left rule,
  muted), frontmatter lines (mono, small, subtle), done-task lines subtle; **task markers `[ ]`/`[x]`
  replaced by a clickable checkbox widget** (`:29-48, 76-83, 109-118`; the one click that writes
  into a note).
- Inline highlight style (`ui/editor/theme.ts:109-144`): markers dimmed (processingInstruction),
  headings coloured/weight 500, **bold**, *italic*, ~~strike~~, links and URLs coloured,
  `#tags` as chips (mono, accent fill, border), inline code mono, quotes coloured, list markers
  default colour; code tokens: keyword, string, comment, number/bool/null, type/class/def,
  property/attribute, invalid. **Markers are never hidden** (decorated source, not WYSIWYG,
  `theme.ts:8-12`).
- *Inferred from `@lezer/markdown` GFM*: table delimiters get the marker colour and table header
  cells the heading colour; there is **no table widget/alignment/formatting** in the editor.
- Images are **not rendered inline** in the editor (no image widget anywhere in `decorations.ts`).
- Completion (`setup.ts:100-150`): `[[` → every note path without `.md`; `[[note#` / `[[#` →
  headings of that/this note (`ui/editor/headingCompletion.ts`); `#` → tags already in **this**
  buffer. No `editor.completion.newNote` ("Create …") option (key unused). No `@`/date/emoji
  completion.
- Keys bound inside CM for Markdown (`:207-211`): `Mod-b` `**`, `Mod-i` `_`, `Mod-Enter` toggle
  checkbox. `Cmd+K` Insert Link comes through the global keymap/menu → `insertLink`
  (`ui/editor/commands.ts:89-101`): inserts `[selection]()` and puts the cursor inside the
  parentheses — **no dialog** (`editor.link.*` placeholders unused).
- `Cmd`-click (`setup.ts:212-224`, `decorations.ts:185-199`): follows a `WikiLink` or `URL` node.
  Resolution in `App.tsx:263-279`: relative path → `.md` in editor, PDF/image in viewer; wikilink
  by stem (case-insensitive, `folder/stem` disambiguates, `ui/lib/links.ts:42-51`); **a `https://`
  URL resolves to nothing and silently does nothing** (no opener plugin; Mode 1 privacy). A
  wikilink to a missing note does nothing (no "create on follow").
- Attachments (`ui/editor/attachments.ts`, `ui/lib/attachments.ts`, ADR-0017): `Cmd+V` with an
  image (png/jpeg/gif/webp) or dropping image files → written to `attachments/` next to the note
  as `<stem>-YYYYMMDD-HHMMSS[-n].<ext>`, `![](attachments/…)` inserted. Other file types dropped
  fall through to default handling (text). No attachment management/rename/cleanup UI.
- Font size chords `Cmd+=` `Cmd+-` `Cmd+0` write the `editor.fontSize` setting (default 16) and
  set `--ds-font-size-editor` (`ui/stores/ui.ts:141-143, 220-225`). The editor font is the UI
  sans (`theme.ts:22`), not the mono font; there is no font-family choice.
- Sublime-style commands available by chord/menu (`ui/editor/commands.ts:103-126`): select next /
  all occurrences, add cursor above/below, move line, duplicate line, delete line, toggle comment
  (code scope), go to line (CM's stock panel).
- `Cmd+F` / `⌥⌘F` open **CodeMirror's stock search panel** (find, replace, next, previous, all,
  replace, replace all, match case, regexp, by word). It is **not localised**: no
  `EditorState.phrases` in `ui/src` (grep 0), so the panel is English even in German UI; the
  `editor.find.replace*`, `editor.find.wholeWord`, `editor.gotoLine.placeholder` catalog keys are
  unused.
- Non-Markdown text files: language by filename via `LanguageDescription.matchFilename`
  (`setup.ts:89-92`); no Markdown decorations, no completion, no attachments, no Cmd-click.
  `Cmd+/` toggles comments. `Cmd+E` does nothing.
- **Verified absent** in the editor: folding (no `foldGutter`/`codeFolding`, grep 0; only the
  placeholder is themed `theme.ts:49`), minimap, indentation guides (§7.1 lists them as baseline
  but nothing in `setup.ts` adds a guide extension), typewriter/focus mode, vim, a formatting
  toolbar, heading-level shortcuts, list indent/outdent commands beyond Tab, table editing, smart
  typography, word-wrap toggle, line-ending/encoding conversion, trim-on-save.

### 10.3 Saving (`ui/stores/editorSave.ts`)
Autosave 1 s after the last keystroke (`:36, 187-199`), on tab switch, blur, close, quit
(`App.tsx:213-222`, `tabs.ts:62`). `Cmd+S` flushes now. Precondition-checked writes; a mismatch
writes a **conflict copy immediately** and keeps autosaving there (`:243-263`). No manual
"revert", no version history, no "save as".

---

## 11. Native menus (`shell/menu.rs:135-508`), labels from `i18n/en.json`

- **novalis**: About novalis (version from Cargo) · Services · Hide · Hide Others · Show All · Quit.
- **File** (`:159-216`): New Note ⌘N · New Folder ⇧⌘N · New Board · ─ · Open Vault… ⌘O · ─ ·
  Save ⌘S · Rename · Move to Trash · Show in Finder · ─ · Close Tab ⌘W · Reopen Closed Tab ⇧⌘T.
- **Edit** (`:229-357`): Undo · Redo · ─ · Cut · Copy · Paste · Select All · ─ · Find… ⌘F · Find
  Next ⌘G · Find Previous ⇧⌘G · Find and Replace… ⌥⌘F · Find in Vault… ⇧⌘F · Go to Line… ⌃G · ─ ·
  Select Next Occurrence ⌘D · Select All Occurrences ⇧⌘L · Add Cursor Above ⌃⇧↑ · Add Cursor
  Below ⌃⇧↓ · ─ · Move Line Up ⌃⌘↑ · Move Line Down ⌃⌘↓ · Duplicate Line ⇧⌘D · Delete Line
  ⌃⇧K · Toggle Comment ⌘/ · ─ · Bold ⌘B · Italic ⌘I · Insert Link ⌘K · Toggle Checkbox ⌘↩ · ─ ·
  **Spelling ▸ ☑ Check Spelling While Typing** (check item, `:218-227`).
- **View** (`:418-455`): Show/Hide Sidebar ⌘\ · Show/Hide Board ⇧⌘B · ─ · Increase Font Size ⌘= ·
  Decrease Font Size ⌘- · Reset Font Size ⌘0 · ─ · **Appearance ▸** ○System ○Light ○Dark ·
  **Language ▸** ○System ○Deutsch ○English · ─ · Enter Full Screen.
- **Go** (`:457-496`): Quick Open… ⌘P · Command Palette… ⇧⌘P · ─ · Back ⌘[ · Forward ⌘] · ─ ·
  Previous Tab ⇧⌘[ · Next Tab ⇧⌘].
- **Window** (`:498-503`): Minimize · Zoom · ─ · Close Window.
- **Verified absent** from the menu bar: a **Help** menu; **Toggle Preview** (`menu.view.togglePreview`
  is used by the palette only, never by `menu.rs`); Show/Hide Backlinks; Today's Note; Settings…;
  **Install Command-Line Tool…** (`menu.app.installCli` and `app.installCli.*` exist in the catalog,
  `MENU_KEYS` `:37-95` does not list them, no `install_cli` command in `shell/lib.rs:33-59`;
  `docs/DECISIONS.md:561` records it as approved but open: the CLI is not yet a sidecar); Print;
  Export; Open Recent; Preferences/`Cmd+,` (unbound by ADR-0004, `docs/KEYMAP.md:46`).
- The menu is rebuilt when appearance/language/spellcheck/sidebar/board visibility change
  (`shell/commands.rs:181-208`).

---

## 12. Empty states, first run, vault picker, banners, toasts

- **Boot**: blank `div.boot` until `bootstrap()` returns (`App.tsx:296`); a failed boot shows a
  red card "Something went wrong" + raw error code + "Open Vault…" (`:283-295`). Pre-React
  failures paint a `<pre class="fatal">` (`ui/main.tsx:26-53`).
- **No vault** (first run, or `lastVault` gone): the main pane shows "Open a vault" / "A vault is a
  folder of Markdown files. Put it in your OneDrive or Google Drive folder…" / **Open Vault…**
  button (`App.tsx:315-322`); the sidebar renders an empty `<nav>` (`Sidebar.tsx:133`). The
  picker is the native folder dialog (`shell/commands.rs:270-281`); the chosen folder becomes
  `lastVault` (`:134-150`). No "create a new vault" flow (any folder is a vault; `.novalis/vault.json`
  is written by the CLI `init`, not the app), no recent-vaults list (`docs/SETTINGS.md` "Notes"),
  no demo/sample vault offer, no onboarding.
- **Vault open, no active tab**: "Open a note from the sidebar or press ⌘P." (`App.tsx:341-345`).
- **CloudHint** (`ui/components/CloudHint.tsx`): once per install for fileProvider/mirrored vaults:
  "This vault is in a cloud folder. Online-only notes download when you open them." + Dismiss.
- **Banner** per document (`ui/components/Banner.tsx`):
  - "Your last change was replaced by sync" → Reload · Restore mine (`:25-47`).
  - "Changed on disk" + "Your text is kept in {copy} until you decide." → Reload · Keep mine ·
    Save as conflict copy (`:49-84`).
  - Info banners with Dismiss: "This file is not UTF-8 encoded and opens read-only." / "Larger than
    50 MB: editing may be slow." / "Larger than 5 MB: opened in plain mode without Markdown styling
    or syntax highlighting." (`:86-102`; thresholds `shell/dto.rs:19-21`).
  - `banner.legacyVault.*` (old-Novalis vault detection) is in the catalog but **never shown**
    (0 uses).
- **Toast** (`ui/components/Toast.tsx`): one line bottom-right, 6 s, Close button; text = the
  catalog entry for the core error code (`errors.*`) or `editor.previewExternalLink`. No
  "Copy details" (`errors.copyDetails` unused), no toast history, no undo toast.
- **Prompt** (`ui/components/Prompt.tsx`): the single dialog shape — title + one input (or textarea
  for card descriptions, or a confirmation line) + Cancel/OK. Used for New Note (with the
  extension hint "Without an extension the file becomes .md. Kept as typed: .bash .cfg …"), New
  Folder, Rename, Move to Trash?, board/column/card names, descriptions, delete confirmations.
  Empty input is a no-op (except textarea); no validation feedback inline (errors arrive as toasts).

---

## 13. What a user CANNOT do today (each verified absent in code)

### Journal / daily notes
1. Open **yesterday's** or any other day's note by a command or key — only Today exists
   (`commands.ts:217-273`, `keymap.ts:23-79`); you must expand `journal/` in the tree.
2. See a **list or calendar of journal days**; no "previous/next day" navigation; no
   week/month view; no "on this day".
3. Use a **template** for the daily note (created as `b""`, `shell/commands.rs:599-602`).
4. Change the journal folder or file-name pattern (hard-coded `commands.ts:60-69`).
5. Open Today from the menu bar or a chord.

### Finding things
6. Quick-open a non-`.md` file (`.txt`, `.json`, `.pdf`, images…) — `Cmd+P` lists notes and boards
   only (`Palette.tsx:63-70`, `walk.rs:52-54`).
7. Search inside non-`.md` files (`SearchPanel.tsx:89`, `allFiles: false`).
8. Filter search by **folder** (DTO supports it, UI sends `null`, `SearchPanel.tsx:86`) or by
   **date**; no `path:`/`tag:`/`before:` query syntax.
9. Jump to the **matching line** from a search hit (line discarded, `SearchPanel.tsx:176-179`);
   navigate search results with the keyboard.
10. **Replace across files**.
11. See a **tag list/cloud**, click a tag to filter, rename a tag, see tag counts in the UI.
12. See **recently opened** notes (`palette.section.recent` unused; history exists only as
    back/forward).
13. Create a note straight from a non-matching quick-open query.
14. Sort/filter the tree by anything other than name/modified; filter the tree by text; sort by
    created date or size.
15. See a note's **frontmatter title** in the tree, tabs or breadcrumb (all show the file name /
    stem; only backlinks use the title).

### Reading / navigating a note
16. See a **table of contents / outline panel** (dropped; heading jump lives in ⇧⌘P and only while
    the editor is mounted, not in preview).
17. **Fold** headings or code blocks.
18. Click **breadcrumb** segments to navigate (plain spans, `TitleBar.tsx:34-41`).
19. Follow an `https://` link — editor Cmd-click does nothing, preview shows a toast
    (`Preview.tsx:429-433`); no "copy link".
20. Toggle a task checkbox **in the preview** (rendered `disabled`).
21. See **syntax highlighting inside code fences in the preview** (editor yes, preview no).
22. Render **math**, callouts/admonitions, highlights `==x==`, block ids, embeds/transclusion,
    inline images in the editor.
23. Search inside a **PDF**, view all PDF pages continuously, rotate, see thumbnails; zoom an
    **image**.
24. See **cursor position (Ln/Col)**, selection length or cursor count in the status bar.
25. Word count of the **selection** only; reading time.

### Editing
26. Insert a link through a **dialog** (⌘K inserts `[text]()` inline only).
27. Use a formatting toolbar, heading-level shortcuts (H1–H6), list/quote/code-block commands,
    table insertion/formatting, date/time insertion, emoji picker.
28. Auto-create a missing note by following a `[[wikilink]]` (no-op on miss, `App.tsx:277-278`).
29. Complete `#tags` from the **whole vault** (buffer only, `setup.ts:139`) or get a "Create
    '<name>'" completion option.
30. Paste/drop **non-image** attachments (PDF etc.) as links; manage/rename/delete attachments
    from the UI.
31. Use a localised **find/replace panel** (CodeMirror's English panel; `phrases` never set).
32. Revert to a saved version, see version history, "Save As", duplicate a note, copy a note's
    path or wikilink, move a **folder** by drag (files only).
33. Change editor font family, line height, width, tab size, or wrap per file (all hard-coded;
    the only settings are language, appearance, font size, spellcheck — `docs/SETTINGS.md`).

### Tabs / windows
34. **Reorder** tabs by drag, right-click a tab, close others/all, pin a tab, open a note in a
    **second window or split**, rename a tab independently of the file (renaming = File ▸ Rename
    on the active file).
35. **Resize the sidebar** by drag (state exists, no handle — `setSidebarWidth` never called).

### Boards
36. Give a card a due date, label/colour, checklist, or attachment; render its description as
    Markdown; filter/search cards; archive/done; WIP limits; keyboard operation of the board.
37. Open a board's cards from the backlinks pane reliably when it is not the loaded board
    (*inferred* defect, §5.1).

### App-level
38. **Print** or **export** a note (HTML, PDF, DOCX) — no command, no menu item
    (`Cmd+P` is quick-open by decision, `docs/KEYMAP.md:48`).
39. Open a **recent vault**, switch vaults quickly, create/initialise a vault from the app, see
    more than one vault.
40. Install the CLI from the app (approved, not built — `docs/DECISIONS.md:561`).
41. Open a Help/keyboard-shortcuts reference from the app; a preferences window; `Cmd+,`.
42. Resolve conflict copies from a panel (only counts are shown; `status.conflicts.*` unused);
    download all online-only notes in one go (`palette.cmd.downloadCloudOnly` unused).
43. Use a non-listed file type at all (e.g. `.go`, `.java`, `.c`, `.rb`, `.sql`, `.php`, `.lua`,
    `.docx`, `.xlsx`, `.mp3`, `.mp4`, `.epub`) — hidden from the tree (`fileTypes.ts:53-58`) even
    though `@codemirror/language-data` could highlight many of them.
44. See a rendered view of `.txt`/`.csv`/`.json` (no table view for CSV, §7.3 "not a table editor";
    no JSON tree; `Cmd+E` is `.md`-only).

---

## Appendix A — catalog keys with no UI reference (verified 0 uses outside tests)

`app.installCli.body/done/install/title`, `app.untitled`, `banner.legacyVault.step1/step2/title`,
`board.noteMissing`, `board.openNote`, `board.title`, `editor.completion.newNote/notes/tags`,
`editor.find.replace/replaceAll/replacePlaceholder/wholeWord`, `editor.gotoLine.placeholder`,
`editor.link.targetPlaceholder/textPlaceholder`, `editor.readOnly`, `editor.search.filterFolder`,
`errors.copyDetails`, `menu.app.installCli`, `palette.cmd.downloadCloudOnly/filterByTag/
gotoHeading/showCloudOnly/showConflictCopies/switchBoard`, `palette.foot.commands/openInNewTab`,
`palette.section.recent/tags`, `status.conflicts.*`, `status.cursors`, `status.downloading`,
`status.position`, `status.selected`, `tree.conflictCopy`, `tree.download`, `tree.empty`,
`tree.folderItems`, `tree.newFolderHere`, `tree.newNoteHere`, `tree.openInNewTab`.

These are useful as a map of features that were planned/mocked but not built.

## Appendix B — keymap summary (`docs/KEYMAP.md:31-86`, `ui/lib/keymap.ts:23-79`)

Global: ⌘S ⌘N ⌘O ⌘W ⌘P ⇧⌘P ⇧⌘F ⇧⌘[ ⇧⌘] ⌘1–9 ⇧⌘T ⌘[ ⌘] ⌘E ⌘\ ⇧⌘B ⌘= ⌘- ⌘0 ⇧⌘N.
Editor: ⌘Z ⇧⌘Z ⌘F ⌘G ⇧⌘G ⌃G ⌘D ⇧⌘L ⌥⌘F ⌃⇧↑ ⌃⇧↓ ⌃⌘↑ ⌃⌘↓ ⇧⌘D ⌃⇧K; Markdown: ⌘B ⌘I ⌘K ⌘↩;
code: ⌘/. Tree: ↩ rename, ⌘⌫ trash. Unbound by decision: ⌘, . Mouse: ⌥-click multi-cursor,
⌘-click link, checkbox click, drags (§1.3, §7). No rebinding.
