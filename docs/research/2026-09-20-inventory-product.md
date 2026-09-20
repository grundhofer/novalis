# novalis — complete product inventory (as of 2026-09-19, `main` at `aeead36`, VERSION `1.0.0-alpha.1`)

Legend used throughout:

- **VERIFIED** — seen in code (path:line cited) or in a doc that records a measurement.
- **DOC** — stated in PLAN.md / an ADR / DECISIONS.md; not independently re-verified beyond reading.
- **INFERRED** — my conclusion from greps or absence of code; not run, may be wrong.

Sources read in full: `PLAN.md` (827 lines), `docs/DECISIONS.md` (563 lines), `docs/decisions/0001…0021`, `docs/KEYMAP.md`, `docs/SETTINGS.md`, `docs/SYNC-REALITY.md`, `docs/RELEASING.md`, `docs/PRIVACY.md`, `packages/agent-skill/novalis/SKILL.md`, `i18n/en.json` (287 lines), `apps/desktop/ui/src/lib/commands.ts` (360), `apps/desktop/ui/src/lib/keymap.ts` (156), `apps/desktop/ui/src/lib/fileTypes.ts`, plus targeted greps into `apps/desktop/src-tauri/src/{lib,menu,commands}.rs`, `crates/novalis-cli/src/{cli,error}.rs`, `crates/novalis-cli/src/ops/`, `apps/desktop/ui/src/{editor,components,stores}/`, `docs/BUDGET.json`, `docs/FILE-PROVIDER-CHECKLIST.md`, `docs/releases/v1.0.0-alpha.1.md`, `.github/workflows/release.yml`, `Cargo.lock`.

---

## A. BUILT — every user-facing feature that exists today

### A.1 Shell, vault, tree, sidebar

