# Inventory: core — how the core, the shell and the CLI treat file types, and what the perf harness measures

Repository: `/Users/sgrundhoefer/Projects/novalis` at `aeead36` (main, 2026-09-19). Read-only analysis; the only things executed were `cargo build -p novalis-cli`, `cargo build --release -p novalis-core --example perf`, the fixture generator into the scratchpad, and the debug CLI against a scratch vault. Nothing in the repository was modified.

Legend: **[code]** = verified by reading the cited lines · **[run]** = verified by executing · **[infer]** = my inference.

---

## 0. TL;DR

- The core has exactly one `.md` gate: `vault::path::is_note_name` (`crates/novalis-core/src/vault/path.rs:101-103`, `name.len() > 3 && name.ends_with(".md")`, case-sensitive). Everything "note-shaped" — the cache, link resolution, relink, the CLI's addressing, quick-open — filters through it (`walk_notes`, `vault_note_rel`). Everything "file-shaped" — `list_dir`, `read_file`, `read_bytes`, `write_atomic`, `rename`, `trash`, `walk_files`, search with `all_files` — accepts any regular, non-hidden, non-symlink path. **[code]**
- The Tauri shell's `read_file`, `write_file`, `read_blob`, `rename`, `trash` accept any extension (`vault_rel`, not `vault_note_rel`). The tree filter by extension is **UI-only** (`apps/desktop/ui/src/lib/fileTypes.ts:54-58`); the shell already ships every visible entry. **[code]**
- Text vs binary is decided **after** reading the whole file, by `String::from_utf8` (`fs.rs:189-192`). No sniffing, no NUL check, no size-based refusal on `read_file`. A NUL-laden but UTF-8-valid file is "text"; a BOM is preserved (and defeats H1 title detection, side finding §7.1). **[code][run]**
- The 5 MB / 50 MB thresholds live only in the shell DTO layer (`apps/desktop/src-tauri/src/dto.rs:19,21`) as flags on `FileDto`; the one hard refusal is `read_blob` above 50 MB (`commands.rs:361`). The core has no size limits at all. **[code]**
- IPC: 27 of 30 commands (`lib.rs:30-61`). Contents cross the IPC as JSON strings: `FileDto.text: String`, `BlobDto.base64: String`. `tauri::ipc::Response` (raw bytes) exists but has no `specta::Type`, so it cannot be declared through the typed builder. **[code][infer]**
- CSP (`tauri.conf.json:27`): `img-src 'self' data: blob:` only. No `media-src`, no `frame-src`, `object-src 'none'` → `<audio>`/`<video>`/`<iframe>` from `blob:` are blocked today. **[code]**
- CLI: `ls`, `cat`, `edit`, `meta`, `mv`, `rm`, `links`, `relink`, `new`, `card --note` all resolve through the `.md`-only stem index; `search` is `.md`-only with no flag to widen it. A non-`.md` file cannot be addressed or listed by the CLI at all (`novalis cat notes.txt` resolves the *stem* `notes.txt` → `notes.txt.md`). **[code][run]**
- Perf: `just perf` measures only `incrementalScan10kNotesMs` and `searchFirstResults10kNotesP95Ms` on a generated 10k-`.md` vault. Adding 10k `.txt` siblings left the scan unchanged (437→441 ms) and doubled time-to-first-hit (19→40 ms) purely from the pre-scan walk; both far inside budget. The `dmgMb: 12` budget is gated nowhere; the shipped DMG is 5.6 MB. **[run][code]**

---

## 1. Rust core (`crates/novalis-core/src`)

### 1a. How the vault tree is enumerated

Two primitives, one walker:

