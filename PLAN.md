# novalis — Rewrite Plan

**Status:** draft for owner review, revision 2 after a six-lens adversarial review · **Date:** 2026-09-05 · **Author:** Claude (research: 10 agents; review: 6 critics, 62 findings, ~50 applied; reports under `docs/research/`) · **Decider:** Sebastian Grundhöfer

novalis replaces the current Novalis (Tauri v2 + React/TipTap, 38k lines, 34 feature flags) with a clean, minimal, high-performance tool for **organizing, creating, writing and editing Markdown files**, plus a **Sublime-like text editor** for basic file types and a **simple Kanban board whose data lives outside the notes**. It syncs between devices through **Google Drive and OneDrive**. It ships as a **monorepo** (core library, macOS desktop app, CLI for AI agents), in **German and English**, and starts on an **empty branch** that replaces the old code forever.

This document is the plan. Every decision below was checked against the old codebase, the design catalog, vendor documentation and measurements on this Mac. Things that could not be verified are marked **ASSUMED**. Nothing beyond the brief ships on silence: §4 lists every such item, and each needs your recorded yes.

---

## 0. Summary

| Topic | Decision | Why (one line) |
|---|---|---|
| Stack | **Tauri 2.11 + Rust core crate + CodeMirror 6** editor, React 19 shell, one Cargo + pnpm workspace | Only stack where "text editor first with Markdown niceties" is a proven pattern; IME, dead keys, spellcheck and VoiceOver come free from WKWebView; the CLI shares the core in-process; other platforms stay possible. Measured cost vs native on this Mac: ≈2× memory, roughly +70–120 ms to the setup callback (first paint not yet measured, see Spike C). |
| Editor | **Decorated source mode**: every Markdown character stays visible and styled, never hidden, never re-serialized | Byte-exact fidelity. The old WYSIWYG round trip caused 5 silent data-loss bugs. One editor for `.md` and `.rs`. |
| Notes | Folder tree, tabs, quick-open, vault search, rename with link rewriting, macOS Trash; tags, backlinks and completion are proposed in §4.3 and wait for your yes | The minimal "organize" set. Everything else from the old app is dropped, not flagged off. |
| Links | `[[wikilinks]]` resolved by **filename stem** (Obsidian rule), no alias resolution; Markdown links also followed | Deterministic without an index; what agents and other tools expect. Needs a one-time migration for old vaults (40 of 63 demo notes, 6 of them with titles that cannot be filenames). |
| Kanban | `<vault>/boards/<slug>/board.json` + `cards/<ULID>.json`, one file per card, cards link notes by vault-relative path | Two devices editing different cards offline never conflict in any sync client. Visible folder because dot-folder sync is unverified for Google Drive. |
| Sync v1 | **Mode 1**: the vault lives in the local OneDrive / Google Drive folder; the app is File-Provider-safe (dataless files, conflict copies, no locks) and also handles Google Drive's Mirror mode (a plain folder) | Zero OAuth, zero shipped credentials. `fs.rs` and `conflict/mod.rs` are lifted from the old repo; cloud detection, watcher, search and boards are new. About one week after Spikes A and D pass, two if a fallback triggers. |
| Sync v2 | **Mode 2**: in-app login (OneDrive via Graph first, Google via `drive.file`), fully specified in §5.7, built only after your go | About two months plus vendor verification; requires shipping OAuth client credentials. |
| Index | Small **SQLite cache in app-data** (paths, mtimes, sizes, hashes, titles, tags, links), incremental by mtime, shared by app and CLI, never on the first-paint path; full-text search = on-demand parallel scan | The CLI needs persistence to be fast; bodies are never duplicated; FTS5 only if the 10k-note benchmark fails. |
| Settings | Four proposed: language, appearance, editor font size, spellcheck (+ last vault as state, no preferences window) | Everything else is hard-coded or a transient command. Each of the four still needs your yes. |
| Design | Four directions from your catalog: **Swiss**, **Editorial-Print**, **Dev-Noir**, **Warm Editorial**; delivered first as static mockups (11 frames) so you choose before code exists | Swiss wins the catalog's own finder in every scenario; the four are mutually compatible; all fonts are SIL OFL. |
| i18n | `i18n/en.json` + `de.json` as the single source; i18next in the UI, the same JSON read by Rust for native menus; CLI English-only | Two locales with identical plural rules do not justify a second runtime. |
| Repo | Same GitHub repo; `main` → `legacy` rename first (with a temporary bypass actor, because the ruleset blocks renames), orphan `main` with CI already in it pushed second; first tag `v2.0.0-alpha.1` | Keeps URL, stars, releases and the AGPL source chain. |
| Minimalism gate | ADR with a quoted owner "yes" for every new setting, feature, dependency, shortcut or network call; enforced by parity tests (settings, keymap, lockfiles) and a PR checklist | The old app's 763-line preferences model and 34 flags are the counter-example. |

Estimated effort to a usable alpha: **10–12 weeks** for one developer working with coding agents (ASSUMED, see §12; re-planned after week 2).

---

## 1. Premises corrected

Research found facts that differ from the brief or the old docs. The plan uses the corrected facts.

1. **Full Xcode 26.6 (build 17F113) is installed** at `/Applications/Xcode.app`; `xcode-select` merely points at the Command Line Tools. `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` activates it per command without sudo. Under CLT alone `swift test` cannot run and Metal shaders cannot compile; with the Xcode path both work. Policy: CLT is the default build path (all Tauri work runs on it); `DEVELOPER_DIR` is opt-in when a task needs Xcode tooling. The gpui fallback in §14 would make it the default path.
2. **Only an "Apple Development" signing identity exists.** Notarized distribution needs a "Developer ID Application" certificate, which needs the paid Apple Developer Program (99 USD/year). `notarytool`, `stapler` and `codesign` are present locally; nothing else is missing. The owner decided on 2026-09-05 not to enrol for the coming year, so v1 releases ship unsigned (§11.4).
3. **The old checkout is on branch `fix/oauth-client-id`** (one commit ahead of `main`, a real fix), not on `main`. The cut-over runs from a fresh clone. The repo is public; `main` is protected by ruleset 20518201 with **zero bypass actors** (no force-push, no deletion, PR + 4 required checks). GitHub's ruleset docs state that with force pushes blocked, administrators cannot rename or change the default branch unless they can bypass the ruleset, so the cut-over needs a temporary bypass actor (§13).
4. **Google Drive for desktop is not installed on this Mac** (only OneDrive, with a real File Provider domain at `~/Library/CloudStorage/OneDrive-Persönlich` containing dataless files). OneDrive behaviour was tested hands-on; Google Drive behaviour is from vendor docs until Drive is installed for Spike D. Drive has two modes: **Stream** (File Provider, dataless files, fixed `~/Library/CloudStorage/GoogleDrive-<account>/` location) and **Mirror** (a plain folder with full copies). Mode 1 must handle both.
5. **`just` is not installed** (rustc/cargo 1.96, pnpm 11, node 22, tauri-cli 2.11.4 are). Day 2 bootstraps it.

---

## 2. Product definition

### 2.1 What novalis is

- A **vault** is a folder of plain files. Notes are `.md` with optional YAML frontmatter, `[[wikilinks]]`, Markdown links and `#tags`. novalis never rewrites bytes the user did not type; the only frontmatter writes are the explicit `meta` and `new --tag` CLI commands, which edit named keys as text and never re-serialize the block.
- A **text editor** that opens `.md` and the basic file types in §7.3 with the Sublime feel: instant open, tabs, command palette, fuzzy quick-open, goto line, find/replace with regex, vault-wide search, multi-cursor, bracket matching, syntax highlighting, autosave.
- A **Kanban board** per vault (or several), stored as small JSON files next to the notes, cards optionally linked to notes. Columns are configurable; nothing else is.
- **Sync** by putting the vault into the OneDrive or Google Drive folder. novalis detects that, handles cloud-only files and conflict copies, and never holds locks.
- A **CLI** (`novalis`) that gives AI agents the same primitives headlessly, with `--json`, stable exit codes and `--dry-run`.
- **German and English**, macOS first, other platforms possible later because nothing in the stack is macOS-only.

### 2.2 What novalis is not (dropped from the old app, absent from the codebase, not flagged off)

AI features, voice, PDF, canvas, calendar, reminders, tasks parsed from note bodies (`@due`, `@status`), Today view, graph view, properties/relations/rollups, block references, transclusion, math, Mermaid, callouts, formatting toolbar, slash menu, outline panel, plugins, templates, daily notes, version history, git sync, P2P sync, Notion/ENEX import, docx export, configurable keybindings, feature flags, folder colours, manual tree order, alias resolution, non-UTF-8 encodings, Spanish and French.

Each of these is a **feature** under the minimalism gate. If one is wanted later, it gets an ADR with your yes first.

### 2.3 Architecture rules (each backed by a measured failure of the old app)

