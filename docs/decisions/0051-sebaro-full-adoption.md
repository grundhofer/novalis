# 0051 — The full sebaro adoption: the owner's answers of 2026-10-24

**Status:** accepted, built on the `sebaro-umbau` branch (steps 0–15), not yet merged to `main` · **Date:** 2026-10-24 · **Decider:** Sebastian Grundhöfer

## Context

ADR-0048 rebuilt novalis in sebaro as a pilot. It used sebaro's token contract 1.5, hand-mapped onto the `--ds-*` names. Since then sebaro has decided more (D67–D100 in sebaroDesign):

- the window frame and desktop density
- the ⌘K command palette
- fourteen fixed shortcuts
- a settings view
- the colour tone „Kühl · Warm“
- exported files with `--sb-*` names instead of a hand-made copy
- 70 confirmed rules in the sebaro Guide

The owner asked for novalis to be rebuilt fully in sebaro without losing function. Some of it was already fixed for novalis:

- petrol only in the tile (D65)
- sidebar start width 240 px, draggable 200–360 px (D100)
- ⌘K / Strg+K for the palette (D84)
- Hell/Dunkel in the View menu and in the settings (D75)

A read-only inventory (`docs/sebaro-umbau.md`) found where sebaro's rules collide with novalis's own (ADR-0004, ADR-0008, ADR-0037, ADR-0038, ADR-0048, ADR-0049, CLAUDE.md). The owner answered 27 questions, each with a recommendation. Every answer took the recommendation.

## Decision

