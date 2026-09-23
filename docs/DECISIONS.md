# Decisions

Index of owner decisions for novalis. Each row of the 2026-09-05 answers became an ADR under `docs/decisions/` at scaffold time (ADR-0001…0009 as listed in PLAN.md §11.5); the answers since are recorded below by date, and each that adds a feature, a field or a dependency has its own ADR (ADR-0010…0032). This file is the record.

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
| Read-only rendered preview (`Cmd-E`) | yes, v1.1 — built 2026-09-15 (ADR-0020) |
| Hide-syntax live preview | no |
| Split view / board + note split | no (D21) |
| Folding, focus/typewriter, minimap, vim | no |
| Image paste/drop | yes, hard-coded `attachments/` next to the note, no setting (ADR-0017, 2026-09-15) |
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
| "Install command-line tool" menu item | yes — **struck 2026-09-20** (below): the tap's `novalis-cli` formula fills the need |
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
| First version tag | `v1.0.0-alpha.1` (changed 2026-09-18, below) |
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

Still on the branch, the owner asked three things at once:

> kónnen wir auch diagramme etc. darstellen wie von mermaid oder sowas wie
> puml? was sollten wir noch unterstützen?

> ich möchte die dateien, genau wie die boards per drag and drop verschieben
> können.

> ist es außerdem möglich screenshots bzw. bilddateien in diesen abzulegen?
> am besten per command v etc

Asked "Bilder/Screenshots in Notizen: welcher Umfang?", with the policy fixed
in the question (a folder `attachments/` next to the note, the file named
after the note and the time, a `![](...)` link, a 24th IPC command, an ADR):

> ⌘V aus der Zwischenablage (Recommended), Bilddateien aus dem Finder auf die
> Notiz ziehen

Recorded as **ADR-0017** (attachments: ⌘V and drop write the image to
`attachments/` next to the note, named `<stem>-YYYYMMDD-HHMMSS.<ext>`, and
insert `![](attachments/…)`; one new IPC command `write_blob`, 24 of 25, that
never overwrites; the §7.3 image types only; hard-coded, no fifth setting).
The "Image paste/drop" row above is changed accordingly, as is PLAN.md §4.4.

Asked "Dateien und Ordner im Baum per Drag & Drop verschieben (Ziel:
Ordnerzeile oder Wurzel; Links werden umgeschrieben wie bei Umbenennen)?":

> Ja (Recommended)

Recorded as **ADR-0018** (a file row dropped onto a folder row or the tree's
empty space is the existing `rename`, wikilinks and card references rewritten
as File ▸ Rename does; folders are drop targets but not yet draggable, since a
directory move needs a directory-aware relink the core does not have; board
rows are neither; "manual tree order" stays dropped). Both gestures are in the
`docs/KEYMAP.md` mouse-gesture table.

Asked "Diagramme und mehr im Lesemodus ⌘E (der Lesemodus selbst ist genehmigt
und kommt zuerst; jede Zeile hier ist eine eigene Abhängigkeit mit ADR)":

> Mermaid (Recommended)

KaTeX was not selected; PlantUML had been explained as needing Java or a
server, which the privacy rule forbids. Mermaid is approved for the ⌘E
read-only preview only (itself a v1.1 yes, PLAN.md §4.4, not yet built) and
gets its own ADR when built, as a lazy chunk loaded only for a note with a
`mermaid` fence. PLAN.md §2.2 and §7.2 carry the clause; ADR-0016's list of
approved-for-later formats notes it.

Later on 2026-09-15, with the tree drag (ADR-0018) and the attachments
(ADR-0017) in hand, the owner wrote:

> also man sollte auch boards per drag and drop bewegen.

> der screenshot wird als zeile hinzugefügt, ist aber nicht sichtbar

> wir sollten zwischen editier und view mode für .md umschalten können mit
> einem kleinen button

Asked "Boards per Drag & Drop — was genau soll bewegt werden?" (several
answers allowed):