1. **First paint never waits for an index.** The tree is rendered from directory enumeration on a thread; the cache and search start after the tree is interactive and are cancellable. *(Old app: full mtime scan plus a re-read of every note body before the tree appeared; the vault picker showed meanwhile.)*
2. **The text buffer is the source of truth; serialization is the identity function.** Rich rendering is a decoration over unchanged text. *(Old app: 5 silent corruption bugs from Markdown → ProseMirror → Markdown.)*
3. **Never rewrite untouched bytes.** No `modified:` stamping, no frontmatter re-serialization, no whitespace normalization. Metadata comes from the filesystem. *(Old app: whole YAML block re-emitted from a struct on every autosave; one path deleted a user's first section.)*
4. **Atomic, verified saves, and a refused save always has a destination.** Same-directory hidden temp file → fsync → rename → fsync parent. Before writing, compare the target's (mtime, size, hash) with what the editor loaded; on mismatch the buffer is written at once to a conflict copy next to the target (§5.3) and the banner appears. Self-writes are matched by content hash, not by a clock window. Destinations are never clobbered (`renamex_np(RENAME_EXCL)`, fallback link+unlink). *(Old app: truncating writes shipped for six weeks; a 2 s echo window; a 200 ms debounce window that silently discarded typing.)*
5. **Watcher batches.** FSEvents backend (never kqueue, which opens a descriptor per file and hydrates cloud-only files), 100 ms debounce, rename stitching, one batch event `{added, removed, modified, renamed}` per window; the UI patches its in-memory tree, never refetches. *(Old app: one event per file, each triggering a full tree walk plus two more IPC calls.)*
6. **No global lock.** Filesystem operations hold no state beyond the vault path; the cache has one writer actor with its own connection. *(Old app: one `Mutex<Engine>` holding the SQLite connection across file IO; one slow OneDrive hydration froze every command.)*
7. **Never read a cloud-only file eagerly.** Detect `SF_DATALESS` in `st_flags` (fallback: `size > 0 && blocks == 0`). Scanner, search and cache tasks run under an RAII guard that sets `setiopolicy_np(IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES, IOPOL_SCOPE_THREAD, OFF)` on entry and restores the default on drop (the policy is per OS thread and pooled threads are reused), so an accidental read fails with `EDEADLK` instead of downloading; explicit opens run under the default policy and assert it; show a cloud badge; download only on explicit user action with a visible state and timeout. Any operation that must read bodies (relink, migrate, trash) counts cloud-only files first and either materializes them as an explicit action or reports them as skipped. *(Verified on this Mac: stat does not materialize; the policy makes `read()` fail with errno 11 and the file stays dataless.)*
8. **One IPC per user action; batched boot.** `bootstrap()`, `read_file`, `write_file`, `list_dir`, `rename`, `trash`, `search` (streaming), board operations. Surface stays under 25 commands. *(Old app: 158 commands, ≥12 boot round-trips, `getPreferences` called three times.)*
9. **Bundle discipline by CI.** A step parses `dist/index.html` and fails if any preloaded chunk exceeds its budget. *(Old app: a 3.09 MB Mermaid chunk was preloaded at boot despite a lazy `import()` in source.)*
10. **Kanban is its own data.** The app never parses tokens out of note bodies and never rewrites a note to update a card. *(Old app: column moves rewrote `@status(...)` inside note lines.)*
11. **Settings are a struct with `deny_unknown_fields`** and a parity test against `docs/SETTINGS.md`. Adding a key fails CI until the doc and an ADR exist. The same parity idea guards the keymap (`docs/KEYMAP.md`) and new top-level lockfile entries (PR body must cite an ADR).
12. **Before the tree is interactive: nothing but enumerate and paint.** After it: only the watcher and the cancellable cache actor. No migrations, sweeps or polling timers, ever; housekeeping (tombstone purge) happens on the next write of the affected file set.
13. **Test the failures that actually happened**: byte-identical save→reopen→save ×3 corpus, crash between temp and rename, dirty buffer + external change + SIGKILL → conflict copy holds the full buffer, 1,000-file watcher burst → 1 batch, cloud-only fixture for relink/search, manual File Provider checklist, generated 10k/50k-note benchmark from the first commit.

---

## 3. Decisions taken (contradictions resolved)

The ten research reports disagreed on the points below; the review added D21–D26. Each row picks one option (Rule 3: pick, don't blend) and names what was rejected.

| # | Question | Decision | Taken from | Rejected and why |
|---|---|---|---|---|
| D1 | Stack | Tauri 2.11 + Rust core + CM6, ~70 % confidence; fallback gpui-pre 0.3 + gpui-component 0.6 if Spike C fails (§14 prices the switch) | stack | Swift/AppKit: macOS-only forever, no real multi-cursor in NSTextView, STTextView is GPL-or-commercial, tests need Xcode. gpui: pre-1.0 breaking changes, Zed's editor crate GPL and unpublished, no Markdown preview component. Electron: 244 MiB bundle, 2–3× RAM. |
| D2 | UI shell framework | React 19 + Vite, strict rules (no god store, CM6 owns the editor DOM, virtualized tree and board) | old-codebase, monorepo | Vanilla/Solid/Svelte: lighter, but lose the JSX-aware `no-literal-string` i18n lint, typed i18next keys and agent fluency; the old app's problems were structural (one 1,362-line store), not React. |
| D3 | Editor mode | Decorated source mode; read-only preview and hide-syntax live preview are separate §4.3 items | editor-scope, perf-lessons | Obsidian-style live preview as default (stack): the most expensive editor feature, fights multi-cursor and find. TipTap/WYSIWYG: rejected by evidence in Rule 2. |
| D4 | Wikilink resolution | By filename stem, case-insensitive, shortest unambiguous path on duplicate stems; `[[folder/Name]]` and `[[Name\|label]]` and `[[Name#heading]]` supported; Markdown links followed too; **no alias resolution, aliases neither read nor written** | editor-scope, critique, review | Title-based (old app, cli, kanban): needs an index for correctness, ambiguous for agents, not what Obsidian does. Alias fallback (cli): needs the index on the resolution path and hides broken references. Migration cost accepted (§10). |
| D5 | Note identity for cards and CLI | Vault-relative path; the app's rename/move rewrites wikilinks, Markdown links and card references in one rename-first, idempotent operation; the CLI `mv` does the same | cli, perf-lessons | Frontmatter `id` key: writes into notes the user did not edit (Rule 3). Wikilink target string (kanban): with filename resolution it equals the path stem anyway. |
| D6 | Kanban store | `<vault>/boards/<slug>/board.json` + `cards/<ULID>.json`; a board is recognised by a valid `board.json`, not by the folder name; whole-card last-writer-wins on `updated` with byte-verbatim resolution; losers kept under `conflicts/` | kanban, review | `.novalis/kanban/*.json` (cli, monorepo, perf-lessons, old-codebase): dot-folder sync unverified for Google Drive, old watcher and sync manifest skipped dot-paths. One JSON per board (sync): every concurrent edit becomes a vendor conflict copy the app must parse and merge. |
| D7 | Index | SQLite cache in app-data (`files` with hash, `links`, `tags`), one writer actor, incremental scan (stat all, read only changed files), shared by app and CLI, app heartbeat lets the CLI skip its own scan; full-text search = on-demand parallel scan streaming results | old-codebase (schema pattern), cli (persistence), perf-lessons (no FTS, no body duplication) | In-memory only (editor-scope): the CLI would re-read every note per invocation. FTS5 from day one: duplicates bodies; deferred to the benchmark. |
| D8 | Trash | macOS system Trash via the `trash` crate; **the CLI always uses the prompt-free `NsFileManager` method**; the app's method is a §4.4 decision (Finder method gives "Put Back" but spawns `osascript` and triggers a one-time Automation permission prompt and needs an entitlement); cloud-only notes are materialized before trashing or refused | editor-scope, review | In-vault `.novalis/trash` (cli, old-codebase): syncs deleted notes to other devices and needs a restore/empty UI. |
| D9 | i18n tooling | `i18n/en.json` + `de.json` flat keys; i18next core + react-i18next in the UI; `i18next-cli extract --ci` + `eslint-plugin-i18next` in CI; Rust reads the same JSON for native menu labels; core and CLI have no strings, only typed errors | monorepo | Fluent (two runtimes), Paraglide (no lint, different format), hand-rolled `t()` (perf-lessons: loses plurals and the CI gate). |
| D10 | Fonts | Bundle only what the chosen style needs, Latin subset, self-hosted woff2, budget ≤ 250 KB; system fallback stacks; never a CDN | design (fidelity), perf-lessons (budget) | 0 bytes/system fonts only: loses the catalog look, and your own research note warns system fonts erase recognition. 300–600 KB all-styles bundle: pays for styles not chosen. |
| D11 | Performance budgets | See §11.3; startup and RSS rows are provisional until Spike C measures first paint and a React + CM6 baseline; the crate budget is relative to the measured scaffold | stack (measurements), perf-lessons (rules), monorepo (measuring recipe), review | perf-lessons' 150 ms / 150 MB / ≤ 200 crates: below the measured hello-world floor (a bare Tauri 2 app already has 431 `Cargo.lock` entries); "≤ 60 npm packages": uncounted. |
| D12 | Settings | `language`, `appearance`, `editor.fontSize`, `spellcheck` proposed (each needs yes) + `lastVault` as state; no preferences window; `version` is a schema stamp | editor-scope, review | `style` (monorepo): one style is chosen at design time. `vaults[]` (monorepo): multi-vault is a feature beyond the brief. `sync.mode/folder`: meaningless in Mode 1. A preferences window for two drop-downs: chrome the brief avoids. |
| D13 | Variants deliverable | Static HTML mockups first (4 styles × 2 screens with light/dark toggle + 3 layout alternates = 11 frames on one page); `tokens.css` for the winner is written **after** the Spike C go/no-go | design, review | Token-switched builds of the real app (monorepo): designSprache has no `tokens/` directory yet and the app does not exist; comes later once tokens ship. |
| D14 | Git cut-over | Add a temporary bypass actor (repository admin) to ruleset 20518201, rename `main` → `legacy`, protect `legacy`, push the orphan `main` **with `ci.yml` and the final job names already in it**, wait for green, switch default, rewrite required checks and remove the bypass in one PUT | monorepo, review (T1, F1, F10) | Push `rewrite` then switch default then delete/rename (old-codebase): more steps. Force-push: blocked. "Never disables protection" (revision 1): impossible under GitHub's rules; the honest statement is "protection stays active for everyone except the owner for a ten-minute window". |
| D15 | App identifier | New reverse-DNS id `io.github.grundhofer.novalis`, new keychain service of the same name, fresh app-data dir | critique | Reusing `com.novalis.desktop` / `app.novalis`: inherits `settings.json` with `recentVaults`, shares Launch Services identity, blocks side-by-side use during migration. |
| D16 | Sync Mode 2 reuse | Drop `sync/*` (iroh transport, crypto, tickets, `state.json`); keep the pure 3-way planner `sync/manifest.rs` (`plan`, `next_base`, `conflict_copy_path`) and `oauth.rs` as reference | sync, old-codebase | Dropping the planner with the transport: it is the one piece of Mode 2 that is already unit-tested. |
| D17 | Kanban conflicts by mode | Mode 1: generic detection of vendor conflict copies in `cards/` (any file whose parsed `id` matches an existing card) + whole-card LWW. Mode 2: the sync engine never lets a conflict copy appear for board files; card-level LWW; losers kept under `conflicts/` in both modes | kanban, sync, review | Applying either rule alone to both modes; discarding LWW losers in Mode 2. |
| D18 | `@due` / `@status` tokens in old notes | Left as inert text; never stripped; `novalis doctor` reports their count; optional one-time import of `@status` cards into the default board is a §4.4 decision | critique | Silent stripping (touches notes); ignoring the question. |
| D19 | Autosave | Autosave for all file types, 1,000 ms debounce, flush on blur / tab switch / quit; `Cmd-S` = flush now; a refused flush writes a conflict copy immediately, so `Cmd-W`/`Cmd-Q` never block and never lose text (proposed default, owner decides in §4.4) | editor-scope, review | Explicit save only (Sublime): surprising for a notes tool on a synced folder; two rules per file type: a hidden setting. |
| D20 | Tabs | Tabs on (Sublime convention) in the eight base mockup frames; the no-tab layout is one alternate frame so you decide visually | editor-scope | No tabs (design): organizing notes means switching between them. |
| D21 | Pane model | **No pane model in v1.** A card click opens the linked note in a tab; the board toggle (`Cmd-Shift-B`) returns to the board. The board + note split (mockup L5) stays a mockup that decides a later feature | review (brief F2) | Building the split while rejecting split view: the same pane-focus model decided both ways. |
| D22 | Frontmatter writes | Never on save, never re-serialized. Only `meta` and `new --tag` write, and only the named keys as line-level text edits; `new` takes no `--title` (title = filename stem) | review (A3, consistency F2) | "Never written" with a `meta` command (revision 1): contradiction. Dropping `meta`: agents need retagging. |
| D23 | Vault marker | The **one** file v1 writes under `.novalis/` is `vault.json` `{"format":1}`, created by `init` and by the app on first open; used for CLI vault discovery (walk up from cwd) and as the migration marker; legacy `config.json` is read once and never written | review (A6, DS-12) | Discovery by `boards/` (mis-identifies any project folder); writing `config.json` (forbidden by the plan's own rule). |
| D24 | Order of build | Core crate + a thin CLI subset as the core's test harness first (weeks 2–5), desktop alpha second (weeks 5–9), the remaining CLI commands third | review (brief F3) | Full 20-command CLI with golden tests before any desktop UI (revision 1): contradicts "start with the desktop app for Mac". This ordering deviates from the brief's wording and is put to you in §4.4. |
| D25 | Mockup breadth | 4 styles / 11 frames, agent-generated from one shared screen skeleton, in parallel with Spikes A/B | design, review (F12) | 2 finalists (critique R7): the family decision needs a grotesk and a serif seen side by side. If the frames must be human time, cut to 2. |
| D26 | Dependency budget | `Cargo.lock` ≤ scaffold + 150 entries (scaffold measured on day 2; a bare Tauri 2 app measured 431), no `*-sys` crates beyond `libsqlite3-sys` and Tauri's own; old app: 910 | review (T2) | "≤ 200 crates" (perf-lessons): below the floor, would fail CI on the empty scaffold. |

---

## 4. Owner decisions needed

The brief says: ask before adding any setting or feature. This is the one consolidated list, and **silence ships nothing**: every row below adds a setting, feature, command, dependency or mockup, and each ships only with an explicit yes recorded in an ADR.

**Owner answers, 2026-09-05.** The owner adopted every recommendation in §4.1–§4.5 as the decision ("section 4 please make your recommendations"), with one change: **no Apple Developer Program enrolment for the coming year** ("i won't start apple developer enrolment for the upcomming year"), so releases ship unsigned and notarization is deferred (§11.4). After seeing the mockups the owner chose **Dev-Noir first, Swiss as the alternative, with tabs** ("i like two style dev noir first and then as alternative swiss … I think we need tabs"); the remaining §4.6 details (accent hue, custom title bar) are as shown in the mockups unless changed. The answers are recorded in `docs/DECISIONS.md` and become ADR-0001…0009 at scaffold time. The "Recommended" column below is therefore the decided value unless a row says otherwise.

### 4.1 Settings (each is one persisted key)

| Key | Values | Recommended | Where it is changed | Note |
|---|---|---|---|---|
| `language` | `system` / `de` / `en` | yes | Follows macOS per-app language (System Settings ▸ Language & Region); menu item View ▸ Sprache/Language as fallback | Could be zero-setting if the per-app mechanism works in a Tauri bundle (ASSUMED, Spike C checks) |
| `appearance` | `system` / `light` / `dark` | yes | View ▸ Appearance menu items | Drop it if "follow system" is enough for you |
| `editor.fontSize` | integer | yes | `Cmd +` / `Cmd -` / `Cmd 0` only | Default = the chosen style's size |
| `spellcheck` | bool | yes | Edit ▸ Spelling (macOS convention) | Default true |

No preferences window in v1 (`Cmd-,` unbound) — a §4.4 question. State that is persisted but is not a setting: `lastVault` (in `settings.json`); window size/position, open tabs, sidebar width (in `<app-data>/state.json`, free-form, never in `SETTINGS.md`).

### 4.2 Hard-coded defaults that would otherwise be settings (confirm or change the value)

Soft wrap on for `.md`/`.txt`, off for code · line numbers off for `.md`/`.txt`, on for code · auto-pair `(` `[` `` ` `` and wrap selection with `*` `_` `[[` in Markdown · indentation detected per file, 2 spaces default (4 for `py`, `rs`, `swift`, `sh`) · autosave 1,000 ms · large-file thresholds 5 MB (plain mode) and 50 MB (warning) · watcher debounce 100 ms · tree sort folders-first, name ascending · editor measure 66–72 ch · font sizes per style spec · UTF-8 only (other encodings open read-only with a banner).

### 4.3 Sublime/GFM baseline that the plan treats as part of "text editor" and "Markdown", listed so you see it before code exists

Heading jump via the command palette (replaces the dropped outline panel) · clickable task checkboxes and `Cmd-Enter` toggle (the only click that writes into a note: it flips `[ ]`/`[x]`) · `Cmd-B`/`Cmd-I` wrap the selection in `**`/`_` (the only formatting commands) · word/character count in the status bar · indentation guides for code · `links --orphans` in the CLI. Say no to any of these and it goes.

### 4.4 Features proposed by research that are beyond the brief (each needs yes)

| Feature | Proposed by | Recommended | Argument for |
|---|---|---|---|
| Tags as search filter / palette (frontmatter `tags:` and inline `#tags`; no tree panel) | editor-scope | **yes, v1** | Every old vault already carries tags; core of "organizing" |
| Backlinks list for the open note (shows "cards linking here" too) | editor-scope, kanban | **yes, v1** | Data is free from the cache |
| `[[` and `#` autocompletion | editor-scope | yes, v1 | Writing ergonomics; cheap with the cache |
| Read-only rendered Markdown preview (`Cmd-E`) | editor-scope | yes, v1.1 | Reading long notes and tables; rendered by Rust `pulldown-cmark`, no editor impact |
| Hide-syntax live preview mode (Obsidian style) | stack | no | Most expensive editor feature; conflicts with multi-cursor |
| Split view / board + note split (two panes) | editor-scope, design | no (D21) | Adds a pane-focus model; L5 mockup shows what it would be |
| Folding, typewriter/focus mode, minimap, vim | editor-scope | no | Modes with own state |
| Image paste/drop into notes | editor-scope | no (later) | Needs an attachments-folder policy = a setting |
| Version history (app-data snapshots) | old-codebase | no | Drive/OneDrive keep versions |
| Multi-vault / recent vaults list | monorepo | no | Single vault + "Open Vault…" |
| E-paper focus/print mode | design | no | A mode = a feature |
| Flat 2.0 "control" mockup row | design | yes (an afternoon) | Shows what the framework default looks like |
| Kanban: card description (Markdown), due date, tags, colour, WIP limits, swimlanes, done semantics | kanban | no (description first if anything) | Each is a schema addition |
| Kanban: soft-delete tombstones (`deleted` timestamp, purged on next write after 30 days) | kanban | **yes** | Without it a card edited on one device and deleted on another is resurrected by the sync client |
| Kanban: several boards per vault | kanban | yes (zero cost) | The layout supports it; a board switcher appears only if >1 board exists |
| CLI `relink <from> <to>` as a public command | cli | **yes** | The one primitive merges, dedupes and link repair need; `mv` uses it internally anyway |
| CLI `meta` (frontmatter set/unset, add/remove tag) as line-level text edits | cli | yes | Agents retag; strict YAML parse never clobbers broken frontmatter |
| CLI `init <dir>` (writes `.novalis/vault.json`) | cli | yes | Enables vault discovery by walking up from cwd |
| CLI `help --json` and `skill --path` | cli | yes | Agent self-discovery |
| CLI `doctor --fix` | cli | no (doctor stays read-only) | |
| "Install command-line tool" menu item (symlinks the bundled `novalis` into `/usr/local/bin`) | review | yes | Otherwise agents have no `novalis` on PATH |
| MCP server (`novalis mcp`, stdio, same binary) | cli | no (v2) | Only for clients without shell access |
| Localized CLI (German) | cli, monorepo | no | Agents read English |
| Pseudo-locale `en-XA` for dev | monorepo | yes | Catches unwrapped strings; dev-only |
| Pre-commit hooks | monorepo | no (CI only) | |

### 4.5 Product and platform choices (each has a recommendation; your answer is recorded in an ADR)

| Question | Recommended | Alternatives |
|---|---|---|
| Sync Mode 2 (in-app Google Drive / OneDrive login) in v1? | **No; v1 = Mode 1. Mode 2 spec is ready (§5.7) for v2** | Yes → +2 months, and you must accept shipping Google `client_id` + `client_secret` (Google-sanctioned for installed apps) and a Microsoft `client_id` in the binary, or require users to paste their own |
| Mode 2 scopes | Google `drive.file` (non-sensitive, app-created folder only) · OneDrive `Files.ReadWrite.AppFolder` | Full `drive` (restricted, annual CASA 540–4,500 USD) · `Files.ReadWrite` (any folder) |
| Build order | **Core + thin CLI harness first, desktop alpha second (D24)** | Desktop shell first with the core growing underneath it (matches the brief's wording; the CLI harness is what makes the core testable without a UI) |
| Apple Developer Program (99 USD/yr) | **Decided: no enrolment for the coming year.** Releases ship unsigned with the right-click-open note; revisit before the first non-alpha release in 2027 | Enrol now → signed + notarized releases from the first alpha |
| Auto-update | **None** (keep the old promise: no update check). Update path = GitHub Releases; a personal Homebrew tap `grundhofer/homebrew-novalis` can carry the unsigned cask (users install with `--no-quarantine` or right-click-open) | Tauri updater plugin (+1 network call, key custody, and it needs signed builds). The main `homebrew/cask` tap rejects un-notarized artefacts and applies notability criteria this repo does not meet (verified) |
| Trash method in the app | **`NsFileManager` (no prompt, no entitlement; "Put Back" not guaranteed on every macOS)** | Finder method (Put Back works; one-time "novalis möchte den Finder steuern" prompt; needs the Apple Events entitlement and usage string) |
| Minimum macOS | **14 (Sonoma)** | 12.1 is the File Provider floor; 14 gives Safari 17 WebKit for CM6 |
| Architecture | **arm64 only** (as the old release) | Universal binary: now possible (no ort-sys), doubles CI build time |
| First version tag | **`v2.0.0-alpha.1`** | `v0.3.0` (suggests continuity), `v1.0.0` |
| License | **AGPL-3.0-only + COMMERCIAL-LICENSE, ADR-0001 copied verbatim** | Re-decide; drop the section-7 plugin exception (harmless to keep) |
| Wikilink migration for old vaults | **Rename files to their frontmatter title** (Obsidian style) with automatic link rewriting for titles that cannot be filenames; `--dry-run` first | Rewrite links to current filenames (links become slugs like `[[local-first-software]]`) |
| `@status` cards from old notes | **Leave as text** | One-time import into the default board via `novalis migrate --import-status` |
| Merge PR #94 (`fix/oauth-client-id`) into `main` before tagging `legacy-final` | **Yes** (1 commit, real fix; the old CI names still exist on that branch so its checks can pass) | Close it |
| Delete the 12 stale remote branches listed in §13 after `legacy-final` is pushed (the 4 dependabot branches go with their closed PRs) | **Yes** | Keep |
| Keyboard: `Cmd-P` | **Quick-open** (Sublime/Zed); no Print in v1 | Keep Print; quick-open on `Cmd-O`/`Cmd-T` |
| Keyboard: `Cmd-K` | **Insert/wrap Markdown link** | Command palette (Dev-Noir signature); palette then stays on `Cmd-Shift-P` |
| Keyboard: board toggle | **`Cmd-Shift-B`** (`Cmd-B` stays bold) | Palette-only, no chord |
| Sidebar toggle | **`Cmd-\`** (old novalis) | `Alt-Cmd-S` (Finder), `Cmd-K Cmd-B` (Sublime) |
| Kanban placement | **Pane in the same window, toggled by `Cmd-Shift-B` or the palette (mockup L4)** | Separate window |
| Card click | **Opens the linked note in a tab (D21)** | Split next to the board (mockup L5; a later feature) |
| Preferences window in v1 | **No** (menus and shortcuts only, `Cmd-,` unbound) | A window with the four items |
| Cloud-only files in the tree | **Shown with a cloud badge, downloaded on open** | Hidden until materialized |
| Autosave | **Autosave for all file types, 1,000 ms (D19)** | Explicit save only; autosave for `.md`/`.txt` only |
| Commit message policy | **No `Claude-Session:` trailers** (262 of 466 old commits carry them) | Keep |

### 4.6 Design choices (after seeing the mockups, §6; recommendations from the ranking)

1. Family: grotesk (Swiss, Dev-Noir) or paper/serif (Editorial-Print, Warm Editorial)? Recommended: grotesk.
2. Style within the family. Recommended: Swiss.
3. Layout: sidebar + tabs (L2, recommended per D20), no tabs (L1), palette-only (L3); board as pane (L4, recommended); board + note split (L5) is a later feature.
4. Signal colour: one hue with form-coded status (Swiss, Editorial-Print; recommended) or green/amber semantics (Dev-Noir, Warm Editorial)?
5. Accent hue: Swiss red `#E30613` (recommended) or your own; Dev-Noir must not be violet.
6. Fonts: Inter (recommended, already in the old repo's pipeline) or a less generic grotesk (your research note suggests Mona Sans); serif pair Newsreader + Instrument Serif.
7. Window chrome: native title bar (recommended for Swiss/Editorial/Warm) or custom 38 px bar with breadcrumb (Dev-Noir).
8. Textures off (recommended) or the Dev-Noir full vocabulary shown once.
9. Mockup language: German first, English second pass (recommended).

Semantic tokens mean Phase 3 can start on the recommended style and swap later at token cost only.

---

## 5. Architecture

### 5.1 Monorepo layout

```
novalis/
├─ CLAUDE.md                      # agent contract, ≤150 lines (§11.7)
├─ justfile                       # THE task runner: just setup|dev|check|test|test-cli|app|release|bump
├─ Cargo.toml  Cargo.lock  rust-toolchain.toml (1.96.0)  deny.toml  .cargo/audit.toml
├─ pnpm-workspace.yaml  package.json (pnpm 11)  VERSION
├─ crates/
│  ├─ novalis-core/               # vault fs, atomic save, watcher batches, cache, search scan,
│  │                              # links/relink, boards store, cloud detection, migrate; NO UI deps, NO strings
│  └─ novalis-cli/                # `novalis` binary (clap 4.6) on core only; --json; English
│     └─ src/ops/*.rs             # one fn(ctx, Args) -> Result<T: Serialize + JsonSchema> per command,
│                                 # used by the clap layer, by `help --json`, later by `novalis mcp`
├─ apps/
│  └─ desktop/
│     ├─ src-tauri/               # thin shell: <25 commands, menu from i18n JSON, window state;
│     │                           # bundles `novalis` at Contents/MacOS/novalis
│     └─ ui/                      # React 19 + Vite, CodeMirror 6; imports i18n/*.json, packages/tokens
├─ packages/
│  ├─ tokens/                     # tokens.css (--ds-*) for the chosen style; GENERATED-PENDING until
│  │                              # designSprache ships DTCG tokens, then vendored via `just tokens:sync`
│  └─ agent-skill/novalis/        # SKILL.md + reference.md + examples.md (§9.5)
├─ i18n/  en.json  de.json        # single source of truth, flat "namespace.key"
├─ fixtures/
│  ├─ demo-vault/                 # vendored novalis-demo-vault (63 notes)
│  └─ gen/                        # generator: umlaut/NFD names, case twins, conflict copies, notes under
│                                 # boards/, cloud-only stand-ins, 10k/50k notes
├─ design/variants/               # the 11 mockup frames + comparison page (§6.3)
├─ docs/  PLAN.md  DECISIONS.md  decisions/NNNN-*.md  SETTINGS.md  KEYMAP.md  PRIVACY.md  RELEASING.md
│         BUDGET.json  FILE-PROVIDER-CHECKLIST.md  research/
├─ scripts/  check-versions.mjs  bundle-budget.mjs  lockfile-adr-check.mjs  gen-vault.py
└─ .github/workflows/  ci.yml (jobs: check (macos-latest), check (ubuntu-latest), audit)  release.yml  perf.yml
```

Toolchain: Cargo workspace + pnpm workspace (both proven in the old repo), `just` 1.58 as the only runner (bootstrapped on day 2 with `brew install just`), rustfmt + clippy `-D warnings`, eslint flat config (`react-hooks` + `i18next/no-literal-string`), `cargo deny check licenses bans sources` with the old `deny.toml`, `cargo audit` with `deny = ["yanked"]`, dependabot grouped weekly (one root-scoped entry per ecosystem), all actions SHA-pinned.

### 5.2 Core crate (`novalis-core`)

Modules and their old-code ancestry (lift = copy with tests and adapt; new = write):

| Module | Responsibility | Origin |
|---|---|---|
| `vault::path` | `vault_rel` / `vault_note_rel` guards (reject `..`, absolute, hidden, non-`.md` for note API); symlink-aware; **every path NFC-normalized at ingress** (readdir, watcher, IPC, CLI args, card JSON, link targets) | lift `vault/fs.rs` + fix symlink blindness (old audit finding 497) |
| `vault::fs` | `list_dir` (readdir + lstat only, never canonicalize), `read_file` → `{text, mtime, size, hash}` (UTF-8 only; other encodings flagged read-only), `write_atomic` with parent fsync and precondition check, `rename` via `renamex_np(RENAME_EXCL)` with case-only and normalization-only (same-inode) two-step handling, `trash` | lift + extend |
> **Measured 2026-09-08 — conflict copies are not guaranteed.** With Google
> Drive, a server-side edit and an offline local edit to the same file were
> reconciled by Drive **silently discarding the server version and creating no
> conflict copy at all** (full evidence chain in
> `docs/spikes/2026-09-07-spike-d-google-drive.md`). The overwritten version is
> retained in Drive's own history, so it is overwritten rather than destroyed,
> but nothing appears on disk for the app to find.
>
> Every sentence below that says a vendor conflict copy "will" appear is
> therefore **provider-dependent and unverified for Drive**: §0's summary line,
> §2.1, D6, D17, §5.2, §5.3's cloud hints, §5.6 items and §8.4. OneDrive's
> behaviour is still only assumed — that row of the checklist needs the same
> two-client run and has not had one.
>
> Two consequences the code has to own rather than the plan: the app cannot
> detect this class of loss at all (the save precondition compares local bytes
> to remembered local bytes, and a silent server-side overwrite produces no
> FSEvent), and `boards::resolve_card_conflicts` / `resolve_board_conflicts`
> are today called by nothing in either binary.

| `vault::cloud` | `SF_DATALESS` detection, RAII materialize-off guard, File Provider domain detection via `~/Library/CloudStorage/` prefix or xattr `com.apple.file-provider-domain-id`, plus a "mirrored cloud folder" heuristic for Google Drive Mirror mode (path under the Drive mirror root, ASSUMED detectable, Spike D), conflict-copy detection generalized to `<stem>-<hostname>.<ext>`, `<stem> (n).<ext>`, `<stem> (…conflicted copy…).<ext>` for any extension, requiring differing content; **resolution re-implemented** on `write_atomic` + `trash` + `RENAME_EXCL` (the old resolver hard-deletes and copies with truncation) | new, detection patterns from `conflict/mod.rs` |
| `vault::watch` | `notify` 8.2 + `notify-debouncer-full` 0.7 (rename stitching), FSEvents backend pinned, 100 ms, one batch per window, ignore dot-files/`*.tmp`/`~*`/`.novalis/`, self-write suppression by (path, size, mtime, hash) | new, ideas from `watcher.rs` |
| `notes::frontmatter` | Lenient read of `title` and `tags`; **`edit`**: line-level insert/replace/remove of a named key inside the existing YAML block, never re-serializing, strict parse before writing; `title` = frontmatter title → first H1 → stem | lift reader from `vault/frontmatter.rs`, drop writer, add surgical edit |
| `notes::links` | Extract `[[target]]`, `[[target\|label]]`, `[[target#heading]]`, `[text](path.md)`; resolve by stem (§7.2); `relink(old_target: &str, new_path)` rewrites all forms plus card references, rename-first, idempotent, each file under its scan-time precondition, reports `skipped` and `cloudOnlySkipped` | new (old core indexed only `[[…]]` and never rewrote) |
| `cache` | SQLite in app-data: `files(path PK NFC, path_fold, mtime_ns, size, hash NULLABLE, title, stem, cloud_only)`, `links(src, target, form, line, resolved)`, `tags(path, tag)`, `meta(key, value)` incl. `watcher_alive_at`; WAL, `busy_timeout` 5 s, `user_version` in the file name (`<vaultkey>-s<schema>.sqlite`, so app and CLI on different schemas coexist instead of rebuilding each other), single writer actor; incremental scan = stat every file, read bodies only where (mtime, size) changed **or `cloud_only` flipped** (hydration does not bump mtime); cloud-only rows have `hash NULL` and no links | lift `index/schema.rs` pattern, 3 tables instead of 9 |
| `search` | Parallel on-demand scan (`ignore` + `grep-searcher`/`memchr`) under the materialize-off guard, streaming, skips cloud-only and reports the count, `tag:`/`folder:` filters from the cache | new |
| `boards` | Board/card store (§8), ULID ids, fractional-index ordering, LWW merge with verbatim writes, conflict folder, tombstones, read-time precondition with field-level replay | new |
| `migrate` | Report title≠stem, all-or-nothing rename plan with relink and sanitization map, import `taskView.kanbanColumns`, count `@due`/`@status` tokens, cloud-only handling | new |
| `error` | Typed `CoreError` kinds mapped to CLI exit codes and UI catalog keys | lift `engine.rs` `CommandError` kinds |

Dependency budget: D26.

### 5.3 Desktop app (`apps/desktop`)

- **Shell (Rust):** `bootstrap()` returns `{settings, vault, tree, lastOpen}` in one call; commands `read_file`, `write_file(expected)`, `list_dir`, `rename`, `trash`, `search` (channel), `board_*`; native menu built from `i18n/*.json`; one watcher thread; one cache actor thread per vault, which owns every write to the SQLite index and beats its heartbeat so the CLI can skip its own scan; events: `fs-batch`, `menu-action`, `cache-updated`. All commands `async` + `spawn_blocking`; the materialize-off guard is applied per task, never left on a pooled thread.
- **UI (React):** small stores per domain (vault/tree, tabs, editor-save, navigation, board); virtualized tree and board; CM6 owns the editor DOM; command palette is the home of every transient toggle; status bar (words · line:col · cloud state). No preferences window.
- **Editor (CM6):** `@codemirror/view` 6.43, `state`, `search`, `lang-markdown` + `@lezer/markdown` GFM + custom inline parsers for `[[wikilinks]]` and `#tags`, `lang-yaml` `yamlFrontmatter`, `@codemirror/language-data` lazy grammars, `allowMultipleSelections` + `rectangularSelection` + `selectNextOccurrence`, `closeBrackets`, `bracketMatching`, `history`. Decorations: heading sizes, emphasis styling with markers visible, link/tag colours, clickable task checkboxes, `Cmd-click` on links. Above 5 MB: plain mode (no Markdown decorations, no highlighting); above 50 MB: warning.
- **External-change state machine (one spec shared by editor, board store, watcher, CLI, sync):**
  1. On open capture `(mtime, size, hash)`; after every own write record `(path, size, mtime, hash)`.
  2. Watcher batch marks the path changed:
     - buffer clean and the last write was not ours, or the disk hash equals our recorded hash → reload silently;
     - buffer clean, the last write **was ours**, and the disk hash differs → the sync client replaced our text: banner *„Deine letzte Änderung wurde von der Synchronisierung ersetzt"* with **Neu laden / Meine wiederherstellen** (restore writes our recorded content as a conflict copy or over the target, the user chose);
     - buffer dirty → banner *„Auf der Festplatte geändert"* / "Changed on disk" with **Neu laden / Meine behalten / Als Konfliktkopie speichern**; if the disk diff is exactly a link rewrite from a rename, re-apply it to the buffer instead of raising the banner.
  3. On save (autosave tick or `Cmd-S`): stat target; if `(mtime, size)` differ from captured and the disk hash differs from last-known → **the buffer is written immediately and atomically to `<name> (conflict <host> <YYYY-MM-DD HHMM>).md` in the same folder and keeps autosaving there** until the banner is resolved: *Neu laden* trashes the copy; *Meine behalten* renames it over the target (the user chose, so no precondition; in a non-cloud vault the disk version is first written to a conflict copy because there is no vendor history); *Als Konfliktkopie speichern* keeps both. `Cmd-W` and `Cmd-Q` never block and never lose text.
  4. Watcher events matching a recorded own write are dropped.
  5. Board and card writes carry the `(mtime, size, hash)` captured when that JSON was last read; on mismatch the store re-reads, re-applies the single field change (column / order / title / notes) and writes again; card edits are field-level and replayable, so no banner.
  6. CLI `edit --if-match <sha256>` maps to step 3 (refuse with exit 4 instead of writing a copy); `mv`/`relink` write each affected file under its scan-time precondition and report `conflicts`.
- **Cloud hints:** one-line, dismissable, in the status bar: vault is in a cloud folder · N notes cloud-only · N conflict copies found (click → list with Keep original / Keep copy / Keep both, resolution per §5.2 `vault::cloud`).

### 5.4 CLI (`novalis-cli`) — see §9

### 5.5 Data formats

**Vault:** any folder. `boards/<slug>/` is a board only if it holds a valid `board.json`; other files under `boards/` are ordinary notes and `doctor` reports `.md` files inside a board folder. `.novalis/vault.json` is the one file v1 writes there (D23); legacy `.novalis/config.json` is read once for migration. Everything else is the user's.

**Notes:** `.md`, UTF-8, line endings preserved. Frontmatter: `title` and `tags` read; written only by `meta` and `new --tag` as text edits of named keys (D22).

**Settings** (`~/Library/Application Support/io.github.grundhofer.novalis/settings.json`; `version` is a schema stamp, `lastVault` is state, four settings):

```json
{ "version": 1, "language": "system", "appearance": "system", "editor": { "fontSize": 16 }, "spellcheck": true,
  "lastVault": "/Users/…/OneDrive-Persönlich/Notizen" }
```

**State:** `<app-data>/state.json` (window, tabs, sidebar width), free-form.

**Cache:** `<app-data>/cache/<vaultkey>-s<schema>.sqlite`, where `vaultkey` = first 16 hex of SHA-256 over the NFC-normalized absolute vault path with the root symlink resolved once and the trailing separator stripped (files below the root are never canonicalized, Rule 7). Disposable.

**Boards:** §8.

### 5.6 Sync Mode 1 (v1): vault inside the vendor's folder

What the app does, all in core. Two vault kinds: **File Provider vault** (OneDrive; Google Drive in Stream mode) and **mirrored vault** (Google Drive in Mirror mode: plain files, no dataless state, but conflict copies still appear).

1. Detect the kind (`~/Library/CloudStorage/` prefix or the domain xattr → File Provider; Drive mirror root → mirrored, ASSUMED until Spike D); show the hint once.
2. Enumerate with readdir + lstat only; never `canonicalize`; never glob through dataless directories (they can be dataless too and enumeration can hydrate them).
3. Scanner, search and cache tasks run under the materialize-off guard; `EDEADLK` or `SF_DATALESS` → `cloud_only = true`, body not read, hash NULL, tree shows a cloud badge, search reports "N Notizen nicht durchsucht (nur online)".
4. Open a cloud-only note off the main thread under the default policy with a visible „Wird geladen…" state and a cancellable timeout (materialization can take seconds).
5. Save via hidden same-dir temp + fsync + rename + parent fsync; close descriptors immediately; never `flock`.
6. Conflict copies: detect by the generalized patterns in any folder including `boards/*/cards/`; resolve per §5.3 (notes) and §8.4 (cards); never delete, always trash, always `RENAME_EXCL`.
7. Cache and settings live in app-data, never in the synced folder (SQLite WAL is documented to corrupt under sync clients).
8. Paths are NFC at every ingress and stored NFC; a casefolded shadow column serves resolution; a rename whose source and target are equal under NFC + casefold is a same-inode rename via the temp-name two-step; the app refuses to create two files that differ only by case or normalization.
9. Operations that read bodies (relink, migrate, trash, `rm`) count cloud-only files first: the app materializes them as an explicit action with progress; the CLI reports them (`cloudOnlySkipped`) and requires `--materialize` or `--force`.

**Settled by Spike A on the real OneDrive domain (2026-09-05, `docs/spikes/2026-09-05-spike-a-onedrive.md`):** temp+rename is safe (10–12 ms, no conflict copy, no duplicate, the provider treats it as the same item; the §14 write-in-place fallback is not needed for OneDrive); case-only and NFC→NFD renames are same-inode renames and the provider forwards the NFD name verbatim, so novalis must write NFC; five rewrites of one card in 43 ms produce one file and one upload; `trash` with `NsFileManager` takes 57 ms, needs no prompt, and writes Put Back records; `SF_DATALESS` is exact across all 44,851 cloud-only files in the domain and a stat-only scan of 53,777 files takes 1.9 s without hydrating anything. Two findings became hard requirements: **FSEvents reports NFD paths even for an NFC-registered watch** (so NFC-at-ingress is mandatory, not optional), and **the provider emits `Modify(Metadata)` events 0.2–1 s after every own save**, so self-write suppression must match on content, not on "any event on my path", and must survive that window.

**Still unverified (needs a second client or Google Drive; checklist in `docs/FILE-PROVIDER-CHECKLIST.md`):** vendor conflict-copy naming, a same-card edit from two clients, the NFD round trip through the server, trashing a dataless note, Finder Put Back, FSEvents for a remote change, and Google Drive for desktop in Stream and Mirror mode.

### 5.7 Sync Mode 2 (v2, on your go): in-app login

Specification, so the decision is informed; nothing is built in v1. Mode 2 is refused on a vault that already lives under `~/Library/CloudStorage/` (double sync).

- **OAuth:** PKCE S256 + loopback on `127.0.0.1:<port>` (Google) / `http://localhost` (Microsoft, port ignored); lift `oauth.rs` (479 lines, 6 tests) and `secrets.rs` (keyring 4.2 with `apple-native-keyring-store`). Google Desktop clients need the `client_secret` at token exchange (Google: "obviously not treated as a secret" for installed apps); Microsoft public clients need none. Keep the old "paste your own client id" escape hatch. Register the Microsoft app in a work/school tenant so publisher verification stays possible.
- **Scopes:** Google `drive.file` (non-sensitive: basic brand verification only, no CASA, no 100-user cap) → one app-created folder `novalis/`. OneDrive `Files.ReadWrite.AppFolder` → `Apps/novalis/`. Files the user drops into the Google folder via the web may be invisible to `drive.file` until touched by the app (ASSUMED; confirm in the prototype).
- **Engine:** SQLite state DB in app-data (`files(path, size, mtime_ns, local_hash, base_hash, remote_id, remote_version, remote_hash, parent_remote_id, state, last_error)`, `remote_ids`, `cursor`, `queue`) + content-addressed base blobs; **non-disposable** (on loss, the first sync compares local vs remote hash per path and writes a conflict copy for every difference, never overwriting); hash-driven 3-way planning lifted from `sync/manifest.rs`; delta polling every 60 s while focused and after each own upload (no webhooks: both vendors need a public HTTPS endpoint).
- **Preconditions:** Google Drive v3 has **no etag/If-Match** (discovery doc rev 20260901 verified) → write with `fields=version,headRevisionId`; if the returned `version` ≠ expected + 1 another writer interleaved: fetch `revisions.list`, download the revisions between expected and returned, write them as `<name> (conflict <device> …).md`, then mark clean. Change tokens have no documented expiry; on a rejected `pageToken` re-fetch `startPageToken` and re-list the app folder. Microsoft Graph → `createUploadSession` with `If-Match: <cTag>` → 412 on conflict (true compare-and-swap); delta with 410-resync semantics; `quickXorHash` is the only hash guaranteed for personal + business.
- **Merge policy:** Markdown → automatic 3-way merge with `diffy 0.5` against the base blob when clean; otherwise keep local untouched and write the remote as `<name> (conflict <device> <YYYY-MM-DD HHMM>).md`. Never last-writer-wins for notes. Boards → card-level LWW; losers kept under `conflicts/`; never a conflict copy for board files.
- **Deletes:** always to a recoverable trash on the other side; delete-vs-edit → keep and re-upload, flag it.
- **Failure handling:** persisted queue, exponential backoff with jitter, honour `Retry-After` (Graph 429/503) and Drive 403/429; resume upload sessions; verify every upload by server hash; `invalid_grant` → "reconnect" state keeping the queue; refresh tokens rotate on every use (Microsoft, 90-day life) so persist the new one each time.
- **Effort (ASSUMED):** core 3–4 weeks, OneDrive 1.5 weeks, Google 1.5–2 weeks + brand verification wait, soak 1 week. Build OneDrive first (real preconditions, documented resync, guaranteed hash).

### 5.8 i18n

- Source: `i18n/en.json` (canonical) and `i18n/de.json`, flat keys `namespace.key`, `{{var}}` placeholders, plurals as `key_one`/`key_other` (de and en both have exactly these CLDR categories).
- UI: i18next 26 + react-i18next; type-safe keys from `en.json`; inactive locale loaded lazily.
- Rust shell: `serde_json` reads the same file for native menu labels and error → message mapping; predefined items (Quit, Hide, Services) get system names.
- CI: `i18next-cli extract --ci` (drift), `i18next-cli status` (missing translations), `eslint-plugin-i18next no-literal-string` (jsx + `placeholder`/`title`/`aria-label`/`alt`), catalog parity test (no empty values, same keys/vars/markup), pseudo-locale `en-XA` in dev (if approved).
- Dates: ISO in files; `Intl.DateTimeFormat(lang)` in the UI only; the CLI prints ISO 8601.
- German specifics: umlaut filenames and wikilinks in fixtures (NFC/NFD), the German OneDrive folder name `OneDrive-Persönlich`, banner and conflict texts in both languages from day one.

### 5.9 Design tokens

Until designSprache ships DTCG tokens, `packages/tokens/tokens.css` is hand-written for the chosen style from the fact sheet's `palette`, `params` and `googleFonts` fields, marked `GENERATED-PENDING`, and written only after the Spike C go/no-go (D13). Components use semantic tokens only (`--ds-color-bg-canvas`, `--ds-color-fg-default`, `--ds-radius-control`, `--ds-font-sans`…). When designSprache's Style Dictionary build exists, `just tokens:sync <slug> <commit>` vendors its `tokens.css` with a SHA-256 manifest and CI fails on drift. Light and dark are two token sets, never `filter: invert()`.

---

## 6. Design

### 6.1 The four directions (from your catalog, ranked by its own finder and a 7-criterion score)

| # | Style | Mode in catalog | One-line character | Fonts (all SIL OFL 1.1, none on macOS) | Status coding |
|---|---|---|---|---|---|
| 1 | **Swiss** (`swiss`) | light; dark derived | Grid, hairlines, radius 0, one red (`#E30613`) under 5 % of the area, empty margin column | Inter 400/500/700 | form + word (■/□), one hue |
| 2 | **Editorial-Print** (`editorial-print`) | light; dark derived | Paper `#FBF8F1`, ink `#17140F`, serif display + reading serif, small caps, brick red `#8C2F1F`, 3 px double rules | Instrument Serif + Newsreader | form + word, one hue |
| 3 | **Dev-Noir** (`dev-noir`) | dark; light derived | Grey ladder `#08080B → #EDEDEF`, 1 px hairlines, radius 6–8/10–12, mono metadata, `kbd` badges, custom 38 px title bar | Inter + Geist Mono | accent + green/amber |
| 4 | **Warm Editorial** (`warm-editorial`) | light; dark derived | Warm paper `#FAF7F2`, ink `#2B2622`, sheet radius 14, warm shadows, terracotta `#A8432A` | Instrument Serif + Newsreader + Inter micro-labels | earthy accent + muted green/ochre |

Full specs (eight hard parameters, palettes for both modes with WCAG ratios, rules, failure modes, how tree/editor/board/palette look in each) are in `docs/research/2026-09-05-design.md` F3–F6. Applied to all four: exactly one radius per element class, at most one shadow step (zero for Swiss/Editorial), every interactive element gets a second marker besides colour, `tabular-nums` on all numbers, focus ring built first as one global utility, **all textures off** (noise, grain, grid, glow, paper gradient).

Rejected as base styles: Flat 2.0 (the catalog calls it a substrate with zero recognition; kept as a control row), E-Paper (no status colour, reads as broken on emissive displays; possible later as a mode), Terminal-Mono/Data-Dense/Portal-Density/Pixel (fail the prose-readability gate), all loud/textured/blur families.

### 6.2 Reference content rule

Every mockup uses identical content so only design varies: names from the demo vault; one fixed German note with h1, h2, paragraph, list, blockquote, code block, `[[wikilink]]`, one task; one board with four columns (Ideen · In Arbeit · Warten · Fertig) and nine cards, two linked to notes; the same search string; the same palette state. Viewport 1280×800.

### 6.3 Deliverable: 11 frames on one comparison page

Screens and layouts (legend): **S1** = files + editor + status bar with the tab strip (layout **L2**, the D20 default); **S2** = Kanban as a pane in the same window (layout **L4**) with one card selected. Alternates rendered once in the leading style: **L1** no tabs (single document, quick-open only), **L3** palette-only (no sidebar, palette open), **L5** board + linked note split (a later feature, shown to decide it).

- 4 styles × 2 screens, each with a light/dark toggle (`data-theme` on the root div) = 8 frames, plus L1, L3, L5 = 11 frames. Optional Flat 2.0 control frame (§4.4).
- Built as static HTML + CSS following the catalog's scoping rule (one `<style>`, one `<div class="style-<slug>">`, prefixed selectors, no `:root`), fonts self-hosted, a ~150-line Python generator in the spirit of `build.py`, plus the catalog's own "Als Prompt kopieren" export for each finalist so an agent can implement the style without seeing the catalog.
- Effort: agent-generated from one shared screen skeleton, ~4 days of agent time in parallel with Spikes A/B (D25).

Decision sequence: family → style → layout → accent/fonts (§4.6).

---

## 7. Editor and notes scope

### 7.1 Feature tiers

| Tier | Feature | Setting? |
|---|---|---|
| MUST | Instant open (Rust reads, string to CM6, grammar lazy) · tabs · command palette `Cmd-Shift-P` · quick-open `Cmd-P` (fuzzy, `nucleo`-class matcher) · goto line `Ctrl-G` · find/replace `Cmd-F` / `Cmd-Alt-F` (regex, case, word, replace-all) · vault search `Cmd-Shift-F` with results panel · multi-cursor (`Cmd-D`, `Cmd-Shift-L`, `Alt-click`, `Ctrl-Shift-↑/↓`) · syntax highlighting · bracket matching · soft wrap per type · undo/redo · autosave · large-file fallback · external-change banner | none |
| Baseline (§4.3, listed for you) | Line numbers per type · indentation guides (code) · auto-pair (Markdown subset) · word/char count · heading jump via palette · indentation detection · clickable checkboxes · `Cmd-B`/`Cmd-I` | none |
| Needs yes (§4.4) | Spellcheck (macOS native; see spike) · `[[`/`#` completion · backlinks list · tags filter | spellcheck only |
| LATER (needs yes) | Read-only preview `Cmd-E` · split view · folding · focus/typewriter · image paste · multi-file replace | |
| NO | Minimap, vim, LSP, terminal, git, plugins, AI, themes gallery, toolbar, slash menu, trim-on-save, encoding conversion | |

### 7.2 Markdown flavour and link resolution

CommonMark 0.31.2 + GFM tables, task lists, strikethrough, autolinks + YAML frontmatter + `[[wikilinks]]` + inline `#tags`. Not in v1: callouts, highlights, comments, block ids, embeds, math, Mermaid, footnotes. Parser: `@lezer/markdown` GFM bundle + two small inline parsers (wikilink, tag); Rust side `pulldown-cmark 0.13` with `ENABLE_WIKILINKS` for link extraction and the later preview.

Resolution of `[[X]]`: X is matched case-insensitively against file stems (after NFC); on a unique match that is the note; on duplicate stems (`index.md` and `reading/index.md` in the demo vault) `[[folder/stem]]` disambiguates and `doctor` reports the duplicates; `[[X#heading]]` and `[[X|label]]` strip their suffixes; a stem containing `#` or `|` cannot be a link target and `doctor` reports it. Markdown links `[text](relative/path.md)` resolve relative to the note (percent-decoded). The CLI exposes `linkTarget` (the shortest unambiguous wikilink text) on every note it lists so agents never guess.

### 7.3 File types

| Tier | Extensions | Grammar |
|---|---|---|
| A (Lezer) | `md markdown` · `txt text` (none) · `json map` · `yaml yml` · `toml` (legacy stream) · `xml svg` · `html htm` · `css` · `js mjs cjs jsx ts mts cts tsx` · `py` · `rs` | `@codemirror/language-data`, lazy |
| B (legacy stream) | `sh bash zsh` · `ini conf cfg properties env` · `swift` · `Dockerfile` | `@codemirror/legacy-modes` |
| C (plain) | `csv tsv log gitignore LICENSE Makefile` | none; csv/tsv open with wrap off and line numbers on, not a table editor |

Stop there. No tree-sitter (WASM per grammar, no maintained CM6 binding). UTF-8 only; a file that is not valid UTF-8 opens read-only with a banner.

### 7.4 Keymap (hard-coded, no rebinding UI, documented in `docs/KEYMAP.md` with a parity test, ADR-0008)

Apple standard untouched (`Cmd-Z/Shift-Cmd-Z`, `Cmd-F/G`, `Cmd-S`, `Cmd-N/O/W/Q`, `Cmd-B/I` apply `**`/`_` in Markdown, `Ctrl-Cmd-F` full screen; `Cmd-,` unbound in v1). Editor: `Cmd-P` quick-open · `Cmd-Shift-P` palette · `Ctrl-G` goto line · `Cmd-D` next occurrence · `Cmd-Shift-L` all occurrences · `Cmd-Alt-F` replace · `Cmd-Shift-F` vault search · `Cmd-/` comment (code) · `Ctrl-Shift-↑/↓` add cursor · `Cmd-Ctrl-↑/↓` move line · `Shift-Cmd-D` duplicate line · `Ctrl-Shift-K` delete line · tabs `Shift-Cmd-[`/`]`, `Cmd-1…9`, `Shift-Cmd-T` · navigation `Cmd-[`/`]` · `Cmd-K` link · `Cmd-Enter` toggle checkbox · `Cmd-\` sidebar · `Cmd-Shift-B` board · `Cmd-=`/`-`/`0` font size. Tree: `Enter` rename, `Cmd-Delete` trash, `Shift-Cmd-N` new folder.

### 7.5 Spellcheck — settled by Spike B (2026-09-05)

tauri-apps/tauri#7705 reproduces on macOS 26.6: out of the box a WKWebView shows no red underlines, though the right-click menu already offers the correct German suggestions. The cause is one user-defaults key, not a missing WebKit feature: with `WebContinuousSpellCheckingEnabled` set, the underlines appear (measured three ways — sending `toggleContinuousSpellChecking:`, writing the key before launch, and a control run without it). **v1 therefore ships real underlines**: the shell seeds that key from the `spellcheck` setting at startup and the existing Edit ▸ Spelling item toggles both. The `NSSpellChecker`-decoration fallback is dropped from v1.1. Report: `docs/spikes/2026-09-05-spike-b-spellcheck.md`. Still inferred rather than measured: that the key behaves identically inside the app's own webview (neither wry 0.55 nor Tauri 2.11 touches the text checker, so there is no known mechanism for a difference); confirm in Phase 3.

---

## 8. Kanban specification

### 8.1 Layout

```
<vault>/boards/<board-slug>/
├─ board.json            # presence of a valid board.json makes this folder a board
├─ cards/
│  ├─ 01K4G9Z2Q7M3N8RSTV5WXY6ZAB.json
│  └─ …
└─ conflicts/            # losers of a same-card conflict, never deleted automatically
```

Board folders appear in the file tree as one "board" item (the treatment the old app gave `.canvas` files). `board.json` and `cards/*.json` are excluded from the note cache; `.md` files inside a board folder remain notes and are reported by `doctor`.

### 8.2 Files

`board.json`:
```json
{ "format": 1, "name": "Atlas",
  "columns": [ { "id": "todo", "name": "To Do" }, { "id": "doing", "name": "Doing" }, { "id": "done", "name": "Done" } ],
  "updated": "2026-09-05T08:41:12.345Z" }
```

`cards/01K4G9Z2Q7M3N8RSTV5WXY6ZAB.json`:
```json
{ "id": "01K4G9Z2Q7M3N8RSTV5WXY6ZAB", "title": "Zoom-Stufen für Offline-Bundles festlegen",
  "column": "doing", "order": "a0V",
  "notes": [ "projects/Atlas Rendering Spec.md" ],
  "created": "2026-09-01T07:12:03.010Z", "updated": "2026-09-05T08:41:12.345Z" }
```

Rules: pretty-printed, sorted keys, trailing newline, atomic writes with the read-time precondition (§5.3 step 5), temp name never `.lock` (OneDrive forbids it), unknown keys round-trip untouched (`serde(flatten)`), titles never in filenames, `updated` is bumped **only by user or CLI edits**, never by conflict resolution or re-keying. `deleted` timestamp tombstone (if approved): tombstones older than 30 days are dropped the next time the app or CLI writes that board's card set (no timer, no startup sweep).

### 8.3 Identity and ordering

- Card id = ULID (26 chars Crockford base32, time-sortable, no forbidden characters; the `ulid` crate 3.0).
- Column id = stable slug chosen at creation, display name separate (the old `KanbanColumnDef{id,title}` shape).
- `order` = fractional-index string (rocicorp base-62 scheme, `a0`, `a0V`, `a1`…, ~150 lines ported so agents can hand-write keys); sort by `(order, id)`, which is already deterministic; **only the card the user moves is ever re-keyed**, never another card automatically.
- A card whose column no longer exists is shown in the first column with a marker, never hidden.

### 8.4 Conflicts (Mode 1)

- Different cards edited offline → no conflict by construction.
- Same card → the sync client leaves a sibling copy; detect generically (any file in `cards/` whose parsed `id` equals an existing card). Siblings with identical bytes are deleted (trash) without a `conflicts/` entry. Otherwise whole-card LWW on `updated` (ms); tie → bytewise-lexicographically larger content wins; **the winner's bytes are written verbatim** (no re-serialization, `updated` untouched, so every device converges on identical bytes and no resolve→conflict loop starts); the loser moves to `conflicts/<id>-<updated>.json` with `RENAME_EXCL`; one-line notice *„Board Atlas: 1 Karte hatte widersprüchliche Änderungen, die neuere wurde behalten (14:02); ältere Kopie unter conflicts/"*.
- `board.json` conflict → same rule; columns present in either version are unioned so no card is orphaned.

### 8.5 Configurable = board name + column list (add/rename/reorder/delete). Everything else: §4.4.

---

## 9. CLI specification

### 9.1 Principles

Headless binary on the core crate (no IPC to the app, no daemon). Vault = source of truth; the cache is rebuildable. Never prompts. `--json` explicit, automatic when stdout is not a TTY (`--plain` forces text); bare JSON on stdout, JSON error object on stderr; deterministic sort orders; `--dry-run` on every mutation returns the exact success shape plus `"dryRun": true` and `changes:[{path,line,before,after}]` for multi-file operations, and exits with the code the real run would (`migrate` alone is dry-run by default and needs `--apply`); idempotent creates (`--exist-ok` → `existing: true`); every write carries its read-time precondition, `--if-match <sha256>` adds the agent's own; list commands return `{items:[…], truncated:bool, total?}`; contracts immutable after 1.0 (add, never rename). Index-backed reads run the incremental scan first unless the app's `watcher_alive_at` heartbeat is younger than 10 s (`index --status` reports `indexSource: "app" | "scan"`); `--no-index` skips the scan on reads and is rejected (exit 2) on mutations. English only.

Vault discovery: `--vault <dir>`, else `$NOVALIS_VAULT`, else walk up from cwd for `.novalis/vault.json`, else exit 7. Note addressing: vault-relative path, or stem (case-insensitive; ambiguity → exit 4 with candidates). Every listed note carries `path`, `stem`, `title` (frontmatter → H1 → stem) and `linkTarget`.

### 9.2 Commands

| Command | Key flags | Output | Effect |
|---|---|---|---|
| `ls [folder]` | `--tree`, `--tag T`, `--sort`, `--limit`, `--fields` | `{items:[{path,stem,title,linkTarget,folder,tags,modified,size,sha256\|null,cloudOnly}],truncated}` | read; `sha256` from the cache, NULL for cloud-only |
| `cat <note>…` | `--body`, `--frontmatter`, `--lines A:B`, `--materialize [--timeout 30s]` | text, or `{items:[{path,title,linkTarget,frontmatter,body,sha256,links:[{target,form,line,resolvedPath}]}]}` | read; cloud-only → exit 8 unless `--materialize` |
| `new <path>` | `--tag T…`, `--content <text\|->`, `--exist-ok` | `{path,stem,linkTarget,existing}` | create; title = stem; `--tag` writes a `tags:` key; exit 4 if exists |
| `edit <note>` | one of `--append`, `--prepend`, `--replace-section "## H"`, `--insert-after-section "## H"`, `--find/--replace [--regex] [--expect N=1]`, `--set-body -`; `--if-match`; `--nth N` for duplicate headings | `{path,sha256Before,sha256After,changed}` (+`diff`) | atomic write; frontmatter untouched; a section runs from its heading to the line before the next heading of the same or higher level; `--prepend`/`--insert-after-section` insert after the frontmatter block; duplicate heading → exit 4 with candidates |
| `meta <note>` | `--set k=v`, `--unset k`, `--add-tag`, `--rm-tag`; `--if-match` | `{path,frontmatter,sha256After}` | line-level YAML text edit of named keys, strict parse first, unknown keys preserved (D22) |
| `mv <from> <to>` | `--no-relink`, `--force`, `--materialize` | `{from,to,relinked:[{path,count}],cardsUpdated:[{board,id}],conflicts:[path],cloudOnlySkipped:[path]}` | `RENAME_EXCL` rename, then relink of all forms; exit 5 if `cloudOnlySkipped` or (`--no-relink` with backlinks) without `--force` |
| `rm <note>` | `--force`, `--materialize` | `{path,danglingBacklinks:[path],cloudOnly}` | macOS Trash (`NsFileManager`); exit 5 if `danglingBacklinks` non-empty without `--force`; cloud-only → materialize or exit 8 |
| `search <query>` | `--tag`, `--folder`, `--limit 50`, `--snippets` | `{items:[{path,line,snippet}],truncated,cloudOnlySkipped:N}` | on-demand scan |
| `links <note>` / `links --unresolved` / `links --orphans` | `--backlinks`, `--outgoing` | `{outgoing:[{target,form,line,resolvedPath}],backlinks:[{path,line}],cards:[{board,id,title,column}]}` / `{items:[{target,form,sources:[{path,line}]}]}` / `{items:[path]}` | cache |
| `tags` | `--limit` | `{items:[{tag,count}]}` | cache |
| `relink <from> <to>` | `--force`, `--materialize` | `{rewritten:[{path,count}],cardsUpdated,conflicts,cloudOnlySkipped}` | `<from>` is a **literal link target string** (wikilink text or Markdown path, case-insensitive, percent-decoded, not required to resolve); `<to>` must resolve; rewrites `[[from]]`, `[[from\|l]]`, `[[from#h]]`, `[text](from)` and card `notes[]` |
| `board ls` / `board show <b>` / `board columns <b> --set <json>` | | boards, columns, cards | boards store |
| `card ls [--board B] [--note <note>] [--column C]` | | `{items:[{board,id,title,column,order,notes,updated}]}` | answers "which cards link to X" |
| `card add <b> --title T [--column C] [--note <note>]…` | `--after ID \| --first \| --last` (default last) | `{card}` | `--column` = id, or name when unambiguous (else exit 4); default column = first |
| `card mv <id> [--column C] [--after ID \| --first \| --last]` · `card set <id> [--title T] [--add-note N] [--rm-note N]` · `card rm <id>` | `--if-updated <rfc3339>` | `{card}` | one file per change; `rm` writes the tombstone if approved, else deletes |
| `index --rebuild` / `--status` | | `{cachePath,files,stale,indexSource,appVersion,cliVersion}` | cache |
| `sync status` | | `{vaultKind:"fileProvider"\|"mirrored"\|"local",cloudOnly:[path],conflictCopies:[path]}` | Mode 1 read-only |
| `doctor` | | `{ok,checks:[{id,status,detail}]}` | vault marker, cache opens, app/CLI version skew, frontmatter parse failures, unresolved links, duplicate stems, unlinkable stems (`#`/`\|`), notes under board folders, conflict copies, cloud-only notes with unindexed links, legacy `@due/@status` count |
| `migrate` | `--dry-run` (default), `--apply`, `--rename-to-title`, `--import-columns`, `--import-status` (needs yes), `--materialize` | `{renames:[{from,to,reason}],linksRewritten:[{path,count}],unlinkable:[…],columns,legacyTokens,cloudOnlySkipped}` | §10 |
| `init <dir>` · `help --json` · `skill --path` | | | `init` writes `.novalis/vault.json` (idempotent) |

Exit codes: 0 ok · 1 internal · 2 usage · 3 not found · 4 conflict (exists / ambiguous / precondition or `--if-match` mismatch) · 5 needs `--force` (dangling backlinks on `rm`, `mv --no-relink` with backlinks, cloud-only skips on `mv`/`relink`/`migrate`) · 6 cache busy, only on cache mutations (`index --rebuild`, the scan's write step); a busy cache during a read serves the existing cache with a stderr warning `{"warning":{"code":"stale_index"}}` · 7 no vault · 8 cloud-only (hint: `--materialize`). Error shape: `{"error":{"code","message","path","hint","candidates"}}`.

### 9.3 Concurrency with the app

Cache in app-data with WAL + 5 s busy timeout, schema version in the file name; CLI writes through the same atomic path with read-time preconditions; the app's watcher picks them up as external changes (clean buffers reload, dirty ones get the banner or, for a pure link rewrite, the rewrite applied in place). `--if-match` closes the gap for `edit`/`meta`; multi-file rewrites report `conflicts`, and the skill requires `links --unresolved` after every `mv`/`relink`.

### 9.4 Distribution

`novalis` ships inside the app bundle at `Contents/MacOS/novalis`; the "Install command-line tool" menu item (§4.4) symlinks it to `/usr/local/bin/novalis`; the personal tap's cask carries a `binary` stanza; releases also publish `novalis-cli-<ver>-arm64.tar.gz`. `doctor` warns on app/CLI version skew.

### 9.5 MCP (v2, needs yes)

`novalis mcp` stdio in the same binary (`rmcp` 3.2, `transport-io`), ten tools wrapping the same `ops` handlers, `outputSchema` via `schemars`, annotations `readOnlyHint`/`destructiveHint`/`idempotentHint`.

### 9.6 Agent skill

`packages/agent-skill/novalis/SKILL.md` (~120 lines, portable Agent-Skills fields only: `name`, `description`, `license`, `allowed-tools: Bash(novalis *)`). Invariants: plain files are truth; link text is the file stem, `[[folder/stem]]` when `doctor` reports duplicate stems, use `linkTarget` from `ls`; always `--json` (`cat` is JSON when piped, `--plain` for raw text); never touch the cache; re-read `sha256` after every `meta`/`edit` before the next `--if-match`; check `cloudOnlySkipped` and run `links --unresolved` after every `mv`/`relink`; never pass `--no-index` to mutations. The standard loop (`doctor` → `ls`/`search` → `cat` → plan → `--dry-run` → apply → `links --unresolved`), a one-line-per-command cheat sheet, exit codes; details in `reference.md` and `examples.md` (merge two notes, build a MOC, retag a folder, dedupe, repair links, move a card when a note ships). `novalis skill --path` prints the location; nothing is auto-installed.

---

## 10. Migration from the old Novalis

Every existing vault was written by the old app: all demo notes carry `title/created/modified` frontmatter, 40 of 63 have a stem that differs from the title, 6 titles contain `:` (OneDrive-forbidden, shown as `/` by Finder) and 16 of the 228 wikilinks point at them, `.novalis/config.json` (`prefsVersion: 1`) holds five Kanban columns plus 32 feature flags, and 63 `@due(` and 67 `@status(` tokens live in bodies.

- **Identifier:** new bundle id and keychain service; the old app keeps working side by side; old app-data is never touched.
- **`novalis migrate`** (CLI; the app's first-open prompt is read-only and says „Führe `novalis migrate --dry-run` aus" plus „Beende die alte App auf allen Geräten und warte, bis die Synchronisierung ruht"):
  1. computes the full rename plan against the **final** state (NFC, casefold, sanitization map published as a table, e.g. `:` → ` –`, `/` → `-`, `#` and `|` reported as unlinkable); rejects the whole plan if any two targets collide or a target equals a non-renamed file; `--apply` is all-or-nothing per the dry-run output; every rename uses `RENAME_EXCL`;
  2. for every note whose new stem ≠ title (sanitized or suffixed), runs `relink(<old title>, <new path>)` across notes and cards in the same operation and reports `linksRewritten` (16 in the demo vault); reports links that resolved only through aliases in the old app;
  3. counts cloud-only notes first and requires `--materialize` (or reports `cloudOnlySkipped`, exit 5);
  4. writes `.novalis/vault.json` with a `migrated` timestamp so a second device does not repeat the renames after sync;
  5. imports `taskView.kanbanColumns` into `boards/kanban/board.json` with `--import-columns`; counts legacy tokens; optional `--import-status` creates cards from `@status` tasks (needs yes).
  A golden test on the demo vault asserts `links --unresolved` is empty after `migrate --apply`.
- **Frontmatter:** never rewritten by migration; stale `modified:` values stay as they are.
- **`.novalis/`:** legacy `config.json` read leniently once; unknown keys ignored; `trash/`, `plugins/`, `state.json` ignored.
- **Release note** (de/en) for legacy users: what changed, that `legacy` branch and releases ≤ v0.2.1-rc2 are unsupported, how to run `migrate --dry-run`.

---

## 11. Quality, release, governance

### 11.1 Tests

- Core: unit tests with `fixtures/demo-vault` + generated fixtures (umlaut/NFD names, case twins, conflict-copy names for OneDrive/Drive/Dropbox, notes under `boards/`, cloud-only stand-ins, 10k/50k notes with some 2 MB files); the Rule-13 corpus (byte-identical save cycles, crash between temp and rename, dirty buffer + external change + SIGKILL → conflict copy, watcher burst → 1 batch, search a fixture with a dataless file then open it on the same runtime → succeeds).
- CLI: golden tests `tests/cli/<case>/{args, stdout.golden, stderr.golden}` against the demo vault, `--json` compared after `jq -S`, `UPDATE_GOLDEN=1` regenerates.
- UI: exactly one accessibility-driven smoke test (xa11y, as in the old `e2e/`): open fixture vault, create note, type, assert file on disk within 2 s, quit; runs on tags and `e2e`-labelled PRs.
- Manual: `docs/FILE-PROVIDER-CHECKLIST.md` executed on the real OneDrive and Google Drive (Stream and Mirror) folders before each release.

### 11.2 CI (`ci.yml`, jobs `check (macos-latest)`, `check (ubuntu-latest)`, `audit`)

fmt, clippy `-D warnings --locked`, `cargo test --locked`, eslint, `i18next-cli extract --ci` + `status`, catalog parity test, `check-versions.mjs`, bindings drift (`tauri-specta` export + `git diff --exit-code`), `bundle-budget.mjs` (parses `dist/index.html` modulepreloads against `docs/BUDGET.json`), settings-parity test, keymap-parity test (`docs/KEYMAP.md`), `lockfile-adr-check.mjs` (a new top-level `Cargo.lock`/`pnpm-lock.yaml` entry requires `ADR-NNNN` in the PR body), `cargo deny`, `cargo audit`, `pnpm audit --audit-level=high`. `perf.yml` on `main` and tags only (§11.3). `release.yml` on `v*` tags: gate = `ci.yml` via `workflow_call`, `tauri-action` v1 build, sign + notarize when secrets exist, draft release, build-provenance attestation, `SHA256SUMS`, CLI tarball.

### 11.3 Performance budgets (CI thresholds at 2× for runner noise; real numbers kept as an artifact)

| Metric | Budget |
|---|---|
| Window visible (first paint) after launch | ≤ 300 ms, **provisional**: measured so far is 166–231 ms to the `setup()` callback with a hidden window; Spike C measures first paint with `--exit-after-first-frame` and re-sets this row |
| Tree interactive, 10k-note vault, warm disk | ≤ 500 ms, independent of the cache |
| Idle RSS after opening the demo vault | ≤ 200 MB summed processes; the per-process split is an output of Spike C |
| Eager JS | ≤ 250 KB gzip, no single eager chunk > 120 KB; eager CSS ≤ 20 KB; fonts ≤ 250 KB |
| IPC at boot | ≤ 3 calls before the tree paints; 1 per open; 1 per save |
| Open note | 100 KB ≤ 16 ms p95; 1 MB ≤ 60 ms; 5 MB plain mode ≤ 500 ms; 50 MB plain mode ≤ 2 s and summed RSS stays under the 200 MB row (a 50 MB file is ~100 MB as a UTF-16 JS string) |
| Keystroke → paint | ≤ 8 ms p50 / 16 ms p95 in a 1 MB Markdown document with decorations on |
| Save | 1 fsync'd write, 0 re-reads, 0 cache work on the calling path |
| Incremental scan | 10k notes ≤ 1.5 s (stat all, read only changed) |
| Search | 10k notes / 100 MB ≤ 300 ms p95 to first results (decides FTS5 later) |
| Watcher | 1,000-file burst → ≤ 1 tree update, ≤ 100 ms UI-thread work |
| Binary / DMG / crates | ≤ 12 MB DMG; `Cargo.lock` ≤ scaffold + 150 (D26) |

Measured with a hidden `--exit-after-first-frame` flag + `hyperfine`, `/usr/bin/time -l` for RSS, in-app `NOVALIS_PERF=1` keydown → double-rAF deltas (Spike C uses a standalone harness page with the same measurement before the app exists), timed core tests.

### 11.4 Release, signing, versioning

SemVer, annotated tags `vX.Y.Z`, `-rc.N` pre-releases (hyphen ⇒ prerelease flag), first tag `v2.0.0-alpha.1`. One `VERSION` file, `just bump` propagates to the three stamps, `check-versions.mjs` guards. Signing: **unsigned for the coming year by owner decision (2026-09-05)**; the DMG is ad-hoc signed by the Tauri bundler, the release notes carry the right-click-open / `xattr -d com.apple.quarantine` instructions as the old releases did. `release.yml` keeps the signing and notarization steps behind the documented secrets (`APPLE_SIGNING_IDENTITY`, `APPLE_API_ISSUER/KEY/KEY_PATH`, `APPLE_CERTIFICATE/_PASSWORD`, `KEYCHAIN_PASSWORD`) so enabling them later is a secrets change, not a pipeline change. No updater; update path = GitHub Releases, optionally a personal tap `grundhofer/homebrew-novalis` carrying the unsigned cask (the main cask tap rejects un-notarized artefacts and applies notability criteria this repo does not meet, verified). Privacy: `docs/PRIVACY.md` keeps the old promise: no telemetry, no analytics, no crash reporting, no update check; the outbound-connection table is empty in Mode 1.

### 11.5 Minimalism gate

- `docs/decisions/NNNN-*.md` in the old ADR voice (`# NNNN — Title`, Status/Date/Decider, Context ≤ 5 sentences, Decision, Rejected alternatives table, Consequences, **Owner approval: date + verbatim yes**, Sources). ADR-0001 licensing copied verbatim; ADR-0002 no update check; ADR-0003 identifier; ADR-0004 settings allow-list; ADR-0005 wikilink resolution and migration; ADR-0006 Kanban store; ADR-0007 design direction; ADR-0008 v1 keymap; ADR-0009 build order (D24).
- PR template checklist: no new setting / feature / menu item / shortcut / dependency / outbound call without an ADR number and quoted yes; every user-visible string in both catalogs; no hard-coded colours/fonts/radii; budgets unchanged or re-measured; `just check` green.
- CI parity: `docs/SETTINGS.md` ↔ `Settings` struct; `docs/KEYMAP.md` ↔ keymap table; lockfile additions ↔ ADR reference; `docs/PRIVACY.md` ↔ `reqwest` usage grep.

### 11.6 Third-party notices and licences

MIT notice for any CSS or tokens lifted from designSprache `styles/*.html`; CC BY 4.0 attribution for fact-sheet prose quoted in docs or mockups; OFL texts shipped for bundled fonts; `cargo deny` + a JS licence check in CI; `THIRD-PARTY-NOTICES.md` generated, not hand-maintained. AGPL section 6 corresponding source = the git archive + lockfiles (no `cargo vendor` tarball once libgit2 is gone).

### 11.7 `CLAUDE.md` (≤ 150 lines)

Purpose in three sentences and the minimalism rule; directory map; the only commands (`just setup|dev|check|test|test-cli|app`), never ad-hoc `cargo`/`pnpm` for gating; where things live (strings → `i18n/`, colours → tokens, settings → `docs/SETTINGS.md` + struct, keys → `docs/KEYMAP.md`, decisions → `docs/decisions/`); generated files and their regen commands, never hand-edited; local limitations (CLT default, `DEVELOPER_DIR` opt-in, no Developer ID yet, `just` via brew); privacy rule; what not to do (settings, dependencies, touching `legacy`); no attribution trailers in commits.

---

## 12. Roadmap

Estimates are for one developer with coding agents; **ASSUMED** and re-planned after week 2. Phases overlap only where one track is agent-driven (mockups, fixtures, golden tests).

### Phase 0 — Scaffold and spikes (week 1)

1. **Owner actions on day 1:** install Google Drive for desktop, sign in, choose Stream mode (Mirror tested second), let it settle. (§4 is answered; Apple enrolment is off the table for the year.)
2. Scaffold **locally** in this directory: `justfile`, workspace, `CLAUDE.md`, `PLAN.md`, ADR-0001…0009 drafted from your §4 answers, `docs/SETTINGS.md`, `docs/KEYMAP.md`, `docs/PRIVACY.md`, `.gitignore` (`.claude/`, `docs/plans/`), **`ci.yml` with the final job names**, `fixtures/demo-vault`, fixture generator; `brew install just`; measure the scaffold's `Cargo.lock` size for D26.
3. **Spike A — File Provider on `~/Library/CloudStorage/OneDrive-Persönlich`** (1.5 days; second-client edits first so sync latency overlaps the rest): temp+rename, xattrs, conflict-copy naming via the web UI, an `ä`/NFD-named note round trip, a case-only rename, a same-card edit on two clients under `boards/test/cards/`, `trash` of a normal and a dataless note including Put Back and the Finder-method Automation prompt, FSEvents delivery. Output: `docs/FILE-PROVIDER-CHECKLIST.md` with results.
4. **Spike B — WKWebView spellcheck underline** on macOS 26 (1 day).
5. **Cut-over (§13) at the end of the week**, once `just check` is green on the scaffold: dry run on a scratch repo configured with the same two rules and no bypass (it must reproduce the refusal), then the real run.

Exit: `just check` green; spikes written up; `main` on GitHub is the scaffold and every further change is a PR gated by the two runner jobs.

### Phase 1 — UI/UX variants (weeks 1–2, agent track)

11 mockup frames (§6.3) with the catalog's prompt export per style; your decisions in §4.6 recorded in ADR-0007. `tokens.css` is written after Spike C.

### Phase 2 — Stack spike and core with the CLI harness (weeks 2–5)

1. **Spike C — Tauri + CM6 typing latency and large files** (days 8–12): Tauri 2.11 shell, CM6 with `lang-markdown` **plus the two custom inline parsers and a decoration plugin for headings/emphasis/links**, a generated 10k-note vault, a 1 MB Markdown file (typing measured keydown → double-rAF, N ≥ 200 keystrokes, p50/p95), a 5 MB and a 50 MB file opened via `ipc::Response` raw bytes (time to editable, summed RSS), first paint via `--exit-after-first-frame`. **Trigger table:** keystroke p95 > 24 ms, or 50 MB plain mode > 2 s, or summed RSS > 200 MB with the 50 MB file open → evaluate the gpui fallback (§14 row 1) for two days before deciding; p95 16–24 ms → one more day of optimization, not fallback. Outputs: the §11.3 startup and RSS rows re-set; the per-process RSS split.
2. **Spike D — Google Drive for desktop** (day 11, its own day): Stream mode first (dataless path, `~/Library/CloudStorage/GoogleDrive-…`), Mirror mode second (plain folder), both with the web UI as second client: dot-folder policy, conflict-copy naming, temp+rename, `boards/` behaviour, NFD names; record the mode in the checklist.
3. Core crate modules (§5.2) with tests and the Rule-13 corpus; cache actor with heartbeat; search scan benchmark (decides FTS5).
4. **CLI harness subset** on the core with golden tests: `ls cat new edit mv rm search links tags index init doctor`.

Exit (week 5): the harness subset passes golden tests against the demo vault and generated fixtures; benchmarks recorded; stack go/no-go decided.

### Phase 3 — Desktop app (weeks 5–9)

Shell + `bootstrap`; tree (virtualized, cloud badges); tabs; editor with decorations, multi-cursor, find/replace, grammars, large-file mode; quick-open; palette; vault search panel; external-change banner and conflict-copy flow; **week-7 checkpoint: editor + tree + tabs daily-driveable on your own vault before Kanban starts**; Kanban pane with drag and drop, column editing, note linking (card click opens a tab); approved §4.4 items (tags filter, backlinks, completion); settings (4 keys via menus/shortcuts) and native menus from `i18n/`; de/en catalogs complete; migration prompt (read-only).

Exit (week 9): daily-driveable on your own vault in OneDrive; smoke test green; budgets met on the 10k fixture.

### Phase 4 — Remaining CLI, hardening, first release (weeks 9–11)

`board`, `card`, `relink`, `meta`, `migrate`, `sync status`, `help --json`, `skill --path` with golden tests and `SKILL.md`; File Provider checklist on both providers and both Drive modes; watcher burst and crash tests; bundle budget CI; perf job; unsigned release path with the right-click-open note; `RELEASING.md`; release notes de/en; `v2.0.0-alpha.1` draft → publish; README banner on `main` pointing legacy users to `legacy`; repo description and topics updated.

### Phase 5 — After v1 (each needs a yes)

Read-only preview (`Cmd-E`); board + note split; MCP server; hide-syntax live preview mode; Mode 2 sync (OneDrive first, §5.7); universal binary; Windows/Linux builds; image paste with an attachments policy.

### First two weeks, day by day

| Day | Work |
|---|---|
| 1 | Owner: install Drive (Stream). Agent: local scaffold begins; scratch-repo dry run of the cut-over (with the ruleset rules replicated) |
| 2 | `brew install just`; `justfile`, `ci.yml` (final job names), ADR-0001…0009 drafts, `CLAUDE.md`, fixtures vendored; scaffold `Cargo.lock` measured |
| 3–4 | Spike A on OneDrive (1.5 days); mockups start (Swiss S1/S2) in parallel |
| 4 | Spike B (spellcheck, 1 day) |
| 5 | Mockups: Editorial-Print, Dev-Noir; fixture generator; `just check` green → **real cut-over (§13)** |
| 6–7 | Mockups: Warm Editorial, L1/L3/L5 alternates, comparison page, prompt exports → your design decision |
| 8–12 | Spike C (Tauri + CM6 with decorations, latency, 50 MB, first paint); go/no-go on day 12 |
| 11 | Spike D (Google Drive, both modes) |
| 13–14 | Core: `vault::fs`, `vault::cloud`, `write_atomic` + precondition + conflict-copy path, watcher batches, Rule-13 corpus start |

---

## 13. Git cut-over procedure

> **Revised 2026-09-05 — superseded by [`docs/cutover.sh`](docs/cutover.sh).**
> The sequence below is kept as the record of what was planned. Two of its
> assumptions did not survive contact with the live repository, and the fix
> removes the bypass actor entirely:
>
> 1. **Step 0 assumed PR #94's four required checks could pass.** They cannot.
>    `dependency audit` fails on RUSTSEC-2026-0258 (`h2`, unbounded empty DATA
>    frames), an advisory published after that branch was last built, plus 20
>    allowed unmaintained-crate warnings. Merging it on GitHub would have needed
>    an admin override. The script merges it locally into `legacy` instead, with
>    the reason in the merge commit.
> 2. **Steps 1b and 5 opened a ~10-minute window with protection lowered.**
>    Unnecessary. Ruleset 20518201 is scoped to `~DEFAULT_BRANCH`, not to the
>    literal name `main`, so moving the default branch to `legacy` carries the
>    protection with it and leaves the old `main` unprotected. The orphan is then
>    force-pushed onto `main` rather than `main` being renamed, which is what
>    required the bypass. No bypass actor is ever created.
> 3. **Step 6's `--notes-file` would have replaced each release's body.** The
>    original notes are part of what the AGPL's corresponding-source obligation
>    hangs off, and they are the only changelog those binaries have. The script
>    prepends a legacy banner and keeps the existing notes below a rule.
>
> The revised order is: freeze `legacy` (old main + PR #94) and tag it → close
> the 5 open PRs → default branch to `legacy` → force-push the orphan to `main`
> → wait for CI → default branch back to `main` → one ruleset `PUT` for the new
> job names → relabel releases → prune 12 branches → repoint the old checkout.
>
> Already done: ruleset **22348468 "legacy protection"** (`deletion` +
> `non_fast_forward` on `refs/heads/legacy`) was created ahead of the branch, so
> it arms the instant `legacy` is pushed. Ruleset 20518201 is untouched and its
> `bypass_actors` is still `[]`.

Verified: git 2.54 `switch --orphan` (fails if a local branch of that name exists, hence the rename first), `gh repo edit --default-branch`, the GitHub branch-rename API semantics (retargets open PRs, keeps redirects), the ruleset `PUT` endpoint, and GitHub's rule that **renaming or changing a protected default branch requires a bypass actor when force pushes are blocked**. Dry-run the whole sequence on a scratch repository configured with the same two rules and no bypass actor (day 1); it must reproduce the refusal at step 2 without step 1b.

```sh
# 0. preflight — merge PR #94 into main via the GitHub UI (the old CI job names still exist on that branch,
#    so its 4 required checks can pass); close the 4 dependabot PRs; wait for the merge commit
gh pr list -R grundhofer/novalis --state open
git clone git@github.com:grundhofer/novalis.git novalis-cutover && cd novalis-cutover
git ls-remote --tags origin                                   # v0.1.0 v0.2.0 v0.2.1-rc2 expected

# 1a. freeze the old line at the merge commit (tag name deliberately not v*.*.* so release.yml does not fire)
git tag -a legacy-final -m 'Last commit of the original Novalis (Tauri v2 + React/TipTap); superseded by the rewrite' origin/main
git push origin legacy-final

# 1b. temporary bypass so the owner may rename and re-target the default branch (removed again in step 5)
gh api repos/grundhofer/novalis/rulesets/20518201 > ruleset.json
#    add  "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}]   (5 = repository admin)
gh api -X PUT repos/grundhofer/novalis/rulesets/20518201 --input ruleset.json

# 2. rename main -> legacy on GitHub (keeps URLs, retargets PRs, moves default branch + ruleset)
gh api -X POST repos/grundhofer/novalis/branches/main/rename -f new_name=legacy

# 2b. protect legacy immediately: second ruleset on refs/heads/legacy with deletion + non_fast_forward only
gh api -X POST repos/grundhofer/novalis/rulesets --input legacy-ruleset.json

# 3. empty branch (local main renamed first), scaffold WITH ci.yml, push as the new main (non-default now: allowed)
git fetch --prune origin && git branch -m main legacy && git branch -u origin/legacy
git switch --orphan main && git clean -fdx
# … copy the scaffold from /Users/sgrundhoefer/Projects/novalisNeo (CLAUDE.md justfile README.md LICENSE docs/ .github/ …) …
git add -A && git commit -m 'chore: start the novalis rewrite on an empty tree'
git push -u origin main
#    wait for the ci.yml run on main to be green: jobs "check (macos-latest)", "check (ubuntu-latest)", "audit"

# 4. make it the default (ruleset 20518201 follows ~DEFAULT_BRANCH)
gh repo edit grundhofer/novalis --default-branch main

# 5. one PUT: required checks -> the new job names, bypass_actors -> [] again
#    edit ruleset.json: rules[].parameters.required_status_checks[].context = ["check (macos-latest)", "check (ubuntu-latest)", "audit"]
gh api -X PUT repos/grundhofer/novalis/rulesets/20518201 --input ruleset.json

# 6. releases stay (AGPL/GPL corresponding-source obligations attach to shipped binaries): relabel, never delete
gh release edit v0.2.0 -R grundhofer/novalis --title 'Novalis v0.2.0 (legacy — original Tauri/React app)' --notes-file legacy-note.md
gh release edit v0.2.1-rc2 -R grundhofer/novalis --title 'Novalis v0.2.1-rc2 (legacy pre-release)' --prerelease

# 7. prune the 12 stale remote branches (the 4 dependabot branches go with their closed PRs)
git push origin --delete release/v0.2.1-rc1 spike/e2e-xa11y test/math-rendering test/pane-flush-contract test/save-path-guards \
  fix/notion-asset-lookup fix/release-macos-arm64 fix/save-path-data-loss fix/table-cell-blocks investigate/webkitgtk-atspi \
  chore/release-hygiene deps/tiptap-3

# 8. old checkout: keep /Users/sgrundhoefer/Projects/novalis as the legacy working copy
cd /Users/sgrundhoefer/Projects/novalis && git fetch --prune && git branch -m main legacy && git branch -u origin/legacy
#    delete local worktree-agent-*, pr20, pr20fresh, tier4-wave1; keep planC-capture only if quick-capture is wanted
```

Protection stays active for everyone except the owner for the roughly ten minutes between steps 1b and 5. From step 4 on every change to `main` is a PR gated by the two runner jobs. The rewrite's working copy is `/Users/sgrundhoefer/Projects/novalisNeo`, re-pointed at the repo after step 4. Hygiene: no session trailers; `.claude/` and `docs/plans/` ignored; `docs/decisions/` tracked.

---

## 14. Risks and fallbacks

| Risk | Signal | Fallback and its price |
|---|---|---|
| WKWebView cannot meet the Spike C trigger table | Spike C | gpui-pre 0.3 + gpui-component 0.6 (a bare gpui 0.2.2 hello-world measured 62 MB / 105 ms; gpui-pre and gpui-component not measured, editor performance is the vendor's claim). **Survives:** core crate, CLI, ADRs, mockups as pictures. **Discarded:** React shell, i18next + lint, `tokens.css`, woff2 pipeline, bundle-budget CI, Spike B. **Costs:** `DEVELOPER_DIR` becomes the default path, Markdown decorations built from scratch, re-plan 1–2 weeks (ASSUMED). |
| Decorated-source Markdown feels too raw for long writing | Your reaction to the mockups and the week-7 build | Read-only preview first (cheap); hide-syntax live preview as a later mode |
| Temp+rename misbehaves in File Provider folders | Spike A | Write-in-place with a pre-copy (`.bak` then truncate+write+fsync) for File Provider vaults only, decided by the vault-kind check |
| Google Drive skips or renames `boards/` files unexpectedly | Spike D | Single `board.json` with card-level LWW as the Mode-1 store for Drive vaults, or one file per board universally |
| Filename migration rejected by you | §4.5 | Title-based resolution using the cache (deterministic tie-break: most recently modified), documented as slower and ambiguous for agents |
| Unsigned releases scare off users (Gatekeeper warning) | Decided for the coming year | Release notes carry the right-click-open instructions as the old releases did; enabling signing later is a secrets change in `release.yml` |
| ~~Spellcheck underlines stay hidden~~ | Closed by Spike B | Underlines are recoverable with one user-defaults key; v1 ships them (§7.5) |
| Search scan too slow on 10k+ notes | Phase-2 benchmark | FTS5 external-content table owned by the cache actor |
| Solo-developer time | Week-2 re-plan; week-7 checkpoint | Cut §4.4 yes-items (backlinks, completion, tags filter) to v1.1 before cutting MUST items; Phase 4 CLI commands can slip past the alpha |

---

## 15. Appendix

### 15.1 Reuse map (old repo → new)

| Old file | What to lift | How |
|---|---|---|
| `apps/desktop/src-tauri/src/oauth.rs` | PKCE S256, loopback listener, refresh-token preservation, 6 tests | Mode 2 reference |
| `apps/desktop/src-tauri/src/secrets.rs` | keyring wrapper, blank-deletes | Mode 2, keyring 4.2 + `apple-native-keyring-store` |
| `apps/desktop/src-tauri/src/settings.rs` | atomic read-modify-write settings file | lift; 4 settings + `lastVault` + `version` |
| `apps/desktop/src-tauri/src/engine.rs` | poisoned-mutex recovery, `CommandError` kinds | error kinds only; no global engine |
| `apps/desktop/src-tauri/src/watcher.rs` | generation counter, self-write suppression idea | redesign with batches and content hashes |
| `crates/novalis-core/src/vault/fs.rs` | `vault_rel`, `write_atomic`, `is_cloud_placeholder`, case-only rename, ~20 tests | lift + parent fsync + precondition + `RENAME_EXCL` + symlink fix |
| `crates/novalis-core/src/vault/frontmatter.rs` | lenient reader, `extract_title`, tag regexes | reader only; new surgical `edit` |
| `crates/novalis-core/src/models/note.rs` | `NoteSummary` shape | trimmed |
| `crates/novalis-core/src/index/schema.rs` | WAL pragmas, `user_version`, incremental mtime scan, cloud-only re-read rule | 3 tables, schema in file name |
| `crates/novalis-core/src/conflict/mod.rs` | conflict-copy **detection** regexes | detection only; resolution re-implemented (the old code hard-deletes and copies with truncation) |
| `crates/novalis-core/src/sync/manifest.rs` | pure 3-way planner `plan`/`next_base`/`conflict_copy_path` | Mode 2 reference |
| `apps/desktop/src-tauri/src/lib.rs` + `examples/gen_bindings.rs` | tauri-specta builder, bindings drift gate | lift |
| `apps/desktop/frontend/src/ipc/api.ts` | result unwrap wrapper | lift |
| `apps/desktop/frontend/src/locales/__tests__/catalogs.test.ts` | catalog parity test | lift |
| `.github/workflows/ci.yml`, `release.yml`, `deny.toml`, `.cargo/audit.toml`, `.github/dependabot.yml` | gating design, SHA pins, audit config | templates |
| `docs/decisions/0001-licensing.md`, `COMMERCIAL-LICENSE.md`, CONTRIBUTING inbound grant, README privacy table | governance | copy verbatim |
| `e2e/` (xa11y driver) | one smoke test | trimmed |

### 15.2 Measurements this plan relies on (2026-09-05, this Mac, release builds, hidden window, N=3)

| Stack hello-world | Startup | RSS idle | Binary |
|---|---|---|---|
| SwiftUI + AppKit + NSTextView | 98–115 ms to `didFinishLaunching` | 51 → 82 MB | 72 KB |
| gpui 0.2.2 | 105 ms to window open (268 cold) | 57 → 62 MB | 5.3 MB |
| Tauri 2.11.5 static HTML | 166–231 ms to `setup()` (first paint not measured) | 85 → 97 MB main + ≈79 MB WebKit helpers | 6.3 MB; 431 `Cargo.lock` entries |

Old Novalis: 910 crates, 666 npm packages, 40 MB binary, 18.8 MB DMG, 4.7 MB raw / 1.31 MB gzip eager bundle, 158 IPC commands, ≥12 boot round-trips, 34 feature flags, 1,233 i18n keys per locale, 763-line preferences model.

### 15.3 Research and review reports

`docs/research/2026-09-05-{old-codebase,perf-lessons,stack,design,sync,kanban,cli,editor-scope,monorepo,critique}.md` — each with findings marked verified/likely/assumed, recommendations with rejected alternatives, owner decisions and sources. The review of revision 1 (six lenses, 62 findings) is summarized in the plan's D21–D26 and the changes to §4, §5.3, §8.4, §9, §10, §11.3 and §13.