| Feature | Where it lives (VERIFIED unless noted) | Basis |
|---|---|---|
| Open Vault… (`Cmd+O`), `lastVault` remembered, first-open writes `.novalis/vault.json` | `lib/commands.ts:151-163` (`vault.open`); `menu.rs:177`; `en.json:12-14` | PLAN D23, ADR-0004 (`lastVault` is state) |
| Folder tree, virtualized, folders first; files sorted by **Name** or **Modified** via the legend (`treeSort` in `state.json`) | `components/Sidebar.tsx:77-82,175-178`; `en.json:258-259,274-275` | ADR-0012 §2; PLAN §4.2 |
| Sidebar control row: New Note, New Folder, board toggle | `Sidebar.tsx:146-167` dispatching `file.newNote`, `tree.newFolder`, `board.toggle` | ADR-0012 §1 |
| **Today's Note** row + palette command → `journal/YYYY-MM-DD.md`, created empty, local date | `lib/commands.ts:60-88` (`JOURNAL_FOLDER`, `localIsoDay`, `todayNote`); `en.json:277` | ADR-0012 §3 (struck "daily notes" from §2.2) |
| Settings button (sliders glyph) in the sidebar foot → palette on the four settings only | `lib/commands.ts:233` (`settings.open`), `:314-319,349-358` (`settings: true` subset); `en.json:199,221` | ADR-0012 amended 2026-09-15 |
| New Note dialog keeps typed §7.3 extensions, shows the rule + sorted list | `lib/commands.ts:25-42` (hint `tree.newNoteHint`); `lib/fileTypes.ts:14-18` (`CREATABLE_EXTENSIONS`); `en.json:271` | ADR-0014, ADR-0015 §4 |
| Tree lists only §7.3 tiers A–D (+ `Dockerfile LICENSE Makefile`); `.wav`/`.mp4` etc. not drawn | `lib/fileTypes.ts:20-21,53-58` (`isSupported`) | ADR-0015 §3 |
| Board folders drawn as root-level rows with display name | ADR-0012 "Consequences" (DOC); `Sidebar.tsx:81` passes `boards` to `treeRows` | ADR-0012 |
| Rename (`Enter` in tree, File ▸ Rename, palette) with wikilink + card `notes[]` rewriting | `lib/commands.ts:95-116` (`renameTo`, `renamePath`); core relink (DOC, ADR-0005) | ADR-0005, PLAN D5 |
| Move to Trash (`Cmd+Delete`, File menu, palette, context menu) with confirmation; macOS Trash via `NsFileManager` | `lib/commands.ts:131-149` (`trashPath` asks first); `en.json:4-5` | PLAN D8, §4.5 "Trash method" |
| **Drag & drop of file rows** onto a folder row / tree root = rename with relink; folders are drop targets only | `lib/commands.ts:118-129` (`moveEntry`, `entry.dir` refused) | ADR-0018 |
| **Drag board rows** to reorder (`order` key in `board.json`); **drag a card** from the board pane onto a board row | ADR-0019 (DOC); `board_write` `place` in shell (DOC) | ADR-0019 |
| **Right-click context menu** on tree rows: Show in Finder, Rename, Move to Trash, New Note, New Folder (board row: Show in Finder only) | `lib/commands.ts:185-193` (`openTreeContextMenu`); `menu.rs:517-534`; IPC `tree_context_menu` `lib.rs:50` | ADR-0021 |
| **Show in Finder** (`tree.reveal`, `open -R`) in File menu, palette, context menu; no chord | `lib/commands.ts:257-260`; `menu.rs:200`; IPC `reveal` `lib.rs:49`; `en.json:171` | ADR-0021 |
| Cloud badge on online-only rows, "online only" footer counts, conflict-copy counts | `en.json:256-257,265-268`; `stores/vault.ts` (`conflictCopyOf`, DOC per DECISIONS.md:502) | PLAN §4.5 "Cloud-only files", §5.6 |
| Cloud hint banner shown once ("This vault is in a cloud folder…") | `components/CloudHint.tsx:20` | PLAN §5.3 "Cloud hints" |
| Custom 38 px title bar with breadcrumb + `kbd` badge (⇧⌘P) | `components/TitleBar.tsx`; ADR-0007 | ADR-0007 |
| Sidebar toggle `Cmd+\` | `keymap.ts:70`; `lib/commands.ts:235` | ADR-0008 |

### A.2 Tabs and navigation

| Feature | Where | Basis |
|---|---|---|
| Tab strip; close `Cmd+W` (never blocks), reopen `Shift+Cmd+T`, next/prev `Shift+Cmd+]`/`[`, `Cmd+1…9`, back/forward `Cmd+[`/`]` | `keymap.ts:33,52-65`; `lib/commands.ts:225-230,271-273`; `components/TabStrip.tsx` | PLAN §7.4, ADR-0008, D19, D20 |
| Quick-open `Cmd+P` (fuzzy, notes only) | `keymap.ts:37`; `lib/commands.ts:231`; `lib/fuzzy.ts`; `en.json:214` | PLAN §4.5 "Cmd-P" |
| Command palette `Shift+Cmd+P` with sections Commands / Headings / Notes / Boards; **heading jump** (replaces the dropped outline panel) | `components/Palette.tsx:21-39,79`; `lib/commands.ts:314-360` (entry list) | PLAN §4.3, §7.1 MUST |
| Open tabs / window / sidebar width persisted in `state.json` | ADR-0004 (DOC); `commands::state_save` `lib.rs:60` | PLAN §4.1 |

### A.3 Editor (CodeMirror 6, decorated source mode)

| Feature | Where | Basis |
|---|---|---|
| Instant open, Rust reads (`read_file`), grammar lazy via `@codemirror/language-data` | `editor/setup.ts:77-94` (`languageFor`); `lib.rs:39` | PLAN D1, D3, §7.1 MUST |
| Markdown: GFM bundle + custom inline parsers for `[[wikilinks]]` and `#tags`, YAML frontmatter | `editor/setup.ts:81-86` (`markdown({ base, codeLanguages: languages, extensions: [WikiLink, Tag] })`, `yamlFrontmatter`); `editor/markdownExt.ts` | PLAN §5.3 "Editor (CM6)", §7.2 |
| Syntax highlighting for §7.3 tiers A/B (JSON, YAML, TOML, XML/SVG, HTML, CSS, JS/TS, Python, Rust, shell, ini, Swift, Dockerfile) — via `LanguageDescription.matchFilename(languages, path)` | `editor/setup.ts:89-92`; `ui/package.json` deps `@codemirror/language-data` | PLAN §7.3 |
| Decorations: headings, emphasis with markers visible, link/tag colours, **clickable task checkboxes** (the only click that writes), `Cmd+Enter` toggles checkbox | `editor/decorations.ts:16,40-41,112,134` | PLAN §4.3, §5.3 |
| `Cmd`-click follows wikilink / Markdown link; `⌘`-click on `![](attachments/…)` opens the viewer | `lib/links.ts`; `editor/Editor.tsx` (`onFollowLink`) | KEYMAP.md mouse gestures |
| Multi-cursor: `Cmd+D`, `Shift+Cmd+L`, `Alt`-click, `Ctrl+Shift+↑/↓`, rectangular selection | `editor/setup.ts:160-161`; `editor/commands.ts` ids `editor.selectNextOccurrence`, `editor.addCursorAbove/Below`; `keymap.ts:40-46` | PLAN §7.1 MUST |
| Find/replace `Cmd+F` / `Alt+Cmd+F` (CM6 `search({top:true})`, regex/case/word/replace-all); `Cmd+G`/`Shift+Cmd+G` | `editor/setup.ts:19,168`; `keymap.ts:27-29,42` | PLAN §7.1 MUST |
| Goto line `Ctrl+G`; move line `Ctrl+Cmd+↑/↓`; duplicate `Shift+Cmd+D`; delete line `Ctrl+Shift+K`; comment `Cmd+/` (code only) | `keymap.ts:39,44,47-50`; `editor/commands.ts` | PLAN §7.4 |
| Bracket matching, auto-pair (`closeBrackets`), history, selection-match highlight, indent unit per file | `editor/setup.ts:157-170,198` | PLAN §4.2, §5.3 |
| Soft wrap on for md/txt, off for code; line numbers off for md/txt, on for code | `editor/setup.ts:192-193` (`options.wrap`, `options.numbers`) | PLAN §4.2 |
| `Cmd+B` / `Cmd+I` wrap `**`/`_`; `Cmd+K` insert/wrap link (dialog) | `keymap.ts:34-35,67`; `editor/commands.ts` `markdown.bold/italic/link` | PLAN §4.3, §4.5 |
| Autosave 1,000 ms, flush on blur/tab switch/quit, `Cmd+S` = flush now | `stores/editorSave.ts`; `keymap.ts:30` | PLAN D19 |
| External-change state machine: "Changed on disk" banner (Reload / Keep mine / Save as conflict copy), "Replaced by sync" banner (Reload / Restore mine), immediate conflict-copy write on refused save, status "Autosaving to …" | `components/Banner.tsx:25,49`; `stores/editorSave.ts:23,42,274`; `en.json:16-30,239`; IPC `write_conflict_copy` `lib.rs:44` | PLAN §5.3 steps 1-4 |
| Large files: >5 MB plain mode banner, >50 MB warning banner; not-UTF-8 → read-only banner | `Banner.tsx:87-89`; `en.json:22,26-27` | PLAN §4.2, §7.3 |
| Status bar: words, characters, cursors, selection, cloud state, conflict counts | `components/StatusBar.tsx:24-50`; `en.json:230-254` | PLAN §4.3, §5.3 |
| Spellcheck: `spellcheck` DOM attribute on the CM6 content follows the setting; Edit ▸ Spelling ▸ Check Spelling While Typing menu item | `editor/setup.ts:184` (`spellcheck: String(hooks.spellcheck)`); `menu.rs:218-222` | ADR-0004; PLAN §7.5 — **see D.9: the §7.5 user-defaults seeding is not found in the shell** |
| Font size `Cmd+=`/`-`/`0` writes `editor.fontSize` | `keymap.ts:72-74`; `lib/commands.ts:245-247` | ADR-0004 |
| `[[` completion (note list, "Create …" entry), `[[note#` / `[[#` heading completion, `#` tag completion from the buffer | `editor/setup.ts:96-149` (`completions`: `wiki`, `heading`, `tag`); `editor/headingCompletion.ts` | PLAN §4.4 yes; DECISIONS.md:448-466 (2026-09-16) |
| **Attachments**: `Cmd+V` image from clipboard / image files dropped on the editor → `attachments/<stem>-YYYYMMDD-HHMMSS.<ext>` next to the note, `![](attachments/…)` inserted; never overwrites | `editor/attachments.ts`; `lib/attachments.ts`; IPC `write_blob` `lib.rs:41` | ADR-0017 |

### A.4 Read-only preview (⌘E)

| Feature | Where | Basis |
|---|---|---|
| `Cmd+E` / eye-glyph button beside the tab strip toggles a Rust-rendered preview (`pulldown-cmark`, GFM tables/tasks/strikethrough, footnotes, wikilinks; frontmatter skipped; raw HTML as text) | `keymap.ts:69`; `lib/commands.ts:239-244`; IPC `render_markdown` `lib.rs:42`; `components/Preview.tsx` | ADR-0020 |
| Attachments shown via `read_blob`; internal links followed; external links refused with a toast | `Preview.tsx`; `en.json:94` | ADR-0020 |
| **Mermaid 12** draws `mermaid` fences as a lazy chunk, `securityLevel: "strict"` | `ui/package.json` `"mermaid": "12.0.0"`; ADR-0020 | ADR-0020 (owner: "Mermaid (Recommended)") |
| Preview chords: `Cmd+F` find bar over rendered text, `Cmd+G`/`Shift+Cmd+G`, `Escape`; `Cmd+B`/`Cmd+I` toggle marks in the source block; other editor chords switch back to the editor | `lib/commands.ts:287-301`; `lib/previewBridge.ts`; `lib/previewEdit.ts`; `Preview.tsx:159-473` | ADR-0020 amended 2026-09-16 (chords) |
| Backlink jump into a previewed note lands on the block, lit briefly | `components/Backlinks.tsx:33-35` (`goToPreviewLine`) | DECISIONS.md:435-441 (defect fix) |

### A.5 Viewer (tier D)

| Feature | Where | Basis |
|---|---|---|
| PDF via **pdf.js** on a canvas + text layer, app's own bar: prev/next, page N of M (typed), zoom −/+/level, fit width (default) | `components/PdfViewer.tsx`; `ui/package.json` `"pdfjs-dist": "6.3.289"`; `en.json:279-286` | ADR-0016 (supersedes the WebView-PDF half of ADR-0015) |
| Images `png jpg jpeg gif webp` via `<img>` from a `blob:` URL; `svg` stays editable XML | `lib/fileTypes.ts:23-42`; `components/Viewer.tsx`; IPC `read_blob` `lib.rs:40` | ADR-0015 |

### A.6 Search, backlinks, tags

| Feature | Where | Basis |
|---|---|---|
| Vault search `Shift+Cmd+F` panel: streaming results, regex, case, **tag filter** (datalist from the cache), cloud-only-skipped count, truncation notice | `components/SearchPanel.tsx:35-97,141-155`; `en.json:96-107` | PLAN §7.1 MUST; §4.4 "Tags as search filter" |
| **Backlinks pane** (toggle in palette): one entry per link occurrence with the line's snippet, click jumps to the line; "cards linking here" section | `components/Backlinks.tsx:22-35,99-100`; `lib/commands.ts:236,336-341`; `en.json:66-71`; IPC `backlinks` `lib.rs:53` | PLAN §4.4 yes; DECISIONS.md:417-444 ("Pro Stelle, Sprung zur Zeile", "ne, die zeilen nicht") |
| Tags: frontmatter `tags:` + inline `#tags` indexed in the cache, exposed to search filter and `#` completion; IPC `tags` | `lib.rs:52`; `SearchPanel.tsx:47` | PLAN §4.4 |

### A.7 Kanban board

| Feature | Where | Basis |
|---|---|---|
| Board pane in the same window, toggle `Shift+Cmd+B` / sidebar button / View menu; board rows in the tree; board switcher when >1 board | `keymap.ts:71`; `lib/commands.ts:237`; `en.json:61` (`board.switcher`); `components/BoardPane.tsx` | ADR-0006, ADR-0007 (L4), §4.5 |
| New Board (File menu, palette) → `boards/<slug>/board.json` | `lib/commands.ts:165-182`; `menu.rs:172`; IPC `board_create` `lib.rs:56` | ADR-0006 |
| Columns: add / rename / move left-right / delete (orphaned cards shown in the first column with a marker) | `en.json:31,37,44-48,53-54,60` | ADR-0006, §8.5 |
| Cards: new, rename, **description** (Markdown by convention, plain text on the card, 3-line clamp, multiline dialog with `Cmd+Enter`), link/unlink note, open note (card click opens the linked note in a tab), delete (tombstone) | `en.json:33,49,51-52,55-59,63`; IPC `card_write` `lib.rs:58` | ADR-0006, ADR-0013, D21 |
| Card drag between columns; card drag to another board (sidebar row); board reorder | ADR-0019 (DOC); KEYMAP.md:98,100 | ADR-0019 |
| Card/board conflict resolution on the **first read of each board after vault open**; dismissable notices; unreadable-card count | `commands.rs:917-922` (`resolve_board_conflicts`, `resolve_card_conflicts` gated by `first`); `en.json:39,42-43,64-65` | §8.4; DECISIONS.md:117-145 ("Erstes Lesen pro Board", "Ja, Schließen-Knopf") |
| Soft-delete tombstones (`deleted`, purged after 30 days on next write) | `crates/novalis-core/src/boards/mod.rs:6,70,76` | ADR-0006 |

### A.8 Settings (exactly four) and menus

| Feature | Where | Basis |
|---|---|---|
| `language` (system/de/en) — View ▸ Language + palette | `menu.rs:386`; `lib/commands.ts:264-266`; `SETTINGS.md:25` | ADR-0004, ADR-0012 §4 |
| `appearance` (system/light/dark) — View ▸ Appearance + palette | `menu.rs:359`; `lib/commands.ts:261-263` | ADR-0004 |
| `editor.fontSize` — `Cmd+=`/`-`/`0` + View menu + palette | `menu.rs:435-447` | ADR-0004 |
| `spellcheck` — Edit ▸ Spelling + palette | `menu.rs:218-222`; `lib/commands.ts:267-268` | ADR-0004 |
| Native menus (File/Edit/View/Go/Window) built from `i18n/*.json`; `MENU_KEYS` parity test | `menu.rs:30-75` (`MENU_KEYS`), `:159-498` | PLAN D9, §5.8 |
| No preferences window; `Cmd+,` unbound (asserted by the parity test) | `KEYMAP.md:46` | ADR-0004, ADR-0008 |
| German + English catalogs, 285 keys each, parity + `no-literal-string` lint in CI | `i18n/en.json`, `i18n/de.json` (285 keys each, counted); `justfile:167-169` | PLAN §5.8 |

### A.9 Sync awareness (Mode 1)

| Feature | Where | Basis |
|---|---|---|
| File-Provider / Drive-mirror vault detection, `SF_DATALESS` cloud-only detection, materialize-off guard for scans, download on explicit open with timeout | core `vault::cloud` (DOC, PLAN §5.2); `en.json:115,125,236-238` | PLAN §2.3 rule 7, §5.6; Spike A/D |
| Atomic save (temp → fsync → `RENAME_EXCL`), precondition by (mtime,size,hash), self-write suppression by content hash | core `vault::fs` (DOC); Spike A measured (PLAN.md:346) | PLAN §2.3 rule 4 |
| FSEvents watcher, 100 ms batches, one `fs-batch` event | `apps/desktop/src-tauri/src/watcher.rs`; `lib.rs:62` (`FsBatch`) | PLAN §2.3 rule 5 |
| Vendor conflict-copy **detection + counts** (one detector in core, shared with `doctor`) | `stores/vault.ts`, `StatusBar.tsx:48-50`; SYNC-REALITY.md:50-53 | §5.3 — resolution UI **not** built (see B.3) |

### A.10 CLI `novalis` (VERIFIED against `crates/novalis-cli/src/cli.rs:52-91` and `src/ops/`)

Built: `ls`, `cat`, `new`, `edit`, `meta`, `mv`, `rm`, `search`, `links` (incl. `--unresolved`, `--orphans` `ops/links.rs:107`), `tags`, `relink`, `index`, `init`, `doctor` (checks: `vault_marker cache version_skew frontmatter unresolved_links duplicate_stems unlinkable_stems notes_in_boards conflict_copies cloud_only_links legacy_tokens`, `ops/doctor.rs`), `help` (`--json`), `board ls/show/columns --set`, `card ls/add/mv/set/rm` (with `--description`, `--if-updated`), `migrate` (dry-run default, `--apply`, `--rename-to-title`, `--import-columns`). Global flags `--vault --json --plain --dry-run --no-index --quiet` (`cli.rs:23-48`). Exit codes 0–8 per §9.2 (`SKILL.md:114-126`). Golden tests `just test-cli`. Agent skill `packages/agent-skill/novalis/{SKILL,reference,examples}.md`.

Stubs that exit 2 "planned in Phase 4": `sync status`, `skill --path` (`cli.rs:88-91`, `error.rs:147`) — see B.4.

### A.11 Distribution and governance (built)

Unsigned arm64 DMG + CLI tarball + source archive + `SHA256SUMS` + provenance attestations via `release.yml`; `v1.0.0-alpha.1` published 2026-09-19 (`docs/releases/v1.0.0-alpha.1.md`); Homebrew tap `grundhofer/homebrew-novalis` (cask + formula) created 2026-09-19 (`RELEASING.md:137-167`). UI test runner vitest/jsdom/RTL (ADR-0011). Flat 2.0 control mockup row exists (`design/variants/png/flat-*.png`, `design/variants/README.md:3`).

---

## B. APPROVED, NOT BUILT

### B.1 Reading formats approved 2026-09-15 (each needs its own ADR when built)

Owner, asked "which reading formats to plan next" after choosing pdf.js (DECISIONS.md:241-246; ADR-0016:59-63):

> EPUB (Recommended), Markdown-Lesemodus ⌘E (Recommended), DOCX (nur lesen), CBZ

- **EPUB** — approved, not built. ADR-0016:62 proposes "an EPUB reader on a Rust `zip` crate". (Sequence: see C.5 — EPUB was *not selected* earlier that day as a v1 viewer type.)
- **DOCX (read-only)** — approved, not built. ADR-0016:62: "DOCX through `mammoth`".
- **CBZ** — approved, not built. ADR-0016:63: "CBZ once `zip` is there".
- Markdown-Lesemodus ⌘E — the fourth item, **built** the same day (ADR-0020).

Proposed order (DECISIONS.md:245-246): EPUB, preview (done), DOCX, CBZ.

### B.2 "Install command-line tool" menu item

- Approved 2026-09-05 via "section 4 please make your recommedations" adopting PLAN §4.4 row "Install command-line tool menu item … yes" (PLAN.md:164; DECISIONS.md:54).
- **VERIFIED not built**: the strings exist (`en.json:6-9` `app.installCli.*`, `:134` `menu.app.installCli`, `:120` `errors.installCliFailed`) but no source file references them (`grep -rln installCli apps/desktop/ui/src apps/desktop/src-tauri/src crates` → nothing; `menu.rs` has no `menu.app.*` key). Nothing in `tauri.conf.json` bundles the CLI (`bundle` block lines 30-48 has no `externalBin`); `release.yml:101-105` builds the CLI and publishes it as a tarball but does not place it at `Contents/MacOS/novalis` despite the comment saying so (INFERRED from reading the workflow; the comment at `release.yml:100-101` describes an intent the steps do not implement).
- Open-items table (DECISIONS.md:561): "The app binary is already `Contents/MacOS/novalis-desktop`; the CLI needs a name and a place in the bundle before the menu item can do anything. Recommendation: ship the CLI as a sidecar named `novalis` and symlink that."

### B.3 Conflict-copy resolve panel (promised in PLAN §5.3)

- PLAN.md:309: "N conflict copies found (click → list with Keep original / Keep copy / Keep both)".
- **VERIFIED not built**: `status.conflicts.title/empty/keepOriginal/keepCopy/keepBoth` (`en.json:240-244`) are referenced by no code; `StatusBar.tsx:48-50` renders the count only. SYNC-REALITY.md:80-82: "It does not offer to resolve vendor conflict copies from the app yet. It only counts them." DECISIONS.md:503: "**Still open.** Either build it or drop the promise from the plan." Release notes name it as Known (`docs/releases/v1.0.0-alpha.1.md:73-74,86-88`).

### B.4 CLI commands in the approved contract, stubbed

- `sync status` (PLAN §9.2 line 531) and `skill --path` (§4.4 "CLI `help --json` and `skill --path`: yes", PLAN.md:162; DECISIONS.md:52) — `cli.rs:88-91` marks both "planned in Phase 4"; `SKILL.md:86-91` lists them as Planned.
- `migrate --import-status` — PLAN §9.2 says "(needs yes)"; owner chose "leave as text" (§4.5) → **not approved**, correctly not built (ADR-0005:13).
- CLI flag to place a board (`order`) — ADR-0019:69-72 "an add, later, and needs no contract change" (not a decision yet).

### B.5 Approved §4.3/§4.4 items with gaps (INFERRED from greps; not run)

| Item | Status |
|---|---|
| Indentation guides for code (§4.3) | No `indentationMarkers`/indent-guide code found in `apps/desktop/ui/src` → **not built** |
| "Tags as search filter / **palette**" (§4.4 yes) | Search filter built; palette tag entries **not built** (`palette.cmd.filterByTag`, `palette.section.tags` `en.json:195,220` unreferenced; `Palette.tsx:32-35` has no `tag` section) |
| Search **folder** filter | UI sends `folder: null` (`SearchPanel.tsx:86`); `editor.search.filterFolder` (`en.json:99`) unreferenced → **not in the UI**; the CLI `search --folder` exists |
| Pseudo-locale `en-XA` (dev only; §4.4 yes, DECISIONS.md:57) | No `en-XA`/pseudo code found → **not built** |
| Migration prompt in the app (§10: first-open read-only prompt; Phase 3 "migration prompt (read-only)") | `banner.legacyVault.*` (`en.json:23-25`) unreferenced; `Banner.tsx` kinds are only `replacedBySync/changedOnDisk/notUtf8/hugeFile` → **not built**; the CLI `migrate` exists |
| "Download All Online-Only Notes", "Show Online-Only Notes", "Show Conflict Copies", "Switch Board…" palette commands; per-row "Download"; "Downloading N of M" | `en.json:194,201-203,247,261` unreferenced → **not built** (counts and download-on-open exist) |
| Editor find/replace panel strings (`editor.find.replace*`, `wholeWord`, `regex`) | Used only by the preview find bar and search panel; the CM6 editor panel is `search({top:true})` with no `EditorState.phrases` mapping found → INFERRED: the editor's own find bar shows CM6's English defaults, untranslated |
| `menu.app.about`, `menu.edit.undo/redo/cut/copy/paste` | Unreferenced in `menu.rs` → INFERRED these are Tauri predefined items with system labels (KEYMAP.md:113-119 says so for Quit/Full Screen); harmless |

### B.6 Planned for later — NOT approved, each needs a yes (PLAN §12 Phase 5, PLAN.md:663-665)

- Board + note split (L5 mockup; D21)
- MCP server `novalis mcp` (§9.5; §4.4 "no (v2)")
- Hide-syntax live preview mode (§4.4 "no")
- Sync Mode 2, OneDrive first (§5.7 fully specified; §4.5 "No; v1 = Mode 1")
- Universal binary (§4.5 "arm64 only")
- Windows/Linux builds (§2.1 "other platforms possible later"; ADR-0016 chose pdf.js partly for cross-platform)

Also LATER-tier in §7.1 (PLAN.md:418), each needs a yes: split view, folding, focus/typewriter, multi-file replace.

---

## C. REJECTED — with the exact reason/quote and date

### C.1 The §2.2 not-list (PLAN.md:56-60) — "dropped from the old app, absent from the codebase, not flagged off"; each is a feature under the minimalism gate

AI features · voice · **PDF editing** (was "PDF"; viewing approved ADR-0015) · canvas · calendar · reminders · **tasks parsed from note bodies (`@due`, `@status`)** (D18: left as inert text, `doctor` counts them) · **Today view** · **graph view** · properties/relations/rollups · block references · transclusion · math · **Mermaid in the editor** (preview only, ADR-0020) · callouts · **formatting toolbar** · slash menu · outline panel (replaced by palette heading jump) · plugins · **templates** · **version history** · git sync · P2P sync · Notion/ENEX import · docx export · configurable keybindings · feature flags · folder colours · **manual tree order** (re-affirmed ADR-0018:48-50) · alias resolution (D4) · non-UTF-8 encodings · Spanish and French.

Struck from the list: **daily notes** on 2026-09-14 (ADR-0012 §3: "one hard-coded `journal/YYYY-MM-DD.md` opened from the sidebar, created empty; 'Today view' and 'templates' stay dropped").

### C.2 §7.1 NO row (PLAN.md:419)

Minimap · vim · LSP · terminal · git · plugins · AI · themes gallery · toolbar · slash menu · trim-on-save · encoding conversion.

### C.3 §7.2 / §7.3 (PLAN.md:423, 436)

Not in v1 for the editor: callouts, highlights, comments, block ids, embeds (`![[…]]`), math, footnotes (the preview renders footnotes anyway, ADR-0020:83-87). "Stop there. No tree-sitter (WASM per grammar, no maintained CM6 binding). UTF-8 only."

### C.4 §4.4 rows answered "no" on 2026-09-05 (adopted via "section 4 please make your recommedations", DECISIONS.md:9)

| Feature | Reason (PLAN.md line) |
|---|---|
| Hide-syntax live preview (Obsidian style) | "Most expensive editor feature; conflicts with multi-cursor" (:148) |
| Split view / board + note split | "no (D21) — Adds a pane-focus model; L5 mockup shows what it would be" (:149) |
| Folding, typewriter/focus mode, minimap, vim | "Modes with own state" (:150) |
| Version history (app-data snapshots) | "Drive/OneDrive keep versions" (:152) |
| Multi-vault / recent vaults list | "Single vault + 'Open Vault…'" (:153) |
| E-paper focus/print mode | "A mode = a feature" (:154) |
| Kanban: due date, tags, colour, WIP limits, swimlanes, done semantics | "Each is a schema addition" (:156); description later approved (ADR-0013) |
| CLI `doctor --fix` | "doctor stays read-only" (:163) |
| MCP server | "no (v2) — Only for clients without shell access" (:165) |
| Localized CLI (German) | "Agents read English" (:166) |
| Pre-commit hooks | "no (CI only)" (:168) |
| Tags **tree panel** | §4.4 row text "(frontmatter `tags:` and inline `#tags`; no tree panel)" (:144) |

### C.5 §4.5 product/platform rows rejected (PLAN.md:172-197; DECISIONS.md:60-87)

- Sync Mode 2 in v1 — no ("+2 months, and you must accept shipping Google `client_id` + `client_secret`").
- Apple Developer Program — **"i won't start apple developer enrolment for the upcomming year."** (2026-09-05, ADR-0010).
- Auto-update / Tauri updater — none ("+1 network call, key custody, needs signed builds", ADR-0002).
- Finder trash method (Put Back) — rejected for the `osascript` Automation prompt + entitlement.
- Universal binary — arm64 only ("doubles CI build time").
- `Cmd-P` Print — no ("Quick-open (Sublime/Zed); no Print in v1").
- `Cmd-K` command palette (Dev-Noir signature) — no; link insertion instead (ADR-0008).
- Preferences window — **no** ("menus and shortcuts only, `Cmd-,` unbound"; ADR-0004: "Chrome the brief avoids; two drop-downs and a checkbox fit in menus").
- `@status` cards import — "Leave as text".
- Explicit save only (Sublime) — rejected for autosave-all-types (D19: "surprising for a notes tool on a synced folder").
- Cloud-only files hidden — rejected; shown with badge.
- `Claude-Session:` trailers — no.

### C.6 Rejections inside ADR "Rejected alternatives" tables (2026-09-05)

- ADR-0004: `style` key (runtime style switch), `vaults[]`, `sync.mode/folder`, per-file-type autosave rules, folder colours / manual tree order / feature flags.
- ADR-0005: title-based resolution, alias fallback ("hides broken references"), frontmatter `id` identity ("writes into notes the user did not edit").
- ADR-0006: `.novalis/kanban/*.json`, one JSON per board, tokens in note bodies, SQLite inside the vault, hard delete without tombstone.
- ADR-0007: Swiss as primary (**"dev noir first and then as alternative swiss"**), Editorial-Print / Warm Editorial, no-tabs L1 / palette-only L3 as base (**"I think we need tabs"**), L5 split, violet accent, native title bar, full Dev-Noir textures ("Noise under prose"), system fonts only.
- ADR-0008: configurable keybindings, vim mode ("Modes with their own state"), two-stroke chords ("chords with two strokes are a mode").
- ADR-0003: reusing the old identifier, importing old settings.
- ADR-0002: opt-in update check ("Two gated items at once: a new setting and a new network call").
- ADR-0016: native PDF renderers pdfium/MuPDF ("`*-sys` crates with a 10+ MB binary, which D26 and the DMG budget rule out"); WebView PDF view (its overlay icons "do nothing inside the app and cannot be turned off"; not cross-platform).

### C.7 Rejections and reversals from owner conversations (2026-09-13 … 2026-09-19)

| Date | Feature | Sequence / quote | Where |
|---|---|---|---|
| 2026-09-14 → 09-15 | **Settings button in the sidebar** | First **not selected** among four options ("Einstellungen-Knopf" left out; "the four settings reach the palette either way"), then reversed while testing: **"bitte noch settings button icon ermöglichen"** → built as a sliders glyph opening the palette on the four settings; still no window, `Cmd+,` unbound | DECISIONS.md:166-178, 248-256; ADR-0012:53-61, 118-122 |
| 2026-09-15 (morning) | **EPUB as a v1 viewer type** | Asked which read-only types (PDF recommended, "EPUB priced as a new dependency and its own reader"): **"Bilder (png, jpg, gif, webp, svg)", PDF (Recommended)** — "EPUB was not selected and is not built" | DECISIONS.md:213-221; ADR-0015:33-38, 47-48 |
| 2026-09-15 (later, same day) | **EPUB as a planned format** | After the pdf.js decision, asked "which reading formats to plan next, each with its own ADR when built": **"EPUB (Recommended), Markdown-Lesemodus ⌘E (Recommended), DOCX (nur lesen), CBZ"** → "All four are approved and not yet built". So: not chosen as a v1 type in the first question; approved as a later, ADR-gated format in the second. Net state: **approved, not built** (B.1) | DECISIONS.md:241-246; ADR-0016:59-63 |
| 2026-09-15 | **KaTeX** (math in notes) | Offered in the "Diagramme und mehr im Lesemodus" question; **not selected** ("Mermaid (Recommended)" only). Note ADR-0020:69-72: `katex` still enters the lockfile through Mermaid, "That is not the KaTeX the owner did not select: `$…$` in note text is not rendered." | DECISIONS.md:298-304; ADR-0020:33-38, 73 |
| 2026-09-15 | **PlantUML** | "PlantUML had been explained as needing Java or a server, which the privacy rule forbids" → rejected | DECISIONS.md:304-305; ADR-0020:34-36 |
| 2026-09-15 | **Boards outside `boards/`** ("Board in einen Ordner verschieben") | Owner first selected it, then asked with the cost named: **"Nein, Boards bleiben unter boards/ (Recommended)"** → withdrawn | DECISIONS.md:320-333; ADR-0019:20-35 |
| 2026-09-15 | **Inline images in the editor** | "Bilder im Editor sichtbar machen?" → **"Erst im Lesemodus ⌘E"** (decorated source mode D3 stands) | DECISIONS.md:342-344; ADR-0020:22-24, 73-75 |
| 2026-09-16 | **Formatting toolbar** | "macht es sinn, die gängisten markdown formatierungsoptionen für md files oben in der leiste einzublenden?" → recommendation against (§2.2, §7.1 NO; palette already lists the four chords) → **"ok, hast recht."** → "Recorded as a confirmed no; no ADR, nothing changes" | DECISIONS.md:386-396; ADR-0020:108-111 |
| 2026-09-16 | **Line numbers on backlink entries** | "ne, die zeilen nicht" | DECISIONS.md:442-444 |
| 2026-09-16 | **One backlink entry per note** (alternative) | Chose **"Pro Stelle, Sprung zur Zeile"** instead | DECISIONS.md:428-431 |
| 2026-09-16 | **Blocking `[[Name#` completion from downloading cloud-only notes** | Chose **"So lassen: `[[Name#` darf laden"** (kept the download) | DECISIONS.md:458-463 |
| 2026-09-16 | **Preview toggle as text button** | "…ein icon, keinen text haben, weil weniger infos" → glyph | DECISIONS.md:378-384; ADR-0020:93-101 |
| 2026-09-16 | Tree-side trash of a board, context menu on tabs/cards/editor, multi-select, "Move to…", "Duplicate", a chord for reveal | ADR-0021:44-47 "was not asked for"; :58-59 "Not built" | ADR-0021 |
| 2026-09-18 | **Running the File-Provider checklist before release** | "ich denke wir lassen die checkllste jetzt sein" → **"Ja, aussetzen"** (gate 1 waived for pre-releases) | DECISIONS.md:508-519; RELEASING.md:32-39 |
| 2026-09-18 | **Keeping old release tags** (recommended) | **"Alles löschen, auch Tags"** | DECISIONS.md:521-524 |
| 2026-09-18 | **`v2.0.0-alpha.1`** (recommended) / **`1.0.0` bare** (advised against) | **"v1.0.0-alpha.1"** | DECISIONS.md:526-536 |
| 2026-09-19 | Homebrew tap left optional | **"nein, ich will so ein homebrew repo."** → created (a distribution channel, no ADR) | DECISIONS.md:538-549 |
| 2026-09-13 | Board-conflict resolution timing alternatives ("beim Öffnen des Vaults, alle Boards", "beim nächsten Schreiben") | Chose **"Erstes Lesen pro Board"** | DECISIONS.md:117-145 |

### C.8 Attachments/tree scope explicitly excluded (ADR text)

- ADR-0017:74-75: pasting non-image files, inline images in the editor, resizing/conversion, `![[…]]` embed syntax, a configurable folder.
- ADR-0018:64-66: reordering rows, dropping onto a board row, dragging a file out to the Finder.
- ADR-0019:97-99: boards outside `boards/`, a board dropped into a folder, reordering cards across boards in one drag, a CLI flag that places a board.
- ADR-0014:60-61: a file-type picker, a "New File" item, creation of types the editor cannot open, `novalis new` for non-notes.
- ADR-0015:76-77: EPUB, DOCX, audio, video, any editing of a viewed file.
- ADR-0013:67-69: rendering the card Markdown, a second field, a card detail view, search over descriptions.
- ADR-0012:114-116: a fifth setting, a preferences window, a template, a "Today view", a configurable journal folder.

---

## D. OPEN / ASSESSED ONLY

1. **Cloudflare bucket sync** (owner 2026-09-14: "…zusätzlichen sync in ein bucket von cloudflare zum cross device sync … das würde eine mobile und eine webapp ermöglichen"). Answered with an assessment only, no decision (DECISIONS.md:362-372): first outbound connection → PRIVACY table row + lockfile HTTP-client refusal; needs credentials/token in the app, a third-writer conflict story next to Mode 1, and a non-existent web/mobile client. "It is not opened now… a v2 question of the size of Mode 2 (§5.7) and gets its own ADR before any code."
2. **Resolve panel** — see B.3. DECISIONS.md:503 "Still open… Either build it or drop the promise from the plan."
3. **"Open items after the week-1 scaffold" table** (DECISIONS.md:551-563), still headed "need your yes before they are closed":
   - The v1 dependency set (`schemars`, `tauri-specta`, `notify-debouncer-full`, React, CodeMirror, …) has no ADR; the recommendation was "One ADR-0011 'v1 dependency set'" — **but ADR-0011 was later used for the UI test runner** (2026-09-08), so the dependency-set ADR was never written (VERIFIED by the file list `docs/decisions/`).
   - `schemars` three majors in `Cargo.lock` (0.8 / 0.9 / 1.2).
   - CLI golden test location `tests/cli/` vs §11.1 (keep).
   - `edit --replace-section` keeps the heading (reword §9.2 before 1.0).
   - "Install Command-Line Tool" needs a sidecar (B.2).
   - `Shift+Cmd+N` scope `global` vs §7.4 "Tree" (keep global; KEYMAP.md:105-112).
4. **SYNC-REALITY.md** (all VERIFIED as measurements recorded there):
   - Google Drive silently discards the losing edit, no conflict copy (2026-09-08); novalis cannot detect it (:14-35). Cross-device change detection is Mode 2 work.
   - OneDrive same-note two-client conflict **never run** (:37-43) — "treat it as an assumption".
   - Drive's `Note 2.md` collision name deliberately not matched (:75-79).
   - Vendor conflict copies counted, not resolved (:80-82).
   - Advice: quit on one device before editing on another (:84-88).
5. **FILE-PROVIDER-CHECKLIST rows not run** (VERIFIED from the file): A4 conflict-copy naming, A7 same-card two clients, A9 dataless trash, A13 open cloud-only note, A14 search skips cloud-only, A16 card precondition mismatch; B5 two-client half; B9 dataless trash "unexplained" (one of two runs disagreed with the code; #116 adds a trace); C2, C7. Gate 1 waived for pre-releases with the condition that release notes list these (RELEASING.md:32-39) — they do (`docs/releases/v1.0.0-alpha.1.md:68-93`).
6. **Folder drag in the tree** — ADR-0018:40-44, 64: needs a directory-aware relink the core lacks; "gets its own record when built". Also open: relative Markdown links (incl. `![](attachments/…)`) inside a moved note are not rewritten (ADR-0017:66-73; ADR-0018:60-63).
7. **CLI placement of boards** (`order`) — ADR-0019:69-72, "an add, later".
8. **Spellcheck mechanism mismatch** (INFERRED): PLAN §7.5 (PLAN.md:444) says the shell "seeds `WebContinuousSpellCheckingEnabled` from the `spellcheck` setting at startup"; `grep -rn "WebContinuousSpellCheckingEnabled\|NSUserDefaults\|Continuous" apps/desktop/src-tauri/src` finds nothing. Only the DOM attribute is set (`editor/setup.ts:184`). Whether red underlines actually appear in the shipped app is unverified here; §7.5 itself flags "Still inferred rather than measured… confirm in Phase 3".
9. **`language: system` per-app mechanism** — ASSUMED (SETTINGS.md:49-51; ADR-0004:41).
10. **PRIVACY ↔ HTTP-client CI grep** — "Not yet enforced by CI" (PRIVACY.md:30); checked by hand at release time.
11. **Cargo.lock crate budget not enforced by any script** (VERIFIED: `grep cargoLockEntriesOverScaffold scripts/ justfile .github/workflows/` → nothing). Current count: **514 `[[package]]` entries** vs cap 431 + 150 = **581** (BUDGET.json:39-40 notes 511 when written) → 67 of headroom.
12. Two conflict detectors — settled (DECISIONS.md:502). Board conflict resolution unreachable — settled (:504; `commands.rs:917-922`).
13. **Editor find bar localization** (INFERRED, B.5): CM6's default panel, no `phrases` mapping.
14. **Minor doc drift**: DECISIONS.md:417 refers to a heading "Backlinks placement" that does not exist in the file; PLAN §11.5 (PLAN.md:612) lists ADR-0009 as the last scaffold ADR though 0010 (unsigned releases) was also written on 2026-09-05.

---

## E. HARD RULES that constrain any new feature

| Rule | Text / value | Where (VERIFIED) |
|---|---|---|
| **Minimalism gate** | "Nothing is added because it might be useful. A new setting, feature, menu item, shortcut, dependency or outbound connection needs an owner decision: ask the owner, then record the answer as `docs/decisions/NNNN-*.md` with the owner's verbatim 'yes' quoted, and cite `ADR-NNNN` in the PR body. If `PLAN.md` does not name it and `docs/DECISIONS.md` does not approve it, the answer is no until asked." | `CLAUDE.md` "The minimalism rule"; PLAN §11.5 (PLAN.md:610-614); PLAN.md:117 "silence ships nothing" |
| **Exactly four settings, no fifth** | `language`, `appearance`, `editor.fontSize`, `spellcheck` (+ `version` stamp, `lastVault` state); `Settings` struct `deny_unknown_fields`; parity test vs `docs/SETTINGS.md` fails CI in either direction | ADR-0004; `SETTINGS.md:21-30`; PLAN §2.3 rule 11 (:74). ADR-0012 and ADR-0017 both avoided a fifth key by hard-coding (`treeSort` → `state.json`; attachments folder hard-coded) |
| **No preferences window, `Cmd+,` unbound** | Parity test asserts the chord is unbound | `KEYMAP.md:46`; ADR-0004; ADR-0008 |
| **IPC surface cap 30, 27 used** | "The IPC surface. 27 commands — PLAN.md §2.3 rule 8 caps it at 30." | `lib.rs:30-61` (27 entries counted); PLAN.md:71; raised from 25 by "Grenze auf 30 anheben (Recommended)" (ADR-0020) |
| **Lockfile / ADR check** | A new top-level `Cargo.lock` or `pnpm-lock.yaml` entry requires `ADR-NNNN` in the PR body (CI fails otherwise) | `scripts/lockfile-adr-check.mjs:1-16`; `ci.yml:152`; CLAUDE.md "Generated files" |
| **`Cargo.lock` ≤ scaffold + 150** | Scaffold 431 → cap **581**; currently **514** (measured now); no `*-sys` crates beyond `libsqlite3-sys` and Tauri's own. Not enforced by a script (D.11) | PLAN D26 (:111), §11.3 (:602); `docs/BUDGET.json:38-40` |
| **No outbound connection** | No telemetry/analytics/crash reporting/update check; PRIVACY table empty; CSP `default-src 'none'`, `connect-src ipc: http://ipc.localhost`; any network call is a feature needing an ADR and a PRIVACY row; PlantUML rejected on this rule | `PRIVACY.md:3-30`; ADR-0002; CLAUDE.md "Privacy rule"; ADR-0020:34-36 |
| **Bundle budgets** | Eager JS ≤ 250 KB gzip, no eager chunk > 120 KB, eager CSS ≤ 24 KB (raised from 20 on 2026-09-16, "Budget auf 24 kB anheben (Recommended)"), fonts ≤ 250 KB, DMG ≤ 12 MB; `bundle-budget.mjs` parses `dist/index.html` modulepreloads; lazy chunks for pdf.js and Mermaid | `docs/BUDGET.json:14-18,37`; PLAN §11.3 (:594,602); `justfile:171-177`; PLAN §2.3 rule 9 |
| **Performance budgets** | First paint ≤ 300 ms (provisional), tree interactive 10k ≤ 500 ms, RSS ≤ 200 MB, keystroke p95 ≤ 16 ms, open 100 KB ≤ 16 ms, search 10k ≤ 300 ms, ≤ 3 IPC at boot / 1 per open / 1 per save; `perf.yml` on `main` and tags | `docs/BUDGET.json`; PLAN §11.3 (:589-604) |
| **i18n parity** | Every user-visible string in `i18n/en.json` **and** `de.json` (285 keys each now), flat `namespace.key`; `eslint-plugin-i18next no-literal-string`; catalog parity test; `MENU_KEYS` test; core and CLI carry no strings | CLAUDE.md "Where things live"; `justfile:167-169`; `menu.rs:33-36`; PLAN §5.8 |
| **Keymap parity** | `docs/KEYMAP.md` table ↔ `lib/keymap.ts` (same chords, ids, scopes); no rebinding UI; adding/changing a chord needs an ADR, a KEYMAP row and menu labels in both catalogs | `KEYMAP.md:6-14`; ADR-0008:25; `apps/desktop/src-tauri/tests/keymap_parity.rs` (named in KEYMAP.md:7) |
| **No textures / images in UI, no hard-coded colours, no CDN fonts** | Tokens only (`--ds-*`), light and dark as two token sets; textures off (ADR-0007); fonts self-hosted, Latin subset ≤ 250 KB | CLAUDE.md "What not to do"; ADR-0007:18-19; PLAN D10, §5.9 |
| **Contracts immutable after 1.0** | CLI commands, JSON shapes, exit codes 0–8: "add, never rename" after the first non-pre-release `1.0.0` — the reason `1.0.0` bare was advised against on 2026-09-18 | PLAN §9.1 (:507); CLAUDE.md "CLI contract"; RELEASING.md:12-15 |
| **Architecture rules** (constrain how, not whether) | First paint never waits for an index; buffer is truth / serialization is identity; never rewrite untouched bytes; atomic verified saves; watcher batches; no global lock; never read cloud-only eagerly; Kanban is its own data (never parse tokens from bodies); no migrations/sweeps/polling timers | PLAN §2.3 rules 1-13 (:62-76) |
| **Data-format rules** | Only `.novalis/vault.json` is written under `.novalis/`; boards only under `boards/` (re-affirmed ADR-0019); card fields fixed except `description`; frontmatter written only by CLI `meta`/`new --tag` | PLAN D22, D23, §5.5, §8.2; ADR-0006/0013/0019 |
| **Process rules** | Only `just` commands gate ("Never gate on ad-hoc `cargo …` or `pnpm …`"); "Done" = `just check` green, nothing skipped; no attribution trailers; never touch `novalis-legacy`/`legacy`; surgical changes | CLAUDE.md "The only commands", "What not to do" |
| **Platform rules** | macOS 14+, arm64 only, unsigned until ADR-0010 is revisited (before the first non-alpha release in 2027); CLT default toolchain | ADR-0010; PLAN §4.5; CLAUDE.md "Local limitations" |
| **UI test constraints** | vitest/jsdom/RTL mock `../ipc/client`; cannot see CSS, hover or drag — those need a human | ADR-0011:70-79; CLAUDE.md "UI tests" |

---

## F. RECURRING OWNER PREFERENCES (inferred from the quotes)

1. **Takes the recommended, smallest form almost every time.** "section 4 please make your recommedations"; "folge deinen vorschlägen"; nearly every multiple-choice answer picks the "(Recommended)" option (sidebar controls, Today row, card description, typed extensions, pdf.js, Mermaid, IPC cap 30, boards stay under `boards/`, gate waiver). Exceptions are deliberate and stated (tags deleted, `v1.0.0-alpha.1`, Homebrew repo).
2. **Accepts a "no" when the rule is explained.** Formatting toolbar: "ok, hast recht."; boards outside `boards/`: "Nein, Boards bleiben unter boards/". The minimalism rule is his, and he honours it when reminded.
3. **Wants icons/glyphs over text and less visible information.** "…ein icon, keinen text haben, weil weniger infos"; "es sollte ein icon um die settings zu öffnen"; "ne, die zeilen nicht" (no line numbers on backlinks); "sortiericon".
4. **Wants shortcuts and commands to work everywhere, in every mode.** "die shortcuts sollten auch im view mode funktionieren, nicht nur im edit mode"; "…im vorschau modeus mit command b … etwas fett zu markieren"; the toggle button "sollte immer sichtbar sein".
5. **Wants novalis to be a reader for whatever is in the vault, not just an editor.** "macht es sinn beim lesen der dateien pdf zu unterstützen? … gerne auch epub etc. alles was sinnvoll zum lesen ist."; "was für neue buch dokument formate können wir einfach unterstützen?"; "kónnen wir auch diagramme etc. darstellen wie von mermaid oder sowas wie puml? was sollten wir noch unterstützen?"; "wir sollten zwischen editier und view mode für .md umschalten können". But also: "nur unterstützte dateitypen anzeigen lassen. keine wav, mp4 etc" — reading formats yes, noise no.
6. **Direct manipulation: drag & drop and right-click everywhere.** "ich möchte die dateien, genau wie die boards per drag and drop verschieben können."; "also man sollte auch boards per drag and drop bewegen."; "open in finder per rechtsklick?"; "ist es außerdem möglich screenshots bzw. bilddateien in diesen abzulegen? am besten per command v etc".
7. **Cross-platform curiosity, without abandoning the Mac-first stack.** "können wir etwas nehmen, das auch cross platform verfügbar ist?"; "hast du dich bei der technologie wahl an cross platfform oder maximaler performance orientiert"; the Cloudflare idea "würde eine mobile und eine webapp ermöglichen". (Phase 5 lists Windows/Linux; pdf.js was chosen partly for this.)
8. **No servers, no Java, no accounts, no outbound traffic.** PlantUML dropped the moment it meant "Java or a server"; no Apple enrolment this year; no update check; the Cloudflare bucket parked as a v2 question of Mode-2 size once the credential/privacy cost was named.
9. **Tests the app himself and reports concrete defects, wants them fixed on the spot.** "der screenshot wird als zeile hinzugefügt, ist aber nicht sichtbar"; "die icons funktionieren nicht alle"; "das stört mich"; "der vorschau/bearbeiten button kann je nach breite ausgeblendet werden". Several fixes are recorded as defects, not decisions (ADR-0012 consequences; DECISIONS.md:435-441).
10. **Wants things to be findable from the window, not only from menus/chords.** The 2026-09-14 list ("aktuell kann ich keine neuen markdown files … erstellen … Den kanban mode sehe ich auch nicht … es sollte ein icon…") was about discoverability of features that already existed as menu items and chords.
11. **Pragmatic about process gates when they block shipping.** "ich denke wir lassen die checkllste jetzt sein"; "Ja, aussetzen"; "please merge everything and clean up"; "go with implementation and use subagents where usefull".
12. **Cares about the journal / daily capture and about Kanban as a first-class surface.** "…eine sektion … um schnelle tägliche notizen anzuzeigen"; "ich möchte auf dem kanban mode auch die karte etwas befüllen können"; "Karten zwischen Boards ziehen".
13. **Writes in German, tolerates English docs; wants German first in the UI** (ADR-0007 "Mockup language: German first").
14. **Prefers a clean slate over continuity** when the old thing is being replaced: "da wir das alte novalis ersetzen, können wir auch die alten releases alle abräumen?" → "Alles löschen, auch Tags"; empty-branch rewrite; new bundle identifier.