> Reihenfolge der Boards im Baum, Karten zwischen Boards ziehen, Board in
> einen Ordner verschieben

The third answer would take boards out of `boards/`, where ADR-0006, the
CLI, `doctor` and the tree find them, and a board folder move is the
directory-aware relink ADR-0018 left open. Asked "Boards an beliebigen Orten
im Vault (statt nur unter boards/)? …" with that cost named:

> Nein, Boards bleiben unter boards/ (Recommended)

The third option is withdrawn. Recorded as **ADR-0019** (amending ADR-0006
and ADR-0018): `board.json` gains an optional `order`, a fractional-index
key written only for a dragged board, boards without one following by name;
the core's `move_board` and the shell's `board_write` `place` compute the
key in Rust; a card dragged from the open board onto a board row moves
there with the same id, last in the target's first column, the source card
tombstoned as ADR-0006 deletes. The CLI reads the order and does not write
it yet; PLAN.md §8.2 shows the key.

Asked "Bilder im Editor sichtbar machen?":

> Erst im Lesemodus ⌘E

Asked "IPC-Obergrenze: PLAN §2.3 Regel 8 sagt „unter 25 Befehle", die
Vorschau bräuchte den 25. Wie weiter?":

> Grenze auf 30 anheben (Recommended)

Recorded as **ADR-0020** (amending ADR-0008 and PLAN.md §2.3 rule 8): the
v1.1 read-only preview is built — `Cmd+E` bound to `note.togglePreview`, a
"View"/"Edit" button at the tab strip's end, per tab, session state only;
rendered in Rust by `pulldown-cmark 0.13` (three lockfile entries) through
`render_markdown`, the 25th command under a cap of 30; attachments shown
through `read_blob`, internal links followed, external links not opened;
Mermaid 12 draws `mermaid` fences as a lazy chunk (the ADR the Mermaid
answer above was waiting for; it names the package count). The
"Read-only rendered preview" row above and PLAN.md §4.4 and §7.2 are changed
accordingly; CLAUDE.md and `lib.rs` say 30.

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

## Answered 2026-09-16

Testing the preview (ADR-0020) with many notes open, the owner wrote:

> der vorschau/bearbeiten button kann je nach breite ausgeblendet werden, wenn
> viele notizen offen sind. der sollte immer sichtbar sein und ein icon, keinen
> text haben, weil weniger infos.

Recorded as the first amendment to **ADR-0020**: the toggle is an eye glyph in
a fixed cell beside the scrolling tab strip; the ADR names the eager-CSS budget
raised on the way. Then:

> macht es sinn, die gängisten markdown formatierungsoptionen für md files oben
> in der leiste einzublenden?

Answered with a recommendation against: a formatting toolbar is on the PLAN.md
§2.2 list of what novalis is not and in §7.1's "NO" row, and the palette
(`Shift+Cmd+P`) already lists the four formatting chords (bold, italic, link,
checkbox). The owner:

> ok, hast recht.

Recorded as a confirmed no; no ADR, nothing changes. Then:

> die shortcuts sollten auch im view mode funktionieren, nicht nur im edit mode

Asked "Welche Shortcuts sollen in der Vorschau (Ansehen-Modus) wirken?"
(several answers allowed):

> Suchen ⌘F / ⌘G / ⇧⌘G (Recommended), es sollte auch möglich sein im vorschau
> modeus mit command b zum beispiel etwas fett zu markieren

Recorded as the second amendment to **ADR-0020** ("chords"): in the preview,
`Cmd+F` opens a find bar over the rendered text (`Cmd+G` / `Shift+Cmd+G` move
between the marked matches, `Escape` closes it); `Cmd+B` and `Cmd+I` take the
selected rendered text, find it in the source of its block — the renderer tags
paragraphs, headings and list items with their source span — and toggle `**`
/ `_` around it in the buffer, which the preview re-renders and the autosave
writes. A selection that cannot be placed (across blocks, split by markup,
ambiguous, empty) switches the tab to the editor instead of guessing, as does
every other editor chord (`Cmd+K`, `Cmd+Enter`, `Ctrl+G`, `Cmd+D` …), not
replayed there. No new dependency, string key, command id or chord;
`docs/KEYMAP.md` "Not listed" says which chords the preview answers.