| # | Question | Decision |
|---|---|---|
| 1 | Where the settings live | A **settings view inside the main window**, opened with **⌘,**. No second window. It holds only the existing settings, each with a help sentence. The place „Einstellungen“ sits bottom left in the sidebar (DSK-02). Amends ADR-0004, ADR-0008, ADR-0012 and CLAUDE.md („no preferences window; no Cmd-,“) |
| 2 | Colour tone | **A sixth setting `tone`** (`cool` / `warm`, sebaro „Papier“, FAR-15) in `settings.json` and the `Settings` struct, shown in the settings view and beside Hell/Dunkel. Amends ADR-0004 and CLAUDE.md („exactly the five“) |
| 3 | Eager CSS budget | `scripts/bundle-budget.mjs` measures **gzip**. The limit is set after the first real build and shown to the owner with the measurement (estimate about 32 kB gzip). Changes `docs/BUDGET.json` and PLAN.md §11.3. Measured on the first build with the export: 218 kB raw, 30.5 kB gzip; the owner confirmed **33 kB gzip** on 2026-10-24 („33 kB gzip (Empfohlen)“) |
| 4 | Public repository | The exported files name other sebaro products. The rebuild runs **locally on the branch**, and **nothing is pushed** until sebaro ships a product-filtered export (recorded in `docs/sebaro-luecken.md`). The export folder gets a `.license` note for its own licences |
| 5 | Window parts | All four are built: the **sidebar tool** in the title bar (DSK-04), View ▸ **„Breite der Seitenleiste“ Schmal · Normal · Breit** (200 / 240 / 360 px, DSK-07), **F6 / ⇧F6** through the areas plus „Nächster / Vorheriger Bereich“ in the Window menu and the palette (DSK-09), and **„Verschieben nach …“** in the tree (DSK-11) |
| 6 | Menu bar | sebaro's groups **Ablage · Bearbeiten · Darstellung · Fenster · Hilfe** (DSK-08). „Gehe zu“ is dissolved: Quick Open and Today go to File, tabs and history to Window, „Befehle … ⌘K“ to View. Help holds only the macOS help search, nothing with a network |
| 7 | Trash command | Last in Edit with ⌘⌫, worded **„In den Papierkorb …“** instead of sebaro's „Löschen …“ |
| 8 | Backlinks | **Stay under the editor**, restyled. No inspector, no ⌥⌘I |
| 9 | ⌘K | ⌘K opens the palette. **Insert Link moves to ⇧⌘K**, which overrides CodeMirror's ⇧⌘K delete-line; Delete Line stays ⌃⇧K. **⇧⌘P stays** as the second palette chord. Amends ADR-0008 |
| 10 | Colliding shortcuts | Sidebar **⌃⌘S** (⌘\ goes), tabs **⌃⇥ / ⌃⇧⇥** (⇧⌘[ / ⇧⌘] go), font size **⌘+ / ⌘−** (⌘0 stays). Back/forward ⌘[ / ⌘] stay until checked on a German keyboard (superseded by #36: ⌘← / ⌘→, in a text field ⌃⌘← / ⌃⌘→) |
| 11 | New Folder | **⌥⌘N**; ⇧⌘N is left free (sebaro: New Window) |
| 12 | Return in the tree | **Return opens** and arrows only move focus (NAV-11). Rename stays in the File menu, the context menu and the palette and loses Return |
| 13 | Dialog button | The submit verb („Anlegen“, „Umbenennen“) becomes a **secondary action** with spec/02 §1.7's waiting state (from 1 s on). A failure stays in the dialog as a sentence with the error sign, and „Noch mal versuchen“ stays. No lime in a dialog (EBE-03, AKT-01). Amends ADR-0048 |
| 14 | Toasts and errors | **Errors stand in the action zone** as a sentence with the error sign until the next action. The toast stays for „Karte hinzugefügt“ and, as a recorded deviation, for „Kopiert: …“ |
| 15 | Counters | Words, characters, line/column and selection stay as a **grey counter line** before the state sentence in the action zone (recorded deviation from STA-07) |
| 16 | Preview toggle (⌘E) | A **compact icon tool** with a sprite icon and the tooltip „Vorschau ⌘E“ instead of the hand-drawn eye; no second row of tabs |
| 17 | Unresolved wiki link | **text-muted, no underline**, no dash (FOR-03). Amends ADR-0038 |
| 18 | #tags | **Link style**: „#“ in text-muted, the word in text colour with the 2 px cobalt underline. ⌘-click still searches. Amends ADR-0037 |
| 19 | Board actions | Always-visible **„Mehr“ menus** for board, column and card, with „Löschen …“ last after a separator. The native card context menu gets the same order. New Card stays at the column's foot (ADR-0050) |
| 20 | German words | „Vault“ and „Board“ stay as product terms. „Tab“ becomes **„Reiter“** (confirmed by #38: both stand in `docs/GLOSSARY.md`) |
| 21 | Window scripts | **React with sebaro's markup**: window, tree, palette, tabs, dividers and F6 as React counterparts with identical markup, ARIA and key contract. Only the delegated `sb-tooltip.js` and `sb-menu.js` are loaded |
| 22 | Appearance storage | **`settings.json` stays the one source**. A Rust initialisation script hands `sb-theme`, `sb-tone`, `sb-motion` and `data-sb-platform` to `theme-init.js`, and `build.rs` sets the window ground from the exported `tokens.json` (DSK-14). The localStorage copy `novalis.appearance` goes. Amends ADR-0049 (`data-motion` → `data-sb-motion`) |
| 23 | Renaming tokens | Every pilot token with an unchanged value is renamed `--ds-*` → `--sb-*` in **one mechanical commit**. Tokens with a new role are changed view by view. No alias layer and no mixed state |
| 24 | Truncation | Text **wraps** instead of ending in „…“ (ZUG-09, D99, D100). The virtualised tree and CSV table stay one line with the full name in the tooltip (recorded gap) |
| 25 | 200 % text for the review pictures | **Both**: the editor font doubled with ⌘+, and the webview text at 200 % as a developer check without a new setting |
| 26 | Start tile | The exported **`sb-start.js`**, with `hold()` / `release()` around start-up, replaces `StartTile.tsx`. If it fails in WKWebView, `StartTile.tsx` is adapted to STR-01 instead, and that is reported |
| 27 | Detail package | All twenty points as recommended (listed in `docs/sebaro-umbau.md` §11; point 16 superseded by #37: `scripts/check-sebaro-export.mjs` instead of `export_system.py --verify --files-only`) |

## Rejected alternatives

Every non-recommended option of the 27 questions; they are listed with their reasons in `docs/sebaro-umbau.md` §11.

## Consequences

- Building waited for a sebaroDesign commit naming D100 and for the export command to be confirmed with the owner; as of 2026-10-26 it is built on the `sebaro-umbau` branch, steps 0–15 (see the status line). CLAUDE.md, `docs/SETTINGS.md`, `docs/KEYMAP.md`, PLAN.md and the parity tests change in the step that builds each point, not before.
- Every deviation from a sebaro rule and every gap is in `docs/sebaro-luecken.md`. Nothing is built in sebaroDesign or the sebaro Guide.
- `@novalis/tokens` is retired. Without `packages/tokens/package.json` the version stamps go from six to five.

**Owner approval:** 2026-10-24, answers to the gathered questions of step 2, verbatim: „Ansicht mit ⌘, (Empfohlen)“, „Ja, sechste Einstellung (Empfohlen)“, „Auf gzip umstellen (Empfohlen)“, „Lokal bauen, vor Push filtern (Empfohlen)“; „Seitenleisten-Werkzeug (Empfohlen), Breite Schmal·Normal·Breit (Empfohlen), F6 durch Bereiche (Empfohlen), „Verschieben nach …“ (Empfohlen)“, „sebaro-Gruppen (Empfohlen)“, „„In den Papierkorb …“ (Empfohlen)“, „Unten bleiben (Empfohlen)“; „Link ⇧⌘K, ⇧⌘P bleibt (Empfohlen)“, „Auf sebaro umstellen (Empfohlen)“, „⌥⌘N (Empfohlen)“, „Eingabe öffnet (Empfohlen)“; „Nebenaktion mit Verb (Empfohlen)“, „Fehler in die Zone (Empfohlen)“, „Graue Zählerzeile bleibt (Empfohlen)“, „Werkzeug mit Icon (Empfohlen)“; „Grau, ohne Unterstrich (Empfohlen)“, „Linkstil (Empfohlen)“, „„Mehr“-Menüs (Empfohlen)“, „Vault/Board bleiben, Reiter (Empfohlen)“; „React mit sebaro-Markup (Empfohlen)“, „settings.json bleibt (Empfohlen)“, „Gleiche Werte auf einmal (Empfohlen)“, „Umbrechen, außer Baum/CSV (Empfohlen)“; „Beides (Empfohlen)“, „sb-start.js nehmen (Empfohlen)“, „Alle wie empfohlen (Empfohlen)“.

## Sources

ADR-0004 · ADR-0008 · ADR-0012 · ADR-0037 · ADR-0038 · ADR-0048 · ADR-0049 · ADR-0050 · `docs/sebaro-umbau.md` · `docs/sebaro-luecken.md` · sebaroDesign `DECISIONS.md` D65, D67, D75, D78, D84, D90, D91, D94, D98–D100, `shared/ADOPTION.md` §5, `systems/sebaro/spec/02-components.md` §4 · sebaro Guide rules DSK-02, DSK-04, DSK-07, DSK-08, DSK-09, DSK-11, DSK-14, FAR-15, EBE-03, AKT-01, NAV-11, STA-07, FOR-03, ZUG-09, STR-01

## Amendment 2026-10-25: answers during the view steps

While views 1–10 were being rebuilt, the owner answered seven more questions, each with a recommendation. Every answer took the recommendation. Nothing here adds a feature or a setting.

| # | Question | Decision |
|---|---|---|
| 28 | Tab overflow: sebaro shrinks every tab to 8 rem, then scrolls | **Keep sebaro's CSS**; no novalis deviation |
| 29 | Sidebar width at large text | **Stays px** (D100: 240, 200–360 px) |
| 30 | Unresolved links and #tags in the preview | **Unchanged**: the preview marks neither (ADR-0037, ADR-0038) |
| 31 | Gap between the traffic lights and the tile | **Wait for sebaro**; no novalis value |
| 32 | Callouts above the editor (#27.7) | Warnings as `sb-callout--warning`, plain information as `--note` |
| 33 | Code files at 200 % text | **Scroll sideways**, an exception like the tree and the CSV table (#24) |
| 34 | Search-cache files that the picture runs left in the app folder | **Delete** them; the picture tools remove their own cache from now on |

**Owner approval:** 2026-10-25, verbatim: „sebaro-CSS behalten (Empfohlen)“, „Bleibt px (Empfohlen)“, „Bleibt wie bisher (Empfohlen)“, „Auf sebaro warten (Empfohlen)“; „So lassen (Empfohlen)“, „Scrollen, als Ausnahme (Empfohlen)“, „Ja, löschen (Empfohlen)“.

## Amendment 2026-10-26: answers after D102

The view steps 11–15 and the adoption of sebaro D102 raised more questions. The owner answered them on 2026-10-26, each with a recommendation, and every answer took the recommendation.

| # | Question | Decision |
|---|---|---|
| 35 | The board tab (ADR-0050) | Becomes a **pinned tab** (sebaro D102 (5)): no ×, not closed by Delete, ⌘W or middle click; the board comes and goes through the board tool and View ▸ Board. Amends ADR-0050 |
| 36 | Back / Forward | **⌘← / ⌘→**, in the editor and text fields **⌃⌘← / ⌃⌘→** (D102 (14)); ⌘[ / ⌘] go. Amends ADR-0008 and #10 |
| 37 | CI check of the export (#27.16) | An own small script `scripts/check-sebaro-export.mjs` that hashes every file against `sebaro-export.json`, in `just check` and `ci.yml`; sebaro's tool is not shipped |
| 38 | English words | A short glossary `docs/GLOSSARY.md` with „Vault“ and „Board“ (D102 (20)); confirms #20 |
| 39 | Undo after „Verschieben nach …“ | The toast offers **„Rückgängig“**, which moves the item back (D102 (16)); only for this case |
| 40 | Footnotes in the preview | sebaro's `sb-note-ref` / `sb-notes` with a link back to the place (D102 (32)), as post-processing in the preview; core and CLI unchanged |
| 41 | Card context menu | Gains **„Notiz verknüpfen …“**, in the order of the card's „Mehr“ menu (AKT-10) |
| 42 | Dropping a card | The upper half of a card drops **before**, the lower half after (spec/02 §4.22) |
| 43 | View ▸ „Vorschau“ ⌘E | A checkbox item in View; no new shortcut |
| 44 | „Reiter nach vorn / nach hinten“ | The two menu items stay |
| 45 | Deleting a board | „Board in den Papierkorb legen …“; columns and cards keep „Löschen …“ |
| 46 | Scrollbar under the tab row | Stays visible (D102 (10)) |
| 47 | Ten points as built | Help holds only the search field; no „Befehle ⌘K“ tool in the title bar; cards are not renamed by key or double click; ⌘W without a tab does not quit; ⌘⌦ no longer moves to the Trash, only ⌘⌫; an empty board has no own „Neues Board“ button; the settings view keeps the sidebar with „Einstellungen“ as the current place; the sidebar overlay takes focus from the tool, the palette and ⌃⌘S but not from the menu, and stays open when a note is opened until sebaro decides; after a failed open the callout shows only the latest reason; the old „No preferences window“ sentences in PLAN.md and DECISIONS.md stay as history |

**Owner approval:** 2026-10-26, verbatim: „Anheften (Empfohlen)“, „sebaro-Kürzel (Empfohlen)“, „Eigenes kleines Skript (Empfohlen)“, „Kurzes Glossar anlegen (Empfohlen)“; „Ja, bauen (Empfohlen)“, „Ja, in der Vorschau (Empfohlen)“, „Ja (Empfohlen)“, „Ja, nach Hälften (Empfohlen)“; „Ja (Empfohlen)“, „Behalten (Empfohlen)“, „„Board in den Papierkorb legen …“ (Empfohlen)“, „Sichtbar lassen (Empfohlen)“; „Alle so lassen (Empfohlen)“.

## Amendment 2026-10-27: answers after D104 and D105

The final reviews raised more questions. The owner answered them on 2026-10-27, each with a recommendation, and every answer took the recommendation.

| # | Question | Decision |
|---|---|---|
| 48 | ⌃⌘S arrives on macOS only as a menu event | **⌃⌘S counts as the menu**: it opens the sidebar overlay without taking focus; the tool and the palette take focus in. Amends #47. No new dependency |
| 49 | The 200 % review pictures (#25) | **Only the web view at 200 %**; the editor font stays at its default, since it follows the root font since D102. Amends #25 |
| 50 | How the rebuild reaches main | **One squash commit** on a new branch from main, after a search of the diff for every name of ADR-0051 #4; `sebaro-umbau` stays local; no PR or push without the owner's OK |
| 51 | Another product's name in the quotes of DECISIONS.md and ADR-0048 | Stays: the name is public, and the quotes stay verbatim |
| 52 | Tables in the preview | Named for screen readers after the heading before them (spec/02 §3.9): „Tabelle unter „…““, without a heading „Tabelle 1“, „Tabelle 2“ |
| 53 | Number columns | Aligned to the end with tabular figures (`.sb-num`) in the Markdown preview only; an alignment written in the Markdown wins. The CSV table stays as it is |
| 54 | Go to Line with an invalid line | sebaro's field error („Gib eine Zeile von 1 bis n ein.“); the bar stays open |
| 55 | macOS's own menu items | `CFBundleLocalizations` (de, en) in Info.plist, so they follow the system language |
| 56 | Five smaller points | Without a vault the sidebar shows only the foot „Einstellungen“; an Escape that belongs to a dialog, the palette or a menu leaves the toast with „Rückgängig“ standing; CLAUDE.md's directory map names `scripts/check-sebaro-export.mjs`, `docs/GLOSSARY.md`, `docs/sebaro-umbau.md` and `docs/sebaro-luecken.md`; three unused i18n keys go; two commit texts without an ADR reference are not rewritten (the squash replaces them) |

**Owner approval:** 2026-10-27, verbatim: „⌃⌘S wie das Menü (Empfohlen)“, „Nur WebView 200 % (Empfohlen)“, „Ein Squash-Commit (Empfohlen)“, „Ist öffentlich, lassen (Empfohlen, falls bekannt)“; „Ja (Empfohlen)“, „Ja, nur Markdown-Vorschau (Empfohlen)“, „Ja (Empfohlen)“, „Ja (Empfohlen)“; „Alle wie empfohlen (Empfohlen)“.

## Amendment 2026-10-29: answers after D108

| # | Question | Decision |
|---|---|---|
| 57 | Tables in the EPUB and DOCX readers | Named the same way as in the preview (#52), with the same texts |
| 58 | The sentence under the tabs in an empty vault | Only „Keine Notiz offen.“; the hint to choose a note or press ⌘P goes when there is nothing to choose |
| 59 | The editor's code colours, looks and selection mark | Taken from the export's `editor/sebaro-codemirror.ts` instead of novalis' copy; the export folder comes back into the typecheck |
| 60 | CLAUDE.md on `--nv-*` | Says that none is left and that a new one needs a gap row |
| 61 | Cleaning the branch history | As #50: no rewrite; the rebuild lands as one squash commit on a new branch from main, after a search for every name; `sebaro-umbau` stays local |
| 62 | Five points as built | `just check` keeps novalis' own export check (#37), not the verifier inside the export folder; the last resort after a crash stays `sb-fatal` from `main.tsx`; no `CFBundleDevelopmentRegion = de`; Go to Line sends +n, −n and n% past the end to the end; the menu bar follows macOS's appearance until sebaro decides |

**Owner approval:** 2026-10-29, verbatim: „Ja, gleiche Regel (Empfohlen)“, „Nur „Keine Notiz offen.“ (Empfohlen)“, „Exportdatei nutzen (Empfohlen)“, „Ja, ändern (Empfohlen)“; „Wie #50: Squash beim Landen (Empfohlen)“, „Alle so lassen (Empfohlen)“.

## Amendment 2026-10-29 (2): answers after D111

| # | Question | Decision |
|---|---|---|
| 63 | Markdown source looks in the editor | The rules novalis shares with sebaro's `sebaroMarkdownHighlight` (bold, italic, strikethrough, link, inline code, quote, marks) come from the export; novalis keeps only the heading size at the line (#27.4), the `#tag` link look (#18) and the code block and list rules |
| 64 | What counts as a number in a Markdown table (#53) | novalis' wider reading stays (a note's language is not the interface's); only „not given“ is added |
| 65 | The board row in the tree while the board shows | No place line on it; the pinned board tab carries the place (NAV-01) |
| 66 | Landing | The squash branch is prepared locally (new branch from main, one commit, name search, `just check`) with a PR text; nothing is pushed without the owner's further OK |

**Owner approval:** 2026-10-29, verbatim: „Gemeinsames von sebaro (Empfohlen)“, „Nur „not given“ ergänzen (Empfohlen)“, „So lassen (Empfohlen)“, „Ja, lokal vorbereiten (Empfohlen)“.
