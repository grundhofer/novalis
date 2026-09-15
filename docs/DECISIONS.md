# Decisions

Index of owner decisions for novalis. Each row of the 2026-09-05 answers became an ADR under `docs/decisions/` at scaffold time (ADR-0001…0009 as listed in PLAN.md §11.5); the answers since are recorded below by date, and each that adds a feature, a field or a dependency has its own ADR (ADR-0010…0016). This file is the record.

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
| Kanban extra card fields | no, except description (ADR-0013, 2026-09-14) |
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

## Answered 2026-09-13

The §8.4 card-conflict resolution first landed on the PR #107 branch as a
write on every board read, with its error swallowed and the notice stamped
with the render time. The proposal to separate detection (on read) from resolution (once),
report the error and drop the time was accepted on 2026-09-10:

> folge deinen vorschlägen

Building it moved the moment from "vault open" to "first read of each board
after the vault was opened", because §2.3 rule 12 rules out a sweep over every
board before the tree is interactive. Asked on 2026-09-13, with the alternatives
"beim Öffnen des Vaults, alle Boards" and "beim nächsten Schreiben (wie
Tombstone-Purge)" on the table:

> Erstes Lesen pro Board

The notice is kept in the UI until dismissed, with the existing `banner.dismiss`
string — a control the plan did not name:

> Ja, Schließen-Knopf

The `({{time}})` fragment is gone from `board.conflictNotice`, since one time
is undefined for several cards; the example sentence in §8.4 says the same now:

> PLAN.md-Beispiel angleichen

Recorded in `docs/SYNC-REALITY.md` and PLAN.md §8.4. No ADR: no new
dependency, setting, menu item or shortcut.

## Answered 2026-09-14

The owner opened the app on 2026-09-14 and wrote:

> aktuell kann ich keine neuen markdown files oder andere unterstützte formate
> erstellen. diese funktion sollte bestehen. es sollte links auch eine sektion
> gebeb um schnelle tägliche notizen anzuzeigen.
> Den kanban mode sehe ich auch nicht.
> es sollte ein icon um die settings zu öffnen.
> außerdem benötigen wir ein sortiericon für die notizen, die ordner immer
> alphabetisch anzeigen.
> ich möchte auf dem kanban mode auch die karte etwas befüllen können.
> bitte lass uns eine einfache aber gute verbesserung links in der steuerung
> vornehmen ohne probleme zu verursachen.
> in den settings denke ich darüber nach ob wir nicht auch einen zusätzlichen
> sync in ein bucket von cloudflare zum cross device sync anbieten sollten. als
> alternative zu den anderen. das würde eine mobile und eine webapp ermöglichen.

Four questions were put to them the same day, each with the smallest form
recommended. Asked "Welche Steuerelemente sollen in die Sidebar?" (several
answers allowed):

> Neue Notiz / Neuer Ordner (Recommended), Board-Knopf (Recommended),
> Sortierung über die Spaltenköpfe (Recommended)

The fourth option, "Einstellungen-Knopf", was not selected. Its description had
said the four settings reach the palette (`Shift+Cmd+P`) either way, so they
gain palette entries and no button; no preferences window, `Cmd+,` stays
unbound. Asked "Tagesnotizen: welche Form?", with the file fixed as
`journal/JJJJ-MM-TT.md`, created empty, no template:

> Eine Zeile Heute oben im Baum (Recommended)

Asked "Karteninhalt auf dem Board":

> Feld description (Recommended)

Asked "Andere Dateiformate anlegen":

> Dialog Neue Notiz erkennt §7.3-Endungen (Recommended)