Trying the backlinks pane (above, "Backlinks placement") on a note linked
from one other note several times, the owner wrote:

> wenn ich viele rückverweise in eine notiz packe, taucht diese öfters in
> Notiz a zum beispiel auf, aber springt immer zur gleichen stelle. entweder
> wir springen einfach so in die notiz an den anfang über den backlink, dann
> braucht es nur einen backling pro zielnotiz oder wir springen genau an die
> stelle des backlinks, dann müssen wir die backlinks bzw. beschreibung
> unterscheidbar machen

Asked "Rückverweise: ein Eintrag pro Notiz oder ein Eintrag pro Stelle?", with
a line number and a per-note entry as the alternatives:

> Pro Stelle, Sprung zur Zeile

So every link stays its own entry, shown with the text of its line (the
vault search's snippet, from one guarded read of the source note; the path
only when the note cannot be read), and a click opens the note at that line.
Two things found on the way and fixed as defects, not decisions: the jump
into a note shown in the preview ("das stört mich") lands on the block whose
source span holds the line, lit for a moment since the preview has no
cursor; and the line is settled against the text on screen, because the
cache follows the file only after the autosave pause and a moved link
otherwise went to where it had been. Asked whether the entries should also
show the line number:

> ne, die zeilen nicht

Then, of the `[[` completion already built:

> können wir überschriften autovervollständigen sobald # eingegeben wurde?

Asked "Überschriften-Vervollständigung in Wikilinks: nach `[[Notiz#` die
Überschriften dieser Notiz anbieten, nach `[[#` die der aktuellen?":

> Ja, beide Formen

Recorded as an extension of the §4.4 "`[[` and `#` autocompletion" yes, for
the `[[note#heading]]` form PLAN.md §7.2 already defines: `[[#` offers the
headings of the buffer, `[[note#` those of the named note — read through the
existing `read_file`, the buffer first when the note is open. `read_file` is the "downloaded on open" read of §4.5, so naming a
cloud-only note before the `#` downloads it as opening it would; put to the
owner as "Nur beim Öffnen, nicht beim Tippen" against "So lassen: `[[Name#`
darf laden":

> So lassen: `[[Name#` darf laden

No new command, dependency, string or chord; the tag completion stays out of
a link.

### Open after the sync tests (2026-09-08)

After #113 was merged, the owner wrote:

> ich will noch eine delete funktion für ordner und notizen. außerdem ein
> open in finder per rechtsklick?

Trash for notes and folders exists (`Cmd+Delete`, File menu, palette); what
was missing is a way on the row itself. Asked "Kontextmenü (Rechtsklick) auf
Baumzeilen — welche Einträge?" (several answers allowed):

> Im Finder zeigen, In den Papierkorb legen, Umbenennen, Neue Notiz / Neuer
> Ordner hier

Asked where "Im Finder zeigen" should also be reachable:

> Auch Ablage-Menü und Palette

Recorded as **ADR-0021**: a native context menu on tree rows, built by the
shell from the catalog with the File menu's own ids (a board row gets "Show
in Finder" only — its rename and delete are the board pane's); `tree.reveal`
runs `open -R`, sits in the File menu and the palette, has no chord; two IPC
commands (`reveal`, `tree_context_menu`, 27 of 30); one new string.

### The four items open after the sync tests (2026-09-08), as of 2026-09-16