- `vault::fs::list_dir(dir)` (`vault/fs.rs:147-167`): `read_dir` + `lstat` (`entry.metadata()` never follows symlinks, comment at 152-153), NFC name, sorted by name. **Returns everything**, hidden included; `DirEntry.is_hidden()` (`fs.rs:45-47` → `path::is_hidden`, `path.rs:26-28`: dot-prefixed) is a flag, not a filter. `EntryKind` is `File | Dir | Symlink | Other` (`fs.rs:26-31`). No extension logic anywhere in `list_dir`. **[code]**
- `vault::walk::walk_files(root)` (`vault/walk.rs:22-49`): iterative DFS over `list_dir`; skips hidden names (32-34) and anything that is not `File`/`Dir` (43: symlinks and `Other` dropped); collects every regular file with `size`, `mtime_ns`, `cloud_only`; sorted by path. Descends into `boards/` like any folder — a board's `board.json` and `cards/*.json` are `WalkedFile`s. **[code]**
- `vault::walk::walk_notes(root)` (`walk.rs:52-56`): `walk_files` then `retain(is_note_name)`. So `.md` only, and only lowercase `.md` (`Todo.MD`, `x.markdown` are not notes; the shell's `creatable_name` comment at `commands.rs:520-524` says so explicitly). **[code]**

Who uses which:

| Caller | Walker | File |
|---|---|---|
| cache scan | `walk_notes` | `cache/mod.rs:32,433` |
| search | `walk_files`, then `is_note_name` unless `all_files` | `search/mod.rs:26,185-188` |
| relink | `walk_notes` | `notes/relink.rs:24,271` |
| conflict-copy finder / cloud-only lister | own DFS over `list_dir`, hidden skipped, all kinds of files | `vault/cloud.rs:233-283, 294+` |
| CLI stem index, `doctor` | `walk_notes` | `crates/novalis-cli/src/ctx.rs:163`, `ops/doctor.rs:199` |
| shell `list_notes` (quick-open, `[[` completion) | `walk_notes` | `apps/desktop/src-tauri/src/commands.rs:323` |
| shell tree (`bootstrap`, `list_dir`) | `list_dir` per folder, no walk | `commands.rs:62-106` |

The boards folder is not special to the walkers; `boards::BOARDS_DIR` matters only to the shell's tree row decoration (`commands.rs:75, 85-92`) and `doctor` (`ops/doctor.rs:194-211`). **[code]**

### 1b. What the cache indexes

`cache/mod.rs`, SQLite, schema at 129-161: tables `files(path, path_fold, mtime_ns, size, hash, title, stem, cloud_only)`, `links(src, target, form, line, resolved)`, `tags(path, tag)`, `meta(key, value)`.

- Input set: `walk_notes` (`cache/mod.rs:433`) → **`.md` only**. No other file type ever gets a `files` row, so `ls`, `tags`, `links`, backlinks, orphans and stem resolution are `.md`-only by construction. **[code]**
- Per note read (`494-511`): `read_file` under `MaterializeOff` (432); if `utf8` → `parse_note` (641-652): `frontmatter::title` (frontmatter `title:` → first `# H1` → stem), `frontmatter::all_tags` (frontmatter `tags:` + inline `#tags`), `links::extract` (wikilinks + Markdown links whose target ends in `.md`). If not UTF-8 → row with hash and stem-title, no links, no tags, `report.not_utf8 += 1` (503-511). Cloud-only → row with `hash NULL`, never read (471-473, 513-516). **[code]**
- Incremental: stat everything, read only where `(mtime, size, cloud_only)` changed (474-480). `resolve_links` reruns whenever membership changed (593-597). **[code]**
- No size threshold; a 50 MB `.md` is read and parsed in full on scan. **[code]** (Confirmed by absence: `grep -rn "MB\|1024" crates/novalis-core/src` finds only the board tombstone age.)

### 1c. What vault-wide search scans

`search/mod.rs:161-297`:

- Candidates: `walk_files` (185), then `if !query.all_files && !is_note_name(&f.path) { continue }` (186-188) — so **`.md` by default, every regular non-hidden file with `all_files`**. Folder prefix (177-181, 190-194) and tag filter via the cache (168-176, 195-199). Cloud-only candidates are counted from `lstat` and skipped before any read (200-203). **[code]**
- Reading: one scoped worker per core, each under its own `MaterializeOff` (216-232); `read_file` (239) — the **whole file** — then `if !content.utf8 { not_utf8 += 1; continue }` (253-256), then a per-line regex (257-258). No size cap, no early bail on binary content: a 40 MB `.wav` renamed `.md` (or any file under `all_files`) is read fully, then dropped as not-UTF-8. **[code]**
- Regex is built with `size_limit(1 << 22)` (100-103); snippets bounded at 200 chars (29, 107-125). Results stream via callback in arbitrary order; `search_collect` sorts (301-313). **[code]**
- The `all_files` switch exists end-to-end in core and DTO (`dto.rs:431`), but the UI hardcodes `allFiles: false` (`apps/desktop/ui/src/components/SearchPanel.tsx:89`) and the CLI hardcodes `all_files: false` (`crates/novalis-cli/src/ops/search.rs:54`) with no flag in `SearchArgs` (`cli.rs:302-322`). Pinned by the core test at `search/mod.rs:362` ("only .md notes") and `372-375` (`all_files` finds the `.txt`). **[code]**

### 1d. Read/write API — where `.md` is required

Path guards (`vault/path.rs`):

- `normalize_rel` (33-55): NFC, rejects absolute, `..`, empty component.
- `vault_rel(root, rel)` (60-78): `normalize_rel` + symlink check on existing components. **No extension rule, no hidden rule.**
- `vault_note_rel(root, rel)` (82-98): `normalize_rel` + non-empty + no hidden component + `is_note_name(file_name)` else `InvalidPath{NotMarkdown}` (`error.rs:23-26`).

Filesystem primitives (`vault/fs.rs`) take `&Path` and know nothing about extensions: `stat` (139-142), `list_dir` (147-167), `read_bytes` (172-184: whole file into a `Vec` sized from `metadata().len()`, SHA-256 → `Precondition`), `read_file` (187-200), `write_atomic` (282-301), `create_atomic` (306-326, `RENAME_EXCL`), `rename` (387-423), `trash` (428-452), `conflict_copy_path`/`write_conflict_copy` (455-496, extension-preserving by `rfind('.')`). **[code]**

Who calls `vault_note_rel` (i.e. who refuses non-`.md`):

| Caller | Line | Effect |
|---|---|---|
| `relink_many` | `notes/relink.rs:263` | every `new_path` must be a `.md` |
| CLI `Ctx::note_target` | `crates/novalis-cli/src/ctx.rs:134` | `new`, `mv <to>` — and it *appends* `.md` first (129-133), so `new x.txt` makes `x.txt.md` **[run]** |
| shell `create_note` | `commands.rs:554-555` | only for names that end in `.md`; other creatable names use `creatable_file_rel` (567-579: same guards minus `.md`) |

Everything else (`read_file`, `write_file`, `read_blob`, `write_conflict_copy`, `rename`, `trash`, `reveal` in the shell; `load` in the CLI) goes through `vault_rel`. `CoreError::NotMarkdown` is therefore reachable in the shell only from `create_note` with a `.md` name that fails the guard (which cannot happen after `creatable_name`) and from `rename`'s relink (only when both sides are `.md`, `commands.rs:635`). **[code]**

### 1e. UTF-8, NUL, BOM, binary sniffing

- `read_file` (`fs.rs:187-200`): `String::from_utf8(bytes)`; on failure `from_utf8_lossy` and `utf8 = false`. `FileContent` (89-99) carries `text, mtime_ns, size (original bytes), hash (original bytes), utf8`. Callers "treat such files as read-only (PLAN.md §7.3)" — a convention, not enforced in core. **[code]**
- **NUL bytes**: no check anywhere (`grep -rn '\\0\|NUL\|is_binary\|sniff\|infer\|mime' crates apps/desktop/src-tauri` → nothing but frontmatter's BOM lines). A file `nul\0inside hello\n` is valid UTF-8 → `utf8: true`, indexed, searchable, editable; the search snippet carries `\u0000`. **[run]** (§8 transcript.)
- **BOM**: `frontmatter::block_span` skips a leading U+FEFF (`notes/frontmatter.rs:58`) and `edit_key` re-emits it (369-374), so frontmatter reads/edits are BOM-safe. `body()` (81-86) returns the BOM as part of the body when there is no frontmatter, and `title()` (223-237) does `line.trim().strip_prefix("# ")` — `str::trim` does not strip U+FEFF — so a BOM'd `# Heading` is not seen and the title falls back to the stem. **[code][run]** (side finding §7.1.)
- **No binary sniffing**, no `content_inspector`/`infer`/`mime_guess` in `Cargo.toml` (`crates/novalis-core/Cargo.toml` deps: serde, serde_json, thiserror, chrono, libc, regex, rusqlite, sha2, trash, ulid, pulldown-cmark, unicode-normalization). The non-UTF-8 test fixture is `[0xff, 0xfe, 'a']` (`fs.rs:616-619`) and `[0xff,0xfe,'[','[','x',']',']']` (`cache/mod.rs:835-839`), i.e. UTF-16-LE-BOM-shaped bytes. **[code]**
- UTF-16 / Latin-1 files therefore open read-only and lossy; no transcoding exists (PLAN.md §4.2 line 134: "UTF-8 only"). The generator writes one Latin-1 `.md` (`fixtures/gen/gen_vault.py:524-525`). **[code]**

### 1f. Size thresholds (5 MB / 50 MB)

- **Core: none.** `read_bytes` allocates `meta.len()` and reads to end (`fs.rs:176-177`). Cache, search, relink, `cat` all read whole bodies regardless of size. **[code]**
- **Shell:** `dto.rs:19` `PLAIN_MODE_BYTES = 5 * 1024 * 1024`, `dto.rs:21` `HUGE_FILE_BYTES = 50 * 1024 * 1024`.
  - `FileDto::new` (`dto.rs:339-351`): `plain_mode: size >= 5 MB`, `huge: size >= 50 MB` — **flags only**; `read_file` (`commands.rs:335-346`) still sends the entire text. **[code]**
  - `read_blob` (`commands.rs:354-374`): `lstat` first, refuses `size > HUGE_FILE_BYTES` with `bad_request` (361-364), else base64 of the whole file. Note `>` here vs `>=` for `huge`. **[code]**
  - `write_blob` (`commands.rs:394-427`): refuses decoded `len > HUGE_FILE_BYTES` (415-420). **[code]**
  - `render_markdown` (`commands.rs:381-383`): no limit. **[code]**
- **UI:** consumes the flags — `editorSave.ts:104-111` (`readOnly: !file.utf8`, banner for huge/plainMode), `editor/setup.ts:196` (`if (hooks.plainMode) return base` → no grammar, no decorations), `StatusBar.tsx:33`. **[code]**
- Nothing pins the two numbers in a test (only `editorSave.test.ts:36` sets `plainMode: false` on a fixture). **[code]**

### 1g. Rename / relink for non-`.md` files

- `fs::rename` (`fs.rs:387-423`) is extension-agnostic: clobber refusal, case/normalization twin two-step, parent creation. **[code]**
- Shell `rename` (`commands.rs:615-646`): after the rename, `if is_note_name(&from_rel) && is_note_name(&to_rel)` → `relink_many` (635-642); otherwise `rewritten`, `cards_updated`, `conflicts`, `cloud_only_skipped` come back empty. So renaming `a.txt` or `a.pdf` is a plain rename. **[code]**
- This is consistent with link extraction: Markdown links are only extracted when the decoded target ends in `.md` (`notes/links.rs:268-270`), wikilinks resolve only against `.md` stems (`links.rs:373-395`, the index is built from `.md` paths). So nothing ever links to a non-`.md` file in the core's model; there is nothing to relink. An attachment link `![](attachments/x.png)` written by ADR-0017 is invisible to the link index and is **not** rewritten when the note or the image moves. **[code][infer on consequence]**
- `relink_many` refuses a non-`.md` `new_path` with `NotMarkdown` (`relink.rs:263`) and skips non-UTF-8 sources (290-293). **[code]**
- CLI `mv`: `resolve_note(from)` + `note_target(to)` (`ops/mv.rs:40-41`) → `.md` only on both ends. **[code]**

### 1h. Cloud-only (dataless) handling for reads

- Detection: `cloud::is_dataless` (`vault/cloud.rs:21-30`): `SF_DATALESS` in `st_flags`, fallback `size > 0 && blocks == 0`. Surfaced as `DirEntry.cloud_only`, `FileStat.cloud_only`, `WalkedFile.cloud_only`. **[code]**
- Guard: `MaterializeOff` RAII (`cloud.rs:43-61`) sets `setiopolicy_np(..., IOPOL_SCOPE_THREAD, OFF)`; reads of dataless files then fail with `EDEADLK`, mapped to `CoreError::CloudOnly` by `from_io` (`error.rs:127`). Applied by the cache scan (`cache/mod.rs:432`), search workers (`search/mod.rs:225`), `link_snippets` (136), relink (`relink.rs:270`), conflict finder (`cloud.rs:234`). Under the guard a `read_file` of a placeholder is a typed error, not a download. **[code]**
- Explicit open: `cloud::materialize` (`cloud.rs:74-81`) asserts the default policy and reads. Shell `read_file` and `read_blob` run **without** the guard on purpose ("downloaded on open", `commands.rs:10-13, 340-342`), no timeout, no progress state; a dataless file blocks one `spawn_blocking` thread until File Provider delivers it. `read_blob` stats for size but does not look at `cloud_only`. **[code]** The UI shows a cloud badge on the row (`Sidebar.tsx:308`) but has no "downloading" state or timeout (no such string in `i18n/en.json`; `grep -i "downloading\|hydrat"` in `ui/src` → nothing). **[code][infer]**
- CLI: `note::load` (`crates/novalis-cli/src/note.rs:16-34`) stats first; cloud-only → exit 8 unless `--materialize`, then `materialize_within` on a detached thread with `--timeout` (default 30 s, 57-74, 94). **[code]**
- `trash` refuses a dataless file (`fs.rs:429-434`). Cache rows for placeholders carry `hash NULL`, no links/tags (`cache/mod.rs:14-16, 805-828` test). **[code]**

---

## 2. Tauri shell (`apps/desktop/src-tauri/src`)

### 2a. The IPC surface — 27 of 30

`lib.rs:30-61` (`specta_builder`), also counted in `commands.rs:1`. Events: `FsBatch`, `MenuAction`, `CacheUpdated` (62). Bindings are generated from this builder into `ui/src/ipc/bindings.ts` (65-79); CI diffs them.

| # | Command | `commands.rs` | Path guard | Notes |
|---|---|---|---|---|
| 1 | `bootstrap` | 237-263 | — | settings + `scan_vault` (root listing only, 110-132) + UI state |
| 2 | `open_vault_dialog` | 270-279 | — | folder picker from Rust |
| 3 | `open_vault` | 283-293 | — | `scan_vault` + `attach_vault` (watcher + cache actor) |
| 4 | `list_dir` | 299-310 | `normalize_rel`+`vault_rel` (in `visible_entries` 63) | one folder; hidden/symlink/other dropped (66); board slug + conflict-copy classification (73-105) |
| 5 | `list_notes` | 320-329 | — | `walk_notes` → `.md` paths only |
| 6 | `read_file` | 335-346 | `vault_rel` | any extension; whole file; `FileDto` |
| 7 | `read_blob` | 354-374 | `vault_rel` | any extension; ≤ 50 MB; base64 |
| 8 | `write_blob` | 394-427 | `creatable_file_rel` | only `png jpg jpeg gif webp` (387); ≤ 50 MB; `create_atomic` |
| 9 | `render_markdown` | 381-383 | — | text → HTML via `pulldown-cmark` |
| 10 | `write_file` | 434-456 | `vault_rel` | any extension; `text.as_bytes()`; precondition; records own write |
| 11 | `write_conflict_copy` | 463-476 | `vault_rel` | any extension |
| 12 | `create_note` | 545-563 | `vault_note_rel` or `creatable_file_rel` | see 2d |
| 13 | `create_folder` | 589-605 | `vault_rel` | |
| 14 | `rename` | 615-646 | `vault_rel` ×2 | relink only `.md`→`.md` |
| 15 | `trash` | 652-672 | `vault_rel` | `NsFileManager`; cloud-only refused by core |
| 16 | `reveal` | 680-704 | `vault_rel` | `/usr/bin/open -R` |
| 17 | `tree_context_menu` | 713-732 | — | |
| 18 | `search` | 741-~795 | — | `SearchQueryDto` incl. `all_files`; streamed in batches of 64 (45) |
| 19 | `tags` | 797 | — | cache |
| 20 | `backlinks` | 826 | — | cache + `link_snippets` + cards |
| 21 | `board_list` | 875 | — | |
| 22 | `board_read` | 894 | — | |
| 23 | `board_create` | 951 | — | |
| 24 | `board_write` | 977 | — | |
| 25 | `card_write` | 1034 | — | |
| 26 | `settings_set` | 1114 | — | |
| 27 | `state_save` | 1137 | — | |

Capabilities (`capabilities/default.json:6`): `core:default` + `core:window:allow-start-dragging` only — no fs, shell, http, asset-protocol permission for the page. **[code]**

### 2b. `read_file`, `read_blob`, `write_blob`

- `read_file(path) -> FileDto` (`commands.rs:335-346`; DTO `dto.rs:324-351`): `{path, text, precondition{mtimeNs,size,hash as decimal strings}, utf8, plainMode, huge}`. The text is the lossy string for non-UTF-8 files; `size` is the original byte count. Nothing refuses a size; nothing refuses an extension. **[code]**
- `read_blob(path) -> BlobDto` (`commands.rs:354-374`; DTO `dto.rs:125-136`): `{path, base64 (standard, padded), size}`. `lstat` → refuse `> 50 MB` → `read_bytes` → base64. **No extension gate** — an `.epub`, `.docx`, `.mp3` ≤ 50 MB is served today. The comment at `dto.rs:125-127`: "Base64 because the typed IPC has no raw-bytes return; the viewer turns it into a `blob:` URL and never keeps it." **[code]**
- `write_blob(folder, name, base64) -> EntryDto` (`commands.rs:394-427`): extension must be in `ATTACHMENT_EXTENSIONS` (387: `png jpg jpeg gif webp`), decoded length ≤ 50 MB, `creatable_file_rel` (no hidden component), `create_atomic` (never clobbers). **[code]**

### 2c. `list_dir` / `bootstrap`

`visible_entries` (`commands.rs:62-106`): `list_dir` → drop hidden, symlink, other (66) → folders first, then name (68-72) → `board_slug` for a dir directly under `boards/` holding a valid `board.json` (73-92) → `conflict_copy_of` via `cloud::conflict_copy_candidate` against the sibling set (93-102) → `EntryDto` (`dto.rs:227-243`: `path, name, dir, size, mtimeNs, cloudOnly, boardSlug, conflictCopyOf`). **Every regular file is sent** — `song.wav`, `book.epub`, `x.docx` included. The tree filter is `isSupported` in `apps/desktop/ui/src/lib/fileTypes.ts:54-58`, applied in `stores/vault.ts:150,223` and `App.tsx:267`. `bootstrap` returns only the root listing (`commands.rs:130, 232-234`); sub-folders come from `list_dir` on expand. **[code]**

The watcher (`watcher.rs:78-81`) ignores dot-prefixed, `~`-prefixed and `.tmp` names; it has no extension filter, so a changed `.wav` produces a tree event that the UI then filters out. **[code]**

### 2d. Create-file rules (ADR-0014)

`CREATABLE_EXTENSIONS` (`commands.rs:481-518`): `md markdown txt text json map yaml yml toml xml svg html htm css js mjs cjs jsx ts mts cts tsx py rs sh bash zsh ini conf cfg properties env swift csv tsv log` — PLAN.md §7.3 tiers A–C (`PLAN.md:431-433`), minus the extensionless names. `creatable_name` (525-537): `.md` in any case → lower-cased `.md`; a listed extension → kept as typed (case preserved: `Notes.TXT` stays `Notes.TXT`, test 1167); anything else or none → `.md` appended (`clip.wav` → `clip.wav.md`, `.env` → `.env.md`, tests 1172-1174). `create_note` then uses `vault_note_rel` for `.md` names, `creatable_file_rel` for the rest (554-558), and `create_atomic(abs, b"")` (582-585). The UI mirrors the list by hand (`fileTypes.ts:9-18`). **[code]**

### 2e. How contents reach the UI

JSON over Tauri's invoke: `FileDto.text` is a JSON string (a 50 MB file is a ~50 MB JSON string, then a ~100 MB UTF-16 JS string — PLAN.md §11.3 line 596 acknowledges this); `BlobDto.base64` is ~1.33× the bytes, then decoded in JS (`Viewer.tsx:37-41`, `Preview.tsx:274-277` → `URL.createObjectURL(new Blob(...))`). `EntryDto.size`/`mtimeNs` and `PreconditionDto` are decimal strings because `specta-typescript` refuses i64/u64 (`lib.rs:73-75`, `dto.rs:222-226`). **[code]**

Why not raw bytes: `tauri::ipc::Response` (`~/.cargo/registry/.../tauri-2.11.5/src/ipc/mod.rs:190-205`) returns an `InvokeResponseBody` as-is, but Tauri's `specta` feature only implements `Type` for `Channel` (`ipc/channel.rs:54`), not for `Response`; a command returning it cannot be listed in `collect_commands!` and would be missing from `bindings.ts`, which CI diffs. **[code on the crate sources][infer on the consequence]**

### 2f. CSP (`apps/desktop/src-tauri/tauri.conf.json:27`)

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self';
img-src 'self' data: blob:; connect-src ipc: http://ipc.localhost; object-src 'none';
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

- `img-src` allows `blob:` and `data:` → `<img>` from `read_blob` works (ADR-0015/0016).
- **No `media-src`** → falls back to `default-src 'none'` → `<audio>`/`<video>` from `blob:` are blocked.
- **No `frame-src`** (ADR-0016 removed the `frame-src blob:` that ADR-0015 added) and `object-src 'none'` → no `<iframe>`, `<embed>`, `<object>`.
- `worker-src` absent → falls back to `script-src 'self'`; pdf.js's worker is bundled as an asset and loaded from `'self'` (`PdfViewer.tsx:2,14-18`). **[code]**

---

## 3. CLI (`crates/novalis-cli`)

Commands (`src/ops/mod.rs:6-23`): `board card cat doctor edit help index init links ls meta migrate mv new relink rm search tags`; `sync` and `skill` are stubs (67-69). PLAN.md §9.1 (`PLAN.md:507`): "contracts immutable after 1.0 (add, never rename)"; the golden tests (`tests/golden.rs`, cases under `tests/cli/*/`) pin stdout/stderr/exit per case.

Note addressing (`src/ctx.rs`): `resolve_note` (140-154) → `StemIndex::resolve_wiki` over `walk_notes` paths (159-172) → **`.md` only**, case-insensitive, ambiguity = exit 4. `note_target` (124-136) appends `.md` unless present, then `vault_note_rel`. **[code]**

| Command | Scope | Evidence |
|---|---|---|
| `ls [folder]` | cache `files` table → `.md` only; `--tag`, `--sort`, `--limit`, `--fields`; no extension flag | `ops/ls.rs:62-74`; **[run]** `ls` on a scratch vault with `a.md notes.txt sub/script.py README book.epub` listed only the `.md` files |
| `cat <note>…` | `resolve_note` → `.md`; `load` (cloud-only → exit 8 / `--materialize`) → `read_file`; **no `utf8` field, no warning**: a non-UTF-8 note prints lossy text with exit 0 | `ops/cat.rs:84-139`, `note.rs:16-34`; **[run]** `cat blob.md` returned `"body": "��hello\u0000binary"`, exit 0 |
| `search <query>` | `walk_files` filtered to `.md` (`all_files: false` hardwired), `--tag --folder --limit --snippets`; JSON reports `cloudOnlySkipped` but **not** `notUtf8Skipped` although the core reports it | `ops/search.rs:41-55, 26-31`; `cli.rs:302-322`; **[run]** `search hello` hit `a.md`, `bom.md`, `nul.md` (snippet with `\u0000`), skipped `blob.md` silently, never looked at `notes.txt`/`script.py` |
| `new <path>` | always `.md` (`note_target`); ADR-0014: "CLI `new` stays notes-only" | `ops/new.rs:34`, `ctx.rs:129-133`; **[run]** `new x.txt` → `x.txt.md` |
| `edit`, `meta` | `resolve_note`; `load_for_write` refuses non-UTF-8 with exit 2 | `ops/edit.rs:39`, `ops/meta.rs:45`, `note.rs:38-52`; **[run]** `edit blob.md --append x` → `"blob.md is not valid UTF-8; novalis opens it read-only"`, exit 2 |
| `mv`, `rm`, `relink`, `links`, `card --note` | `resolve_note` / `note_target` → `.md` | `ops/mv.rs:40-41`, `ops/rm.rs:30`, `ops/relink.rs:104`, `ops/links.rs:119`, `ops/card.rs:153,206,256,341` |
| `doctor` | `walk_notes` for notes-under-boards; conflict copies via `find_conflict_copies` (all file kinds) | `ops/doctor.rs:196-211` |
| `index`, `tags` | cache → `.md` | `ops/index.rs`, `ops/tags.rs` |

Consequence: a non-`.md` file has **no CLI address**. `novalis cat notes.txt` is parsed as the stem `notes.txt` and resolves to `notes.txt.md` if that exists (`links.rs:376-385` appends `.md` to a key that does not end in `.md`), else exit 3. **[run]**

Golden fixtures: `fixtures/demo-vault` holds 63 `.md` + `.novalis/config.json` (hidden); every golden count (`doctor` "63 notes indexed", `cache/mod.rs:889`) would survive listing other file types only if those stay out of the cache. **[code][run]**

---

## 4. The perf harness

- `just perf` (`justfile:63-75`): generate a 10k-note vault with `fixtures/gen/gen_vault.py --count 10000`, then `cargo run --release -p novalis-core --example perf -- <vault> <cache>`, then `node scripts/perf-budget.mjs`. Not part of `just check`; `perf.yml:19-24` runs it on `main`, `v*` tags and dispatch, uploads `perf.json`.
- `crates/novalis-core/examples/perf.rs` measures exactly two rows: `incrementalScan10kNotesMs` = one cold `Cache::incremental_scan` (77-80) and `searchFirstResults10kNotesP95Ms` = p95 of time-to-first-hit over 20 runs of `search("the")` after one warm-up, `all_files: false` (82-111, `92`). Everything else is listed under `unmeasured` (33-58): first paint, tree interactive, RSS, open-note 100 KB/1 MB/5 MB/50 MB, keystroke p50/p95, watcher burst, `dmgMb`.
- Gate (`scripts/perf-budget.mjs`): threshold = budget × `ciNoiseFactor` 2, `incrementalScan10kNotesMs` × 6 (`docs/BUDGET.json:3-6, 30-31`), flags "over the real budget" separately (80-84), fails on a measured key without a budget (72).
- Generator (`fixtures/gen/gen_vault.py`): 10k `.md` incl. 3 × ~2 MB (`--large`, 341-344, 365), NFD names, twins, conflict copies (one `.txt` pair, 417-419), boards, CRLF, empty, broken frontmatter, one Latin-1 `.md` (524-525), six "other" files (`config.json`, `script.py`, `main.rs`, `README`, `data.csv`, `spec.yaml`, 513-523), watcher-ignored names (526-529), sparse cloud stand-ins. Generated tree here: 10011 `.md`, 23 `.json`, 2 `.txt`, 1 `.yaml`, 1 `.tmp`. **[run]**
- Bundle gate (`scripts/bundle-budget.mjs`, run by `just check`): eager JS ≤ 250 KB gzip, max eager chunk ≤ 120 KB, eager CSS ≤ 24 KB, fonts ≤ 250 KB — **lazy chunks are not counted** (comment 5-6). pdf.js, mermaid, `@codemirror/language-data` grammars, `Editor`, `Viewer`, `Preview` are all dynamic imports (`App.tsx:28-34`, `Viewer.tsx:17`, `Preview.tsx:79`, `setup.ts:89-92`).
- `dmgMb: 12` (`BUDGET.json:34`) is **gated nowhere**: `release.yml` has no size step (`grep -i "budget\|size\|mb"` → nothing), `perf.rs:57` says "measured on the release artifact, not here". Published `novalis_1.0.0-alpha.1_aarch64.dmg` = 5,646,210 bytes (5.4 MiB) with pdf.js and mermaid inside. **[run via `gh release view`]**

Measured on this Mac (release build, scratch vault, cold cache each run) **[run]**:

| Vault | `notesIndexed` | scan ms | search first-hit p95 ms (min/p50/max) |
|---|---|---|---|
| generator default (10011 `.md`, 27 others) | 10010 | 438, 429 | 19, 20 (18/19/19-20) |
| + 10,000 `.txt` copies of the same bodies | 10010 | 437, 446 | 40, 39 (36-37/38/40-41) |

Reading: the scan is dominated by reading 10k `.md` bodies; 10k extra `lstat`s are noise. Time-to-first-hit doubled because `search` builds the full candidate list synchronously (`walk_files`, `search/mod.rs:185`) before any worker starts — the walk over 20k entries is on the critical path even though the `.txt` bodies are never opened. Both rows stay far under 1500 / 300 ms.

How a wider file-type set or larger viewer chunks would show up:

- **Not at all in `just perf`** unless non-`.md` files enter `walk_notes` (cache) or `all_files` is turned on in `perf.rs:92`. The harness cannot see the UI, the tree filter, grammars, pdf.js, or an EPUB reader.
- **In `bundle-budget.mjs`** only if a chunk becomes eager (a static import or a Vite modulepreload); lazy viewer chunks are invisible to it. **[code]**
- **In `dmgMb`** — but that budget is unenforced (see above).
- The app-side rows that would actually move (open-note times, RSS with a 50 MB blob decoded, keystroke latency in a `.log`) are all `unmeasured`. **[code]**

---

## 5. Tests that pin file-type behaviour

| Test | File:lines | Pins |
|---|---|---|
| `note_api_rejects_dot_paths_and_non_markdown` | `core/src/vault/path.rs:255-273` | `vault_note_rel` rejects `.novalis/…`, `.git/…`, hidden components, `shell.sh`, `notes/script.js`, `""`, `a/`, `.md`; accepts `sub/fine.md`, umlaut names |
| `symlink_components_are_rejected_but_plain_dirs_pass` | `path.rs:275-297` | symlink at any depth → `Symlink` |
| `helpers_split_paths` | `path.rs:299-314` | `stem_of("Makefile") == "Makefile"`, `stem_of("a/.hidden") == ".hidden"` |
| `walk_skips_hidden_and_symlinks_and_sorts` | `core/src/vault/walk.rs:62-86` | `walk_files` → `["a/notes.txt","a/y.md","z.md"]`; `walk_notes` → `["a/y.md","z.md"]` |
| `list_dir_uses_lstat_and_reports_kinds` | `core/src/vault/fs.rs:625-649` | hidden file listed and flagged; symlink kind reported |
| `read_file_reports_hash_and_utf8` | `fs.rs:606-623` | `[0xff,0xfe,'a']` → `utf8 == false`, lossy text ends with `a` |
| `conflict_copy_naming` | `fs.rs:734-759` | extensionless `LICENSE` gets `(conflict …)` with no ext |
| `finds_literal_matches_case_insensitively_across_folders` | `core/src/search/mod.rs:342-376` | `scanned == 3` "only .md notes"; `all_files` finds `notes.txt` (3 hits) |
| `non_utf8_notes_are_indexed_without_links` | `core/src/cache/mod.rs:830-847` | non-UTF-8 `.md` → row with hash, stem title, no links, `not_utf8 == 1` |
| `cloud_only_rows_have_no_hash_and_no_links` | `cache/mod.rs:805-828` | sparse `.md` never read |
| `scans_the_demo_vault_fixture` | `cache/mod.rs:883-898` | demo vault = 63 notes |
| `edit_key`/`read` BOM cases | `core/src/notes/frontmatter.rs:499-500, 578-579` | BOM + CRLF frontmatter reads; BOM re-emitted on edit |
| `typed_extensions_are_kept_and_md_is_lower_cased` | `apps/desktop/src-tauri/src/commands.rs:1162-1179` | ADR-0014 table incl. `clip.wav` → `clip.wav.md`, `.env` → `.env.md` |
| `creatable_file_rel_refuses_hidden_and_empty` | `commands.rs:1183-1191` | `.env.txt`, `sub/.hidden/notes.txt`, `""` → `invalid_path`; `sub/notes.txt` ok |
| watcher `ignored` | `watcher.rs:228-233` | `.tmp`, dot and `~` names ignored |
| `fileTypes` (UI) | `apps/desktop/ui/src/lib/fileTypes.test.ts:6-22` | supported: `a.md notes/b.txt c.json Notes.TXT d.pdf e.PNG Makefile sub/LICENSE`; unsupported: `song.wav clip.mp4 book.epub archive.zip README x.docx`; `viewKind("a.svg") == null` |
| tree filter (UI) | `apps/desktop/ui/src/stores/vault.test.ts:110-114` | `song.wav`, `clip.mp4` next to `a.md`, `scan.pdf`, `photo.jpg` are not drawn |
| CLI goldens | `crates/novalis-cli/tests/cli/{ls,cat,search,doctor,new,…}` | outputs over the 63-note demo vault; `doctor` prints "63 notes indexed"; `new` golden creates a `.md` |

No test pins `PLAIN_MODE_BYTES`/`HUGE_FILE_BYTES`, the `read_blob` extension-agnosticism, the CSP, or a Markdown link to a non-`.md` target (`links.rs` tests have none). **[code]**

---

## 6. Minimal core/shell changes for the three UI wishes

### (a) Show and open every text-like file in the vault

- **Listing: no core or shell change.** `list_dir` already returns every regular file; the filter is `isSupported` (`fileTypes.ts:54-58`). Widening the tree is a UI-only change — but see (b): without a content check, every `.wav`/`.zip` clicked would be read in full and then flagged non-UTF-8 (`commands.rs:342`, the exact ADR-0015 complaint), so (a) needs (b) or a UI denylist.
- **Opening/saving: no change.** `read_file`/`write_file` are extension-agnostic; the editor already resolves any grammar `@codemirror/language-data` knows by filename (`setup.ts:89-92`).
- **Creating:** widen `CREATABLE_EXTENSIONS` (`commands.rs:481-518`) and its UI mirror; or drop the allow-list and keep only the `.md`-fallback for extensionless names (`creatable_name` 525-537). Needs the ADR-0014 rule restated.
- **Search across them:** core and DTO already carry `all_files`; the UI hardcodes `false` (`SearchPanel.tsx:89`). CLI: add `--all-files` to `SearchArgs` and `all_files: args.all_files` in `ops/search.rs:54` — add-only, contract-safe; `notUtf8Skipped` could be added to `SearchOut` the same way.
- **Quick-open / `[[` completion:** `list_notes` is `walk_notes` (`commands.rs:323`); widening it means a parameter (`notes_only: bool`) or a second walk — the IPC signature is not the immutable contract, the CLI is. Keep `[[`-completion `.md`-only regardless, since links only resolve to `.md`.
- **Cache: leave `.md`-only.** Titles/tags/backlinks for `.txt` would change the CLI `ls`/`tags`/`doctor` shapes and the 63-note goldens.
- **CLI addressing of non-`.md` files** (`cat notes.txt`) would need `resolve_note` to try an exact path before the stem lookup (`ctx.rs:146`) — a behaviour change to an existing command, arguably still "add" since today's result is exit 3, but it changes the meaning of an argument; flag for the owner.
- Cost: 0 new IPC commands.

### (b) Detect text vs binary by content, not extension

- **Core, one addition:** a sniff on the bytes `read_file` already holds — e.g. `FileContent.binary: bool` = a NUL byte within the first 8 KiB (git/grep heuristic), plus optionally `bom: Option<Bom>` for `EF BB BF` / `FF FE` / `FE FF`. Zero extra IO; `fs.rs:187-200` is the whole change, plus the test at 606-623. Non-UTF-8 stays `utf8 == false` as today.
- **Better for the UI's latency**: a head-only `fs::sniff(path, 8 KiB) -> Sniff` so the shell can stop before reading a 2 GB `.mov`; then `read_file` in the shell does `stat → sniff → (binary ? refuse/empty text : read_file)`. Still one IPC per open (rule 8). Adds one `File::open` + one 8 KiB read per open.
- **Shell:** extend `FileDto` (`dto.rs:324-351`) with `binary` (and maybe `kind: "text" | "binary"`), keep `utf8`. No new command; bindings regenerate. For a binary the shell should send `text: ""` to avoid the 2× lossy string.
- **UI:** decide viewer vs editor from `FileDto.binary`/`viewKind`, not from `isSupported`.
- Limits: content sniffing cannot tell `.epub` from `.zip` or which viewer to use — extension (or magic bytes: `PK\x03\x04`, `%PDF-`, `\x89PNG`) still picks the viewer. UTF-16 stays read-only unless transcoding is added (PLAN.md §4.2 says UTF-8 only).
- Cost: 0 new IPC commands (1 if a standalone `sniff` command is preferred).

### (c) Serve audio/video/EPUB/DOCX bytes to the WebView

- **EPUB/DOCX ≤ 50 MB: 0 shell changes to fetch** — `read_blob` has no extension gate. What is missing is a reader: EPUB = zip of XHTML (JS unzip such as `fflate` = new npm dep + ADR, or Rust `zip` in core + a 28th command `read_archive_entry(path, entry)`; ADR-0016 already sketches "an EPUB reader on a Rust `zip` crate"); DOCX = `mammoth` (npm, ADR). Rendering EPUB chapters inline needs sanitised HTML (`style-src 'unsafe-inline'` is already there; images → `blob:` under `img-src` ok; embedded fonts would need `font-src blob:`); an `<iframe>` route needs `frame-src blob:` back (ADR-0016 removed it).
- **Audio/video: base64-over-JSON is the wrong transport.** Ceiling 50 MB (`commands.rs:361`; most MP4s are larger), 1.33× string + decoded copy + `Blob` in memory, no seeking before the whole file arrives, and the CSP blocks `<audio>`/`<video>` anyway (no `media-src`, `tauri.conf.json:27`). Minimal viable path:
  1. CSP `media-src blob:` (one token) — enough for small clips through `read_blob`.
  2. For real media: a custom URI scheme via `register_asynchronous_uri_scheme_protocol` (tauri `app.rs:2198`) that serves vault files with `Range` support under the same `vault_rel` guard and explicit-open policy; CSP `media-src novalis:` (and `img-src novalis:` would let images drop base64 too). **This is not an IPC command** (does not count against 30) but it is a new page-reachable surface, which ADR-0015 §2 explicitly declined for the asset protocol ("no filesystem or asset-protocol permission is granted to the page") → owner decision + ADR.
  3. The built-in `assetProtocol` (`app.security.assetProtocol.enable` + scope) is the off-the-shelf version of 2 and has the same ADR-0015 tension.
- **Raw bytes over IPC** (`tauri::ipc::Response`) would remove the base64 tax but cannot be typed by tauri-specta (§2e) — it would need a hand-written binding outside `bindings.ts`, which CI diffs. **[infer]**
- **IPC budget:** 27/30 used. (a)+(b) need 0; (c) needs 0 for EPUB/DOCX bytes, 1 if the zip reader lives in Rust, 0 for a protocol handler. A `sniff` command would take 1.

---

## 7. Side findings (not asked, found on the way)

1. **BOM defeats H1 title detection** — `frontmatter::title` (`frontmatter.rs:228-229`) trims with `str::trim`, which does not remove U+FEFF; a BOM'd `# BOM` note titles as its stem. **[run]** (`cat bom.md` → `"title": "bom"`, body `'\ufeff# BOM…'`.) Cache titles and `ls` inherit it.
2. **CLI `cat` serves lossy text silently** for non-UTF-8 notes (exit 0, no `utf8` field, no stderr warning) — `ops/cat.rs`, `note.rs:16-34`. `edit`/`meta` refuse correctly. An agent could round-trip garbage. Adding a `utf8` field is contract-add-only.
3. **CLI `search` drops `notUtf8Skipped`** although the core returns it (`ops/search.rs:26-31` vs `search/mod.rs:84-85`).
4. **`write_file` in the shell does not refuse a lossy buffer**; only the UI's `readOnly: !file.utf8` (`editorSave.ts:104`) prevents writing U+FFFD over a Latin-1 file. The CLI refuses (`note.rs:38-52`). A one-line guard in `commands.rs:434-456` would need the `utf8` flag passed back or a re-read.
5. **`dmgMb` budget is unenforced** (§4).
6. **No timeout/progress on shell hydration** of cloud-only files (`commands.rs:340-342, 366`); PLAN.md §2.3 rule 7 asks for "a visible state and timeout"; the CLI has both (`note.rs:57-74`).
7. **Attachment links are outside the link model**: `![](attachments/x.png)` is not extracted (`links.rs:268`), so renaming the note's folder or the image leaves them dangling with no report. **[code]**
8. `read_blob` refuses `> 50 MB` while `FileDto.huge` is `>= 50 MB` (`commands.rs:361` vs `dto.rs:348`) — cosmetic.
9. NUL bytes pass everywhere as text (§1e); a snippet with `\u0000` reaches the UI/CLI JSON. **[run]**

---

## 8. What was run (all in the scratchpad; the repo was not touched)

```
cargo build -p novalis-cli --locked                       # 12 s, incremental
cargo build --release --locked -p novalis-core --example perf
python3 fixtures/gen/gen_vault.py $S/perf-vault --count 10000
/…/shared-target/release/examples/perf $S/perf-vault $S/perf-cache   # ×2, then ×2 after +10k .txt
gh release view v1.0.0-alpha.1 --json assets              # DMG 5,646,210 bytes
```

Scratch vault for the CLI transcript: `a.md` (`# A\n\nhello world`), `notes.txt`, `sub/script.py`, `blob.md` (`\xff\xfehello\0binary`), `bom.md` (`\xef\xbb\xbf# BOM\n\nhello bom`), `nul.md` (`nul\0inside hello`), `book.epub` (`PK\x03\x04junk`), `README`, `.hidden.md`, `notes.txt.md` (`hi`). With `NOVALIS_VAULT` set:

- `ls --json` → `['a.md','blob.md','bom.md','notes.txt.md','nul.md']`
- `cat notes.txt` → the item for `notes.txt.md` (stem resolution), exit 0
- `search hello` → hits in `a.md:3`, `bom.md:3`, `nul.md:1` (`"nul\u0000inside hello"`); `blob.md` skipped silently; `notes.txt`, `sub/script.py`, `README` never scanned; `cloudOnlySkipped: 0`
- `cat blob.md` → `"body": "��hello\u0000binary"`, exit 0
- `cat bom.md` → body starts with `\ufeff`, `"title": "bom"`
- `edit blob.md --append x` → `usage` error "blob.md is not valid UTF-8; novalis opens it read-only", exit 2
- `new x.txt` → created `x.txt.md`, `"stem": "x.txt"`, exit 0
