# Decisions

Index of owner decisions for novalis. Each row becomes an ADR under `docs/decisions/` at scaffold time (ADR-0001…0009 as listed in PLAN.md §11.5). Until then this file is the record.

## Owner answers of 2026-09-05

Verbatim owner statements:

> section 4 please make your recommedations
> i won't start apple developer enrolment for the upcomming year.
> build the mockup frames.

Interpretation recorded: every "Recommended" value in PLAN.md §4.1–§4.5 (revision 2) is adopted as the decision; the Apple Developer Program row is changed to "no enrolment for the coming year"; §4.6 (design) stays open until the mockups have been seen, with Swiss + tabs as the working assumption; the mockups (§6.3) are approved to be built.

### Settings (§4.1) — all four approved

| Key | Decision |
|---|---|
| `language` | yes; follows macOS per-app language, View menu fallback |
| `appearance` | yes; View ▸ Appearance menu items |
| `editor.fontSize` | yes; `Cmd +`/`Cmd -`/`Cmd 0` only |
| `spellcheck` | yes; Edit ▸ Spelling |

No preferences window. `lastVault` is state in `settings.json`; window/tabs/sidebar in `state.json`.

### Hard-coded defaults (§4.2) — accepted as written

### Baseline behaviours (§4.3) — accepted as written

### Features (§4.4)

| Feature | Decision |
|---|---|
| Tags as search filter / palette | yes, v1 |
| Backlinks list (incl. cards linking here) | yes, v1 |
| `[[` and `#` autocompletion | yes, v1 |
| Read-only rendered preview (`Cmd-E`) | yes, v1.1 |
| Hide-syntax live preview | no |
| Split view / board + note split | no (D21) |
| Folding, focus/typewriter, minimap, vim | no |
| Image paste/drop | no (later) |
| Version history | no |
| Multi-vault / recent vaults | no |
| E-paper mode | no |
| Flat 2.0 control mockup row | yes |
| Kanban extra card fields | no |
| Kanban soft-delete tombstones | yes |
| Several boards per vault | yes |
| CLI `relink` public | yes |
| CLI `meta` (line-level edits) | yes |
| CLI `init` (writes `.novalis/vault.json`) | yes |
| CLI `help --json`, `skill --path` | yes |
| CLI `doctor --fix` | no |
| "Install command-line tool" menu item | yes |
| MCP server | no (v2) |
| Localized CLI | no |
| Pseudo-locale `en-XA` (dev only) | yes |
| Pre-commit hooks | no |

### Product and platform (§4.5)

| Question | Decision |
|---|---|
| Sync Mode 2 in v1 | no; v1 = Mode 1; Mode 2 spec ready for v2 |
| Mode 2 scopes (for v2) | Google `drive.file`, OneDrive `Files.ReadWrite.AppFolder` |
| Build order | core + thin CLI harness first, desktop alpha second (D24) |
| Apple Developer Program | **no enrolment for the coming year**; releases unsigned; revisit before the first non-alpha release in 2027 |
| Auto-update | none; GitHub Releases, optional personal tap with unsigned cask |
| Trash method in the app | `NsFileManager` (no prompt) |
| Minimum macOS | 14 |
| Architecture | arm64 only |
| First version tag | `v2.0.0-alpha.1` |
| License | AGPL-3.0-only + COMMERCIAL-LICENSE, ADR-0001 verbatim |
| Wikilink migration | rename files to frontmatter title with automatic relink; dry-run first |
| `@status` cards from old notes | leave as text |
| Merge PR #94 before tagging `legacy-final` | yes |
| Delete the 12 stale remote branches | yes |
| `Cmd-P` | quick-open (no Print in v1) |
| `Cmd-K` | insert/wrap Markdown link |
| Board toggle | `Cmd-Shift-B` |
| Sidebar toggle | `Cmd-\` |
| Kanban placement | pane in the same window |
| Card click | opens the linked note in a tab |
| Preferences window | no |
| Cloud-only files | shown with a cloud badge, downloaded on open |
| Autosave | all file types, 1,000 ms, flush on blur/tab switch/quit |
| Commit message policy | no `Claude-Session:` trailers |

### Design (§4.6) — answered 2026-09-05 after the mockups

> i like two style dev noir first and then as alternative swiss, but what is exactly the difference in layout? I think we need tabs

| Question | Decision |
|---|---|
| Family | grotesk |
| Style | **Dev-Noir** (primary); Swiss kept as the alternative token set |
| Layout | tabs: L2 for notes (sidebar + tab strip), L4 for the board as a pane; L3 is L2 with the sidebar hidden (⌘\); L5 stays post-v1 (D21) |
| Status coding | Dev-Noir rule: one accent + green/amber, always with the word (as shown) |
| Accent hue | teal `#4FB3BF` dark / `#1F7A83` light as shown, pending "keep as shown" |
| Fonts | Inter + Geist Mono (as shown) |
| Window chrome | custom 38 px title bar with breadcrumb + ⌘K badge (Dev-Noir signature), pending "keep as shown" |
| Textures | off |
| Mockup language | German first |