Measuring Drive with a second device (the owner's phone) had surfaced four
gaps between what the plan promised and what the code did; they were listed
on the backlinks branch and reached `main` only now, so their state is the
state of today, not of the day they were found.

| Item | State |
|---|---|
| **Drive creates no conflict copy** — §5.3's conflict flow waits for a second file that never appears on Drive | Measured and recorded in `docs/SYNC-REALITY.md` (PR #107); the app does not pretend otherwise. Cross-device change detection stays Mode 2 work. |
| **Two conflict detectors that disagree** — `stores/vault.ts` re-implemented the core's filename patterns, narrower | Settled: the UI counts `conflictCopyOf` as the core decides it; there is one detector. |
| **The resolve panel does not exist** — §5.3 promises keep-original / keep-copy / keep-both, the five `status.conflicts.*` keys are referenced by no code, only a count shows | Settled 2026-09-22 at stage 0 (answered 2026-09-20, `reliability-conflict-resolve-panel`): each copy is marked in the tree and resolved from its context menu; §5.3 is reworded and the five `status.conflicts.*` keys and `palette.cmd.showConflictCopies` are deleted. The panel waits until a real vendor copy is observed. |
| **Board conflict resolution is unreachable** — `resolve_card_conflicts` and `resolve_board_conflicts` were called by nothing | Settled: both run on the first `board_read` of a board after the vault was opened (PR #107, #111; "Erstes Lesen pro Board" above). |

## Answered 2026-09-18

Asked for a release on 2026-09-17, the owner had chosen to run the File
Provider checklist first; one evening of it later:

> ich denke wir lassen die checkllste jetzt sein. da wir das alte novalis
> ersetzen, können wir auch die alten releases alle abräumen?
> Eigentlich müssten wir eine 1.0.0 releasen oder?

Three questions, each with the recorded rule and its reasoning stated first.
"Release ohne fertige Checkliste — Gate 1 für dieses Pre-Release aussetzen?":

> Ja, aussetzen

"Alte Releases (v0.1.0, v0.2.0, v0.2.1-rc2) löschen?" — recommended was
releases only, tags kept as the record of which source shipped in which
binary:

> Alles löschen, auch Tags

"Welche Version bekommt das erste Release der Neufassung?" — recommended was
the planned `v2.0.0-alpha.1`; `1.0.0` without a suffix was advised against
because PLAN.md §9 freezes the CLI contract "after 1.0":

> v1.0.0-alpha.1

Recorded in `docs/RELEASING.md` (gate 1 waived for pre-releases, condition:
the notes name the unrun rows; the old releases and tags deleted, source on
`legacy` / `legacy-final`) and PLAN.md §4.5 and §11.4. The `-alpha` suffix
carries the meaning the checklist gate carried: not yet verified on every
sync path, contract not yet frozen. No ADR: nothing is added to the product.

## Answered 2026-09-19

Of the Homebrew tap PLAN.md §4.5 had left optional, after the explanation
that a tap has to be its own repository:

> nein, ich will so ein homebrew repo.

Created the same day as `grundhofer/homebrew-novalis`: `Casks/novalis.rb`
for the app and `Formula/novalis-cli.rb` for the CLI, both following
pre-releases; `docs/RELEASING.md` "Homebrew tap" has the per-release steps.
No ADR: a distribution channel outside the app, no change to the product,
no outbound connection from it (ADR-0002 stands: the app checks nothing).

## Answered 2026-09-20

On 2026-09-19 the owner asked for two things at once:

> mache bitte einen plan möglichst viele formate zu unterstützen (auch
> syntax highlighting etc) und trotzdem recht schlank und performant zu
> bleiben. die nutzer sollen novalis nicht nur zur organisation ihrer
> notizen sondern auch als texteditor/anzeiger verstehen.
> welche weitere features würdest du von einer notiz/journal app erwarten,
> welche heute noch fehlen?
> liste diese auf und lass uns entscheiden, was wir noch einbauen. nutze
> gerne subagenten zur analyse und ideenfindung.

The analysis (four inventory reports, a format plan with an adversarial
critique, ten perspective agents whose 178 ideas were merged to 121 and
checked one by one against the record — 88 survived) is in
`docs/research/2026-09-20-*.md`: `formats-plan.md` (the plan, eight
bundled questions with a recommendation each) and `feature-gaps.md` (34
"build", 52 "ask", 16 approved-not-built, 35 "no", 21 already rejected,
17 hard-to-find, in ten decision blocks). Two perspectives — onboarding /
discoverability and accessibility / keyboard / i18n — did not run
(session limits) and are named as such. Three questions, three answers:

Format plan ("Alle Empfehlungen übernehmen / Nur die ADR-freien Phasen
jetzt / Ich antworte einzeln"):

> Alle Empfehlungen übernehmen (Recommended)

Recorded as **ADR-0022** (the widened file-type list from one generated
table, `.map` out, the doc names, only the prose bundle among the extras,
quick-open and search over every listed file with a session-only "All
files" toggle and CLI `search --all-files`, the code presets — Geist Mono,
full width, no spellcheck in code, indentation guides, tag chip Markdown-
only — fence highlighting in the ⌘E preview, ⌘E and image paste for
`.markdown`, the binary verdict on open, the keystroke fix first,
`Todo.MD` left as is, a documentation sentence instead of a folder
denylist), **ADR-0023** (EPUB and CBZ on `rawzip` and one `read_packed`
command, 28 of 30), **ADR-0024** (DOCX through `mammoth`, capped at 15 MB,
after a CSP check in `just dev`) and **ADR-0025** (`heic heif avif` after a
decode check; PDF outline popover and keyboard paging now, PDF search and
continuous scroll later; image zoom without the font-size chords; CSV/TSV
table and rendered SVG behind the eye glyph). Build order: F7 → F1 → F2 →
F3b (no decision needed) → F4 → F3a → F5 → F6 → EPUB → CBZ → DOCX.

Feature gaps ("Block 1 bauen, B-Empfehlungen übernehmen / Nur Block 1
(Defekte) jetzt / Ich antworte Block für Block"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

That answer means, block by block of `2026-09-20-feature-gaps.md` §8
(keys in parentheses map to its tables):

- **Built as defects or plan fulfilment, no further question** (table A,
  block 1 and the "ohne Ja gebaut" lines): ⌘Q waits for the save flush
  (`reliability-quit-flush`); the §7.5 spellcheck underlines, test first
  (`reading-spellcheck-underlines`); a search hit opens at its line
  (`search-hit-jump-to-line`); cursor and scroll survive ⌘E and tab
  switches (`reading-position-kept`); CRLF stays CRLF
  (`texteditor-eol-preserve-crlf`); session restore survives a deleted
  file (`reliability-session-restore-missing-file`); download state and a
  30 s timeout when opening a cloud-only file
  (`reliability-cloud-open-timeout`); window position and size
  (`macos-window-restore`); Ln/Col, selection and cursor count in the
  status bar (`texteditor-status-position`); heading jump also in the
  preview (`reading-heading-jump-in-preview`); `[[note#heading]]` lands on
  the heading (`reading-follow-heading-anchor`); keyboard in the search
  results (`search-keyboard-results`); the folder filter
  (`search-folder-filter`); tags in the palette
  (`search-tag-palette-entries`, the §4.4 yes); the "deleted on disk"
  banner (`reliability-deleted-on-disk-banner`); card backlinks load the
  board (`kanban-backlink-card-jump`); every linked note opens from a card
  (`kanban-open-any-linked-note`); indentation detection
  (`texteditor-indent-detection`) and guides (`texteditor-indent-guides`,
  both ADR-0022); `novalis sync status` and `skill --path`
  (`cli-agents-sync-status`, `cli-agents-skill-path`); the JSON gaps
  `utf8`, `notUtf8Skipped` and `vault` on `index --status`
  (`cli-agents-json-shape-gaps`); match highlighting
  (`search-match-highlight`); BOM and the title (`reliability-bom-title`);
  the window title "note — vault" (`macos-window-title`); the legacy-vault
  banner (`reliability-legacy-vault-banner`); conflict copies at **stage
  0** — a badge in the tree, PLAN.md §5.3's panel promise reworded and the
  five `status.conflicts.*` strings deleted (`reliability-conflict-resolve-
  panel`). Each is a small pull request with a test; the ones that touch
  the keymap, a mouse gesture or a mockup surface carry a one-line record
  as their ADRs say.
- **Yes, each with its own ADR in the pull request that builds it, citing
  this entry**: search prefilled with the selection
  (`search-prefill-selection`); ⌘-click on a `#tag` chip filters
  (`search-tag-chip-click`); create a note from the quick-open query
  (`search-create-from-quick-open`) and from a ⌘-click on an unresolved
  `[[link]]`, unresolved links drawn dimmed
  (`pkm-create-note-from-missing-wikilink`); the ten most recent notes in
  ⌘P, kept in `state.json` (`search-palette-recent`); "Go to Heading…" as
  a palette mode with the `@` prefix, no chord
  (`search-goto-symbol-prefix`); quick-open and search over the listed
  files (`search-quick-open-all-files`, `search-all-files-toggle` — ADR-
  0022); previous / next day (`journal-prev-next-day`); Go ▸ Today's Note
  with `⌘J` (`journal-today-menu-chord`); insert date/time
  (`journal-insert-datetime`); CLI `novalis journal [--date] [--append]`
  (`cli-agents-journal-command`); task checkboxes clickable in the preview
  (`reading-checkbox-toggle-in-preview`); code highlighting in the preview
  (`reading-code-highlight-in-preview`, ADR-0022); image zoom
  (`reading-image-zoom`, ADR-0025); dragging a note from the tree into the
  editor inserts `[[link]]` (`export-drop-note-inserts-wikilink`); tab
  reorder by drag (`texteditor-tab-reorder-drag`); close other / all tabs
  (`texteditor-tab-close-others`); show invisibles
  (`texteditor-show-invisibles`); Sort Lines and Join Lines
  (`texteditor-line-ops`); PDFs as attachments by drop or ⌘V and files
  from the Finder dropped on a folder row (`export-attach-non-image-
  files`, `macos-finder-drop-into-tree`, one ADR amending ADR-0017);
  relative links rewritten on move, the core form, with a `doctor`
  attachments check (`reliability-move-rewrites-relative-links`,
  `export-doctor-attachments`); "Copy Path" and "Copy Link to Note" in the
  palette (`export-copy-path`, `export-copy-wikilink`); dropping a note on
  a column creates a card (`kanban-note-to-card`); a note picker for
  "Link Note…" (`kanban-link-note-picker`); a context menu on cards with a
  Column submenu, `tree_context_menu` generalised, 27 stays 27
  (`kanban-card-context-menu`); the card description rendered as Markdown
  with links and boxes inert (`kanban-description-markdown`, reopening
  ADR-0013 now that the renderer exists); new card from the palette, note
  from card, card from selection, a click on a card without a note opens
  its description (`kanban-new-card-palette`, `kanban-card-to-note`,
  `kanban-card-from-selection`, `kanban-card-click-without-note`); delete
  board as a designed action (`kanban-delete-board`); "Open With", Dock
  drop and `open -a novalis` for `md markdown txt`, a toast for files
  outside the vault (`macos-open-with-dock-drop`), and with it on the same
  branch the `novalis://open?path=` and `novalis://today` scheme
  (`macos-url-scheme`); external `https://` links open in the default
  browser through one `open_url` command — **the 28th** — with a sentence
  in `docs/PRIVACY.md`, by click in the preview and ⌘-click in the editor
  (`export-open-external-links`); "Open in Default App" in the context
  menu and the palette (`export-open-in-default-app`); View ▸ Backlinks
  (`pkm-backlinks-pane-menu`); CLI `search --regex` and `--case-sensitive`
  (`cli-agents-search-flags`); `cat <path>` tries the exact non-`.md` path
  first, decided before 1.0 (`cli-agents-non-md-files`); `board new`
  (`cli-agents-board-lifecycle`; rename/mv later).
- **No** (the recommendation was no and the owner took it): whole-word
  in the vault search, multi-file replace, "Duplicate", wrap toggle per
  tab, upper/lower/unique/reverse line ops, `ls --since`, `⌘R` for the
  heading mode, keyboard operation of the board (reopen once the tree has
  keyboard navigation), card filter and column collapse (until a board
  grows past ~30 cards), unlinked mentions, link preview on hover,
  extract selection to note, the vault-check panel and the conflict panel
  (28th IPC; stage 0 instead), a diff view for conflict copies, Copy as
  HTML, a Help menu with the shortcut sheet (for now), the right-click
  form of the copy commands, `cat --html`, shell completion, and
  everything in table D.
- **Struck**: the "Install Command-Line Tool" menu item approved on
  2026-09-05 (`cli-agents-install-cli-menu-item`) — the tap's
  `novalis-cli` formula (2026-09-19) is the install path; PLAN.md §4.4 and
  §9.4 say so, the six catalog strings go in a cleanup pull request.
- **Stays rejected**: printing the ⌘E preview through the system dialog
  and images under their `![]()` line in the editor were the two
  previously rejected ideas with a new argument (table E); the owner's
  earlier decisions stand ("no Print in v1"; "Erst im Lesemodus ⌘E").
- **To be run later** (block 9.3): the two missing perspectives; until
  then the tree's keyboard navigation, the sidebar resize handle and the
  unlocalised CodeMirror find panel (`EditorState.phrases`) are treated as
  defects, not features.

Where to keep the analysis ("docs/research/ per PR / Nur die Pläne, nicht
die Berichte / Im Chat belassen"):

> docs/research/ per PR (Recommended)

Recorded as this entry and the six files under `docs/research/`.

## Answered 2026-09-21

Two rows left open by F3a (#134), asked as "Soll ich die beiden offenen
Zeilen bauen?" — `php` (named in ADR-0022's language list, absent from the
plan's §3.1 table) and the Markdown grammar for `mkd mdx rmd qmd` (plain
until then, because the grammar brings the note bundle with it):

> Beide (Recommended)

Recorded as the 2026-09-21 amendment of **ADR-0022**: `php` listed as
code with the PHP grammar; the four dialects open like `.markdown`, as
files.

## Open items after the week-1 scaffold (2026-09-05)

These came out of the build and need your yes before they are closed:

| Item | Why it is open | Recommendation |
|---|---|---|
| The dependency set (`schemars`, `tauri-specta`, `notify-debouncer-full`, React, CodeMirror, …) | §11.5 wants an ADR reference for every new top-level dependency; the scaffold added them all at once under D1/§5.1 rather than one ADR each | One ADR-0011 "v1 dependency set" listing them, so later additions are visible against it |
| `schemars` major | Three majors are in `Cargo.lock` (0.8 via Tauri's build deps, 0.9 via tauri-specta, 1.2 for the CLI's `JsonSchema` bound) | Pin the CLI to 0.9 to match tauri-specta, or accept three and say so in ADR-0011 |
| CLI golden test location | PLAN §11.1 says `tests/cli/<case>/`, the build used `tests/golden/<case>/` and the integrator renamed it to `tests/cli/` | Keep `tests/cli/` and leave §11.1 as written |
| `edit --replace-section` semantics | §9.2 read literally would delete the heading too; the CLI keeps the heading and replaces the body, because otherwise the operation is not repeatable | Keep the implemented behaviour and reword §9.2 before 1.0 |
| "Install Command-Line Tool" menu item (§4.4, approved) | The app binary is already `Contents/MacOS/novalis-desktop`; the CLI needs a name and a place in the bundle before the menu item can do anything | **Closed 2026-09-20**: struck; `brew install grundhofer/novalis/novalis-cli` (2026-09-19) is the install path, the six `app.installCli.*` / `menu.app.installCli` / `errors.installCliFailed` strings were deleted on 2026-09-23 |
| `docs/KEYMAP.md` scope of `Shift+Cmd+N` | Documented as `global`, PLAN §7.4 groups it under "Tree" | Keep `global`; it is what the parity test enforces |