Recorded as **ADR-0012** (sidebar controls: the New Note / New Folder / board
buttons, the legend as the sort control with `treeSort` as state, the Today's
Note row and palette command, the settings in the palette), **ADR-0013** (the
optional card `description`, amending ADR-0006) and **ADR-0014** (the New Note
dialog keeps a typed §7.3 extension). The "Kanban extra card fields" row above
is changed accordingly; PLAN.md §2.2, §4.2, §4.4, §5.3, §7.3, §8.2 and §9.2,
`docs/SETTINGS.md` and `docs/KEYMAP.md` prose carry the details. Three things
fixed on the way — board folders drawn as root-level tree rows with their
display name as the L2/L4 frames show, opening a note hiding the board pane,
the title-bar drag permission — are recorded in ADR-0012 as fidelity and
defects, not decisions.

## Answered 2026-09-15

Testing the sidebar branch, the owner wrote:

> wir sollten hier unterstützte dateitypen anzeigen

> macht es sinn beim lesen der dateien pdf zu unterstützen? bitte einfach
> möchlich machen. gerne auch epub etc. alles was sinnvoll zum lesen ist.

> bitte in der seitenleiste ganz links nur unterstützte dateitypen anzeigen
> lassen. keine wav, mp4 etc

Asked which read-only types (PDF recommended; EPUB priced as a new dependency
and its own reader):

> "Bilder (png, jpg, gif, webp, svg)", PDF (Recommended)

Recorded as **ADR-0015**: a read-only viewer for PDF and images (tier D in
PLAN.md §7.3; `svg` stays editable XML), one new IPC command `read_blob` (23 of
25) with `base64` as a direct dependency of the desktop crate (no new lockfile
entry), the tree lists only the types of §7.3, and the New Note dialog shows
the ADR-0014 extension rule. EPUB was not selected and is not built.

Later the same day, of the WebView's PDF view:

> die icons funktionieren nicht alle. welche alternative zur darstellung von
> pdf hben wir oder können wir auch steuerungsbutton in novalis einbauen?
> ganze seite, nächste seie etc zoom etc.

> können wir etwas nehmen, das auch cross platform verfügbar ist? was für neue
> buch dokument formate können wir einfach unterstützen?
> hast du dich bei der technologie wahl an cross platfform oder maximaler
> performance orientiert

Asked "PDF-Anzeige: pdf.js mit eigener Novalis-Leiste … oder WebKit-Ansicht
behalten":

> pdf.js mit eigener Leiste (Recommended)

Recorded as **ADR-0016** (`pdfjs-dist`, the first runtime npm package since
the scaffold; the app's own page/zoom bar; text selectable). Asked which
reading formats to plan next, each with its own ADR when built:

> EPUB (Recommended), Markdown-Lesemodus ⌘E (Recommended), DOCX (nur lesen), CBZ

All four are approved and not yet built; the order proposed is EPUB, the
Markdown preview (already a v1.1 yes, PLAN.md §4.4), DOCX, CBZ.

Still testing, the owner reversed the one option they had left out on
2026-09-14:

> bitte noch settings button icon ermöglichen

Recorded as an amendment to **ADR-0012**: a button in the sidebar foot (the
macOS "sliders" glyph, drawn like the other glyphs) opens the command palette
on the four settings alone (`settings.open`, also a palette entry). Still no
preferences window and no `Cmd+,` (ADR-0004, ADR-0008). Of the New Note
dialog's extension list ("das hier alphabetisch ordnen? sind die
vollständig?"): sorted now; it is complete for the §7.3 text types — the
extensionless tier-C names and the tier-D viewer types are not typed
extensions, and a PDF or image cannot be created empty.

### Open

The Cloudflare bucket ("zusätzlichen sync in ein bucket von cloudflare zum
cross device sync … das würde eine mobile und eine webapp ermöglichen") was
answered with an assessment only, no decision: it would be the first outbound
connection of the app, whose row in the `docs/PRIVACY.md` table exists only
once an ADR puts it there, and whose HTTP client the lockfile check refuses
without one; it needs an account, credentials or a token in the app, a conflict
story for a third writer next to Mode 1, and a web or mobile client that does
not exist. It is not opened now. If the owner wants it, it is a v2 question of
the size of Mode 2 (§5.7) and gets its own ADR before any code.

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