Dark is the primary set; the light ladder is derived and ships too (the catalog requires a maintained light theme for this style).

Implementation go on 2026-09-05 ("go with implementation and use subagents where usefull"): the two pending items (accent hue, custom title bar) stand as shown in the mockups.

## Answered 2026-09-08

> add test runner for missing parts

Recorded as **ADR-0011**: `vitest` + `jsdom` + `@testing-library/react` for the
UI, wired into `just check` and `ci.yml`. `just test` had been reporting success
while running no UI test at all.

### Open after the sync tests (2026-09-08)

Measuring Drive with a second device (the owner's phone) contradicted a design
assumption and surfaced four things that need a decision. None was invented
here; each is a gap between what the plan promises and what the code does.

| Item | Why it is open | Recommendation |
|---|---|---|
| **Drive creates no conflict copy** | PLAN §5.3's whole conflict flow waits for a second file that, on Drive, never appears. An edit made on another device is silently superseded and the app says nothing. Measured, full chain. | Tell the truth in the app rather than pretend: on a vault whose provider is not known to make conflict copies, say so once. Building cross-device change detection means tracking remote revisions, which is Mode 2 work. |
| **Two conflict detectors that disagree** | `novalis_core::vault::cloud` matches four filename patterns; `stores/vault.ts:143` uses its own narrower regex that never matches `Note (1).md`. The count the app shows and the count `doctor` reports differ by construction. | One detector. The UI should ask the core, not re-implement a regex. |
| **The resolve panel does not exist** | PLAN §5.3 promises "click → list with Keep original / Keep copy / Keep both". The five catalog keys (`status.conflicts.*`) are referenced by no code; only a count is rendered. `find_conflict_copies` has exactly one caller, the CLI's `doctor`. | Either build it or drop the promise from the plan. Shipping a count that cannot be acted on is the worse of the three. |
| **Board conflict resolution is unreachable** | `resolve_card_conflicts` and `resolve_board_conflicts` are complete and tested but called by nothing in either binary. Worse, `collect_cards` silently skips any card file whose stem is not a bare ULID, so a vendor sibling is invisible rather than merely unresolved. | Call them, at minimum on board load, and make a skipped card file visible instead of silent. |

## Backlinks placement (2026-09-08)

> deliver backlings, also for cards.

The open question was *where* the list lives, since the approved mockups have no
frame for it. It did not need a new answer: the catalog already specified the
shape before the code existed — `editor.backlinks.title` / `.empty` (whose text
names notes **and** cards) / `.notes` / `.cards` counts, and a
`palette.cmd.showBacklinks` / `hideBacklinks` pair rather than the single
"Toggle" label the sidebar and board use.

So: a pane under the editor, toggled from the command palette with a label that
follows its state, hidden while the board is open (a note's backlinks are
meaningless there), and persisted in `state.json` like the sidebar. No new
string, no new shortcut, no new menu item.

Also corrected here: §4.4 approved "backlinks list (incl. cards linking here)"
and the first cut returned notes only. Cards now come from the board files
rather than the cache, so that half is correct even during the first scan.

## Open items after the week-1 scaffold (2026-09-05)

These came out of the build and need your yes before they are closed:

| Item | Why it is open | Recommendation |
|---|---|---|
| The dependency set (`schemars`, `tauri-specta`, `notify-debouncer-full`, React, CodeMirror, …) | §11.5 wants an ADR reference for every new top-level dependency; the scaffold added them all at once under D1/§5.1 rather than one ADR each | One ADR-0011 "v1 dependency set" listing them, so later additions are visible against it |
| `schemars` major | Three majors are in `Cargo.lock` (0.8 via Tauri's build deps, 0.9 via tauri-specta, 1.2 for the CLI's `JsonSchema` bound) | Pin the CLI to 0.9 to match tauri-specta, or accept three and say so in ADR-0011 |
| CLI golden test location | PLAN §11.1 says `tests/cli/<case>/`, the build used `tests/golden/<case>/` and the integrator renamed it to `tests/cli/` | Keep `tests/cli/` and leave §11.1 as written |
| `edit --replace-section` semantics | §9.2 read literally would delete the heading too; the CLI keeps the heading and replaces the body, because otherwise the operation is not repeatable | Keep the implemented behaviour and reword §9.2 before 1.0 |
| "Install Command-Line Tool" menu item (§4.4, approved) | The app binary is already `Contents/MacOS/novalis-desktop`; the CLI needs a name and a place in the bundle before the menu item can do anything | Ship the CLI as a sidecar named `novalis` and symlink that |
| `docs/KEYMAP.md` scope of `Shift+Cmd+N` | Documented as `global`, PLAN §7.4 groups it under "Tree" | Keep `global`; it is what the parity test enforces |
