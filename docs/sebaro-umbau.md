# sebaro-Umbau von novalis: Bestandsaufnahme

Stand 2026-10-24, Branch `sebaro-umbau` (= `main` bei `a047947`, v1.2.0). Schritt 1 des Umbaus: nur lesen, kein Code geändert. Die Antworten des Inhabers auf die offenen Fragen (Schritt 2) stehen in §11; was sebaro fehlt, sammelt [`sebaro-luecken.md`](sebaro-luecken.md).

**Quellen, nur gelesen:**
- sebaroDesign (Arbeitsstand mit D1–D100, Token-Vertrag 1.9): `AGENTS.md`, `systems/sebaro/AGENTS.md`, `shared/ADOPTION.md`, `systems/sebaro/SYSTEM.md`, `systems/sebaro/spec/`, `systems/sebaro/css/sebaro.css`, `systems/sebaro/dist/tokens.css`, `systems/sebaro/demo/assets/*.js`, `DECISIONS.md`, `tools/export_system.py`.
- sebaro Guide 2.9.0: `AGENTS.md`, `rules/rules.json`. Diese Fassung deckt D1–D99 ab; für D100 gibt es noch keine Regel-ID.

**Was SYSTEM.md §5 zu novalis vorschlägt** (Schreibfläche in sebaro Sans, Löschen ins Kontextmenü, Wortzahl und Speicherstatus in einer Leiste): Das sind nur Vorschläge. Sie stehen als Fragen in §11 und gelten nicht als entschieden.

**Fest für novalis:** Petrol nur in der Kachel (D65). Seitenleiste 240 px Startbreite, im Fenster ziehbar 200–360 px (D100). ⌘K / Strg+K öffnet die Palette (D84). Hell/Dunkel im Menü „Darstellung“ und in den Einstellungen (D75).

## 1 Ausgangslage

novalis ist schon einmal auf sebaro umgestellt worden, als Pilot (ADR-0048, ADR-0049, ADR-0050, v1.2.0). Dieser Pilot hat sebaro von Hand nachgebaut, nach dem Stand von sebaroDesign `8b8d4a7` (Token-Vertrag 1.5), unter den alten `--ds-*`-Namen. Eingebaut sind:

- die Farbaufgaben: Kobalt für den Ort, Lindgrün für die Hauptaktion, eine Gefahrenfarbe
- 2-px-Tintenlinien und keine Schatten
- die Aktionszone mit „Neue Notiz“
- die 45°-Kante beim Löschen
- die 48-px-Titelleiste mit Kachel und Start
- Radio Canada und sebaro Mono
- sieben Icons in `Icon.tsx`
- die Einstellung „Bewegung immer reduzieren“
- das Board als Reiter

Seitdem ist sebaro bis D100 weitergewachsen. Dazu gehören:

- das Fenstergerüst, die Desktop-Dichte und die Befehlspalette (D80, D84, D91 F1a–F14a)
- ein Export statt Nachbau (`--sb-*`-Namen, D67 (13), D77)
- sebaro Sans und sebaro Mono 500 (D68–D71)
- der Farbton „Kühl · Warm“ (D90, D91)
- 70 entschiedene Guide-Regeln (D98)
- Regeln für große Schrift (D99, D100)

Der vollständige Umbau ersetzt den handgemachten Nachbau durch den Export und baut die Fensterteile nach spec/02 §4. Die Funktion bleibt dabei gleich.

**Export:** `export_system.py` nur, wenn ein Commit mit „D100“ in sebaroDesign liegt (am 2026-10-24 war D100 noch nicht committet). Vorgesehen ist `python3 tools/export_system.py sebaro --target tauri --out <novalis>/apps/desktop/ui/src/sebaro --product novalis` (ADOPTION §5 Schritt 1). Der Docstring des Werkzeugs nennt für Tauri noch ein altes Entwurfssystem als Beispiel. Maßgeblich ist ADOPTION §5. Vor dem Lauf wird der Befehl mit dem Inhaber bestätigt.

## 2 Plattformen und Stack

| Teil | Stand | Bezug zu sebaro |
|---|---|---|
| Ziel | macOS 14+, Apple Silicon. Linux-CI baut und testet, liefert aber nicht aus | DSK-08 „Menü“-Taste nur Windows/Linux, für novalis nicht nötig (Frage) |
| Shell | Tauri 2 (`tauri` 2.12.1 im Lock). Ein Fenster `main`, in Rust gebaut (`create: false`), `titleBarStyle: Overlay`, `visible: false` bis zur Wiederherstellung der Lage, kein Fenstergrund gesetzt | DSK-14: Fenstergrund aus `tokens.json` in `build.rs`, nicht unsichtbar starten |
| IPC | 28 von 30 Befehlen | Eine Einstellungsansicht nutzt `settings_set`. `set_appearance` (DSK-14) wäre ein neuer Befehl, falls er gebraucht wird |
| CSP | `script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `font-src 'self'` | ADOPTION §5 Schritt 5: `theme-init.js` als Datei, keine Inline-Skripte |
| UI | React 19, Vite (`target: safari17`), CodeMirror 6, zustand-Stores, i18next mit `i18n/en.json` + `de.json` | sebaro-Skripte (`js/sb-*.js`) erwarten eigenes DOM. Für React gibt es Gegenstücke mit gleichem Markup und ARIA (Frage) |
| Tokens | `@novalis/tokens` (`packages/tokens/tokens.css`, Kopf `GENERATED-PENDING`), 116 `--ds-*`-Namen | Wird durch den Export ersetzt (`--sb-*`, keine Alias-Schicht, TEC-07) |
| Schriften | `apps/desktop/ui/src/fonts/`: Radio Canada (normal, kursiv) und sebaro Mono 400, zusammen 57,5 kB | Export bringt sebaro Sans und sebaro Mono 500 (D70, D71), etwa 61,9 kB gegen 250 kB Budget |
| Budgets | `docs/BUDGET.json`: eager CSS 24 kB (roh, heute etwa 23,5–24,1 kB), Schriften 250 kB, eager JS 250 kB gzip | `css/sebaro.css` hat roh 230 kB (gzip 49,7 kB unminifiziert). Das Budget reicht nicht (Frage) |
| Einstellungen | genau fünf (`language`, `appearance`, `editor.fontSize`, `spellcheck`, `reduceMotion`). Kein Einstellungsfenster, kein ⌘, (ADR-0004) | DSK-02 verlangt eine Einstellungsansicht mit ⌘,. FAR-15 verlangt den Farbton (Frage) |
| Kürzel | `docs/KEYMAP.md` ⇄ `lib/keymap.ts` ⇄ `menu.rs`, Paritätstest in Cargo | 14 feste Kürzel (DSK-09, spec/02 §4.19), `tools/check_shortcuts.py` |
| CLI | `novalis`, ohne Oberfläche | nicht betroffen |

## 3 Ansichten und Bereiche

| Ansicht / Bereich | Komponenten | Abschnitt |
|---|---|---|
| Fensterrahmen, Titelleiste, Start | `App.tsx`, `TitleBar.tsx`, `StartTile.tsx`, `index.html`, `main.tsx` | §6 A |
| Seitenleiste: Kopf, Werkzeuge, Heute-Zeile, Baum, Fuß mit Einstellungen, Teiler | `Sidebar.tsx`, `SidebarResize.tsx` | §6 B |
| Reiterleiste mit Board-Reiter, Inhaltskopf, Vorschau-Umschalter | `TabStrip.tsx` | §6 C |
| Aktionszone: Stand-Satz, Zähler, „Neue Notiz“ | `StatusBar.tsx` | §6 D |
| Befehlspalette, Schnell öffnen, Vault-Suche | `Palette.tsx`, `SearchPanel.tsx`, `Marked.tsx` | §6 E, §7 H |
| Natives Menü, Kontextmenüs (Baum, Reiter, Karte, Board-Zeile) | `src-tauri/src/menu.rs` | §6 F |
| Einstellungen (heute Palette und Menü) | `Palette.tsx`, `menu.rs` | §6 G |
| Bereiche, F6, Inspektor, Mindestbreite | `App.tsx` | §6 H |
| Editor | `editor/*` (theme, setup, decorations, fences, phrases, headingCompletion …) | §7 A, B |
| Markdown-Vorschau | `Preview.tsx`, `styles/preview.css` | §7 C |
| Tabellen- und SVG-Vorschau | `TablePreview.tsx`, `SvgPreview.tsx` | §7 D |
| Betrachter PDF, EPUB, CBZ, DOCX, Bild; Inhaltsverzeichnis | `Viewer.tsx`, `*Viewer.tsx`, `ZoomableImage.tsx`, `ContentsPopover.tsx`, `lib/documentCss.ts` | §7 E |
| Rückverweise | `Backlinks.tsx` | §7 F |
| Board und Karten | `BoardPane.tsx`, `styles/board.css` | §7 G |
| Dialoge (Eingabe, Bestätigung) | `Prompt.tsx` | §8 A |
| Kurzmeldung, Fortschritt, Fehler | `Toast.tsx`, `stores/ui.ts` | §8 B |
| Banner und Hinweise | `Banner.tsx`, `CloudHint.tsx`, `LegacyHint.tsx` | §8 C |
| Leere Zustände, Laden, Boot-Fehler | `App.tsx`, `Viewer.tsx`, `BoardPane.tsx` | §8 D |
| Icons, Kürzel, Texte | `Icon.tsx`, `KEYMAP.md`, `i18n/*.json` | §8 E–G |

## 4 Reihenfolge des Umbaus

Für jeden Schritt gilt:
- Bilder vorher und nachher, hell und dunkel, bei 100 % und 200 % Schrift
- `just check` grün
- Prüfung gegen die passenden Regel-IDs durch einen unabhängigen Agenten

Die Grundlagen kommen zuerst, weil jede Ansicht auf ihnen steht. Danach folgen die Ansichten von außen nach innen und vom Häufigen zum Seltenen. Menü und Kürzel stehen spät, weil sich Rust, i18n und der Paritätstest dort gemeinsam ändern und die meisten ADRs daran hängen.

| # | Schritt | Warum hier |
|---|---|---|
| 0a | Budget-ADR (Messart oder Grenze für eager CSS) | Sobald `sebaro.css` geladen wird, scheitert `just check`. Ohne diese Entscheidung geht nichts |
| 0b | Export nach `apps/desktop/ui/src/sebaro`, `--verify`, Ladefolge `theme-init.js` → `fonts.css` → `tokens.css` → `icons/sprite.css` → `css/sebaro.css` (WEB-01), Lint-Ausnahme für den Exportordner, CI-Prüfung des Exports (gebaut als `scripts/check-sebaro-export.mjs`, ADR-0051 #37) | Grundlage für alles Weitere |
| 0c | Schrift aus dem Export (sebaro Sans, sebaro Mono 500), `src/fonts/` entfällt | kleinster sichtbarer Schritt, Budget hält |
| 0d | Umbenennen der Pilot-Tokens mit gleichem Wert `--ds-*` → `--sb-*` in einem mechanischen Commit. `@novalis/tokens` entfällt, die Versionsstempel gehen von sechs auf fünf | Bilder bleiben bis auf die Schrift gleich, so fallen Fehler auf |
| 0e | Theme-Weg: Auswahl vor dem ersten Bild, Fenstergrund in `build.rs` (DSK-14), `data-sb-motion` statt `data-motion` | kein heller Blitz mehr, eine Quelle für die Wahl |
| 1 | Fensterrahmen und Titelleiste (`sb-window`, `data-sb-density="window"`, `data-sb-platform="mac"`, Kachel aus dem Export, Pfad) | alle Ansichten hängen daran |
| 2 | Aktionszone (Stand-Satz, Zähler, „Neue Notiz“, Fehlerort, Kurzmeldung) | behebt die doppelte Summe (STA-07), Fehlerort für alle späteren Ansichten |
| 3 | Seitenleiste: Teiler 240 / 200–360 px, Baum 32-px-Zeilen, Heute, Werkzeuge, Fuß | D100 fest. Der Tastenvertrag des Baums kommt nach der Antwort |
| 4 | Reiterleiste und Inhaltskopf (`sb-doc-tabs`, Board-Reiter, Vorschau-Umschalter) | baut auf Inhalt und Panel auf |
| 5 | Editor (Code-Farben D69, Editor-Chrome, Suchleiste, Vervollständigung, Banner und Hinweise am Editor) | häufigste Ansicht; Code-Farben sind entschieden |
| 6 | Markdown-Vorschau, dann Tabellen- und SVG-Vorschau | nutzt dieselben Code-Farben |
| 7 | Dialoge (`sb-dialog`, Absende-Taste nach Antwort, Fehlersatz) | einziger Dialog der App, gut getestet |
| 8 | Palette, Schnell öffnen, Vault-Suche (`sb-command-palette`), ⌘K | Rahmen teilen sich drei Overlays |
| 9 | Rückverweise | klein |
| 10 | Betrachter und Inhaltsverzeichnis | viele Werkzeugleisten und Icons |
| 11 | Board und Karten („Mehr“-Menüs, Spaltenfuß, Ziehen) | größter Umbau, hängt an Aktionszone, Dialogen und ADRs |
| 12 | Natives Menü und Kürzel (Gruppen nach DSK-08, KEYMAP, Parität, `aria-keyshortcuts`) | braucht die meisten Antworten |
| 13 | Einstellungsansicht (falls entschieden) | nutzt Seitenleiste, Inhalt und Titelleiste |
| 14 | F6 und Bereiche, Overlay-Seitenleiste unter 722 px, kleinstes Fenster 480 × 400 px | setzt alle Bereiche voraus |
| 15 | Leere Zustände, Laden, Start, Abschluss der Texte | zuletzt sichtbar zu prüfen |


## 5 Grundlagen: Farben, Tokens, Schriften, Maße, Linien, Bewegung, Code-Farben

**Grundlage.** novalis `a047947` (v1.2.0), Branch `sebaro-umbau`. Auf der sebaro-Seite gilt der Arbeitsstand von sebaroDesign:
- `systems/sebaro/dist/tokens.css`: Token-Vertrag 1.9 mit 306 `--sb-*`-Namen.
- `systems/sebaro/css/sebaro.css` und `spec/`.

Dort ist HEAD D99 (`f8bdbee`). D100 steht nur im Arbeitsbaum, ebenso eine noch nicht committete Änderung an `spec/09-platform-web.md`. Der Pilot (ADR-0048) hat Vertrag 1.5 (Commit `8b8d4a7`) von Hand nachgebildet.

Jedes Gegenstück unten habe ich in einer dieser Dateien gesehen: `dist/tokens.css`, `css/sebaro.css`, `spec/`, `demo/assets/` oder `tools/export_system.py`. Die Regel-IDs stammen aus `rules/rules.json` des Guides (2.9.0, deckt D1–D99 ab). Gerendert habe ich nichts, und der Export ist nicht gelaufen.

**Was „Stand“ bedeutet:**
- **Pilot**: Der Wert stimmt schon. Es fehlt nur die Umbenennung `--ds-*` → `--sb-*` (TEC-07, D67 (13), D77).
- **anzupassen**: Wert oder Verwendung ändert sich.
- **neu**: kommt dazu.
- **fehlt in sebaro**: siehe Lückenliste.
- **Konflikt**: Eine Regel oder eine novalis-Konvention steht dagegen.

So sind Ortsangaben ohne Pfad zu lesen:
- `tokens.css:Z` meint `packages/tokens/tokens.css`. Die erste Zahl gilt für Hell, die zweite für Dunkel.
- `app.css` und die übrigen Stylesheets liegen in `apps/desktop/ui/src/styles/`.
- `theme.ts` meint `apps/desktop/ui/src/editor/theme.ts`.

### 1 Farben: Flächen, Text, Linien, Theme-Umschaltung

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| `--ds-color-bg-canvas` | tokens.css:44/133 | `--sb-color-bg` | FAR-05 | Pilot | Werte gleich |
| `--ds-color-bg-surface` | :45/134 | `--sb-color-surface` | FAR-05 | anzupassen | Werte gleich. sebaro sieht `surface` nur für Schieberegler-Daumen und Select-Optionen vor; novalis nutzt es 8×, für Leisten und Panels (z. B. `viewer.css:116, 163`, `app.css:699, 954`, `backlinks.css:9`, `theme.ts:104`). Jede Verwendung einzeln prüfen |
| `--ds-color-bg-raised` | :46/135 | `--sb-color-surface-raised` | FAR-05 | anzupassen | 6× genutzt, für `pre`, `th` und Inline-Code in der Vorschau (`preview.css:149, 160, 235, 351`, `app.css:1075, 1094`). sebaro: Code auf `--sb-color-surface-sunken` (`.sb-code`, `.sb-code-inline`), `th` ohne Füllung (`.sb-table th`, sebaro.css:1272) |
| `--ds-color-bg-hover` | :47/136 | `--sb-color-hover-fill` | FAR-08 | Pilot | |
| `--ds-color-bg-fill` | :48/137 | je nach Verwendung `--sb-color-surface-sunken` (Code, Felder) oder `--sb-color-hover-fill` | FAR-05, FAR-08 | Konflikt | Der Dunkelwert weicht ab (#212429 gegen sunken #090C11). Die 8 Verwendungen einzeln zuordnen, keinen Alias bauen |
| `--ds-color-bg-fill-strong` | :49/138 | kein Gegenstück; dem Namen nach `--sb-color-pressed-fill` | FAR-08, DSK-03 | anzupassen | Der Wert ist der von `--sb-color-border` (#D7D9DD/#32353C), nicht der von pressed-fill (#E7E9EC/#25282F). Die 4 Verwendungen werden zu 1-px-Rahmen in `border-strong` (Klammerpaar, DSK-03), zur Ortslinie (Autocomplete-Auswahl) bzw. zu `pressed-fill` (gedrückte Panel-Taste) |
| `--ds-color-bg-scrim` | :50/139 | `--sb-color-scrim` | EBE-03 | Pilot | |
| `--ds-color-fg-default` | :53/141 | `--sb-color-text` | FAR-06 | Pilot | |
| `--ds-color-fg-muted` | :54/142 | `--sb-color-text-muted` | FAR-06 | Pilot | |
| `--ds-color-fg-subtle` | :55/143 | `--sb-color-text-subtle` | FAR-06, DSK-03 | anzupassen | 32× genutzt. sebaro erlaubt subtle nur für große oder unwichtige Schrift. Zeilennummern, Kommentare, Markup-Zeichen, Front Matter und erledigte Aufgaben bekommen `text-muted` |
| `--ds-color-fg-on-accent` | :56/144 | `--sb-color-on-accent` | FAR-02 | Pilot | nicht verwendet; laut FAR-02 nutzt die Oberfläche `on-*` auch nicht |
| `--ds-color-border-default` | :59/146 | `--sb-color-border` | FAR-07 | Pilot | |
| `--ds-color-border-strong` | :60/147 | `--sb-color-border-strong` | FAR-07 | Pilot | |
| `--ds-color-border-control` | :61/148 | `--sb-color-border-strong` | FAR-07 | Pilot | doppelt mit border-strong; beim Umbenennen bleibt ein Name übrig |
| `--ds-color-line-ink` | :62/149 | `--sb-x-sebaro-layer-line-color` | EBE-01, FOR-02 | Pilot | Hell = `text`, Dunkel = `border-strong` |
| Theme-Attribut `data-theme` | `ui/index.html:8`, `main.tsx:19`, `stores/ui.ts:163` | `:root[data-theme="dark"]` / `[data-theme="light"]` (dist/tokens.css §2–§4) | FAR-09 | Pilot | Gleicher Attributname. „System“ löst novalis selbst über `matchMedia` auf |
| Erste Wahl vor dem ersten Bild: localStorage `novalis.appearance` | `main.tsx:13–23`, `stores/ui.ts:164–165` | `js/theme-init.js` liest `sb-theme`, `sb-tone`, `sb-motion` (spec/03 §13.1). Die App gibt die Wahl per Initialisierungsskript an die Seite (spec/09 §13.1) | DSK-14, WEB-01 | Konflikt | sebaro speichert die Wahl in `appearance.json`. Bei novalis ist `settings.json` die einzige Quelle (ADR-0049, fünf Einstellungen). Vorschlag: `settings.json` bleibt, ein Initialisierungsskript aus Rust schreibt `sb-theme`/`sb-motion` für `theme-init.js`, und `novalis.appearance` fällt weg. So gibt es keine zwei Speicher (Rule 3). Ob `theme-init.js` als Datei unter der CSP `script-src 'self'` vor dem ersten Bild läuft, ist nicht geprüft |
| Fenstergrund vor dem ersten Bild | `src-tauri/build.rs` (nur `tauri_build::build()`); Fenster aus `tauri.conf.json` mit `"create": false`, gebaut in `src-tauri/src/lib.rs:137`, `visible: false`, gezeigt in `src-tauri/src/window.rs:81`; kein Hintergrund gesetzt | exportiertes `tokens.json` (`export_system.py:664–665`, nur bei `--target tauri`), in `build.rs` gelesen: `/tokens/color.bg/light`, `/dark`, `/variants/warm/light/bg`, `/dark/bg`. Rezept in spec/09 §13.1 | DSK-14 | neu | Das Rezept liest `sebaro/tokens.json` relativ zu `src-tauri/`. Beim Export nach `ui/src/sebaro` (ADOPTION §5) lautet der Pfad `../ui/src/sebaro/tokens.json`. `serde_json` ist schon eine Abhängigkeit (`src-tauri/Cargo.toml:24`); als `[build-dependencies]` entsteht keine neue Lock-Zeile. Ein heller Blitz im Dunkelmodus ist bis dahin möglich (nicht geprüft) |

### 2 Farben: Akzent, Hauptaktion, Status, Kachel

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| `--ds-color-accent-default` | :66/151 | `--sb-color-accent` | FAR-03 | anzupassen | 18× genutzt. Nicht jede Verwendung markiert Ort, Link oder Fokus. Abweichend sind: der Heute-Ring als Pille (`app.css:351–357`), die Link-Unterstriche (`theme.ts:240`, `preview.css:87`, `board.css:299`; hier gilt `--sb-color-link`, vgl. die `a`-Grundregel sebaro.css:62), die Trennlinie der Seitenleiste beim Zeigen (`app.css:220–225`, siehe §6) und der Rahmen der Karten-Glyphe (`backlinks.css:82`) |
| `--ds-color-accent-hover` | :67/152 | `--sb-color-accent-hover` | FAR-02 | Pilot | nicht verwendet; FAR-02 schließt `accent-hover` in der UI aus |
| `--ds-color-accent-text` | :68/153 | `--sb-color-link` | LNK-01 | Pilot | |
| `--ds-color-accent-fill` | :69/154 | `--sb-color-accent-subtle` | FAR-02, FAR-03, NAV-01 | Konflikt | 9× als Auswahlfläche (`app.css:196, 408, 572`, viewer.css, `preview.css:311`, theme.ts). sebaro: `*-subtle` kommt in der UI nicht vor (Lint L2, spec/03 §1.4); der aktuelle Ort ist die 3-px-Ortslinie |
| `--ds-color-accent-line` | :70/155 | dem Wert nach `--sb-color-selection` | FAR-03 | Konflikt | 6× als Rahmen oder Outline, u. a. als Fokus des Suchfelds (`theme.ts:133–135`, hier gilt ZUG-02). `selection` ist in sebaro nur für die Textauswahl da |
| `--ds-color-focus` | :71/156 | `--sb-color-focus`, `--sb-focus-ring` | ZUG-02 | Pilot | |
| `--ds-color-primary-default` / `-hover` / `-pressed` / `-fg` / `-outline` | :74–78/158–162 | `--sb-color-primary-action` / `-hover` / `-pressed`, `--sb-color-on-primary-action`, `--sb-color-primary-action-outline` | AKT-03, FAR-01 | Pilot | |
| `--ds-color-success-` / `warning-` / `danger-default` | :82/88/94 | `--sb-color-success` / `-warning` / `-danger` | STA-01 | Pilot | |
| `--ds-color-*-text` (success, warning, danger) | :83/89/95 | `--sb-color-text-on-*-subtle` | FAR-02, STA-01 | anzupassen | Die Statusfarbe gehört nur an die Glyphe, das Wort steht in `text`. Für das Gefahrenwort (`app.css:847, 988`) gilt `--sb-color-danger`. `text-on-*` kommt in der UI nicht vor (Lint L2) |
| `--ds-color-*-fill` | :84/90/96 | `--sb-color-*-subtle` | FAR-02 | Konflikt | Eine Fläche hinter Text ist verboten, außer in Diff-Zeilen. Betroffen: `danger-fill` (`app.css:858`), `warning-fill` (Leerzeichen am Zeilenende `theme.ts:82`, Board) |
| `--ds-color-*-line` (abgeleitet, 26 %) | :85/91/97 | kein Token; Hinweis = `.sb-callout` mit 1-px-Haarlinie `--sb-color-border` und gefüllter Glyphe | STA-05 | anzupassen | Genutzt wird nur `warning-line` (4×: `app.css:705, 1093`, board.css). success- und danger-line sind ungenutzt und fallen weg |
| `--ds-color-tile` / `-tile-glyph` | :285–286 | `--sb-tile-collaboration` / `--sb-tile-collaboration-glyph` (#0F8186 / #FFFFFF, dist/tokens.css §6a) | ZEI-01, ZEI-02 | Pilot | Petrol steht nur in der Kachel (D65): `app.css:91–105`, erfüllt |
| Farbton „Warm“ | – | `:root[data-sb-tone="warm"]` (dist/tokens.css §4a) | FAR-15 | Konflikt | Kommt mit dem Export, bleibt aber ohne Einstellung wirkungslos. Für sebaro entschieden (D90, D91 C4c). In novalis wäre es die sechste Einstellung: Frage an den Inhaber |
| Kategorie-Töne | – | `--sb-category-1…6`, `sb-category--1…6` | FAR-12 | – | novalis hat heute keine vom Nutzer vergebenen Farben, also keine Zeile zum Umbauen |

### 3 Farben im Editor und Code-Farben (D69)

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| `--ds-color-editor-selection` | :101/179 | `--sb-color-selection` | DSK-03 | Pilot | |
| `--ds-color-editor-selection-match` (`.cm-selectionMatch`) | :102/180; `theme.ts:49` | keins | DSK-03 | fehlt in sebaro | weglassen oder als Rahmen zeichnen |
| `--ds-color-editor-cursor`, 1.5 px breit | :103; `theme.ts:43–45` | 2 px `--sb-color-accent` | DSK-03 | anzupassen | |
| `--ds-color-editor-active-line` | :104/182 | `--sb-color-hover-fill` | DSK-03 | anzupassen | heute 4 % abgeleitet, in sebaro deckend |
| `--ds-color-editor-gutter`, aktuelle Zeilennummer | :105; `theme.ts:51–58` | `--sb-color-text-muted`, die aktuelle Nummer in `--sb-color-text` | DSK-03 | anzupassen | |
| `--ds-color-editor-match` (warning-subtle-Fläche) | :106/184; `theme.ts:60`, `theme.ts:83–86` (aktueller Treffer: accent-fill plus accent-line) | Editor: 1 px `--sb-color-border-strong` als Rahmen, der aktuelle Treffer derselbe Rahmen auf `--sb-color-selection` (spec/09 §17, spec/01 §1.8). Vorschau-Suche: `mark` / `.sb-mark` (`--sb-mark`, `--sb-mark-edge`), der aktuelle Treffer `mark[aria-current="true"]` mit 3-px-Kante in `text` (sebaro.css:804–808) | DSK-03, FAR-12 | Konflikt | Heute Flächen in `theme.ts:60`, `preview.css` (`mark.preview-hit`, `.current` :310–313) und `overlay.css` (`mark.match`) |
| Klammerpaar | `theme.ts:87–90` | 1 px `--sb-color-border-strong` als Rahmen, keine Füllung | DSK-03 | anzupassen | Für eine nicht passende Klammer hat sebaro keine Rolle |
| Unaufgelöster Wiki-Link (gedimmt und gestrichelt) | `theme.ts:63–66` (ADR-0038) | keins | FOR-03, FOR-02, LNK-01 | Konflikt | Strichlinien sind verboten: Frage an den Inhaber |
| Unsichtbare Zeichen (Punkt, Tab-Linie, Fläche am Zeilenende) | `theme.ts:70–82` (ADR-0029) | keins | FAR-02 | fehlt in sebaro | Die Fläche am Zeilenende (warning-fill) widerspricht FAR-02 |
| Zitat-Linie | `theme.ts:143–147` (2 px `fg-subtle`, 12 px, Text muted), `preview.css:108–112`, `lib/documentCss.ts:30–34` (2 px `border-strong`, 8 px) | `.sb-quote__text`, `.sb-prose > blockquote`: 2 px `--sb-x-sebaro-layer-line-color`, 16 px Abstand, Text in `text`, kein Kursiv (sebaro.css:1466–1469); im Markdown-Quelltext `t.quote` → `text-muted` (spec/09 §17) | TXT-17, FOR-02 | anzupassen | |
| Front Matter: Mono, 0.85em, subtle | `theme.ts:148–152` | spec/01 §1.8: Front Matter folgt den Looks seiner Sprache (YAML). Code steht in sebaro Mono 500 | DSK-03, TXT-10 | anzupassen | Größe in em, siehe Lücke Editor-Typografie. SYSTEM.md §5 schlägt „Mono nur für Codeblöcke und Pfade“ vor (nur Vorschlag) |
| Erledigte Aufgabe | `theme.ts:156` (`nv-task-done`, subtle) | keins | FAR-06 | fehlt in sebaro | Vorschlag: `text-muted` |
| Aufgaben-Kästchen im Editor | `theme.ts:157–171` | Checkbox: Markierung in Kobalt erlaubt, Radius 4 | FAR-03, FOR-01 | Pilot | |
| Suchleiste und „Gehe zu Zeile“ (`.cm-panels`) | `theme.ts:103–138` | Felder auf `--sb-color-surface-sunken`, Radius `--sb-radius-control` (8), Fokus `--sb-focus-ring` | FAR-05, FOR-01, ZUG-02 | anzupassen | heute: Panel `surface`, Felder auf `canvas` mit Radius 4, Fokus 1 px `accent-line` |
| Autocomplete und Tooltip (`.cm-tooltip`) | `theme.ts:91–102` | Menü: Tintenlinie auf `bg`, Radius `--sb-radius-container` (12), die aktive Zeile mit Ortslinie | FOR-01, EBE-01, NAV-01 | anzupassen | heute Radius 8, Auswahl mit `bg-fill-strong` |
| `--ds-color-syntax-keyword` | :115/192 | `--sb-syntax-keyword` (#54258C / #BC98F9) | FAR-11, TXT-10, TEC-08 | Konflikt | heute Link-Kobalt |
| `--ds-color-syntax-string` | :116/193 | `--sb-syntax-string` (#1B490F / #7BB76E) | FAR-11 | Konflikt | heute Erfolgsgrün. `escape` gehört zu constant (spec/01 §1.8.1) |
| `--ds-color-syntax-number` | :118/195 | `--sb-syntax-constant` (#951D52 / #FAA6B2) | FAR-11 | Konflikt | heute `text-on-warning-subtle` |
| `--ds-color-syntax-comment` | :117/194 | `--sb-color-text-muted` | FAR-11 | anzupassen | heute subtle |
| `--ds-color-syntax-type` (Wert = `--sb-color-info`), Property (`fg-muted`), Funktion (Gewicht medium) | :119; `theme.ts:212–223` | plain = `--sb-color-text`, normales Gewicht | TXT-10 | Konflikt | Farbe, Grau und Gewicht fallen weg |
| `--ds-color-syntax-invalid` | :120/197 | `.sb-tok-invalid`: `underline wavy var(--sb-color-danger) 2px` (sebaro.css:1307) | TXT-11 | anzupassen | |
| `inserted` / `deleted` (success-text / warning-text) | `theme.ts:225–226` | `.sb-diff` (Vorzeichen plus Zeilenfläche) | TXT-11 | anzupassen | Änderungen nur über die Farbe zu markieren ist verboten |
| `--ds-color-syntax-marker` | :109/186 | Markdown-Quelltext: `--sb-color-text-muted`; Code: `--sb-color-text` | DSK-03 | anzupassen | |
| `--ds-color-syntax-heading` | :110/187 | `--sb-color-text` + `--sb-type-title-weight` | DSK-03 | Pilot | |
| `--ds-color-syntax-link`; `a` in `lib/documentCss.ts:35` | :111/188 | Linkstil: Wort in `text`, 2 px `--sb-color-link` (`--sb-x-sebaro-link-underline-width`, 0.2em Abstand) | LNK-01 | anzupassen | documentCss färbt heute das Wort kobalt und unterstreicht dünn |
| `--ds-color-syntax-tag` (Tag-Chip) | :112; `theme.ts:243–251` | dem Wert nach `--sb-color-text-on-accent-subtle`; der Form nach am nächsten `.sb-tag` (umrandet, nicht interaktiv) | FAR-03, STA-04 | Konflikt | kobaltgefüllt und ⌘-klickbar (ADR-0037, Chip seit ADR-0022): Frage an den Inhaber |
| `--ds-color-syntax-code` (Inline-Code) | :113/190 | `--sb-color-text`, Mono auf `--sb-color-surface-sunken` (`.sb-code-inline`, sebaro.css:1294) | DSK-03 | anzupassen | |
| `--ds-color-syntax-quote` | :114/191 | `--sb-color-text-muted` (Quelltext) | DSK-03 | Pilot (Wert) | In der Vorschau steht das Zitat in `text` mit Tintenlinie (TXT-17, siehe oben) |
| Klassen `.tok-*` in Vorschau und Fences | `preview.css:175–217`, `editor/fences.ts:59` | `.sb-tok-keyword` / `-string` / `-constant` / `-comment` / `-invalid` (sebaro.css §6, :1296–1307) | TEC-08 | anzupassen | Entscheidung: Die Fences schreiben `sb-tok-<look>`, die `.tok-*`-Regeln entfallen, wie spec/01 §1.8.1 es anbietet. Der Paritätstest von Fences und preview.css ändert sich mit |
| `HighlightStyle` (`CODE_RULES`, `markdownHighlight`) | `theme.ts:191–262` | `sebaroHighlight` (spec/09 §17) | TEC-08, DSK-03 | neu | spec/09 sagt dazu „CodeMirror only by reading, not run“. spec/09 hat im Arbeitsbaum ungespeicherte Änderungen |
| Mermaid-Diagramme | `components/Preview.tsx:82–88` | keins | FAR-01 | fehlt in sebaro | Mermaid nutzt seine eigene Palette `dark`/`default` |

### 4 Schrift

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| `--ds-font-sans` „Radio Canada“ | tokens.css:212 | `--sb-font-family-ui` „sebaro Sans“ | SCH-01 | anzupassen | Neuer Familienname (D68, D71). Die Metriken gegenüber Radio Canada habe ich nicht verglichen |
| `--ds-font-mono` | :213 | `--sb-font-family-mono` | SCH-01 | Pilot | Der Stapel bekommt Menlo dazu |
| Dateien | `src/fonts/`, `styles/fonts.css`: radio-canada-latin-de 21.092 B, -italic 21.824 B, sebaro-mono-latin-de 15.932 B (400) | `fonts/fonts.css` mit `fonts/web/sebaro-sans-latin-de.woff2` 22.116 B, `-italic` 22.992 B, `sebaro-mono-latin-de.woff2` 16.824 B (**500**) | SCH-02, ICO-08 | anzupassen | Summe 58.848 → 61.932 B, also 60,5 von 250 kB `fontsKb`; das Budget hält. Die neuen Dateien bringen die Tastenzeichen mit (U+2318, 21E7, 2325, 2303, 21A9, 238B, 232B, 21E5 im unicode-range). Die alten Dateien müssen weg, weil bundle-budget jede Schriftdatei unter `dist` zählt |
| Element-Grundregeln von sebaro.css | sebaro.css:35–67 (§1 base) | `h1`–`h3` mit den rem-Rollen display/headline/title, `p { max-inline-size }`, `a`, `code, kbd, samp` → `--sb-type-code`, `:not(pre) > code` auf sunken, `::selection`, `:focus-visible` | SCH-04, LNK-01 | neu | Sie gelten global, sobald sebaro.css geladen ist, also auch in der Vorschau, den Viewern und der UI. Sie überschreiben dort die em-Skala und `0.9em`-Code (`preview.css:31–61`, `theme.ts:155`). Jede Ansicht muss sie bewusst übernehmen oder überschreiben (nicht geprüft) |
| Gewichte `--ds-font-weight-regular` / `-medium` / `-strong` (400/430, 570/600, 670/700) | :123–125/200–202 | `--sb-type-body-weight`, `--sb-type-label-weight` / `--sb-type-body-strong-weight`, `--sb-type-title-weight` | SCH-05 | Pilot | Die Gewichtsverschiebung im Dunkelmodus (+30) ist schon da |
| Laufweite `--ds-letter-spacing-ui` / `-title` / `-mono` (0em in beiden Modi) | :227–229 | `--sb-type-label-tracking` / `--sb-type-title-tracking` / `--sb-type-code-tracking` | SCH-05 | anzupassen | Im Dunkelmodus fehlen +0.01em. Zu jedem `font: var(--sb-type-X)` gehört `letter-spacing: var(--sb-type-X-tracking)` |
| Literale Laufweite −0.02em / −0.022em; Gewicht 550 | `preview.css:50`, `theme.ts:141`, `app.css:1055–1056` | keins; Rollen-Tracking verwenden | SCH-04 | anzupassen | |
| `--ds-font-size-root` 14 px (auf `body`, `app.css:25`) | :215 | UI-Text `--sb-type-label` / `--sb-type-caption` (14/20), Inhalt `--sb-type-body` (16/24) | SCH-04 | anzupassen | `html` hat keine eigene Größe (Browser-Standard 16 px), die sebaro-rem-Werte stimmen also |
| `--ds-font-size-ui` 14 | :216 | `--sb-type-label-size` / `--sb-type-caption-size` | SCH-04 | Pilot (Wert) | |
| `--ds-font-size-ui-sm` 12 (21×), `--ds-font-size-mono-sm` 12 (3×), Literale 12 und 12.5 px | :217–218; `app.css:1062, 1078`; `overlay.css:55` | am Desktop keins; `--sb-type-mobile-label-small` nur für die untere Navigation | SCH-04 | Konflikt | Frage an den Inhaber. Auch der Stand-Satz der Aktionszone steht heute in 12 px (`app.css:873`); in sebaro ist er caption, `text-muted` |
| `--ds-font-size-mono` 13 | :219 | `--sb-type-code-size` 14 | SCH-04, TXT-08 | anzupassen | Gutter, Leisten der Viewer |
| Literale Größen 20 / 17 / 16 / 15 / 14 px | `app.css:678, 936, 1054`, `board.css:29`, `overlay.css:26` (15), `overlay.css:38` (14) | `--sb-type-title` (20/28), `--sb-type-body-strong`, `--sb-type-label`; der Prompt-Pfeil wird zum Icon `search` | SCH-04 | anzupassen | |
| `--ds-font-size-editor` 16 px (zur Laufzeit gesetzt, `stores/ui.ts:178–180`) | :222 | kein Token; Startwert = `--sb-type-body-size` | – | fehlt in sebaro | bleibt eine novalis-eigene Eigenschaft (nicht `--sb-*`, keine Alias-Schicht), wie das schon vorhandene `--nv-indent` |
| `--ds-line-height-ui` 1.4286 | :224 | `--sb-type-label-line-height` | SCH-04 | Pilot | |
| `--ds-line-height-editor` 1.6 | :225 | `--sb-type-body-line-height` 1.5 | SCH-04 | Konflikt | Frage an den Inhaber |
| Überschriften in Editor und Vorschau 1.55 / 1.24 / 1.1 em | `theme.ts:140–142`, `preview.css:31–61`, `documentCss.ts:23–26` | rem-Rollen display/headline/title (sebaro.css:41–43) | SCH-04 | fehlt in sebaro | rem würde `editor.fontSize` übergehen, deshalb bleibt die em-Skala |
| Kursiv | `theme.ts:234`, italic-Datei | Kursiv nur im Markdown-Quelltext (DSK-03), sonst keine Kursive in der UI | SCH-04, DSK-03 | Pilot | |
| `tabular-nums` (etwa 10 Stellen) | z. B. `app.css:875`, `viewer.css:140` | `.sb-num` / `--sb-type-numeric-variant` | SCH-03 | Pilot | Die Viewer-Leisten stehen ganz in Mono (`viewer.css:34, 81, 229`); für ihre Zähler widerspricht das SCH-03 |
| `text-transform: uppercase` | `backlinks.css:26` | verboten | TXT-05 | Konflikt | |

### 5 Abstände, Radien, Linien, Ebenen

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| `--ds-space-1` 2 · `-2` 4 · `-4` 8 · `-5` 12 · `-6` 16 · `-7` 20 · `-8` 24 · `-9` 32 | tokens.css:231–239 | `--sb-space-0-5` · `-1` · `-2` · `-3` · `-4` · `-5` · `-6` · `-8` | RAU-01 | Pilot | wertgleich, weil `html` 16 px hat |
| `--ds-space-3` 6 px (29×) | :233 | keins | RAU-01 | Konflikt | je nach Rolle auf 4 oder 8 runden: Frage an den Inhaber |
| `--ds-radius-control` 8 / `-container` 12 / `-chip` 4 | :242–244 | `--sb-radius-control` / `--sb-radius-container` / `--sb-radius-small` | FOR-01 | Pilot | |
| Radien je Klasse | Codeblock: `preview.css:156–162`, `documentCss.ts:37` (8); Karte: `board.css:228–235` (8, linke Kante 3 px `border-strong`) | Codeblock `.sb-code` 12 auf sunken (sebaro.css:1281); Karte `sb-card--item` 12, 1 px `border-strong`, Ortslinie nur bei Fokus | FOR-01, TXT-08, DAT-13 | anzupassen | D67 (11): Karten mit 1-px-Rand, die Ortslinie nur bei Fokus |
| Literale Radien 2 / 1.5 / 1 px | `overlay.css:113`, `board.css:332`, `backlinks.css:73, 81` | keins; das sind gezeichnete Glyphen, die Icons aus dem Sprite werden | FOR-01, ICO-04 | anzupassen | |
| `--ds-radius-pill` (7×: Punkte, Zähler, Scrollbar-Daumen, Heute-Ring) | :245; `app.css:356, 511, 585, 650, 904, 1029`, `board.css:101` | `--sb-radius-pill` | FOR-06 | Konflikt | Der Pill-Radius ist nur für Avatar, Switch, Radio und Schieberegler-Daumen erlaubt. Status- und Schmutzpunkte werden Glyphen. Der Spaltenzähler `board.css:95–103` ist zusätzlich eine Fläche hinter Text (FAR-02) |
| Dialog-Radius (heute container 12) | `app.css` `.dialog` | `--sb-radius-sheet` 16 (`.sb-dialog`, sebaro.css:1925–1928) | EBE-03, FOR-01 | anzupassen | Die Palette bleibt bei 12 (`.sb-command-palette`) |
| `--ds-line-ink` 2 | :249 | `--sb-x-sebaro-layer-line-width` | EBE-01 | Pilot | |
| `--ds-line-place` 3 | :250 | `--sb-border-width-strong` | NAV-01, FOR-02 | Pilot | spec/02 §0.2 nennt genau dieses Token für die Ortslinie |
| `--ds-line-link` 2 | :251 | `--sb-x-sebaro-link-underline-width` | LNK-01 | Pilot | |
| `--ds-line-control` 1 | :252 | `--sb-border-width-control` | FOR-02 | Pilot | |
| `--ds-line-focus` 2, `outline-offset: 2px` | :253; `app.css:749` | `--sb-focus-width`, `--sb-focus-offset`, `--sb-focus-ring` | ZUG-02 | Pilot | |
| `1px` als Literal (über 60×) | alle Stylesheets, theme.ts, documentCss.ts | `--sb-border-width-hairline` | FOR-02, TEC-01 | anzupassen | |
| `--ds-size-danger-bevel` 12 | :254 | `--sb-x-sebaro-danger-bevel-size` | FOR-04 | Pilot | |
| `--ds-shadow-modal: none` | :127/204 | `--sb-elevation-overlay-shadow` (none) | EBE-01 | Pilot | nicht verwendet, kann wegfallen |
| Deckkraft für Gesperrtes und Ziehen: 0.35 / 0.5 / 0.55 / 0.6 | `viewer.css:101`, `board.css:152, 251`, `app.css:151, 595` | Gesperrt: `text-muted`, Rand `border`, `cursor: not-allowed`, nie Deckkraft. Ziehen: gezogene Zeile mit 2-px-Tintenrand, Ziel mit 3 px `accent` | STA-03, DSK-11 | Konflikt | `app.css:151` ist ein Trenner im Pfad, `app.css:595` das Kreuz des Reiters |
| Einblenden beim Zeigen über Deckkraft 0 → 1 | `board.css:126/134` (Spaltenaktionen), `board.css:205/210`, `app.css:595/607` (Kreuz des Reiters) | Kreuz: am aktuellen Reiter immer, an den anderen beim Zeigen oder Fokus (DSK-10). Das „Mehr“-Zeichen der Karten ist immer sichtbar (D67 (11)) | DSK-10 | anzupassen | |
| z-index 1 / 2 / 10 / 20 / 50 / 100 | `preview.css:349`, `app.css:217, 921, 1012, 114, 1089`, `viewer.css:252` | `--sb-layer-sticky` 20 · `-dropdown` 30 · `-overlay` 40 · `-modal` 50 · `-popover` 60 · `-toast` 70 · `-tooltip` 80 | – | anzupassen | |
| Scrollleisten | `app.css:1021–1033` | keine Regel; nur `scrollbar-width: thin` an `.sb-doc-tabs` (sebaro.css:2449) | – | fehlt in sebaro | |

### 6 Maße und Zeilenhöhen (32 / 48 / 64)

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| `--ds-size-titlebar` 48, Abstand der Ampeln 82 px | :267; `app.css:86` | `--sb-size-control-md`, `.sb-window__titlebar` (sebaro.css:2275–2277); 80 px (`space-16 + space-4`) über `:root[data-sb-platform="mac"]` (sebaro.css:2373–2374) | DSK-06 | anzupassen | spec/09 §13.1 nennt `trafficLightPosition` {x: 16, y: 18}; novalis setzt das heute nicht |
| `--ds-size-tabstrip` 40 | :268 | `.sb-doc-tabs`, `min-block-size: var(--sb-size-control-sm)` = 32 (sebaro.css:2450) | DSK-10 | anzupassen | Wird auch für die Leisten der Viewer genutzt (6× insgesamt) |
| `--ds-size-statusbar` 56 | :269 | – | – | anzupassen | nicht verwendet, fällt weg |
| `--ds-size-action-zone` 56 (Höhe der Leiste), Hauptaktion darin 32 (`.btn` = `--ds-size-control`) | :270; `app.css:864–882, 728–736` | `.sb-bottom-block` mit `.sb-primary-action-bar`: Polster 12 (`--sb-space-3`), Taste `--sb-size-control-lg` 56, mindestens 200 px breit (sebaro.css:2311–2316, :443) | AKT-02, EBE-08, RAU-06 | anzupassen | In sebaro ist die **Taste** 56 px hoch, die Zone also etwa 80 px. novalis hat eine 56-px-Zone mit 32-px-Taste. ADR-0048 („A 56 px action zone“) muss nachgetragen werden |
| `--ds-size-row` / `-control` 32 | :271–272 | `--sb-size-control-sm` unter `data-sb-density="window"` | RAU-05, RAU-06 | Pilot | `size-row` nutzt nur die Heute-Zeile (`app.css:345`) |
| Baumzeile `ROW_HEIGHT = 28`; Einzug `14 + depth*16` | `components/Sidebar.tsx:43, 322` | 32 px; 16 px je `aria-level` (`.sb-tree__row`, sebaro.css:2149–2159) | NAV-11, RAU-06 | anzupassen | |
| Tabellenzeile 28 | `components/TablePreview.tsx:17` | 32 | RAU-06 | anzupassen | |
| Palette: Zeile 34, Eingabe 46, Fuß 36 | `overlay.css:78, 18, 152` | Zeilen 32 (`.sb-row`), Suchzeile 48 (`--sb-size-control-md`, sebaro.css:2231–2234), Fuß 8 + caption 20 + 8 = 36 (sebaro.css:2255–2258) | NAV-09, RAU-06 | anzupassen | Der Fuß bleibt gleich hoch |
| Backlinks-Kopf 28, Spaltenkopf 40 | `backlinks.css:16`, `board.css:80` | 32 (Board-Kopf, spec/02 §3.16) | RAU-06, DAT-13 | anzupassen | |
| Werkzeuge 24 / 22 / 22 | `app.css:274`, `board.css:139`, `viewer.css:87` | `.sb-icon-button--compact` 32 mit Icon `--sb-size-icon-md` 20 (sebaro.css:2208–2209) | NAV-10, ZUG-03 | anzupassen | |
| `.kbd` 18 px (wird als Umschalter genutzt, `SearchPanel.tsx:186–202`) | `app.css:164–181` | Umschalter: `.sb-chip[aria-pressed]` (sebaro.css:756–758); Tastenkürzel: `.sb-keys` (grau, ohne Rahmen) | EIN-04, ICO-08 | anzupassen | |
| `--ds-size-icon` 16 | :273 | `--sb-size-icon-sm` | ICO-04 | Pilot | |
| `--ds-size-tile` 32 | :274 | `.sb-sign-tile--32` (sebaro.css:974); das Token `--sb-x-sebaro-sign-tile-size` ist 48 | ZEI-05 | Pilot | |
| `--ds-size-start-tile` 96 | :275 | `--sb-x-sebaro-start-tile-size` | STR-01 | Pilot | |
| `--ds-size-sidebar` 256 / `-min` 180 / `-max` 480; Startwert 256 | :276–278; `stores/ui.ts:185, 206`; `SidebarResize.tsx:10` | kein Token. `.sb-side-nav` 240 px (sebaro.css:1891); `.sb-window__divider` mit `aria-valuemin="200"`, `aria-valuemax="360"`, `aria-valuenow="240"` (sebaro.css:2376–2379, `js/sb-window.js`) | NAV-04, DSK-07, D100 | anzupassen | 240 und 200–360 sind fest entschieden. Die Breite ist Zustand, keine Einstellung |
| Trennlinie der Seitenleiste beim Zeigen und Fokus: Kobaltlinie über `linear-gradient` | `app.css:220–225` | `.sb-window__divider` ist selbst die 2-px-Tintenlinie. Beim Zeigen ändert sich nur der Zeiger, die Tastatur zeigt den Fokusring (sebaro.css:2376–2391) | DSK-07, FOR-03, FAR-03 | Konflikt | |
| `--ds-size-palette` 640 (auch für den Dialog) | :279 | Palette und Dialog fest `min(560px, …)` (sebaro.css:2223, 1926) | NAV-09, EBE-03 | anzupassen | |
| `--ds-size-board-column` 268 | :280 | `.sb-board__column`: `flex: 1 1 0`, `min-inline-size: 240px` (sebaro.css:1613–1614) | DAT-13 | anzupassen | |
| `--ds-measure-editor` 70ch | :281 | `--sb-size-measure-prose` | TXT-06 | Pilot | |
| `--ds-size-progress-bar` 6 | :265 | `--sb-x-sebaro-primary-action-progress-height` | AKT-05 | Pilot | |

### 7 Bewegung

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| `--ds-motion-duration` 160 ms | :258 | `--sb-motion-duration-medium`; Farb- und Zustandswechsel `--sb-motion-duration-short` 120 ms (spec/02 §0.4) | BEW-03 | anzupassen | 9 Übergänge mit 16 Verwendungen der Dauer-Tokens prüfen |
| `--ds-motion-duration-long` 200 ms | :259 | `--sb-motion-duration-long` | BEW-03 | Pilot | |
| `--ds-motion-ease` | :260 | `--sb-motion-easing-standard`; Eintritt mit `--sb-motion-easing-emphasized`, Schließen mit `-exit` | BEW-02, BEW-03 | anzupassen | |
| `--ds-motion-enter-distance` 8 | :261 | `--sb-x-sebaro-enter-distance` | BEW-02 | Pilot | nicht verwendet. Neues tritt von unten ein (`.sb-enter`, `:modal`, sebaro.css:1942–1946) |
| `--ds-motion-progress-period`; `@keyframes btn-sweep` | :264; `app.css:776–818` | `--sb-x-sebaro-primary-action-progress-period`, `.sb-primary-action__bar` | AKT-05 | anzupassen | Bei reduzierter Bewegung steht der Balken still, volle Breite, 40 % (`app.css:806–818`). Das entspricht AKT-05 schon |
| Bewegung reduzieren: `data-motion="reduced"` setzt die Dauer-Tokens auf 1 ms | tokens.css:292–304; `stores/ui.ts:172–176`; ADR-0049 | Die Media Query kürzt die Dauer-Tokens (dist/tokens.css §7). `html[data-sb-motion="reduce"]` ändert die Tokens **absichtlich nicht** (spec/03 §13.1); jede bewegte Regel ist doppelt abgesichert. In sebaro.css sind das 6 Regeln (Zeilen 473, 556, 1677, 1946, 1950, 2167) | BEW-04 | Konflikt | Die eigenen Übergänge von novalis (`app.css:121, 391, 552, 596, 740`, `board.css:127, 236`, `overlay.css:82`, `preview.css:318`) laufen nach dem Umbau trotz Schalter weiter, wenn sie nicht nach dem Muster aus spec/03 §13.1 geschrieben sind. Entscheidung: das Attribut in `data-sb-motion="reduce"` umbenennen und keine eigene Dauer-Überschreibung behalten, damit nicht zwei Wege gemischt werden. Gespeichert bleibt in `settings.json` (ADR-0049), nicht in localStorage `sb-motion` |
| Startkachel (Flug mit translate/scale, Notfall-Timer 1000 ms) | `components/StartTile.tsx:30, 35`, `app.css:121` | bei reduzierter Bewegung nur Einblenden (`js/sb-start.js`) | STR-01, BEW-04 | anzupassen | |
| Toast 6000 ms | `components/Toast.tsx:17` | fest 6 s, kein Token | EBE-05 | Pilot (Wert) | |
| Aufleuchten des Sprungziels 1200 ms als warning-subtle-Fläche | `components/Preview.tsx:50`, `preview.css:315–323` | Ortslinie am Anfang, wie die angesprungene Fußnote (`.sb-note:target`, sebaro.css:2595) | NAV-01, FAR-02, BEW-01 | anzupassen | Die Fläche widerspricht FAR-02. Ob die Ortslinie nach 1,2 s wieder verschwinden darf, sagt sebaro nicht |

### 8 Größe der eager geladenen CSS gegen das Budget

Gemessen mit lightningcss 1.33.0 aus dem novalis-Lockfile, Ziel Safari 17, minifiziert. Kontrolle: Mit derselben Methode ergeben die heutigen novalis-Dateien genau die Anteile im Build (tokens 5.697 B, app.css 17.206 B). Einen echten Vite-Build habe ich **nicht** gemacht. Die Rohgrößen habe ich nachgeprüft: 2.130 / 42.559 / 1.831 / 230.459 B. Die minifizierten Werte habe ich nicht nachgemessen.

| Datei (Export) | roh | minifiziert | gzip (minifiziert) |
|---|---|---|---|
| `fonts/fonts.css` | 2.130 | 1.329 | 336 |
| `tokens.css` | 42.559 | 36.077 | 3.796 |
| `icons/sprite.css` | 1.831 | 1.101 | 367 |
| `css/sebaro.css` | 230.459 | 152.290 | 21.573 |
| **zusammen** | 276.979 | **190.797 B ≈ 186 KiB** | **25.870 B ≈ 25 KiB** |

- **Budget:** `eagerCssKb` 24, also 24.576 B. Gemessen wird roh mit `statSync` (`scripts/bundle-budget.mjs:79`). ADR-0048 nennt 23,5 von 24 kB. Die 24.084 B im heutigen Build sind nicht nachgeprüft.
- **Ergebnis:** Nach ADOPTION §5 Schritt 2 läge die eager CSS etwa beim 7,8-Fachen des Budgets, ohne den Rest von app.css. Schon `tokens.css` allein (36 kB) reißt das Budget.
- **Kürzen geht nicht:** Exportierte Dateien dürfen nicht von Hand gekürzt werden. Das Budget lässt sich nur per ADR halten oder mit einem kleineren Export von sebaro: Frage an den Inhaber.

### 9 Folgen außerhalb der Stylesheets

- `packages/tokens` (`tokens.css`, das ungenutzte `swiss.tokens.css`, die veraltete README) ist nach dem Umbau überflüssig.
- `justfile` `tokens-sync` (Z. 119–124) und die Zeile „GENERATED-PENDING“ in CLAUDE.md beschreiben dann einen Weg, den es nicht mehr gibt.
- In CI fehlt eine Prüfung auf feste Farben. Heute gibt es dafür nur einen Haken in `.github/PULL_REQUEST_TEMPLATE.md:21`. sebaros Lints L1–L7 (spec/03 §1.4, Skript `lint-colour.sh` als Codeblock) werden nicht exportiert. ADOPTION §2.4 sagt dazu: bewusst kopieren. Für novalis passen L2 (kein `*-subtle`, kein `text-on-*`), L4 (Statusfläche nur an Schalter, Radio, Regler) und L5 (keine Hex-Werte). Heute gibt es in `ui/src` keinen einzigen Hex-Wert.
- Nicht geprüft: das Aussehen bei 200 % Schrift, hell und dunkel, und alle Wirkungen in einer echten Tauri-WebView.

### Prüfung

**Was ich berichtigt habe:**
- **Pilot-Zeile der Aktionszone (§6):** Sie war falsch. `--sb-size-control-lg` ist in sebaro die Höhe der Taste (56) und nicht die der Leiste. Die Zone ist rund 80 px hoch. In novalis steckt eine 32-px-Taste in einer 56-px-Zone.
- **`.sb-doc-tabs`:** nutzt `--sb-size-control-sm`. „kein Token“ war falsch.
- **Sprungziel:** fehlt in sebaro nicht. Das Gegenstück ist die Ortslinie wie bei `.sb-note:target`.
- **Fenstergrund:**
  - Quelle ist das **exportierte** `tokens.json`, das `export_system.py` nur bei `--target tauri` ablegt.
  - Das Rezept steht in spec/09 §13.1.
  - Der Pfad weicht vom Exportordner ab.
  - `serde_json` ist keine neue Abhängigkeit (`src-tauri/Cargo.toml:24`).
- **Bewegung:**
  - `data-sb-motion` steht in 6 Regeln, nicht in 8 (zwei Treffer sind Kommentare).
  - Dass das Attribut die Tokens nicht ändert, ist in spec/03 §13.1 gewollt.
  - Weitere eigene Übergänge habe ich ergänzt.
- **Ortsangaben:**
  - `board.css:134` → `:152`.
  - `overlay.css:38` ist 14 px.
  - Link-Unterstrich `theme.ts:240` statt `:238`.
- **Zählungen:**
  - `1px`: über 60, nicht etwa 45.
  - `tabular-nums`: etwa 10.
  - Übergänge: 9 Deklarationen mit 16 Verwendungen der Dauer-Tokens, nicht 15.
- **Ergänzte Zeilen:**
  - Theme-Attribut und Erstwahl in localStorage gegen `theme-init.js`
  - globale Element-Regeln von sebaro.css
  - Link-Unterstriche in Kobalt (`preview.css:87`, `board.css:299`)
  - Trennlinie der Seitenleiste
  - Zitat-Linien, Front Matter, erledigte Aufgabe, Kästchen
  - Suchleiste und Autocomplete im Editor
  - Radien von Codeblock und Karte, literale Radien
  - Einblenden über Deckkraft
  - `--sb-layer-dropdown`
  - aktueller Suchtreffer in der Vorschau
  - Kategorie-Töne (ohne Element in novalis)
- **Lückenliste:**
  - Gestrichen sind „Statuslinien“ (sebaro hat `.sb-callout`, STA-05) und „6-px-Stufe“ (Rundung nach RAU-01, keine Lücke).
  - Neu ist der Widerspruch zwischen ADOPTION §2.4 und dem Export-Werkzeug.
  - Der Vorschlag für unaufgelöste Links ist ohne eigene `border-strong`-Linie formuliert, weil FOR-02 jeder Linie eine Bedeutung gibt.
- **Fragen:**
  - Bei „unaufgelöster Link“ lautet die Empfehlung jetzt C statt A, weil A eine neue Linienbedeutung einführt (FOR-02).
  - Bei „Farbton“ steht jetzt dabei, dass sebaro FAR-15 schon entschieden hat; in novalis fehlt nur die ADR.

**Bestätigt:**
- Alle zitierten `--sb-*`-Tokens, Klassen, Regel-IDs, Entscheidungen und spec-Abschnitte existieren.
- Die Werte von Hell und Dunkel stimmen.
- Die Schriftgrößen stimmen.

**Nicht prüfen konnte ich:**
- die minifizierten und gzip-Größen sowie die 24.084 B im heutigen Build
- ob `theme-init.js` unter der CSP vor dem ersten Bild läuft
- die Metriken von sebaro Sans gegenüber Radio Canada
- jede Wirkung in der echten WebView und bei 200 % Schrift

spec/09 und D100 sind im Arbeitsbaum von sebaroDesign geändert und noch nicht committet. Sie können sich bis zum Export noch ändern.

## 6 Fenstergerüst und Navigation

Dieser Abschnitt ist nur eine Bestandsaufnahme. Am Code wurde nichts geändert. Es gibt weder Screenshots noch Laufzeitprüfungen.

**Quellen:**
- novalis auf dem Branch `sebaro-umbau` (= v1.2.0).
- sebaroDesign als Arbeitsbaum. HEAD ist D99. D100 steht nur uncommittet in `DECISIONS.md`, deshalb bleibt der Export nach Schritt 3 gesperrt.
- Guide `rules/rules.json`, Version 2.9.0 (Quelle „D1-D99“). Keine Regel nennt D100. DSK-07 und NAV-04 stimmen aber damit überein.

**Abkürzungen:**
- `UI/` = `apps/desktop/ui/src/`
- `Shell/` = `apps/desktop/src-tauri/src/`
- `sb:` = sebaroDesign `systems/sebaro/`

**Stand-Werte:** schon im Pilot · anzupassen · neu zu bauen · fehlt in sebaro · Konflikt · bleibt. Bei „(ADR)“ braucht die Änderung ein novalis-ADR mit dem Wortlaut des Inhabers (CLAUDE.md, D65, D67, ADOPTION §5).

### A Fenster, Titelleiste, Start

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Fensterwurzel `.win` | UI/App.tsx:367; app.css:56 | `.sb-window.sb-window--fill` + `data-sb-density="window"` (spec/02 §4.12, §4.17) | DSK-01 (vorläufig), DSK-04, RAU-05, RAU-06 | neu zu bauen | Die Fensterdichte bringt 32-px-Zeilen in Baum, Menü und Palette. |
| Körper `.body` (Flex) | UI/App.tsx:369; app.css:63 | `.sb-window__body`: Grid `auto · minmax(min(480px, 100%), 1fr) · auto`, mit Teilern 5 Spalten (sb:css/sebaro.css Abschnitt 7a; `:has(> .sb-window__divider)`) | DSK-04 | neu zu bauen | Der Inhalt behält mindestens 480 px. Bei Container-Breite unter 722 px wird die Seitenleiste zum Overlay. |
| Inhalt `main.main` | UI/App.tsx:376; app.css:69 | `main.sb-window__content` (spec/02 §4.17, §4.20) | DSK-04 | anzupassen | |
| Fenstergröße 1280×800, Minimum 720×480 | Shell/../tauri.conf.json:17-20 | Minimum 480×400 (D91 F2a; spec/09 §13.1) | DSK-07 | anzupassen (durch D91 F2a entschieden) | DSK-07 nennt „Ein großes Mindestfenster“ ausdrücklich als Fehler. Die Verhaltensänderung kommt ins Umbau-ADR, ist aber keine eigene Frage. |
| Fenster aus der Konfiguration: `create: false`, `visible: false`, `dragDropEnabled: false`, `titleBarStyle: Overlay`, `hiddenTitle`; in Rust mit `WebviewWindowBuilder::from_config` gebaut und nach `window::restore` gezeigt | tauri.conf.json:13-26; Shell/lib.rs:129-138; Shell/window.rs:68-82 | spec/09 §13.1: `"windows": []`, Fenster ganz in Rust, `trafficLightPosition` 16/18, Fenstergrund aus dem exportierten `tokens.json` über `build.rs` | DSK-06, DSK-14 | anzupassen | Es fehlen `trafficLightPosition` und ein Fenstergrund. `build.rs` enthält nur `tauri_build::build()`. `serde_json` als build-dependency wäre neu (ADR). `visible: false` wird gleich nach dem Positionieren aufgehoben, nicht erst nach dem ersten Bild. Das DSK-14-Verbot („nach dem ersten Bild zeigen“) ist damit wohl nicht verletzt, zur Laufzeit aber nicht geprüft. `dragDropEnabled: false` hängt an §4.22 (siehe B). |
| Titelleiste `header.titlebar` (48 px, links 82 px frei, `data-tauri-drag-region`) | UI/components/TitleBar.tsx:41; UI/styles/app.css:80-89 | `.sb-window__titlebar` (48 px, 2-px-Tintenlinie unten, Text nicht markierbar). Die 80 px setzt `html[data-sb-platform="mac"]:not([data-sb-fullscreen]) .sb-window--fill > .sb-window__titlebar` | DSK-06 | Pilot: Höhe, Tintenlinie, Ziehfläche. Anzupassen: Klasse, 80 statt 82 px, `data-sb-platform`, `data-sb-fullscreen` | Woher die Seite das Vollbild-Ereignis bekommt, ist nicht geprüft. Rust kennt `is_fullscreen` (window.rs:55). |
| App-Kachel `AppTile`, 32 px | UI/components/Icon.tsx:76-89; TitleBar.tsx:42; app.css:93-105 | `.sb-sign-tile.sb-sign-tile--32` mit `brand/inline/tile-novalis-small.svg` aus dem Export (`#0F8186` = `--sb-tile-collaboration`) | ZEI-01, ZEI-05, ZEI-06, ZEI-07 | Pilot: Petrol nur hier (D65). Anzupassen: Datei | Verglichen: Pfad, `viewBox`, `rx` und Transform sind gleich. novalis färbt über Tokens, die sebaro-Datei mit Hex. ZEI-07 verlangt die erzeugte Datei unverändert („bearbeite nie die eingefügten Kopien“). |
| App-Name in der Leiste | fehlt (TitleBar.tsx:41-53) | `.sb-window__name` (label) | DSK-06, ZEI-06 | neu zu bauen | ZEI-06: Die Kachel steht immer mit Namen. Mit dem Namen daneben ist die Kachel `aria-hidden`. |
| Brotkrumen Vault / Ordner / Notiz bzw. Vault / Board; Trenner „/“ per CSS | TitleBar.tsx:26-52; app.css:130-159 (Trenner :149-152) | `.sb-window__path` (caption) mit `chevron-right--16` zwischen den Orten; der letzte Ort in `text` und label-Gewicht; `sb-visually-hidden` „Ort: “ | ICO-06, NAV-08, TXT-16 | anzupassen | Der Kommentar in TitleBar.tsx:9 nennt „▸“, der Code zeichnet „/“. NAV-08 verlangt für Brotkrumen `nav > ol`, spec/02 §4.17 zeigt `__path` als `p` mit Spans. Wo das eine endet und das andere beginnt, ist unklar (Lücke L13). |
| Werkzeuge in der Leiste | keine | `.sb-window__tools[role=group]` mit `sb-icon-button--compact[data-sb-window-toggle][aria-controls][aria-expanded]` (Icon `sidebar`) | DSK-04, NAV-10 | neu zu bauen (ADR, Frage F13) | DSK-04 verlangt für jeden ausblendbaren Teil ein Werkzeug und einen Menüpunkt. Heute gibt es nur Menü, ⌘\\ und Palette. |
| Systemfenstertitel „Stamm — Vault“ | UI/lib/windowTitle.ts:11-15; App.tsx:261-267 | „<Ort> · novalis“ (spec/02 §4.17) | DSK-06 | anzupassen | Eine Datei außerhalb des Vaults heißt heute nur nach ihrem Stamm, ohne App-Namen. |
| Start-Kachel | UI/components/StartTile.tsx:1-52; app.css:107-128 | `.sb-start`, `.sb-start__tile`, `js/sb-start.js` (`sbStart.hold()` / `release()`), `--sb-x-sebaro-start-tile-size` (spec/03 §14) | STR-01, STR-02, BEW-04 | anzupassen | Bei reduzierter Bewegung springt die Kachel heute (Dauer-Token 1 ms, StartTile.tsx:8-9). STR-01: Sie blendet an Ort und Stelle aus. |
| Theme vor dem ersten Bild | UI/../index.html:8 (statisch `dark`); UI/main.tsx:13-22 (`localStorage` `novalis.appearance`); danach `settings.json` | `js/theme-init.js` als Datei; Wahl in `appearance.json`, an die Seite über ein Initialisierungsskript (`sb-theme`, `sb-tone`, `data-sb-platform`) (spec/09 §13.1) | DSK-14, WEB-01 | Konflikt | Heute drei Stellen: statisch, localStorage und `settings.json`. sebaro will dafür eine Datei in Rust. Bewegung heißt bei novalis `data-motion="reduced"`, bei sebaro `data-sb-motion="reduce"`. Gehört zu den Grundlagen und steht hier nur, weil das Gerüst davon abhängt. |
| Startzustände `.boot` (leer) und Startfehler-Karte `.boot-error-card[role=alert]`; `#fatal-banner` / `.fatal` vor React | UI/App.tsx:352-364; UI/main.tsx (`reportFatal`); app.css:51, 1037-1108 | Fehler als Satz: `.sb-callout--error` (Klasse in sebaro.css); die Start-Kachel deckt das Laden ab (STR-01) | STR-01 | anzupassen | Von der ersten Zuordnung übersehen. Der Wortlaut gehört zu den Zuständen. |

### B Seitenleiste und Teiler

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Host `div.sidebar-host` (Breite inline) mit innerem `nav.sidebar` | UI/App.tsx:370-375; UI/components/Sidebar.tsx:204, 209; app.css:201-206 | `nav.sb-side-nav.sb-window__sidebar[aria-label]` (spec/02 §4.3, §4.17, §4.20) | NAV-04, DSK-04 | anzupassen | `nav` hat keinen Namen, obwohl es ein F6-Bereich wird. Ohne Vault rendert es leer (Sidebar.tsx:204). |
| Startbreite 256 px | UI/stores/ui.ts:185, 206; packages/tokens/tokens.css:276 `--ds-size-sidebar` | 240 px (D100 (2), fest); `.sb-side-nav { inline-size: 240px }` (sb:css/sebaro.css:1891) | NAV-04, DSK-07 | anzupassen | Die Breite ist Zustand in `state.json`, keine Einstellung. `--ds-size-sidebar` liest nur preview.css:281 (Suchfeld). Das darf beim Umbenennen nicht mitwandern. |
| Bereich 180–480 px | tokens.css:277-278; UI/components/SidebarResize.tsx:7-11 (Fallbacks); app.css:204-205 | 200–360 px (D100 (2); spec/02 §4.23) | DSK-07 | anzupassen | sebaro hat für 240/200/360 kein Token. Die Werte stehen nur im Teiler-Markup und in sebaro.css (Lücke L1). |
| Teiler `div.sidebar-resize[role=separator]` (6-px-Ziel, ←/→ 16 px, Name „Seitenleiste anpassen“) | SidebarResize.tsx:24-67; app.css:208-226 | `.sb-window__divider[role=separator][aria-orientation=vertical][aria-controls][aria-label="Breite der Seitenleiste"][aria-valuemin=200][aria-valuemax=360][aria-valuenow]`, `aria-valuetext` „264 Pixel“ bzw. „zugeklappt“; 2-px-Tintenlinie, 24-px-Ziel (spec/02 §4.23) | DSK-07, DSK-04, ZUG-02 | anzupassen | Es fehlen: `aria-controls`, `aria-valuemin/max/valuetext`, Schritte 8 px und mit ⇧ 32 px, Pos1/Ende, Eingabe zum Zu- und Aufklappen, Doppelklick zur Startbreite, Zuklappen 48 px unter dem Minimum. Der Name `sidebar.resize` ändert sich. Für „Pixel“ und „zugeklappt“ kommen zwei Strings neu in i18n. |
| Breitenspeicher | ui.ts:219 `setSidebarWidth` nach `state.json` | `localStorage` `sb-pane:<window id>:<pane id>` (sb:demo/assets/sb-window.js:531-536) | DSK-07 | Konflikt | Empfehlung: `state.json` behalten, das ist das vorhandene, in Rust gehaltene Muster. sb-window.js setzt die Breite dagegen per `style.inlineSize` in DOM, das React gehört (Frage F2). |
| „Breite der Seitenleiste ›“ mit Schmal · Normal · Breit | fehlt | `menuitemradio[aria-controls][data-sb-pane-width=min\|start\|max]` in „Darstellung“ (spec/02 §4.23, D94 (1)); nativ als `sidebar-width-min/start/max` (spec/09 §13.1 `mac_menu`) | DSK-07 | neu zu bauen (ADR, Frage F14) | Das ist die Breite der Seitenleiste, keine Dichte. Eine Dichtewahl gibt es in sebaro nicht (spec/02 §4.12, RAU-05). |
| Seitenleiste ein/aus mit ⌘\\ | UI/lib/keymap.ts:82; Shell/menu.rs:450-455; Palette | ⌃⌘S (spec/02 §4.19); `menuitemcheckbox` „Seitenleiste“ in Darstellung | DSK-09, DSK-04 | Konflikt (ADR, Frage F5) | DSK-09 nennt „⌘\\ für die Seitenleiste (braucht ⌥ auf der deutschen Tastatur)“ ausdrücklich unter „dont“. ADR-0008 hat ⌘\\ mit Ja des Inhabers festgelegt. |
| Kopf: Vault-Name `.vault-name` | Sidebar.tsx:210-212; app.css:251 | `.sb-side-nav__head` (caption, text-muted) | NAV-04 | anzupassen | |
| Kopf-Werkzeuge Neue Notiz, Neuer Ordner, Board (`.btn.ghost.tool`, 24 px, natives `title`); Board gedrückt = 3-px-Ortslinie darunter | Sidebar.tsx:213-242; app.css:262-295 | `sb-icon-button--compact` (32×32, Icon 20), `aria-keyshortcuts`, Tooltip `.sb-tooltip[role=tooltip]` über `aria-describedby` mit „Name Kürzel“; gedrückt `.sb-icon-button[aria-pressed="true"]` = `link`-Farbe, keine Ortslinie (sb:css/sebaro.css:542) | NAV-10, EBE-06, ICO-08, ZUG-03 | anzupassen | Größe 24 → 32 px. Die Ortslinie unter dem gedrückten Werkzeug entfällt. Ob das Board-Werkzeug ein Ort ist und Icon plus Wort braucht, ist unklar (Frage F9). |
| Legende Name / Geändert (Sortierung über `aria-pressed`, Pfeil per CSS) | Sidebar.tsx:244-264; app.css:297-335 (:319-335) | nächstes Gegenstück `.sb-segmented` (spec/02 §2.7) oder `.sb-table__sort` mit `arrow-up--16` / `arrow-down--16` | EIN-04, DAT-14, ICO-06 | anzupassen / fehlt in sebaro | Für eine Sortierlegende über einem Baum gibt es keinen Baustein (Lücke L4). |
| Heute-Zeile `button.tree-row.today-row` (Kobaltring per CSS) | Sidebar.tsx:266-269; app.css:338-357 (Ring :351-357) | Ort mit Icon und Wort: `.sb-side-nav__item` bzw. `.sb-row` mit `.sb-row__icon` `today` (Icon vorhanden) | NAV-10, NAV-02, FAR-03 | anzupassen | Ein Kobaltring als Dekoration verstößt gegen FAR-03. ⌘J bleibt eigenes Kürzel (`data-sb-own-shortcut`, spec/02 §4.19). |
| Baum `div.tree[role=tree][tabindex=0]`: flach, virtualisiert, 28 px, Einzug `14 + 16·Tiefe` px inline, Zeilen `tabindex=-1` ohne `aria-level`, Baum ohne Namen | Sidebar.tsx:43, 271-411 (Einzug :322) | `ul.sb-tree[role=tree][aria-labelledby]` > `.sb-row.sb-tree__row[role=treeitem][aria-level][aria-expanded][aria-selected]`, `.sb-tree__twist` mit `chevron-right--16`, Roving-Tabindex (spec/02 §4.14) | NAV-11, RAU-06, TXT-09 | anzupassen | sebaro.css rückt über `aria-level` an der Zeile ein (sb:css/sebaro.css:2150-2161), aber nur bis Ebene 8 (Lücke L16). Eine flache Liste reicht also, der Inline-Einzug entfällt. `ROW_HEIGHT` 28 → 32, das Token `--ds-size-row` (32 px) gibt es schon. sb-tree.js erwartet verschachtelte `ul.sb-tree__group` mit `aria-owns` und passt nicht zur virtuellen Liste (Frage F2). |
| Baum-Tasten: Auswahl folgt den Pfeilen, Eingabe benennt um, ⌘↓ öffnet, ⌘⌫ legt in den Papierkorb | Sidebar.tsx:113-158; keymap.ts:88-89 | Pfeile bewegen nur den Fokus. Eingabe oder Leertaste wählen und lösen `sb-tree-select` aus. Typeahead 500 ms, Pos1/Ende (spec/02 §4.14) | NAV-11 (D98 V1), DSK-09 | Konflikt (ADR, Frage F6) | ⌘⌫ fragt schon nach (UI/lib/commands.ts:219-228) und erfüllt damit D39 und AKT-08. |
| Zeilen-Zustände: `.active-marker`, Ordner-Chevron und Board-Quadrat per CSS, Wort „nur in der Cloud“ (`.badge-cloud`), Konfliktkopie-Badge, Datum bzw. „Board“ in `.meta` | Sidebar.tsx:386-404; app.css:381-480 (Formen :428-460) | aktuelle Zeile `aria-selected="true"`: 3-px-Ortslinie, `link`, Titelgewicht. `.sb-row__icon` mit `folder`, `file-text`, `board`; Status als `.sb-row__meta` + `.sb-status`; „Konflikt“ immer mit `warning--16` (D92 (1)) | NAV-01, STA-08, STA-01, ICO-06 | anzupassen | Die Zeichen sind CSS-Formen statt Icons. `.active-marker` entfällt, weil sebaro.css die Linie über `aria-selected` zeichnet. |
| Leerer Vault: der Baum bleibt leer (`tree.empty` „Dieser Vault enthält noch keine Dateien.“ ist im Katalog, aber ohne Aufrufer) | Sidebar.tsx:271-411; i18n `tree.empty` | `.sb-empty` / `__title` / `__text` | DAT-07 | neu zu bauen | Von der ersten Zuordnung übersehen. Den String gibt es schon. Ob er irgendwo dynamisch benutzt wird, ist nicht geprüft (rg findet keinen Aufrufer). |
| Ziehen und Ablegen (HTML5-DnD, Klasse `.drop`; Typen Datei, Board, Karte, Finder) | Sidebar.tsx:43-60, 277-293, 349-384; app.css:407 | `data-sb-drag`, `data-sb-state=dragging\|drop-into\|drop-before\|drop-after\|drop-refuse`, `data-sb-drop="none"`; `sb-move` mit Kurzmeldung (spec/02 §4.22) | DSK-11 | anzupassen | sebaro nutzt Pointer-Events. sb-window.js verschiebt die Zeile selbst im DOM, wenn `sb-move` nicht abgebrochen wird. In novalis fehlt der Weg ohne Zeiger, „Verschieben nach …“ (neu, ADR). Finder-Ablage geht heute per HTML5, weil `dragDropEnabled: false`. |
| Fuß: Einstellungen-Knopf, nur Icon | Sidebar.tsx:413-422; app.css:490-495 | Ort „Einstellungen“ mit Icon und Wort | NAV-10, DSK-02 | anzupassen | ADR-0050 (Inhaber): Einstellungen bleiben „unten links“. Hängt an Frage F1. |
| Fuß: Hinweise „N nur in der Cloud“ und „N Konflikte“ | Sidebar.tsx:423-434; app.css:497-512 | Die Summe steht einmal als Stand-Satz in der Aktionszone | STA-07, HAL-05 (D98 V3) | Konflikt: entfernen | STA-07 nennt novalis ausdrücklich („novalis zeigte die Summe zweimal“). Die Zahl steht weiter in der Aktionszone, die Funktion bleibt also. |
| Kontextmenü Baum (nativ): Im Finder zeigen · Mit Standardprogramm öffnen · Umbenennen · In den Papierkorb legen · — · Neue Notiz · Neuer Ordner | Shell/menu.rs:558-590; UI/lib/commands.ts:438-446 | Keine Kontextmenü-Komponente für Web oder Tauri (sb-menu.js platziert nur an seinem Knopf). Regel: Löschen zuletzt nach einem Trenner | AKT-10, AKT-08 | anzupassen / fehlt in sebaro | Das native Menü bleibt auf macOS richtig. Nur die Reihenfolge ändert sich: Papierkorb nach einem Trenner ans Ende. Das Wort hat heute kein „…“, obwohl ein Dialog folgt (Lücke L3). **Gebaut in der Schlussprüfung, Runde 1:** Im Finder zeigen · Mit Standardprogramm öffnen · Umbenennen … · Verschieben nach … · — · Neue Notiz … · Neuer Ordner … · — · In den Papierkorb legen …; ein cargo-Test prüft die Reihenfolge. |

### C Reiter und Inhaltskopf

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Leiste `.tabbar > .tabs[role=tablist]` ohne Namen, 40 px, Reiter bis 220 px | UI/components/TabStrip.tsx:51-152; app.css:516-560 (:546); tokens.css:268 `--ds-size-tabstrip` | `.sb-doc-tabs[role=tablist][aria-label="Offene Notizen"]`, 32 px, Haarlinie unten, Reiter 8–15 rem, `position: sticky` (spec/02 §4.21) | DSK-10 | anzupassen | „Offene Notizen“ kommt neu in i18n. `--ds-size-tabstrip` nutzen auch die Viewer-Leisten (viewer.css:31, :78). Beim Umbenennen nicht ungeprüft mitändern. |
| Notiz-Reiter `.tab(.active)` | TabStrip.tsx:81-133 | `.sb-doc-tabs__item > .sb-doc-tabs__tab[role=tab][aria-selected][aria-controls][aria-keyshortcuts="Meta+W Delete"]`; Bereich `.sb-doc-tabs__panel[role=tabpanel]` | DSK-10, NAV-01 | anzupassen | `aria-controls` und das Panel fehlen. Neu: Roving-Tabindex, ← → Pos1 Ende mit automatischer Aktivierung, Entf am Reiter. |
| Schließen `button.tab-close` („×“ per CSS, eigener Tabstopp) | TabStrip.tsx:70-78, 122-130; app.css:589-608 | `span.sb-doc-tabs__close[aria-hidden][title]` mit `close--16`, ohne Tabstopp; immer am aktuellen Reiter, sonst bei Hover oder Fokus (D94 (6)) | DSK-10, ICO-06 | anzupassen | Mittelklick schließt schon (TabStrip.tsx:59-63, 111-115). „Andere schließen“ und „Alle schließen“ gibt es nur in der Palette (commands.ts:504-507, 658-659). |
| Ungesichert-Punkt `.tab-dot` | TabStrip.tsx:120; app.css:581-587 | – | DSK-10 | fehlt in sebaro | DSK-10 und §4.21 setzen eine Rückfrage vor dem Schließen voraus. novalis sichert automatisch und beim Schließen zuerst, deshalb gibt es keine Rückfrage (Lücke L5). |
| Board-Reiter, immer der erste, mit eigenem × (ADR-0050) | TabStrip.tsx:53-80 | `.sb-doc-tabs__item` mit dem Icon `board` | DSK-10 | anzupassen / fehlt in sebaro | ADR-0050: nicht ziehbar und nicht im Verlauf. sebaro kennt keinen festen Sonderreiter (Lücke L6). ADR-0050 sagt „⌃⇥ springt nicht auf ihn“, obwohl novalis ⌃⇥ heute nicht belegt (Reiterwechsel ist ⇧⌘[ / ⇧⌘]). Das ist ein Widerspruch in novalis selbst. |
| Reiter ziehen (`application/x-novalis-tab`, `.tab-spacer`) | TabStrip.tsx:19, 81-150; app.css:569-573, 610-614 | – (§4.22 gilt nur für Zeilen) | DSK-11 | fehlt in sebaro | Als Ablagelinie 3 px `accent` übernehmen (Lücke L6). |
| Vorschau-Umschalter mit Auge (`.tab-preview[aria-pressed]`, `.glyph-eye` per CSS), ⌘E | TabStrip.tsx:155-166; app.css:615-653 | spec/02 §4.21 (Einleitung): Systemreiter `.sb-tabs` (§4.4) wechseln die Ansichten einer Sache, ausdrücklich „Text · Vorschau · Verlauf“. Ein Icon `eye` gibt es unter den 77 nicht; `code` und `file-text` sind vorhanden | NAV-08, ICO-06, NAV-10 | anzupassen (Wort statt Auge) | Korrigiert: Das Muster gibt es in sebaro. Offen ist nur die Form im Fenster, weil `sb-tabs` 48 px hoch ist und keine Fensterdichte hat (Lücke L7). ⌘E hat keinen Menüeintrag. |
| Leer `.tabs-empty`; der Satz `editor.emptyState` steht im Inhaltsbereich | TabStrip.tsx:42-48; App.tsx:421-425 | `p.sb-doc-tabs__none` „Keine Notiz offen. Wähle eine im Ordner links.“ | DSK-10, DAT-07 | anzupassen | Mit `editor.emptyState` zu einem Satz zusammenführen. |
| Ansicht ohne Vault `.empty-state` („Vault öffnen“ als Titel und Text, Taste in der Aktionszone) | App.tsx:385-391; app.css:666-690 | `.sb-empty` / `__title` / `__text`, Aktion unten | DAT-07, AKT-01 | anzupassen | Von der ersten Zuordnung übersehen. |
| Hinweisleisten im Inhalt zwischen Reitern und Text: `CloudHint`, `LegacyHint`, `Banner` (`.banner`, `.banner-warning`) | App.tsx:377-380; app.css:692-727 | `.sb-callout`, `--note`, `--warning` | – | anzupassen | Nur die Lage gehört hierher, der Inhalt zu Hinweise und Zustände. Von der ersten Zuordnung übersehen. |
| Kürzel ⇧⌘[ / ⇧⌘] (Reiter), ⌘[ / ⌘] (Verlauf), ⌘1…9, ⇧⌘T, ⌘W | keymap.ts:45, 64-77; menu.rs:229-240, 516-541 | ⌃⇥ / ⌃⇧⇥ (fest), ⌘W (fest) | DSK-09, DSK-10 | Konflikt (ADR, Frage F5) | ⌃⇥ ist neu. „[ ]“ sind auf der deutschen Tastatur ⌥-Zeichen. novalis vergleicht im Webview die physische Taste (`event.code`, keymap.ts:122-130), das native Menü bindet laut spec/09 §13.1 ebenfalls Tastencodes (Lücke L12). sb-window.js schließt bei ⌘W selbst einen Reiter, das native Menü auch. Wird das Skript geladen, passiert es doppelt. DSK-09 verbietet „⌘1 bis ⌘5 als einzige Sprünge“. Weil es ⌃⇥ gibt, wären sie nicht die einzigen. |
| Kein Kontextmenü am Reiter | TabStrip.tsx | – | – | bleibt | Nichts hinzufügen. |

### D Aktionszone

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| `footer.statusbar.action-zone`, 56 px, volle Fensterbreite, ohne `role=status` | UI/components/StatusBar.tsx:33-99; app.css:861-911 | `.sb-bottom-block > .sb-primary-action-bar`; `__status[role=status]` bzw. `__message` am Anfang, Hauptaktion zuletzt (spec/02 §4.17) | EBE-08, AKT-02, AKT-11 | Pilot: Lage, Breite, Höhe. Anzupassen: Klassen, `role=status` | |
| Stand als Einzelposten: Wörter, Zeichen, Zeile/Spalte, Auswahl, Cursor, schreibgeschützt, Klartextmodus, Konfliktkopie | StatusBar.tsx:52-70 | `.sb-primary-action-bar__status[role=status]`: ein Satz über offene Zustände („1 Konflikt offen.“) | STA-07 | Konflikt / fehlt in sebaro | Zähler sind keine offenen Zustände, und für sie gibt es keinen Platz (Frage F7, Lücke L8). SYSTEM.md §5 schlägt unter „Vorschläge vom 18.10.2026“ vor, Wortzahl und Speicherstatus für novalis in eine Leiste zu legen. Das ist nur ein Vorschlag. |
| Cloud-Anbieter (mit `.status-dot`), Zahl „nur in der Cloud“, Konfliktzahl | StatusBar.tsx:72-86 | im Stand-Satz; Konflikt als `.sb-status--warning` | STA-07, STA-01, STA-08 | anzupassen | Die Doppelung im Seitenleistenfuß fällt weg (B). |
| Hauptaktion „Neue Notiz“ (Plus-Icon) bzw. „Vault öffnen…“ (ohne Icon), `.btn.primary` | StatusBar.tsx:87-97; app.css:752-817 | `.sb-primary-action` mit `__label` und `__bar`, mindestens 200 px | AKT-01, AKT-03, AKT-04, DSK-09 (⌘N) | Pilot / anzupassen | ⌘N als Hauptaktion stimmt schon. |
| Hauptaktion, solange das Board zu sehen ist: weiter „Neue Notiz“ (StatusBar hat keinen eigenen Zweig) | StatusBar.tsx:87-97 | spec/02 §3.16 (Fenster): „Neue Karte“ in der Aktionszone | AKT-01, DAT-13 | bleibt (D65, ADR-0050) | Korrigiert: Das ist keine offene Frage. D65 hält für novalis „Hauptaktion „Neue Notiz“ in allen Ansichten“ fest. ADR-0050 verwirft „New Card als lime primary“ mit dem Wortlaut des Inhabers, ADOPTION §5 bestätigt es. Der Widerspruch zu §3.16 kommt in die Lücken (L15). |
| Lage des Toasts: fest unten rechts über der Aktionszone | app.css:999-1018; UI/components/Toast.tsx | `.sb-window > .sb-bottom-block > .sb-toast`, oben in der Aktionszone (spec/02 §4.17) | EBE-05 | anzupassen | Inhalt und Rolle des Toasts gehören zu den Overlays. |

### E Palette, Schnell öffnen, Vault-Suche

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Palette `.scrim > .palette` (fünf Modi), ohne `role=dialog` | UI/components/Palette.tsx:239-306; UI/styles/overlay.css:1-40; app.css:913-922 | `dialog.sb-command-palette[data-sb-density=window]` mit `showModal()`, `__search` (Icon `search`, `input[role=combobox][aria-controls][aria-autocomplete=list]`), `__list[role=listbox]` > `__section` > `__group` + `.sb-row[role=option]`, `__empty[role=status]`, `__foot` (spec/02 §4.16) | NAV-09, EBE-01, FOR-01 | anzupassen | Heute ein `div` statt `<dialog>`, ohne Combobox und ohne `aria-activedescendant`. Breite 640 px (`--ds-size-palette`) → höchstens 560 px. Oben `min(12vh, 96px)` statt fest 96 px (app.css:919). `--ds-size-palette` nutzt auch `.dialog` (app.css:925). Prompt `›` (overlay.css:23-28) → Icon `search`. |
| Kürzel ⇧⌘P, Menü „Gehe zu ▸ Befehlspalette…“ | keymap.ts:50; menu.rs:503-508 | ⌘K (D84, fest). ⇧⌘P darf laut D84 als zweites bleiben | NAV-09, DSK-09 | Konflikt (ADR, Frage F3) | ⌘K ist heute `markdown.link` (keymap.ts:79; menu.rs:368-373). |
| Abschnitt je Zeile in `.result-meta`, Befehlsmarke per CSS | Palette.tsx:275-297; overlay.css:108-127 | Gruppenköpfe `.sb-command-palette__group`; Kürzel am Zeilenende als `.sb-keys[data-sb-keys]` | NAV-09, ICO-08, ICO-06 | anzupassen | |
| Einstellungszeilen ohne Haken („Erscheinungsbild: Hell“ usw.) | UI/lib/commands.ts:695-705 | `[aria-checked]` mit `.sb-row__check` (`check--16`); keine Schalter in der Palette | NAV-09, DSK-05 | anzupassen | |
| Fuß „navigieren · ausführen/öffnen · schließen“ | Palette.tsx:300-304 | „↑↓ wechseln · ↩ ausführen · ⎋ schließen“ mit `.sb-keys` | NAV-09, ICO-08 | anzupassen | Wortlaut über i18n. |
| Keine Treffer (`palette.noResults` „Keine Treffer“) | Palette.tsx:269 | `__empty[role=status]` „Kein Befehl passt zu „xyz“.“ | NAV-09 | anzupassen | |
| Schnell öffnen ⌘P (zuletzt, Dateien, Boards, „Notiz anlegen“, Präfixe `@` für Überschriften und Tags); Modi `headings` und `pickNote` | Palette.tsx:78-79, 120-235; keymap.ts:49; menu.rs:497-502 | – (die sebaro-Palette ist nur für Befehle) | – | fehlt in sebaro | Den Rahmen `sb-command-palette` mit Gruppen wiederverwenden (Lücke L9). ⌘P bleibt eigenes Kürzel. |
| Vault-Suche ⇧⌘F: `.kbd` als Umschalter (Groß/klein, Regex, alle Dateien), Filter, Zähler im Fuß | UI/components/SearchPanel.tsx:41-298 (Umschalter :186-205); overlay.css:6-24; app.css:164-181, 194-198 | Feld `.sb-search`; Umschalter `.sb-chip[aria-pressed]` (spec/02 §2.9); ein Suchpanel gibt es in sebaro nicht | EIN-04, EIN-05, ICO-08 | anzupassen / fehlt in sebaro | `kbd` ist in sebaro nur Tastenhilfe (Lücke L10). |
| Escape schließt jedes Overlay | App.tsx:237-242 | Escape schließt, der Fokus geht dorthin zurück, wo er herkam (§4.16, §4.20) | ZUG-06, ZUG-08 | anzupassen | Die Fokusrückgabe ist nicht geprüft. |

### F Natives Menü

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Gruppen App · Ablage · Bearbeiten · Darstellung · Gehe zu · Fenster | Shell/menu.rs:152-553 (Liste :550-552) | App-Menü · Ablage · Bearbeiten · Darstellung · Fenster · Hilfe (spec/02 §4.24; spec/09 §13.1 `mac_menu`) | DSK-08 | Konflikt (ADR, Frage F10) | novalis hat „Gehe zu“ zusätzlich und keine „Hilfe“. DSK-08 gilt auch für macOS („Auf macOS steht dasselbe im nativen Menü“) und nennt „eigene Gruppen statt der fünf“ als Fehler. |
| App-Menü: Über (mit Version) · Dienste · ausblenden · andere ausblenden · alle einblenden · eigenes Beenden (sichert zuerst) | menu.rs:160-182 | `mac_menu`: Über · Nach Updates suchen … · Einstellungen … ⌘, · ausblenden · beenden | DSK-02, DSK-13 | anzupassen | „Nach Updates suchen“ verbietet die Datenschutzregel: nicht bauen, Abweichung festhalten. Das eigene Beenden bleibt (D19). Einstellungen: Frage F1. Von der ersten Zuordnung nur teilweise erfasst. |
| Ablage: Neue Notiz ⌘N · Neuer Ordner ⇧⌘N · Neues Board · Vault öffnen… ⌘O · Sichern ⌘S · Umbenennen · In den Papierkorb legen · Im Finder zeigen · Tab schließen ⌘W · Geschlossenen Tab öffnen ⇧⌘T | menu.rs:184-241 | Ablage: Neue Notiz ⌘N · Neues Fenster ⇧⌘N · Öffnen … ⌘O · Zuletzt geöffnet › · Schließen ⌘W; „Löschen …“ zuletzt in Bearbeiten | DSK-08, DSK-09 | anzupassen (Frage F4, F10) | ⌘O „Vault öffnen…“ passt zum festen „Öffnen“. Die zusätzlichen Punkte gehören zur App und bleiben. |
| „Neues Fenster ⇧⌘N“, „Zuletzt geöffnet ›“; heute ist ⇧⌘N Neuer Ordner | menu.rs:192-197; keymap.ts:90 | ⇧⌘N ist für „Neues Fenster“ reserviert (spec/02 §4.19) | DSK-12, DSK-09 | Konflikt (ADR, Frage F4) | Mehrere Fenster stehen nicht im Plan: nicht bauen. |
| Bearbeiten: vordefiniertes Widerrufen, Wiederholen und Zwischenablage; Suchen ⌘F; Editorbefehle; Markdown (⌘B, ⌘I, ⌘K Link, ⌘↩); Rechtschreibung › | menu.rs:243-383 (vordefiniert :254-262) | Bearbeiten: vordefinierte sechs Punkte · Suchen ⌘F · Verschieben nach … · Einstellungen … ⌘, (§4.24) · Löschen … zuletzt ohne Kürzel (spec/09 §13.1) | DSK-08, DSK-09 | anzupassen | Die sechs vordefinierten Punkte stimmen schon. Papierkorb als „Löschen …“ ans Ende (Frage F10). |
| Darstellung ▸ Erscheinungsbild ▸ System · Hell · Dunkel | menu.rs:384-409; i18n `menu.view.appearance` („Erscheinungsbild“) | Untermenü „Hell oder Dunkel ›“ mit „Wie das System · Hell · Dunkel“, ein Haken | DSK-05, AKT-09 (D75, fest) | anzupassen (ADR mit D75-Wortlaut) | Es ändern sich nur Wörter, dazu `MENU_KEYS` (menu.rs:39-109, nur im Test) und beide Kataloge. |
| Darstellung ▸ Seitenleiste / Board / Rückverweise aus- und einblenden (das Wort wechselt) | menu.rs:432-462 | `menuitemcheckbox` mit Haken; Seitenleiste ⌃⌘S | DSK-04, DSK-09 | anzupassen | Board und Rückverweise bleiben eigene Punkte. |
| Darstellung ▸ Schrift größer / kleiner / zurücksetzen mit ⌘= ⌘- ⌘0 | menu.rs:463-480; keymap.ts:84-86 | ⌘+ / ⌘− (fest). Laut spec/09 §13.1 im nativen Menü ohne Kürzel, weil ein Kürzel einen Tastencode bindet; Seitenkürzel | DSK-09 | Konflikt (ADR, Frage F5) | Auf der deutschen Tastatur ist die Taste `Equal` das ´. ⌘+ liegt physisch auf `BracketRight`, also auf ⌘] (Vorwärts). KEYMAP.md:19-20 behauptet, `Cmd+=` sei auch auf Deutsch die Plus-Taste. An Hardware nicht geprüft. |
| Darstellung ▸ Sprache; „Bewegung immer reduzieren“ (Haken) | menu.rs:411-430, 484-491 | Bewegung: `menuitemcheckbox` mit `data-sb-motion-setting` (spec/02 §4.24); Sprache gehört nur zu novalis | BEW-04 | schon im Pilot | |
| „Befehlspalette…“ unter Gehe zu | menu.rs:503-508 | „Befehle … ⌘K“ als letzter Punkt in Darstellung (spec/02 §4.18, spec/09 §13.1) | NAV-09 | anzupassen (ADR, Frage F3, F10) | |
| Gehe zu: Schnell öffnen ⌘P · Befehlspalette ⇧⌘P · Heute ⌘J · Zurück ⌘[ · Vorwärts ⌘] · Vorheriger/Nächster Tab ⇧⌘[ / ⇧⌘] | menu.rs:496-541 | – | DSK-08 | Konflikt (Frage F10) | In den fünf sebaro-Gruppen gibt es für diese Punkte keinen festen Platz (Lücke L17). |
| „Breite der Seitenleiste ›“ | fehlt | siehe B | DSK-07 | neu zu bauen (ADR) | |
| Fenster: Minimieren · Zoomen · — · Fenster schließen | menu.rs:543-548 | Fenster: Minimieren · Nächster Bereich F6 · Vorheriger Bereich ⇧F6 (`data-sb-area="next\|previous"`, spec/02 §4.20) | DSK-09, ZUG-08 | neu zu bauen (ADR, Frage F15) | |
| Kontextmenü Karte: Notiz öffnen · Umbenennen · Beschreibung · Löschen · — · Notiz anlegen · — · In Spalte verschieben › | menu.rs:599-638 | Löschen zuletzt nach einem Trenner | AKT-10 | anzupassen | Einzelheiten im Board-Bereich. |
| Knopf „Menü“ in der Leiste | fehlt | `.sb-secondary-action--compact` + `ul.sb-menu.sb-menu--window`, nur Windows, Linux und Web | DSK-08 | entfällt auf macOS | novalis liefert nur für macOS aus. Das Linux-CI baut, liefert aber nicht aus. Nicht bauen. |

### G Einstellungen

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Einstellungen als Palettenmodus `settings` | Palette.tsx:159; commands.ts:515, 695-705; Sidebar.tsx:413-422 | Einstellungsansicht im Hauptfenster (spec/02 §4.24 F10a; Muster sb:demo/components.html, `#desktop-einstellungen`): `form.sb-window__settings-group`; Bereiche als `.sb-side-nav__item` mit `aria-current`; „Zurück zu <Ort>“ als `.sb-text-action--compact[data-sb-escape]` mit `arrow-left`; keine Aktionszone; Hell oder Dunkel als `.sb-choice-row` + `.sb-radio` mit `data-sb-theme-choice`; Bewegung als `.sb-switch-row` mit `.sb-switch[data-sb-motion-setting]` | DSK-02, DSK-05, AKT-09 | Konflikt (Frage F1) | DSK-02 nennt „Einstellungen nur im nativen Menü oder nur in der Palette“ als Fehler und verlangt zu jeder Einstellung einen Hilfesatz. Das wären fünf neue Sätze in i18n. |
| ⌘, | docs/KEYMAP.md:49 `unbound`; ADR-0008:22 | fest „Einstellungen“ (spec/02 §4.19) | DSK-09, DSK-02 | Konflikt (Frage F1) | |
| Farbton Kühl · Warm | fehlt | `data-sb-tone`, `js/sb-tone.js`, `[data-sb-tone-choice]` | FAR-15 (entschieden), DSK-02 | Konflikt (sechste Einstellung, Frage F1b) | |
| Schalter „Mitteilungen“ | fehlt | §4.24 F11a | DSK-13 | nicht bauen | novalis hat keine Systemmitteilungen. `tauri-plugin-notification` wäre eine neue Abhängigkeit. |

**Der Konflikt um die Einstellungen:**

- **Was novalis festlegt:**
  - ADR-0004: „No preferences window; `Cmd-,` stays unbound (ADR-0008)“.
  - Als verworfene Alternative: „Preferences window with the four items – Chrome the brief avoids“.
  - Folge in ADR-0004: „Menus and shortcuts are the only settings UI“. ADR-0012 ergänzt die Palette.
  - CLAUDE.md: „No preferences window; no Cmd-,“.
  - SETTINGS.md: genau fünf Einstellungen.
  - ADR-0050 (Inhaber): Einstellungen nur einmal, „unten links behalten“.
- **Was sebaro festlegt:**
  - D67 (5): Die Einstellungen bekommen eine eigene Ansicht (⌘,). Natives Menü und Palette bleiben zusätzlich.
  - D91 F10a: Die Ansicht liegt im Hauptfenster, nie in einem zweiten Fenster.
  - D75: Hell oder Dunkel gehört ins Menü „Darstellung“ und in die Ansicht Einstellungen. Für novalis ist das fest.
  - DSK-02 (entschieden), Notiz: „novalis nutzt heute die Palette als Einstellungsseite (ADR-0004); nach D67 braucht der Punkt dort eine ADR mit dem Wortlaut des Inhabers.“
  - DSK-09: ⌘, ist reserviert.
  - FAR-15 (entschieden): Desktop-Apps bieten den Farbton in der Ansicht Einstellungen an.
- **Was genau kollidiert:**
  - (a) ⌘, ist bei novalis absichtlich frei.
  - (b) Wörtlich verbietet ADR-0004 nur ein Fenster. Gemeint war aber jede Oberfläche außer Menü und Palette. Hier braucht es eine Lesart des Inhabers.
  - (c) Der Farbton wäre eine sechste Einstellung.
  - (d) Die sebaro-Bereiche Allgemein · Editor · Tastatur · Über sind für fünf Werte zu viel (Lücke L11).
- **Was nicht kollidiert:** die fünf Werte selbst, das Menü „Darstellung“ (nur andere Wörter) und der Ort unten links in der Seitenleiste.

### H Bereiche, F6, Inspektor, Mindestbreite

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Bereiche `header.titlebar`, `nav.sidebar`, `main.main`, `footer.statusbar` | App.tsx:367-436; TitleBar.tsx:41; Sidebar.tsx:209 | bis zu fünf Bereiche: Titelleiste, `nav[aria-label]`, `main`, Inspektor (`role=region`), Aktionszone (spec/02 §4.20) | DSK-09, ZUG-08 | neu zu bauen | In der Titelleiste ist heute nichts fokussierbar. Der Bereich nimmt dann selbst den Fokus (`tabindex=-1`, Ring innen). |
| F6 / ⇧F6 | fehlt (keymap.ts, App.tsx, menu.rs geprüft) | sb-window.js `moveArea` (sb:demo/assets/sb-window.js:450-475) | DSK-09 | neu zu bauen (ADR, Frage F15) | CodeMirror lädt `defaultKeymap`, `searchKeymap` und `historyKeymap` (UI/editor/setup.ts:197-199). Ob davon etwas F6 belegt, ist nicht geprüft. |
| Inspektor | keiner | `.sb-window__inspector`, 280 px (240–400), ⌥⌘I, Overlay unter 1004 px | DSK-04, DSK-07, DSK-09 | – | ⌥⌘I bleibt reserviert und frei. |
| Rückverweise unter dem Editor (`section.backlinks[aria-label]`, höchstens 33 %) | App.tsx:429-433; UI/components/Backlinks.tsx:58-103; UI/styles/backlinks.css:3-95 | Benannte Region im Inhalt (`.sb-list` / `.sb-note-refs`) oder Inspektor; Icon `back-to-text` (Alias `backlink`) | DSK-04, DAT-01 | Frage F11 | Umschalten nur über Menü und Palette. |
| Mindestbreite des Inhalts | keine (nur Fenster 720) | Inhalt mindestens 480 px (`minmax(min(480px, 100%), 1fr)`); sb-window.js `fit` (:562) lässt die Seitenleiste nachgeben | DSK-04 | neu zu bauen | |
| Seitenleiste als Overlay unter 722 px | fehlt | sb-window.js `relayout` (:213), `--sb-layer-overlay`, `@container sb-window (max-width: 721.98px)` | DSK-04 | neu zu bauen | Zusammen mit dem Mindestfenster 480×400 (D91 F2a). |

### Was nicht geprüft ist

- Keine Screenshots, keine Laufzeit, keine Tests ausgeführt.
- Wer bei ⌘K, ⇧⌘K, ⌘W und ⌘\\ gewinnt (Kürzel im nativen macOS-Menü, keydown der Webview oder CodeMirror): nicht geprüft.
- Ob `refresh_menu` die Haken nach jeder Änderung richtig neu setzt: zur Laufzeit nicht geprüft.
- Ob HTML5-DnD bei `dragDropEnabled: false` im WKWebView bleiben darf, obwohl sebaro Pointer-Events verlangt: nicht geprüft.
- Wie groß sebaro.css Abschnitt 7a/7b nach dem Minifizieren ist: nicht gemessen. Roh sind es 41.812 B, die ganze Datei roh 230.459 B. Das Budget `eagerCssKb` 24 misst gebautes, rohes CSS. overlay.css wird heute schon mit dem Paletten-Chunk nachgeladen.
- Ob `tree.empty` irgendwo dynamisch aufgerufen wird: nicht geprüft.

### Prüfung

Ein unabhängiger Prüfer hat die erste Zuordnung gegen die Arbeitsbäume von sebaroDesign, sebaro-guide und novalis gegengelesen. Alle zitierten Regel-IDs gibt es in `rules.json`. Alle zitierten sebaro-Klassen gibt es in `css/sebaro.css`, alle Attribute in `sb-window.js` bzw. der Spezifikation, alle Tokens in `dist/tokens.css`. Die Spec-Abschnitte von spec/02 §2.7 bis §4.24, spec/03 §14 und spec/09 §13.1 sind da, ebenso alle zitierten Icons. `eye` fehlt wirklich.

**Korrigiert:**

- **Zeilennummern:** `.win` steht auf App.tsx:367 (nicht 366), `.body` auf 369, `nav.sidebar` auf Sidebar.tsx:209 (nicht 207). Das vordefinierte Bearbeiten-Menü steht auf menu.rs:254-262 (nicht 243-252, dort ist das Rechtschreib-Untermenü). Dazu kleinere Bereichsangaben.
- **Start-Kachel:** STR-01 verlangt bei reduzierter Bewegung Ausblenden an Ort und Stelle, nicht Einblenden.
- **„SYSTEM.md §5 P5“:** Eine Marke „P5“ gibt es nicht. Gemeint ist der Vorschlag vom 18.10.2026 in §5.
- **ADOPTION §2.3:** Es erlaubt den Framework-Ersatz ausdrücklich nur für sb-menu, sb-tabs, sb-tooltip, sb-sheet, sb-search und sb-controls. Zu sb-window.js und sb-tree.js sagt es nichts (F2 und L2 angepasst).
- **Vorschau-Umschalter:** Er ist kein „fehlt in sebaro“. spec/02 §4.21 nennt Systemreiter „Text · Vorschau“ ausdrücklich. Offen bleibt nur die 48-px-Höhe im Fenster (L7 umgeschrieben).
- **L12:** Die zweite Hälfte entfällt. spec/09 §13.1 erklärt bereits, warum ⌘+ und ⌘− im nativen Menü kein Kürzel tragen.
- **Gestrichene Fragen:**
  - F8 (Hauptaktion auf dem Board): durch D65 und ADR-0050 entschieden, Empfehlung B widersprach dem Inhaber. Jetzt Lücke L15.
  - F12 (Mindestfenster): durch D91 F2a und DSK-07 entschieden („Ein großes Mindestfenster“ ist ein Fehler).
- **Geänderte Empfehlungen:**
  - F5 empfahl, ⌘\\ als zweites Kürzel zu behalten. DSK-09 verbietet genau das, deshalb jetzt A.
  - F10 empfahl, „Gehe zu“ zu behalten. DSK-08 verbietet eigene Gruppen auch auf macOS, deshalb jetzt A mit einem Verteilungsvorschlag.
- **Ergänzte, vorher übersehene Elemente:** Startfehler-Karte und `.fatal`; Ansicht ohne Vault; leerer Baum (`tree.empty` ohne Aufrufer); Hinweisleisten im Inhalt; App-Menü und Ablage im Einzelnen; „Gehe zu“ im Einzelnen; Fensteroptionen `visible`, `create` und `dragDropEnabled`; fehlende `aria-level`, fehlender Baumname und fehlender Roving-Tabindex im Baum; die Ortslinie unter dem gedrückten Board-Werkzeug (sebaro: `link`-Farbe); doppelte Nutzung von `--ds-size-tabstrip` und `--ds-size-palette`; Präfixe `@`/`#` im Schnell öffnen; „Andere/Alle schließen“ nur in der Palette.
- **Neue Lücken:** L15 (Board-Hauptaktion), L16 (Baum-Einzug nur bis Ebene 8), L17 (kein Platz für Verlauf, Schnell öffnen und Heute in den fünf Gruppen).
- **App-Kachel:** Geometrie mit `tile-novalis-small.svg` verglichen, sie ist gleich.

**Nicht verifiziert:**

- **Laufzeit:** alles, was nur zur Laufzeit zu sehen ist (Kürzel-Konkurrenz, Fokusrückgabe, Fenster-Sichtbarkeit vor dem ersten Bild, Verhalten von WKWebView beim Ziehen).
- **Hardware:** die Belegung der deutschen Tastatur.
- **Größe:** die minifizierte Größe von sebaro.css 7a/7b.
- **Widerspruch in ADR-0050:** Der Satz zu ⌃⇥ passt nicht zum heutigen Keymap.

## 7 Inhalte: Editor, Vorschau, Betrachter, Rückverweise, Inhaltsverzeichnis, Board, Suche

Stand 2026-10-24. Grundlage:
- novalis-Branch `sebaro-umbau` (= v1.2.0).
- sebaroDesign-Arbeitsbaum: Token-Vertrag 1.9. HEAD ist D99, D100 steht nur uncommittet in `DECISIONS.md`.
- Guide 2.9.0 (`rules.json`: D1–D99).

Alles hier ist aus dem Quelltext gelesen. Nichts wurde gerendert, gebaut oder getestet.

Pfadkürzel: `ui/` steht für `apps/desktop/ui/src/`. sebaro-Pfade sind relativ zu `systems/sebaro/` im Repo sebaroDesign.

Bedeutung der Spalte „Stand“:
- **Pilot**: Der Wert stimmt schon, nur `--ds-*` wird zu `--sb-*` umbenannt (TEC-07, D67 (13)).
- **anzupassen**: Ein sebaro-Gegenstück gibt es, der Look weicht ab.
- **neu zu bauen**: In novalis gibt es das Element so noch nicht.
- **fehlt in sebaro**: sebaro hat kein Gegenstück. Das gehört nach `docs/sebaro-luecken.md`.
- **Konflikt**: Eine Regel oder Entscheidung widerspricht dem heutigen Stand.

Schon entschieden, also keine Frage mehr:
- **Code-Looks:** D67 (12), D69 und D85 (vom Inhaber bestätigt) sowie TEC-08 legen fest: fünf Looks, die Zuordnung aus spec/01 §1.8.1, im Editor `sebaroHighlight` (spec/09 §17) und in der Vorschau `sb-tok-<look>` (css/sebaro.css:1295-1307). Damit fällt `CODE_RULES` auf fünf Looks plus `invalid`.
- **Suchtreffer im Editor:** DSK-03 (D67, D85) schreibt den 1-px-Rahmen in `border-strong` vor und verbietet ausdrücklich „gefüllte Suchtreffer in Lindgrün oder Gelb“. Für gerenderten Text und Trefferlisten gilt FAR-12 (`mark` / `.sb-mark`). Dass spec/02 §3.1b Editoren trotzdem `::highlight(sb-mark)` nennt, kommt als Widerspruch in die Lückenliste.

### A. Editor (CodeMirror 6): `ui/editor/theme.ts`, `setup.ts`, `decorations.ts`

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Grund und Textfarbe | theme.ts:17-22 | `--sb-color-bg`, `--sb-color-text` (spec/01 §1.8 „Around the code“) | DSK-03, FAR-05 | Pilot | Werte gleich (#F4F5F8 / #1C1E22) |
| Schriftfamilie Prosa | theme.ts:23-27, `ui/styles/fonts.css:18-38` | `--sb-font-family-ui` „sebaro Sans“, `fonts/fonts.css`, `fonts/web/sebaro-sans-latin-de.woff2` | SCH-01, SCH-02, DSK-03 | anzupassen | Der Pilot nutzt „Radio Canada“ (`ui/fonts/radio-canada-*.woff2`). D71: Es gibt nur noch sebaro Sans und Mono |
| Zeilenhöhe 1.6 | theme.ts:25, `--ds-line-height-editor` | kein Token; `--sb-type-body` ist 1rem/1.5 | SCH-04 | fehlt in sebaro | Editor-Zeilenhöhe als Lücke melden |
| Editor-Schriftgröße (Einstellung `editor.fontSize`) | theme.ts:21, `ui/stores/ui.ts:178-180` | kein Token; `--sb-type-body-size` ist fest 1rem | SCH-04, ZUG-09 | fehlt in sebaro | Braucht eine eigene Produkt-Variable. Der Name ist offen, weil TEC-01 nur Tokens erlaubt |
| Maß 70ch | theme.ts:28-33 | `--sb-size-measure-prose` (70ch) | TXT-06 | Pilot | |
| Code-Ansicht `.nv-mono` | theme.ts:34-41, fonts.css:40-49 | `--sb-font-family-mono`, `--sb-type-code-weight` 500, `fonts/web/sebaro-mono-latin-de.woff2` | SCH-01, TXT-10 | anzupassen | Der Pilot meldet die Mono als 400 an (fonts.css:43). Die Datei weicht von der heutigen sebaro-Datei ab (andere Prüfsumme, 15 932 statt 16 824 Byte), vermutlich der Stand vor D70 |
| Fokusrahmen | theme.ts:42 (`outline: none`) | `--sb-focus-ring`; ein mit F6 erreichter Bereich zeigt den 2-px-Ring innen an seiner Kante (spec/02 §4.20) | ZUG-02 | unklar | Ob das für den Textbereich gilt, ist offen |
| Cursor 1,5 px, auch Drop-Cursor | theme.ts:43-45 | 2 px `--sb-color-accent` | DSK-03, DSK-11 | anzupassen | |
| Auswahl | theme.ts:46-48 | `--sb-color-selection` | DSK-03, FAR-03 | Pilot | Wert gleich (#3057B140) |
| Gleiche Wörter zur Auswahl `.cm-selectionMatch` | theme.ts:49 | keins | – | fehlt in sebaro | |
| Aktuelle Zeile | theme.ts:50 | `--sb-color-hover-fill` | DSK-03 | anzupassen | Heute ein Text-Ton mit 4 % Deckkraft, sebaro ist deckend |
| Gutter und Zeilennummern | theme.ts:51-58 | Nummern `--sb-color-text-muted`, aktuelle Nummer `--sb-color-text`, Größe `--sb-type-code-size` (0.875rem) | DSK-03 | anzupassen | Heute text-subtle und 13 px; die aktuelle Nummer ist muted |
| Falt-Platzhalter `.cm-foldPlaceholder` | theme.ts:59 | Faltmarken `chevron-right--16` / `chevron-down--16` | DSK-03 | ohne Wirkung | `setup.ts` lädt keine Faltung, und v1 hat keine (CLAUDE.md). Die Regel kann weg |
| Suchtreffer, aktueller Treffer | theme.ts:60, :83-86 | 1 px `--sb-color-border-strong` ohne Füllung; der aktuelle auf `--sb-color-selection` (spec/01 §1.8, spec/09 §17) | DSK-03 | Konflikt | Heute warning-fill als Füllung (DSK-03 verbietet sie ausdrücklich), der aktuelle accent-fill mit accent-Kante |
| Klammerpaar | theme.ts:87-90 | 1 px `--sb-color-border-strong`, ohne Füllung | DSK-03 | anzupassen | Für eine nicht passende Klammer hat sebaro nichts |
| Einrückungslinien | `ui/editor/indentationGuides.ts:129-134` | `--sb-color-border` | DSK-03 | Pilot | Heute `--ds-color-border-default` als Gradient |
| Unsichtbare Zeichen (ADR-0029) | theme.ts:67-82 | keins | FAR-02, FOR-03 | fehlt in sebaro / Konflikt | `.cm-trailingSpace` füllt mit warning-fill (theme.ts:82), eine Fläche hinter Text ist verboten. Punkte und Tab-Linie sind Gradienten, laut FOR-03 verboten; ob das bei einem 1-px-Strich gilt, ist unklar |
| Nicht aufgelöster Wiki-Link (ADR-0038) | theme.ts:61-66 | keins; es gibt nur den einen Linkstil | FOR-03, LNK-01 | Konflikt | Strichlinien sind verboten, siehe Frage 2 |
| Link und URL im Quelltext | theme.ts:236-242 | Unterstreichung `--sb-color-link` in `--sb-x-sebaro-link-underline-width` (spec/09 §17) | LNK-01, DSK-03 | anzupassen | Heute wird accent statt link verwendet |
| Markup-Zeichen (`t.processingInstruction`, `t.list`, `t.quote`) | theme.ts:231, :259, :260 | `--sb-color-text-muted`; spec/09 §17 nennt `t.processingInstruction`, `t.contentSeparator` und `t.quote` | DSK-03 | anzupassen | Heute subtle, `t.quote` schon muted-gleich (#66696E), `t.list` default |
| Überschriftenzeilen `.nv-heading-1..3`, `t.heading` | theme.ts:140-142, :232, decorations.ts:23 | `text` im Überschriftengewicht (`--sb-type-title-weight`). Größen für den Editor legt sebaro nicht fest | DSK-03, SCH-05 | anzupassen / fehlt in sebaro | Das harte `-0.02em` (theme.ts:141) muss weg, siehe Frage 4 |
| Fett und kursiv | theme.ts:233-234 | „echtes“ Fett und Kursiv (spec/01 §1.8; spec/09 §17: `t.strong` → bold) | DSK-03 | unklar | Fett ist heute 570 (`--ds-font-weight-medium`, gleich `--sb-type-body-strong-weight`). Ob das als Fett gilt, ist nicht geklärt |
| Durchgestrichen `t.strikethrough` | theme.ts:235 | keine Regel in spec/01 §1.8 oder spec/09 §17 | – | fehlt in sebaro | |
| Inline-Code | theme.ts:252-257 | Mono auf `--sb-color-surface-sunken`, Farbe `text` (`.sb-code-inline`, css/sebaro.css:1294) | DSK-03, FAR-05 | anzupassen | Heute ohne Grund und in muted, 0.9em |
| Zitatzeile `.nv-quote` | theme.ts:143-147 | Zitatlinie 2 px `--sb-x-sebaro-layer-line-width` / `--sb-x-sebaro-layer-line-color`, 16 px Abstand (spec/02 §3.22, `.sb-quote__text`) | TXT-17 | anzupassen | Heute ist die Linie fg-subtle und der Text muted |
| Front Matter | theme.ts:148-152 | YAML in den fünf Looks (spec/01 §1.8, Tabelle „Markup languages“) | TXT-10 | anzupassen | Heute die ganze Zeile subtle in 0.85em |
| Fence-Codezeilen `.nv-code` | theme.ts:155, `ui/editor/fences.ts:59` | Mono 500 in den fünf Looks | TXT-10, TEC-08 | anzupassen | Ob im Editor ein Grund surface-sunken dazukommt, ist unklar (spec/01 §1.8: `bg` im Editor) |
| Erledigte Aufgabe `.nv-task-done` | theme.ts:156 | keine Rolle | – | fehlt in sebaro | |
| Aufgaben-Kästchen (Widget) | theme.ts:157-171, decorations.ts:30-49 | Look wie `.sb-checkbox` (spec/02 §2.4) | EIN-03 | anzupassen | Heute angehakt accent-gefüllt; EIN-03: „Kobalt-Marke, keine Fläche“. Das Widget ist ein span; eine Größe im Fließtext gibt sebaro nicht vor |
| #Tag-Chip (ADR-0037) | theme.ts:243-251 | `.sb-tag` (spec/02 §3.2) ist nicht interaktiv | STA-04, FAR-02, FAR-03 | Konflikt | Heute kobalt gefüllt und per ⌘-Klick bedienbar, siehe Frage 3 |
| Tooltip und Autovervollständigung | theme.ts:91-102 | Overlay wie `.sb-menu` (spec/02 §4.18); aktive Zeile wie `sb-row` mit Ortslinie (spec/02 §4.13) | EBE-07, NAV-01 | anzupassen | Für CodeMirror nicht eigens beschrieben. Heute aktive Zeile auf bg-fill-strong, also eine Fläche |
| Such- und Gehe-zu-Zeile-Leiste `.cm-panels` | theme.ts:103-138 | `.sb-search` (§2.2), `.sb-field--compact`, `.sb-secondary-action--compact` | EIN-05, FAR-12 | fehlt in sebaro / anzupassen | Eine Inline-Suchleiste gibt es in sebaro nicht |
| ⌘K „Link einfügen“ | `apps/desktop/src-tauri/src/menu.rs:368-373`, `docs/KEYMAP.md:79` | ⌘K ist für die Palette fest (D84); spec/02 §4.19 schlägt ⇧⌘K nur vor | DSK-09, NAV-09 | Konflikt | ⇧⌘K ist in der eingebundenen CodeMirror-`defaultKeymap` (setup.ts:197) `deleteLine`. Das dokumentierte novalis-Kürzel für „Zeile löschen“ ist ⌃⇧K (KEYMAP.md:64). Siehe Frage 1 |

### B. Code-Looks (`CODE_RULES`, theme.ts:191-227; dieselben Regeln als `tok-*` in `ui/styles/preview.css:175-217`)

Entschieden durch D67 (12), D69 und D85 sowie TEC-08. Für den Editor gilt `sebaroHighlight` (spec/09 §17; laut Spec „only by reading, not run“). Für die Vorschau gelten die Klassen `.sb-tok-keyword|string|constant|comment|invalid` (css/sebaro.css:1295-1307).

| novalis-Look | heute | sebaro | Regel-IDs | Stand |
|---|---|---|---|---|
| keyword | Link-Kobalt (#254BA4) | `--sb-syntax-keyword`; zusätzlich `controlKeyword`, `definitionKeyword`, `tagName` u. a. (spec/01 §1.8.1) | FAR-11, TXT-10 | Konflikt |
| string (mit escape) | grün | `--sb-syntax-string`; `escape` gehört zu constant | FAR-11 | Konflikt |
| comment | text-subtle | `--sb-color-text-muted` | FAR-11 | anzupassen |
| number (mit changed) | warning-text | `--sb-syntax-constant`; `changed` ist nicht aufgeführt, also plain | FAR-11 | anzupassen |
| type, property, marker | info, muted, subtle | plain `--sb-color-text` | TXT-10 | Konflikt |
| function (Gewicht 570) | medium | plain, nicht fett | TXT-10 | Konflikt |
| invalid | danger als Farbe | `.sb-tok-invalid`: Wellenlinie danger, 2 px | TXT-11 | anzupassen |
| inserted / deleted | nur Farbe (success-text / warning-text) | `sb-diff` (spec/02 §3.19): Zeichen plus Zeilenfüllung | TXT-11, FAR-02 | Konflikt |

Kopplung: `ui/editor/fences.ts:59` erzeugt `tok-<name>`. Der Test `ui/editor/fences.test.ts:55-60` vergleicht `preview.css` mit `CODE_RULES` und muss mitgeändert werden.

### C. Markdown-Vorschau: `ui/components/Preview.tsx`, `ui/styles/preview.css`

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Fläche | preview.css:8-14 | `--sb-color-bg` | FAR-05 | Pilot | |
| Fließtext `.preview-body` | preview.css:16-28 | `.sb-prose` (css/sebaro.css:134-142) | TXT-06 | anzupassen | `.sb-prose > h2/h3` (space-10/-8) bricht die Spiegelregel Editor↔Vorschau |
| Überschriften h1–h6 | preview.css:31-61 | Rollen display, headline, title in rem (css/sebaro.css:41-45); h4–h6 haben keine Rolle | SCH-04, SCH-06 | Konflikt | Die em-Skala hängt an `editor.fontSize`, siehe Frage 4 |
| Listen, `strong` | preview.css:74-82, :104-106 | `.sb-prose li` (css/sebaro.css:139-140) | TXT-06 | anzupassen | |
| Links | preview.css:84-93 | Grundstil `a` (css/sebaro.css:63-65): Unterstreichung `--sb-color-link`, Hover macht das Wort `link`, visited nur in `.sb-prose` | LNK-01 | anzupassen | Heute accent statt link |
| Icon „externer Link“ (D56) | Preview.tsx:343-347, `ui/components/Icon.tsx:35-59`, preview.css:95-102 | `<svg class="sb-icon sb-icon--16"><use href="#external-link--16"/>`, `a > .sb-icon--16:last-child` (css/sebaro.css:66) | LNK-02, ICO-04 | Pilot / anzupassen | Der Pfad ist schon gleich. Klasse (`icon icon-16`) und Ausrichtung ändern sich (auf -0.125em) |
| Zitat | preview.css:108-112 | `.sb-prose > blockquote` (css/sebaro.css:1466-1469): 2 px Tinte, 16 px, nicht kursiv | TXT-17 | anzupassen | Heute Linie fg-subtle, Text muted |
| Trennlinie `hr` | preview.css:114-119 | keine Regel in css/sebaro.css (geprüft) | – | fehlt in sebaro | |
| Bilder, Klick öffnet den Betrachter (ADR-0025) | preview.css:239-248, Preview.tsx:349ff (`read_blob`) | keine `img`-Regel in `.sb-prose` (geprüft) | – | fehlt in sebaro | Heute Radius 4 |
| Aufgaben-Kästchen (ADR-0039) | preview.css:121-127, Preview.tsx:336-341, :503-515 | `label.sb-checkbox > input + span` (§2.4) | EIN-03 | neu zu bauen | Der Kern-Renderer schreibt ein nacktes `input`. Das Fragment müsste nachbearbeitet werden |
| Fußnoten `sup`, `.footnote-definition` | preview.css:129-143 | `sb-note-ref` (spec/02 §6, spec/03 §5); D56 (3): Ziffern und Rücksprünge im Linkstil | LNK-01, BEL-02 | anzupassen | BEL-02 gilt für Websites. Ob das Beleg-Konzept zu Markdown-Fußnoten passt, ist unklar |
| Inline-Code | preview.css:146-154 | `:not(pre) > code` (css/sebaro.css:68), surface-sunken | FAR-05 | anzupassen | Heute bg-raised |
| Codeblock `pre` | preview.css:156-170 | Die eine Form (D80) ist `div.sb-code` mit `__bar`, `__copy`; der nackte `pre.sb-code` ist die Ausweichform für Markdown-Ausgabe (spec/02 §3.10, css/sebaro.css:1281, :1291) | TXT-08, FAR-05 | anzupassen | Heute mit Rahmen, Radius 8 und raised. Der Kopieren-Knopf wäre eine neue Funktion, siehe Frage 5 |
| Hervorhebung `.tok-*` | preview.css:172-217 | `.sb-tok-*` | TEC-08 | anzupassen | siehe B |
| Tabellen | preview.css:219-236 | `.sb-table` in `div.sb-table-wrap[role=region][tabindex=0]` (§3.9); eine nackte `table` gestaltet `.sb-prose` nicht (geprüft) | DAT-05 | anzupassen | Klassen per Nachbearbeitung setzen. Heute alle Seiten gerahmt, Kopf gefüllt |
| Mermaid-Diagramme | preview.css:250-260, Preview.tsx:82-89 | keins | FAR-01 | fehlt in sebaro | Heute mermaid-eigene Themen „dark“ und „default“ |
| Suchleiste in der Vorschau | Preview.tsx:551-588, preview.css:262-303 | `.sb-search` plus `sb-icon-button--compact` mit `chevron-left--16`, `chevron-right--16`, `close--16` | EIN-05, ICO-06 | anzupassen | Heute die Zeichen ‹ › × (Preview.tsx:567, :576, :585) |
| Treffer `mark.preview-hit` | preview.css:305-313 | `mark` / `.sb-mark`, aktueller Treffer `aria-current="true"` (css/sebaro.css:800-816) | FAR-12 | anzupassen | Der Zähler `editor.find.matchCount` „{{current}} von {{count}}“ wird zu „Treffer … von …“ |
| Sprungziel `.preview-target` | preview.css:315-323, Preview.tsx:50 (`TARGET_LIT_MS`) | keins | BEW-01 | fehlt in sebaro | |
| „Wird geladen…“ | Preview.tsx:547 (`editor.loading`) | bei lokaler Arbeit nichts zeigen | STA-06 | Konflikt | |

### D. Tabellen- und SVG-Vorschau

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| CSV/TSV, virtualisiertes Raster | `ui/components/TablePreview.tsx:21-81`, preview.css:325-379 | Look wie `.sb-table`: keine senkrechten Linien, Kopf mit `border-strong`, ohne Füllung | DAT-05, SCH-03 | fehlt in sebaro / anzupassen | Eine Tabelle aus div-Elementen beschreibt sebaro nicht. `role=table` bleibt. Heute Kopf bg-raised, senkrechte Linien (preview.css:378) |
| SVG-Bild | `ui/components/SvgPreview.tsx:14-31`, preview.css:381-397 | nicht nötig | – | – | |

### E. Betrachter und Inhaltsverzeichnis: `ui/components/*Viewer.tsx`, `ZoomableImage.tsx`, `ContentsPopover.tsx`, `ui/styles/viewer.css`, `ui/lib/documentCss.ts`

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Grund | viewer.css:2-9 | `--sb-color-bg` | FAR-05 | Pilot | |
| Werkzeugleisten Zoom, PDF, EPUB | viewer.css:26-37, :73-84, :221-232 | Werkzeuge `sb-icon-button--compact` und `sb-secondary-action--compact` (spec/02 §4.18) | SCH-01, SCH-03, RAU-06 | Konflikt | Die Leisten sind in Mono gesetzt (viewer.css:34, :81, :229). Das widerspricht auch ADR-0048 („Mono for metadata … is gone“) |
| Werkzeugknopf 22 px, gedrückt `.on` | viewer.css:86-108 | `sb-icon-button--compact` 32 px; `aria-pressed` macht das Icon `link`, ohne Füllung (css/sebaro.css:542) | RAU-06, FAR-02 | anzupassen | `.on` füllt heute mit accent-fill (viewer.css:106) |
| Deaktiviert per Deckkraft 0.35 | viewer.css:100-102 | text-subtle, nie Deckkraft (css/sebaro.css:544-551) | STA-03 | Konflikt | |
| ‹ › − + als Zeichen | PdfViewer.tsx:186, :206, :216, :226; EpubViewer.tsx:309, :322; CbzViewer.tsx:175, :186; ZoomableImage.tsx:170, :180 | `chevron-left--16`, `chevron-right--16`, `plus--16`, `minus` | ICO-06, ICO-04 | Konflikt | Für `minus` gibt es keinen 16-px-Master (`icons/dist/icons.json` geprüft) |
| „Einpassen“ / „Seitenbreite“ (`aria-pressed`) | ZoomableImage.tsx:183-185, PdfViewer.tsx:229-231 | `sb-secondary-action--compact` mit `aria-pressed`; Zoom-Icons hat sebaro nicht | NAV-10 | anzupassen | Wort bleibt |
| Seitenfeld | viewer.css:110-131 | `.sb-field--compact` | EIN-01 | anzupassen | |
| Zähler (Zoom, Kapitel, Seite) | viewer.css:137-141, :242-245, :316-320 | `.sb-num` | SCH-03 | anzupassen | |
| PDF-Textauswahl | viewer.css:204-206 | `--sb-color-selection` | FAR-03 | anzupassen | Heute accent-fill |
| PDF-, EPUB-, CBZ-, DOCX-Leser, Bild-Zoom | PdfViewer.tsx, EpubViewer.tsx, CbzViewer.tsx, DocxViewer.tsx, ZoomableImage.tsx | keins | – | fehlt in sebaro | |
| Ablehnungen (geschützt, unlesbar, zu groß) | EpubViewer.tsx:269, CbzViewer.tsx:152, DocxViewer.tsx:109 (`.banner`) | `.sb-callout--warning` / `--error` (§3.11) | STA-05 | anzupassen | |
| „Wird geladen…“ bei lokaler Arbeit | Viewer.tsx:71, :80, :84 (`editor.loading`) | nichts zeigen | STA-06 | Konflikt | |
| EPUB/DOCX-Dokumentstil im Shadow-DOM | documentCss.ts:11-43; eingesetzt per `<style>` in EpubViewer.tsx:182-183, DocxViewer.tsx:69-71 | Regeln wie `.sb-prose`, Zitat, Tabelle, Link | LNK-01, TXT-17, DAT-05 | fehlt in sebaro / anzupassen | css/sebaro.css erreicht keinen Shadow Root. Die CSP (`tauri.conf.json:29`, `style-src 'self' 'unsafe-inline'`) ist dabei kein Hindernis. Abweichungen heute: Link als Kobalt-Wort (:35), Zitat border-strong und muted (:30-34), Bildunterschrift zentriert (:42), `pre` auf bg-fill mit Radius 8 (:37) |
| Inhaltsverzeichnis-Popover | ContentsPopover.tsx:55-72, viewer.css:250-292 | Overlay-Look `.sb-menu`, Zeilen `sb-row`, die aktuelle mit `aria-current` und Ortslinie (§4.13). `.sb-toc` (§4.5) ist nur Artikel-Seitenleiste oder `details` | NAV-08, NAV-01, EBE-07 | fehlt in sebaro / anzupassen | Heute ist `.on` mit accent-fill markiert (viewer.css:291), ohne `aria-current` |
| Umschalter „Inhalt“ (PDF `viewer.outline`, EPUB `viewer.epub.contents`; beide heißen auf Deutsch „Inhalt“) | PdfViewer.tsx:169-172, EpubViewer.tsx:291-294 (`aria-expanded`) | `sb-secondary-action--compact[aria-expanded]` | NAV-10 | anzupassen | |

### F. Rückverweise: `ui/components/Backlinks.tsx:23-103`, `ui/styles/backlinks.css`

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Bereich unten im Pane (max. 33 %), ein- und ausblendbar über „Darstellung“ (ADR-0043) | backlinks.css:3-10, menu.rs:442-446 | kein unteres Fensterteil. `sb-window__inspector` liegt seitlich, 280 px (spec/02 §4.17) | DSK-04, FAR-05 | fehlt in sebaro | Ausblendbar ist er schon (DSK-04). Grund heute bg-surface, siehe Frage 6 |
| Kopf in Großbuchstaben | backlinks.css:22-28 | `sb-list-header` mit `__count` (§3.3) | TXT-05, DAT-01 | Konflikt | sebaro verbietet Versalien |
| Zähler in Mono | backlinks.css:30-35 | `.sb-num` in Sans | SCH-03 | Konflikt | Widerspricht auch ADR-0048 |
| Zeilen für Notiz und Karte | Backlinks.tsx:70-98 | `sb-row` (§4.13): `__icon` `file-text` bzw. `board`, `__name`, `__sub`; zweizeilig 48 px | RAU-06, TXT-09, ICO-03 | anzupassen | Heute eine CSS-Glyphe `.backlink-glyph` |
| Leerzustand | Backlinks.tsx:68 | `.sb-list-end` bzw. Satz „Noch keine …“ | DAT-01, DAT-07 | Pilot | Der Wortlaut „Noch keine Notiz und keine Karte verweist hierher.“ passt schon. Heute in fg-subtle |

### G. Board und Karten: `ui/components/BoardPane.tsx`, `ui/styles/board.css`

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Leeres Board mit Primärknopf in der Mitte | BoardPane.tsx:49-57 | `.sb-empty`; „Neues Board“ als Aktion unten | DAT-07, AKT-01 | Konflikt | ADR-0048: „The empty state's own button goes“ |
| Kopf: Name und „N Spalten · M Karten“ | BoardPane.tsx:146-167 | Leiste über `sb-board`; Zahlen im Spaltenkopf | DAT-01 | anzupassen | |
| Board-Name als Knopf zum Umbenennen | BoardPane.tsx:147-163 | Umbenennen im „Mehr“-Menü; Bearbeiten per Doppelklick oder Taste | AKT-10, FOR-05 | anzupassen | Ein Knopf ohne sichtbaren Hinweis |
| Board-Wechsler `<select class="btn ghost">` | BoardPane.tsx:169-185 | natives `.sb-select` | EIN-05 | anzupassen | |
| „Board löschen“ | BoardPane.tsx:186-192 | `.sb-danger-action` oder als letzter Punkt im „Mehr“-Menü | AKT-07, AKT-08, AKT-10 | Konflikt | siehe Frage 7 |
| „Spalte hinzufügen“ mit Plus-Icon | BoardPane.tsx:193-211 | `sb-secondary-action--compact` mit `plus--16` | AKT-06, ICO-06 | Pilot / anzupassen | Look nach ADR-0050 schon die sebaro-Sekundäraktion. Klasse und Sprite ändern sich |
| Board-Hinweis (Konflikte, unlesbare Karten) | BoardPane.tsx:219-242 | `.sb-callout--note` | STA-05 | anzupassen | |
| „nur online“-Hinweis | BoardPane.tsx:511-515 | `.sb-callout--note` oder Stand-Satz in der Aktionszone (D72) | STA-05 | anzupassen | |
| Spalten mit Rahmen und Radius 12 | board.css:64-73 | `.sb-board__columns`, `section.sb-board__column[aria-labelledby]`, nur Haarlinien (spec/02 §3.16) | DAT-13 | Konflikt | |
| Spaltenbreite 268 px | Token `--ds-size-board-column` (tokens.css:280) | kein Token | – | fehlt in sebaro | |
| Spaltenkopf 40 px | board.css:75-93 | `.sb-board__head` 32 px, `h?.sb-board__title > .sb-board__name + .sb-board__count` | DAT-13, RAU-06 | anzupassen | `sb-board__name` steht in der Spec, css/sebaro.css hat keine Regel dafür |
| Spaltenzähler als Pille | board.css:95-106 | `.sb-board__count` in text-muted, tabellarische Ziffern | DAT-01, FOR-06 | Konflikt | |
| Spaltenknöpfe ← → Umbenennen × (nur bei Hover) | BoardPane.tsx:261-312, board.css:111-133 | „Mehr zu <Spalte>“ als `sb-icon-button--compact` (`more-horizontal--16`) mit `.sb-menu`, „Löschen …“ zuletzt | AKT-10, EBE-07, ICO-06 | neu zu bauen | ADR nötig |
| Karte mit 3 px grauer Kante, Radius 8 | board.css:227-235 | `li.sb-card.sb-card--item`: 1 px `border-strong`, Radius 12, Ortslinie nur auf der aktuellen Karte (css/sebaro.css:899-903) | FOR-05, NAV-01 | Konflikt | FOR-05 nennt novalis als Gegenbeispiel |
| Kartentitel | BoardPane.tsx:349 | `p.sb-card__title` | FOR-05 | anzupassen | |
| Kartenbeschreibung (ADR-0013, -0033) | BoardPane.tsx:354-361, board.css:262-309 | `.sb-card__text` (css/sebaro.css:893) gilt für jede `sb-card`, also auch für `--item`; spec/02 §3.16 nennt für Board-Karten aber nur `__title` und `__meta` | – | fehlt in sebaro (Spec) | Gerendertes Markdown in der Karte beschreibt sebaro nicht |
| Kartenknöpfe Umbenennen ≡ Verknüpfen × (versteckt) | BoardPane.tsx:364-422 | „Mehr zu <Karte>“, immer sichtbar, mit `.sb-menu` | FOR-05, AKT-10, ICO-06 | neu zu bauen | ADR nötig |
| Kontextmenü der Karte (nativ) | `menu.rs:599-638` | aufgebaut wie „Mehr“: Löschen ganz unten nach einer Trennlinie, mit „…“ | AKT-10, DAT-13 | Konflikt | Heute steht „Karte löschen“ an vierter Stelle vor „Notiz aus Karte anlegen“ und „In Spalte verschieben“ (menu.rs:618). Gefahrfarbe und Mülleimer kann ein natives Menü nicht zeigen. „Verschieben ohne Ziehen“ gibt es schon (Untermenü) |
| Verknüpfte Notizen als Chips, × zum Lösen, fehlende Notiz | BoardPane.tsx:428-458, board.css:311-360 | Linkstil plus `file-text`; Lösen mit `close--16` | LNK-01, ICO-06 | fehlt in sebaro / anzupassen | „Notiz nicht gefunden“ steht nur im Tooltip (BoardPane.tsx:432) |
| „Spalte fehlt“ | BoardPane.tsx:426 | `.sb-status--warning`: Glyphe plus Wort | STA-01, STA-08 | anzupassen | |
| Ziehen mit Deckkraft 0.5 | board.css:250-252 | DSK-11; in spec/02 §4.22: `dragging` 2 px Tinte, `drop-before/after` 3 px accent. css/sebaro.css baut das nur für `.sb-row` (:2498-2504) | DSK-11 | Konflikt / fehlt in sebaro | Für Karten gibt es keine fertigen Regeln |
| Ablageziel beim Ziehen | BoardPane.tsx:47, :254, :343 (Zustand `over`) | Ziel in Kobalt: 3-px-Linie zwischen zwei Karten | DSK-11 | neu zu bauen | Heute wird die Ablagestelle berechnet, aber nicht gezeigt |
| „Neue Karte“ im Fuß jeder Spalte (ADR-0050) | BoardPane.tsx:475-499 | spec/02 §3.16 „Windows“: Hauptaktion „Neue Karte“ in der Aktionszone, Spalte der aktuellen Karte | AKT-01, DAT-13 | Konflikt | ADR-0050 hat „New Card als Hauptaktion“ ausdrücklich abgelehnt, D65 nennt „Neue Notiz“ in allen Ansichten. Siehe Frage 8 |
| Leere Spalte | – | `p.sb-board__empty` „Noch keine Karte.“ | DAT-07 | neu zu bauen | Heute zeigt eine leere Spalte nur ihren Fuß |
| Keine Spalten | BoardPane.tsx:505-507 (`board.empty` „Noch keine Karten.“) | `.sb-empty` | DAT-07 | anzupassen | |
| „Wird geladen…“ | BoardPane.tsx:510 (`editor.loading`) | nichts zeigen | STA-06 | Konflikt | |
| Schmales Board unter 640 px | – | `sb-board__nav`, `__position`, `js/sb-board.js` (demo/assets/sb-board.js) | DAT-13 | neu zu bauen | Der Inhalt kann bis 480 px schmal werden (DSK-04) |
| Spaltenkategorie (D73) | `crates/novalis-core/src/boards/mod.rs:34-37` (Column hat nur id und name) | `sb-board__name sb-category sb-category--<n>` | FAR-12 | fehlt in novalis | siehe Frage 9 |

### H. Vault-Suche: `ui/components/SearchPanel.tsx`, `ui/styles/overlay.css`, `ui/components/Marked.tsx`

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Rahmen `.scrim > .palette` | SearchPanel.tsx:159-160 | Look von `dialog.sb-command-palette` (§4.16) | NAV-09, EBE-01 | fehlt in sebaro / anzupassen | Eine Volltextsuche mit Filtern hat sebaro nicht |
| Suchfeld mit Prompt-Glyphe | SearchPanel.tsx:161-171, overlay.css:14-35 | `.sb-search` (Icon `search`, „Suche leeren“) | EIN-05 | anzupassen | |
| Umschalter Groß/klein, Regex, alle Dateien als `.kbd` | SearchPanel.tsx:185-208 | `.sb-chip[aria-pressed]` (§2.9, css/sebaro.css:756-757) | EIN-04 | Konflikt | `kbd` ist in sebaro eine Tastenkappe |
| Filter Tag und Ordner mit datalist | SearchPanel.tsx:209-248, overlay.css:45-62 | `.sb-field--compact` | EIN-01 | anzupassen | datalist kommt in sebaro nicht vor |
| „Filter zurücksetzen“ | SearchPanel.tsx:250-259 (`editor.search.clearFilters`) | `sb-text-action--compact` | AKT-06 | anzupassen | Auch als `.kbd` gesetzt |
| Trefferzeilen | SearchPanel.tsx:269-282 | `sb-row[role=option]` mit `__name` und `__meta` (Pfad); aktive mit Ortslinie | RAU-06, NAV-01, TXT-09 | Pilot / anzupassen | Die 3-px-Linie gibt es schon (overlay.css:93). Pfade in Mono sind erlaubt (ADR-0048) |
| Trefferglyphe | overlay.css:108-114 | `file-text` oder keine | ICO-03 | anzupassen | |
| Markierung `mark.match` | overlay.css:161-164 | `mark` / `.sb-mark` (css/sebaro.css:804-807) | FAR-12 | anzupassen | Heute warning-fill ohne Kante. Gilt auch für Quick Open und die Palette |
| „Suche läuft…“ | SearchPanel.tsx:265 | bei lokaler Arbeit kein Text | STA-06 | Konflikt (gering) | Bei 10.000 Notizen dauert die Suche spürbar |
| „Keine Treffer“ | SearchPanel.tsx:266-268 | `sb-command-palette__empty` (§4.16) | DAT-07 | anzupassen | |
| Fuß mit Zählern | SearchPanel.tsx:285-296 | Satz in caption text-muted; Tasten als `.sb-keys` | ICO-08 | anzupassen | |

### Nicht geprüft
- Kein Bildschirmfoto, keine Ansicht in Hell/Dunkel, kein Test mit 100 % / 200 % Schrift.
- Wie sich das Fenster bei großer Schrift verhält: Die Bedienelemente sind in px festgelegt, nur der Editor wächst mit.
- `sebaroHighlight` ist auch in sebaro nicht ausgeführt worden.
- Nicht geprüft wurde außerdem:
  - ob `sb-menu.js` neben React funktioniert;
  - ob natives Menü oder CodeMirror bei ⇧⌘K gewinnt;
  - ob die novalis-Mono-Datei wirklich der Regular-Schnitt von vor D70 ist (nur Größe und Prüfsumme verglichen);
  - wie groß css/sebaro.css minifiziert ist (unminifiziert 230 459 Byte, gzip 49 698 Byte).

### Prüfung

Gegengeprüft am 2026-10-24, nur lesend. Gesucht wurde in `css/sebaro.css`, `dist/tokens.css`, `icons/dist/icons.json`, `spec/`, `DECISIONS.md` und im Guide `rules/rules.json`.

**Bestätigt:**
- Alle zitierten Regel-IDs gibt es.
- Alle zitierten sebaro-Klassen gibt es, ebenso alle Tokens und Spec-Abschnitte.
- `sb-board__name` hat tatsächlich keine CSS-Regel.
- `minus--16` fehlt wirklich.

**Korrigiert:**
- Einrückungslinien stehen in `indentationGuides.ts:129-134`, nicht in :50-56.
- SearchPanel: „Suche läuft…“ steht in Zeile 265. Der Knopf heißt „Filter zurücksetzen“, nicht „Filter löschen“.
- Der Umschalter im Betrachter heißt in PDF und EPUB „Inhalt“, nicht „Gliederung“.
- Der Ladetext heißt „Wird geladen…“.
- „Spalte hinzufügen“ trägt schon das Plus-Icon und den Look aus ADR-0050.
- Der Leerzustand der Rückverweise passt schon zu DAT-07.
- Die CSP erlaubt `style-src 'unsafe-inline'`. Sie ist also kein Hindernis für den Shadow Root.
- `.sb-card__text` gibt es in css/sebaro.css für jede Karte. Die Lücke liegt nur in spec/02 §3.16.
- Die Ausrichtung des externen Icons ist -0.125em. Zitiert sind jetzt die Zeilen 1295-1307 und 800-816 von css/sebaro.css.
- Laut §3.10 ist die eine Form der Codeblock mit Leiste. Der nackte `pre.sb-code` ist nur die Ausweichform.
- Geprüft und ergänzt: `.sb-prose` gestaltet `hr`, `img` und eine nackte `table` nicht.
- ⇧⌘K kommt in novalis nur aus der `defaultKeymap`. Das eigene Kürzel für „Zeile löschen“ ist ⌃⇧K.

**Ergänzt (Zeilen):**
- Editor: Durchstreichen, Falt-Platzhalter, Tooltip.
- Vorschau: Bilder, Listen und `strong`, „Wird geladen…“.
- Betrachter: „Einpassen“/„Seitenbreite“, der `.on`-Zustand mit Füllung.
- Board:
  - Name als Umbenennen-Knopf;
  - Hinweis „nur online“;
  - Kontextmenü der Karte mit Löschen nicht zuletzt (AKT-10);
  - fehlende Darstellung des Ablageziels;
  - Ziehregeln, die es nur für `sb-row` gibt.
- Suche: „Keine Treffer“, datalist-Felder.

**Fragen:**
- Gestrichen: „Code-Hervorhebung“. Entschieden durch D67 (12), D69, D85 und TEC-08.
- Gestrichen: „Suchtreffer“. Für den Editor entscheidet DSK-03, für Text und Listen FAR-12. Der Widerspruch zu §3.1b bleibt als Lücke.
- Umgeschrieben: „Neue Karte“. ADR-0050 hat die Karte als Hauptaktion abgelehnt, und D65 nennt „Neue Notiz“ in allen Ansichten. Die Empfehlung folgt jetzt dem Inhaber-Entscheid. Der Widerspruch zu spec/02 §3.16 wird als Lücke gemeldet.

**Nicht geprüft:**
- Farbwerte von Pilot-Zeilen, die ich nicht einzeln verglichen habe: Gutter, Kommentar und number.
- Alle Laufzeit- und Darstellungsfragen von oben.

## 8 Dialoge, Rückmeldung, leere Zustände, Icons, Kürzel, Texte

Grundlage ist eine Lesung des Quelltexts von novalis (Branch `sebaro-umbau` = v1.2.0) und des Arbeitsbaums von sebaroDesign (HEAD D99, D100 noch nicht committet) sowie des Guides (`rules/rules.json` 2.9.0, Stand 2026-10-24). Es lief nichts: keine App, kein Build, keine Screenshots, und `tools/check_shortcuts.py` wurde nicht ausgeführt.

Stand-Werte:
- **schon im Pilot**: erfüllt die Regel bereits
- **anzupassen**: vorhanden, weicht ab
- **neu zu bauen**: fehlt in novalis
- **fehlt in sebaro**: siehe `docs/sebaro-luecken.md`
- **Konflikt**: eine novalis-Regel oder ein ADR steht gegen eine sebaro-Regel und braucht eine Entscheidung des Inhabers

### A Dialoge

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Dialog-Rahmen `.scrim > div.dialog[role=dialog][aria-modal]` | `components/Prompt.tsx:87-100`, `styles/app.css:913-997` | natives `<dialog>` mit `showModal()`, `.sb-dialog`, `__title`, `__text`, `__actions` (spec/02 §4.6), Scrim `--sb-color-scrim`, Radius `--sb-radius-sheet` (16) | EBE-03, EBE-01, FOR-01, BEW-02 | anzupassen | Ein `div` statt `<dialog>`. Radius heute `--ds-radius-container` (12), verlangt 16. Breite heute `--ds-size-palette` (640 px), EBE-03 erlaubt höchstens 560 px. Der Scrim schiebt den Dialog nach oben (`padding-top: 96px`, `app.css:913-922`). Der Klick auf den Scrim schließt (`Prompt.tsx:87`); EBE-03 erlaubt das ausdrücklich („Tippen auf den Scrim brechen ab“). Das Einblenden von unten kommt mit `:modal` von selbst. |
| Bestätigung: Danger-Taste mit `trash` und 45°-Schnitt | `Prompt.tsx:148-152`, `app.css:833-861` (`.btn.danger`) | `.sb-danger-action` (spec/02 §1.4), `--sb-x-sebaro-danger-bevel-size` | AKT-07, FOR-04 (D39, D56) | schon im Pilot | Die Form stimmt. AKT-07 und §1.4 verlangen ein 24-px-Icon, novalis zeichnet 16 px. |
| Anfangsfokus der Bestätigung | `Prompt.tsx:44-47` (`accept.current?.focus()`) | „Abbrechen“ zuerst und mit `autofocus` (spec/02 §4.6) | AKT-08, EBE-03 | anzupassen | Heute liegt der Fokus auf der destruktiven Taste. Die Reihenfolge „Abbrechen“ → Verb stimmt schon. |
| Abbrechen `.btn.ghost` | `Prompt.tsx:142-144`, `app.css:819-831` | `.sb-secondary-action--compact` (§1.2, §4.18) | AKT-06 | schon im Pilot | 1 px `border-control`, 32 px. Nur der Klassenname ändert sich. |
| Eingabedialog: lime OK mit Fortschritt („Wird angelegt …“, Tintenbalken, „Noch mal versuchen“) | `Prompt.tsx:153-157`, `stores/ui.ts:55-83`, `app.css:754-818` | `.sb-primary-action` mit `__bar`, `aria-busy`, `data-sb-state="retry"` (spec/02 §1.1, spec/03 §16); sebaro kennt auch den Wartezustand der Nebenaktion: `loader` mit `.sb-spinner` statt des Icons, `aria-busy` (spec/02 §1.7) | AKT-05 (D48) gegen AKT-01 und EBE-03 („im Dialog gibt es nie eine Hauptaktion“) | Konflikt | ADR-0048 hat die lime OK im Dialog festgehalten. sebaro beschreibt in §4.6 nur den Bestätigungsdialog; einen Eingabedialog gibt es nicht → F1, L1. Einen „✓ Angelegt“-Schritt gibt es bewusst nicht (ADR-0048). |
| Beschriftung „OK“ | `Prompt.tsx:155` (`app.ok`) | Verb + Objekt (spec/07 §3 Regel 1) | AKT-04 | anzupassen | Jeder Eingabedialog braucht ein eigenes Verb („Anlegen“, „Umbenennen“, „Sichern“). Das sind neue Keys im `PromptRequest` (bisher gibt es nur `busyKey`). |
| Fehlersatz `p.dialog-error[role=alert]` in Danger-Farbe | `Prompt.tsx:136-140`, `app.css:984-990` (`--ds-color-danger-text`) | Grund in `text` mit `error`-Glyphe davor (D83 (2)). Namensfehler als Feldfehler: `.sb-field__error` mit `error--filled-16`, `aria-invalid`, `aria-describedby` (spec/02 §2.1) | EIN-02, TXT-07 | anzupassen | Heute steht der Satz in Danger-Farbe und ohne Glyphe. |
| Eingabefeld `input/textarea.dialog-input`, Hinweis `.dialog-hint` | `Prompt.tsx:105-135`, `app.css:948-982` | `.sb-field`, `__label`, `__control`, `__help` | EIN-01, ZUG-04 | anzupassen | Es gibt kein sichtbares `<label>`, nur einen Platzhalter. Heute hat das Feld einen vollen 1-px-Rahmen auf `bg-surface`; EIN-01 verlangt eine `surface-sunken`-Fläche mit Grundlinie und ohne Rahmen. |
| Titel der Bestätigungen | `lib/commands.ts:199`, `:222`; `BoardPane.tsx:96`; `lib/cardActions.ts:51` | Titel = Frage („<Objekt> löschen?“, spec/07 §4.4) | EBE-03 | anzupassen | `board.deleteBoard`, `board.deleteCard` und `board.deleteColumn` sind Titel und Tastenwort zugleich (gleicher Key). Der Titel braucht einen eigenen Key mit „?“. |
| Papierkorb-Dialog | `lib/commands.ts:214-235`; `app.confirmTrash.*`, `menu.file.moveToTrash` | spec/03 §7.1 und D83 (8); Beispiel aus AKT-08: „„<Name>“ in den Papierkorb?“ / „Die Datei landet im Papierkorb deines Systems. Von dort kannst du sie zurückholen.“ / „Abbrechen“ · „In den Papierkorb“ | AKT-08 | anzupassen | Heute „In den Papierkorb verschieben?“ / „{{name}} kann aus dem Papierkorb wiederhergestellt werden.“ / „In den Papierkorb legen“. |
| Texte zu Board, Karte und Spalte löschen | `board.deleteBoardBody`, `deleteCardBody`, `deleteColumnBody_*` | Der Text endet mit „Das lässt sich nicht rückgängig machen.“ oder, nur bei echtem Papierkorb, mit „Von dort kannst du sie zurückholen.“ | AKT-08 | anzupassen | Ein Board geht in den Papierkorb (`commands.ts:205`) → Papierkorb-Satz. Eine Karte wird nur mit einem Zeitstempel als gelöscht markiert (`crates/novalis-core/src/boards/mod.rs:647-650`); sie kommt nicht in den Papierkorb, und die App kann sie nicht zurückholen → „Das lässt sich nicht rückgängig machen.“. `deleteCardBody` nennt die Karte nicht, obwohl `cardActions.ts` `values.title` übergibt. Beim Löschen einer Spalte gehen keine Karten verloren. |
| ⌘⌫ fragt immer | `commands.ts:214-235`, `menu.rs:212-214` (ohne Accelerator) | „Löschen …“ ⌘⌫ immer mit Dialog, ohne nativen Accelerator (spec/02 §4.19, spec/09 §13.1) | DSK-09 (D39) | schon im Pilot | – |

### B Rückmeldung (Kurzmeldung, Fortschritt, Fehler)

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Toast `div.toast[role=alert]` mit Schließen-Taste, 6 s | `components/Toast.tsx:11-35`, `app.css:999-1019` | `.sb-toast`, `.sb-toast__action`, `role=status`, im Fenster `.sb-window > .sb-bottom-block > .sb-toast` (`sebaro.css:2512`, spec/02 §4.17), `sbToast.show()/hide()` (`js/sb-controls.js`), spec/02 §4.8 | EBE-05 (D78), FOR-01 | Konflikt | Abweichungen: `role=alert` statt `role=status`; die zweite Taste „Schließen“ (sebaro erlaubt nur „Rückgängig“); unten rechts statt oben in der Aktionszone; keine Pause bei Zeiger oder Fokus; kein Escape; Radius 8 statt 12; `max-width` 520 statt 560. Die 6 s stimmen. |
| `report()`: jeder Fehler wird zum Toast | `stores/ui.ts:293-295`, `stores/board.ts:126` | keine Kurzmeldung für Fehler. Der Fehler steht dort, wo er passiert ist: am Feld oder als `.sb-primary-action-bar__message` (spec/02 §1.1, §4.17) | EBE-05, TXT-07, D83 (2) | Konflikt / fehlt in sebaro | Für Fehler von Menübefehlen, Ziehen oder Links ohne Feld nennt sebaro keine Fläche → F2, L2. |
| `board.cardAdded` („Karte zu {{board}} hinzugefügt.“) | `lib/commands.ts:372` | erlaubter Fall 1 oder 3 in spec/07 §4.3 | EBE-05 | anzupassen | Darf bleiben. „Rückgängig“ wäre eine neue Funktion und bräuchte einen ADR. |
| `palette.copied` („Kopiert: {{text}}“) | `lib/commands.ts:398` | steht nicht in der Liste spec/07 §4.3; Rückmeldung an Ort und Stelle gibt es nur bei `.sb-code__copy` („Kopiert“ für 2 s, spec/02 §3.10) | EBE-05 | fehlt in sebaro | Die Palette ist nach dem Befehl zu, daher geht die Form von `.sb-code__copy` nicht → L3. |
| `tree.dropRefused_*` (Finder-Ablage, nicht kopierte Dateien) | `Sidebar.tsx:175` | Abgelehntes Ziel: keine Marke, der `title` sagt warum (spec/02 §4.22) | DSK-11, EBE-05 | anzupassen | Heute meldet novalis die Ablehnung erst nach dem Drop als Toast. Bei gemischten Dateien lehnt nicht das Ziel ab, sondern einzelne Dateien; dann ist es ein Fehler → F2. |
| Ablehnungen `editor.previewExternalLink`, `editor.externalLinkRefused`, `app.openLinkRefused`, `app.openUnsupported` | `EpubViewer.tsx:255`, `DocxViewer.tsx:103` (beide `editor.previewExternalLink`), `lib/external.ts:18` (`editor.externalLinkRefused`), `lib/opening.ts:40,48,66` | – | EBE-05, TXT-07 | Konflikt | Das sind Fehler, also keine Kurzmeldung → F2. Mehr `showToast`-Aufrufe gibt es nicht (grep). |
| Fehlerort Aktionszone | `components/StatusBar.tsx:33-99` | `.sb-primary-action-bar__message` mit `error--16`-Glyphe, ersetzt den Stand-Satz | D83 (2), AKT-05 | neu zu bauen | nur, wenn F2 = A |
| Stand-Summe zweimal (Seitenleistenfuß und Statusleiste) | `Sidebar.tsx:423-434`, `StatusBar.tsx:79-86` | einmal als `.sb-primary-action-bar__status`; „Konflikt“ immer mit `warning--16` (`.sb-status--warning`) | STA-07, STA-08 (D72, D92) | anzupassen | Der Guide nennt novalis bei STA-07 ausdrücklich. |
| Punkte und Warnfarbe als Status: `.status-dot` (grün, Cloud), `.hint-dot` (Fuß), `.tab-dot`; Statuswort in Warnfarbe `.status-item.warn`, `.badge-conflict` | `StatusBar.tsx:68`, `:74`, `:83`; `Sidebar.tsx:426`, `:432`; `app.css:478-480`, `:507-513`, `:890-906` | Zeichen und Wort mit Sprite-Glyphe (`.sb-status`, `.sb-status--neutral`, `.sb-status--warning`), Wort in `text`; der Stand-Satz in `text-muted` | STA-08, HAL-05 | anzupassen | STA-08 verbietet ein Statuswort in Warnfarbe, HAL-05 verbietet Punkte. |

### C Banner und Hinweise

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Banner für externe Änderung (`replacedBySync`, `deletedOnDisk`, `changedOnDisk`) | `components/Banner.tsx:31-129`, `app.css:693-727` | `.sb-callout--warning` (`warning--filled` 20 px, `__title`, `__text`, 1-px-Haarlinie, keine Fläche, `role="note"`, spec/02 §3.11); Aktionen als `.sb-secondary-action--compact` | STA-05, FAR-02, AKT-01, ZUG-09 | Konflikt | `.banner-warning` hat eine `warning-fill`-Fläche. Je Variante steht eine lime `.btn.primary` mitten in der Ansicht, also eine zweite Primäraktion. Heute `role="alert"`. `.banner-body` schneidet mit `nowrap` und `ellipsis` ab (`app.css:713-720`), auch den Pfad der Konfliktkopie; ZUG-09 verbietet das. Das Callout hat keinen Platz für Aktionen → F4, L4. |
| Info-Banner `binary`, `notUtf8`, `hugeFile`, `plainMode` | `Banner.tsx:131-150` | `.sb-callout--note` (`info--filled`) | STA-05, ZUG-09 | anzupassen | Das Callout hat kein „Ausblenden“ → L4. |
| Hinweis im Board `.board-notice` (Konflikte aufgelöst, Spalten zusammengeführt, unlesbare Karten) mit „Ausblenden“ | `BoardPane.tsx:214-241` | `.sb-callout--note` bzw. `--warning` | STA-05 | anzupassen | Von der ersten Fassung übersehen. Wie oben, L4. |
| Cloud-Hinweis (einmalig) | `components/CloudHint.tsx:12-28` | `.sb-callout--note` | STA-05, TXT-02 | anzupassen | „Cloud-Ordner“: konkreter wäre der Anbieter (`status.cloud.fileProvider` kennt `{{provider}}`). spec/07 §6.2 und TXT-02 nennen „in der Cloud“ ohne Ort als vage. |
| Hinweis auf alten Vault | `components/LegacyHint.tsx:13-33` | `.sb-callout--note`, Befehl in `code` (sebaro Mono, spec/07 §3 Regel 11) | STA-05, ZUG-09 | anzupassen | Der Befehl steht heute in Backticks im Text. Die Zeile wird abgeschnitten, der volle Text steht nur im `title`; ZUG-09 und D99 (1) verlangen Umbruch. „alte Novalis-App“ schreibt den Namen groß: Produktnamen bleiben unverändert (spec/07 §3 Regel 10, §6.1). |

### D Leere Zustände, Laden, Start, Boot

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Kein Vault | `App.tsx:385-391`, `app.css:666-690` (zentriert) | `.sb-empty`, `__title`, `__text`, linksbündig; optional `onboarding--spot` mit `.sb-icon--spot`; Hauptaktion in der Aktionszone (spec/02 §3.14) | DAT-07, RAU-04 | anzupassen | Die Taste steht schon unten (`StatusBar.tsx:92-95`). Der Text ist zentriert. Der Titel „Vault öffnen“ ist ein Verb; vorgeschlagen ist „Kein Vault geöffnet“ (`errors.noVault` gibt es schon). |
| Keine Notiz offen | `App.tsx:421-425` (`editor.emptyState` mit ⌘P) | `.sb-doc-tabs__none` „Keine Notiz offen. Wähle eine im Ordner links.“ (spec/02 §4.21, spec/07 §4.8), Kürzel als `.sb-keys` | DSK-10, DAT-07 | anzupassen | Heute steht der Satz zentriert im Bereich und nicht an der Stelle der Reiterleiste. |
| Leerer Baum | `Sidebar.tsx:204` ist der Fall ohne Vault (leeres `<nav>`); ein leerer Vault zeigt einen Baum ohne Zeile | `.sb-empty` oder Schlusssatz `.sb-list-end` | DAT-01, DAT-07 | neu zu bauen | Der Key `tree.empty` („Dieser Vault enthält noch keine Dateien.“) existiert, wird in `src` aber nicht verwendet (grep). |
| Kein Board | `BoardPane.tsx:50-57` (nur eine lime „Neues Board“ mitten in der Fläche, ohne Titel und Satz) | `.sb-empty`, Hauptaktion unten | DAT-07, AKT-01 | Konflikt | Zusammen mit „Neue Notiz“ in der Aktionszone stehen zwei lime Tasten (ADR-0048: „Neue Notiz“ in jeder Ansicht). Gehört zum Board-Bereich. |
| Leere Spalte `board.empty` „Noch keine Karten.“ | `BoardPane.tsx:506` (`p.board-hint`) | `.sb-board__empty` „Noch keine Karte.“ (spec/02 §3.16, spec/07 §4.8) | DAT-13 | anzupassen | – |
| Palette ohne Treffer `palette.noResults` „Keine Treffer“ | `Palette.tsx:269`, `overlay.css` `.result.empty` (zentriert) | `.sb-command-palette__empty[role=status]` „Kein Befehl passt zu „xyz“.“ (spec/02 §4.16) | NAV-09 | anzupassen | – |
| Vault-Suche „Suche läuft…“ / „Keine Treffer“ / „Die ersten {{count}} Treffer werden angezeigt“ | `SearchPanel.tsx:265-267`, `:293` | lokal ohne Text; Listenende als Satz | STA-06, DAT-01 | anzupassen | Eine Suche über alle Dateien kann über 1 s dauern; STA-06 regelt nur „lokal“ gegen „entfernt“ → F7, L11. Dem Satz zu den Treffern fehlt der Punkt. |
| Rückverweise leer `editor.backlinks.empty` | `Backlinks.tsx:68` | „Noch keine …“ (spec/07 §4.2) | DAT-07 | schon im Pilot | „Noch keine Notiz und keine Karte verweist hierher.“ |
| `.pane-loading` und `.board-busy` „Wird geladen…“ | `App.tsx:382,393,399,401,411`; `Viewer.tsx:71,80,84`; `Preview.tsx:546`; `EpubViewer.tsx:277`; `CbzViewer.tsx:158`; `DocxViewer.tsx:116`; `BoardPane.tsx:510` | lokal nichts; entfernte Arbeit über 1 s: „Wird geladen …“ mit Anzeige (`.sb-loading`, spec/02 §3.12, spec/07 §4.5) | STA-06 | Konflikt | Lokale Lesevorgänge zeigen heute Text. Ein Download aus der Cloud darf ihn zeigen → F7. `.board-busy` war in der ersten Fassung nicht aufgeführt. |
| Viewer: unlesbar, geschützt, leer (`viewer.epub.unreadable`, `viewer.epub.protected`, `viewer.cbz.unreadable`, `viewer.cbz.empty`, `viewer.docx.unreadable`, `viewer.docx.tooLarge`) | `EpubViewer.tsx:271`, `CbzViewer.tsx:28-29`, `DocxViewer.tsx:108-111` | Fehler nach spec/07 §4.1 (was, was sicher ist, was tun), als `.sb-empty` oder `.sb-callout--error` | TXT-07 | anzupassen | Von der ersten Fassung übersehen. Die Sätze sagen nicht, was man tun kann. Gehört auch zum Viewer-Bereich. |
| Boot-Fehler `.boot-error-card` | `App.tsx:351-363`, `app.css:1039-1078` | `.sb-callout--error` oder `.sb-empty` mit „Details“ (spec/07 §4.1) | TXT-07, SCH-04, TEC-01, RAU-04 | anzupassen | „Etwas ist schiefgelaufen“ ist vage (spec/07 §6.4 nennt „Leider ist ein Fehler aufgetreten“). Der Code (`describeBootError`, `App.tsx:71-79`) steht offen in der zweiten Zeile und nicht unter „Details“. Die Werte 17 px / 550 / −0.022em, 12 px, 12.5 px, 32 px und 14 px sind Literale statt Tokens. Die Karte ist zentriert (`place-items: center`). |
| Fatal-Banner `pre.fatal`, `#fatal-banner` | `main.tsx:27-54`, `app.css:1086-1108` | – | – | bleibt | Bewusst ohne i18n, weil es vor i18n greift. |
| Startkachel | `components/StartTile.tsx:15-52`, `app.css:109-128` | `.sb-start`, `.sb-start__tile`, `js/sb-start.js` (`sbStart.hold()/release()`), `--sb-x-sebaro-start-tile-size` | STR-01, STR-02, BEW-04, ZEI-01 (D65) | anzupassen | Petrol nur in der Kachel ist erfüllt, ebenso das Symbol ohne Kürzel (STR-02). Bei reduzierter Bewegung springt die Kachel (1 ms), statt an Ort und Stelle auszublenden (STR-01). Der Rückfall-Timer steht auf 1000 ms. „Nur während echtem Laden“: nicht geprüft. |
| App-Kachel in der Titelleiste `AppTile` | `components/Icon.tsx:71-89` | `brand/inline/tile-novalis-small.svg` aus dem Export (`svg.sb-app-sign` mit `__tile`, `__glyph`), `.sb-sign-tile--32` | ZEI-06, ZEI-07 | anzupassen | Geprüft: Pfad, `rx` und Transform sind gleich wie in der Brand-Datei, die Farben ebenfalls (`--ds-color-tile` #0f8186 / #ffffff). Die Kopie ist aber von Hand übernommen, mit eigenen Klassen; ZEI-07 verlangt die Datei unverändert aus dem Export. |
| „Regel zum ersten Bildschirm“ (D98 V8) | – | BIL-02 | – | nicht anwendbar | V8 gilt nur für App-Websites. |

### E Icons (Sprite-Namen exakt aus `icons/dist/sprite.svg`)

Technik heute: Pfade inline je Icon, Klassen `.icon` und `.icon-16` (`app.css:182-192`, Strich 2.25). sebaro: Sprite einmal inline, `<svg class="sb-icon sb-icon--16" aria-hidden="true" focusable="false"><use href="#name"/></svg>`. Die Größenklassen (`.sb-icon--16`, `.sb-icon--20`) stehen in `icons/sprite.css`, nicht in `sebaro.css` (ICO-04, spec/04 §3, §11). Die Strichstärken 2.25 (24er-Master bei 16 px) und 1.5 (16er-Master) stimmen schon.

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| `plus` | `Icon.tsx:8`; benutzt in `Sidebar.tsx:221`, `StatusBar.tsx:89`, `BoardPane.tsx:209`, `:497` | `plus--16` (eigener 16er-Master, spec/04 §6) | ICO-04 | anzupassen | Heute ist der 24er-Master bei 16 px gezeichnet; spec/04 §3 erlaubt das nur, wenn es keinen 16er-Master gibt. |
| `folder` | `Icon.tsx:9-11`; `Sidebar.tsx:230` | `folder` (nur 24) | ICO-04 | schon im Pilot | Pfad aus dem Sprite. |
| `board` | `Icon.tsx:12-17`; `Sidebar.tsx:240`, `TabStrip.tsx:67` | `board` (nur 24) | ICO-04 | schon im Pilot | – |
| `settings` | `Icon.tsx:18-23`; `Sidebar.tsx:421` | `settings` | ICO-04, NAV-10 | schon im Pilot | Öffnet einen Ort, braucht also Icon und Wort (NAV-10); gehört zum Seitenleisten-Bereich. |
| `trash` | `Icon.tsx:24-30`; `Prompt.tsx:150` | `trash` | AKT-07 | schon im Pilot | Größe 24 statt 16, siehe A. |
| `EXTERNAL_LINK_16` / `externalLinkIcon()` | `Icon.tsx:36-59`; `Preview.tsx:346`; `preview.css:94-100` | `external-link--16`; `a > .sb-icon--16:last-child` (`css/sebaro.css:66`) | LNK-02 | anzupassen | Klasse `icon icon-16` → `sb-icon sb-icon--16`. `vertical-align` −0.15em → −0.125em. |
| Reiter schließen `×` (`.tab-close::before`) als eigener `<button>` mit `aria-label` | `app.css:589-608`; `TabStrip.tsx:69-72`, `:121-125` | `close--16` in `span.sb-doc-tabs__close[aria-hidden]` ohne eigenen Tab-Halt; Schließen mit Entf und ⌘W (spec/02 §4.21, D94) | ICO-06, DSK-10 | anzupassen | Heute ist das Kreuz eine fokussierbare Taste innerhalb des Reiters. |
| Pfadtrenner `/` (`.crumb-sep::before`) | `app.css:149-152`; `TitleBar.tsx:46` | `chevron-right--16` | ICO-06, NAV-08 | anzupassen | Laut Kommentar in `TitleBar.tsx:9-10` „▸“, der Code zeichnet aber „/“. |
| Palette-Prompt `›` | `overlay.css:23-28` | `search` im `.sb-command-palette__search` (spec/02 §4.16) | ICO-06, NAV-09 | anzupassen | – |
| Befehlsmarke `»` | `overlay.css:116-127` | keins, stattdessen Gruppenköpfe `.sb-command-palette__group` | NAV-09 | anzupassen | – |
| Suchleiste der Vorschau `‹ › ×` | `Preview.tsx:567`, `:576`, `:585` | `chevron-left--16` / `chevron-right--16` (oder `arrow-up--16` / `arrow-down--16`), `close--16` | ICO-06 | anzupassen | Welches Paar sebaro für „voriger/nächster Treffer“ will: unklar. |
| Blättern `‹ ›` | `PdfViewer.tsx:186`, `:206`; `EpubViewer.tsx:309`, `:322`; `CbzViewer.tsx:175`, `:186` | `chevron-left--16` / `chevron-right--16` (`.sb-pager`) | ICO-06 | anzupassen | – |
| Zoom `− +` | `PdfViewer.tsx:216`, `:226`; `ZoomableImage.tsx:170`, `:180` | `minus` (kein 16er-Master), `plus--16` | ICO-06 | anzupassen | – |
| Spalte verschieben `← →` | `BoardPane.tsx:270`, `:280` | `arrow-left--16` / `arrow-right--16` oder „Mehr“ › „Verschieben nach …“ | ICO-06, AKT-10, DAT-13 | anzupassen | Board-Bereich. |
| Löschen `×` (Spalte, Karte), Verknüpfung lösen `×` | `BoardPane.tsx:309`, `:421`, `:463` | `trash` (Löschen, im „Mehr“-Menü), `close--16` (lösen) | ICO-06, AKT-10 | anzupassen | – |
| Beschreibung bearbeiten `≡` | `BoardPane.tsx:390` | `edit` (nur 24) | ICO-06 | anzupassen | – |
| Ordner-Pfeil `.chev` (CSS) | `app.css:428-460` | `chevron-right--16` in `.sb-tree__twist`; `folder`, `board`, `file-text` als `.sb-row__icon` | NAV-11, ICO-06 | anzupassen | – |
| Heute-Kreis (Kobalt) | `app.css:342-357` | `today` | FAR-03, NAV-10 | anzupassen | Kobalt als Schmuck verstößt gegen FAR-03. |
| Sortierpfeil `.legend-sort.on::after` | `app.css:322-340` | `arrow-up--16` / `arrow-down--16` | ICO-06 | anzupassen | – |
| Auge `.glyph-eye` (Vorschau umschalten) | `app.css:628-653`; `TabStrip.tsx:155-166` | kein `eye` im Sprite. Für zwei Ansichten eines Dokuments sieht sebaro System-Reiter vor: `.sb-tabs` / `.sb-tabs__tab` „Text · Vorschau“ (spec/02 §4.21 erster Absatz, §4.4); als Icon-Werkzeug ginge `code` („Quelltext“) bzw. `file-text` | ICO-06, NAV-08, NAV-10 | anzupassen | Die erste Fassung hatte das als „fehlt in sebaro“ geführt; sebaro hat aber ein Muster dafür → F14. |
| Punkt für Ungesichert `.tab-dot` | `app.css:581-587`; `TabStrip.tsx:120` | keine Marke in `.sb-doc-tabs`; die Summe sagt der Stand-Satz („1 Notiz nicht gesichert.“, STA-07) | DSK-10, STA-07 | fehlt in sebaro | Die Marke je Reiter fehlt → L6. |
| Datei-Glyphe `.result-glyph`, `.card-note-glyph` | `overlay.css:108-114`; `board.css:327-333` | `file-text` (nur 24) bzw. `link` | ICO-06 | anzupassen | – |
| Tastenzeichen ↖ ↘ ⇞ ⇟ | `lib/keymap.ts:150-166` | sebaro Sans und Mono zeichnen 12 Zeichen: ⌘ ⇧ ⌥ ⌃ ↩ ⎋ ⌫ ⇥ ← ↑ → ↓ (ICO-08); spec/02 §4.21 schreibt „Pos1 / Ende“ als Wort | ICO-08 | fehlt in sebaro | Fällt auf die Systemschrift zurück → L7. |
| `.kbd` als Umschalter (Groß/klein, Regex, Alle Dateien, Filter leeren) | `SearchPanel.tsx:186`, `:194`, `:202`, `:251`; `app.css:164-181`, `:194-198` | `.sb-chip[aria-pressed]` (spec/02 §2.9). `kbd`/`.sb-kbd` nur für Tasten in Hilfetexten (§3.10) | EIN-04, ICO-08 | anzupassen | – |

### F Kürzel (docs/KEYMAP.md gegen die 14 festen Kürzel, spec/02 §4.19 und DSK-09)

| novalis-Element | Ort | sebaro-Gegenstück | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| ⌘K = `markdown.link` | `KEYMAP.md:79`, `menu.rs:368-373` | ⌘K = Befehlspalette (D84, vom Inhaber fest) | NAV-09, DSK-09 | Konflikt | Der Link braucht ein neues Kürzel; spec/02 §4.19 schlägt ⇧⌘K vor. novalis bindet CodeMirrors `defaultKeymap` ein (`editor/setup.ts:9`, `:197`); dort liegt Shift-Mod-k = deleteLine → F8. |
| ⇧⌘P = Palette | `KEYMAP.md:52` | darf als zweites Kürzel bleiben (D84, spec/07 §4.8) | NAV-09 | schon im Pilot | – |
| ⌘, = `unbound` | `KEYMAP.md:49` (ADR-0004, ADR-0008) | ⌘, = Einstellungen als Ansicht im Hauptfenster (fest; D67 (5), D91 F10a) | DSK-09, DSK-02 | Konflikt | F9 |
| ⌘\ = Seitenleiste | `KEYMAP.md:81`, `menu.rs:453` | ⌃⌘S; DSK-09 nennt ⌘\ ausdrücklich als Verbot (`\` ist auf der deutschen Tastatur eine ⌥-Taste) | DSK-09 | Konflikt | F10 |
| ⇧⌘N = Neuer Ordner | `KEYMAP.md:88`, `menu.rs:195` | ⇧⌘N = Neues Fenster (reserviert) | DSK-09 | Konflikt | F10 |
| ⇧⌘[ / ⇧⌘] Reiter, ⌘[ / ⌘] zurück/vor | `KEYMAP.md:65-66`, `:77-78`, `menu.rs:520-539` | Reiter: ⌃⇥ / ⌃⇧⇥. `[` und `]` sind ⌥-Tasten (S4) | DSK-09, DSK-10 | Konflikt | F11. novalis vergleicht physische Tasten (`event.code`, `keymap.ts:130-137`); das native Menü trägt dieselben Accelerators. Welcher Weg auf QWERTZ greift: unklar. |
| ⌘= / ⌘- / ⌘0 Schrift | `KEYMAP.md:83-85`, `menu.rs:467-479` | ⌘+ / ⌘−, ohne nativen Accelerator, von der Seite behandelt (spec/09 §13.1, geprüft im Menücode dort) | DSK-09 | Konflikt | `KEYMAP.md:19-20` nennt `=` die Plus-Taste „on US and German layouts“; auf QWERTZ liegt dort „´“, „+“ ist eine eigene Taste. Auf Hardware nicht geprüft → F12. |
| Eingabe = `tree.rename` | `KEYMAP.md:86`, `Sidebar.tsx:115-118` | Eingabe öffnet (D98 V1) | NAV-11 | Konflikt | F13 |
| F6 / ⇧F6 Bereiche | fehlt | fest, auch als „Nächster Bereich“ / „Vorheriger Bereich“ im Menü „Fenster“ (spec/02 §4.20, spec/09 §13.1) | DSK-09 | neu zu bauen | ADR nötig |
| ⌥⌘I Inspektor | fehlt | fest | DSK-09 | nicht anwendbar | novalis hat keinen Inspektor; ob Rückverweise einer wären: unklar. |
| ⌘N, ⌘O, ⌘F, ⌘W, ⌘Z / ⇧⌘Z, ⌘⌫ | `KEYMAP.md:35-44`, `:87` | fest | DSK-09 | schon im Pilot | Das Menü „Fenster“ enthält das vordefinierte `close_window()` (`menu.rs:547`) neben „Tab schließen“ mit ⌘W (`menu.rs:229-234`); ob beide ⌘W tragen: nicht geprüft. |
| Eigene Kürzel ⌘E ⌘P ⌘J ⌘S ⇧⌘B ⇧⌘F ⌘1–9 ⇧⌘T ⌘↩ ⌘G ⇧⌘G ⌃G ⌘D ⇧⌘L ⌥⌘F ⌘/ ⌃⇧↑/↓ ⌃⌘↑/↓ ⇧⌘D ⌃⇧K ⌘B ⌘I | `KEYMAP.md` | eigene Kürzel, mit `data-sb-own-shortcut`, wo `aria-keyshortcuts` gesetzt wird | DSK-09, NAV-10 | anzupassen | ⌘/ liegt auf QWERTZ auf ⇧7; Wirkung nicht geprüft. |
| Kürzel nur im `title` der Werkzeuge (`tooltip()`); `aria-keyshortcuts` gibt es nirgends | `Sidebar.tsx:66-69` (grep: kein `aria-keyshortcuts` in `src`) | `.sb-tooltip` mit Name und Kürzel, `aria-keyshortcuts` am Element (spec/02 §4.9, §4.19) | NAV-10, DSK-09, DSK-10 | neu zu bauen | Von der ersten Fassung übersehen. |
| Prüfwerkzeug | `tools/check_shortcuts.py` (sebaroDesign) | liest spec/02 §4.19, `sb-window.js` und mit `--page` statische HTML-Seiten (S7 prüft dort `aria-keyshortcuts`) | DSK-09 | fehlt in sebaro | KEYMAP.md, `menu.rs` und von React erst zur Laufzeit geschriebenes Markup kann es nicht prüfen; nicht ausgeführt → L8. |

### G Texte (i18n/de.json, Stimme nach spec/07)

| Textfamilie | Ort | sebaro-Regel | Regel-IDs | Stand | Bemerkung |
|---|---|---|---|---|---|
| Ausrufezeichen, „Sie“/„wir“, Gendersterne, Großbuchstaben-Wörter, „ca.“/„z. B.“, gerade Anführungszeichen | `i18n/de.json` (Skript-Suche) | spec/07 §1, §2, §3 | TXT-01, TXT-05, HAL-05 | schon im Pilot | Keine Treffer (Ausrufezeichen per `jq` nachgeprüft). |
| Ellipse ohne Leerzeichen (15 Keys, z. B. `app.openVault.button`, `editor.loading`, `palette.cmd.settings`, `menu.go.commandPalette`, `board.linkNote`, `status.downloading`) gegen 2 mit Leerzeichen (`app.creating`, `app.saving`) | `i18n/de.json`, `i18n/en.json` | „Wort …“ mit Leerzeichen (spec/07 §4.5, §4.8) | spec/07 §4.8 | anzupassen | novalis ist in sich uneinheitlich. Im Englischen 17 Keys ohne Leerzeichen; welche Form sebaro dort will: nicht geprüft. |
| „OK“ | `app.ok` | Verb + Objekt | AKT-04 | anzupassen | siehe A |
| Geviertstrich „—“ | `banner.deletedOnDisk.title` (de und en) | Halbgeviertstrich „–“ mit Leerzeichen (spec/07 §3 Regel 6) | TXT-05 | anzupassen | – |
| „Etwas ist schiefgelaufen“ | `errors.title` | „<Was> hat nicht geklappt. <Was sicher ist>. <Was du tun kannst>.“ (spec/07 §4.1); vage Sätze verbietet §6.4 | TXT-07 | anzupassen | – |
| Fehlerkatalog `errors.*` (z. B. „Dateisystemfehler: {{detail}}“, „Interner Fehler: {{detail}}“, „Ungültige Anfrage: {{detail}}“) | `i18n/de.json` | keine Codes in der Hauptzeile, Details unter „Details“ | TXT-07 | anzupassen | „Ungültige Anfrage“ steht fast wörtlich im DONT von TXT-07. `errors.copyDetails` gibt es schon. |
| Englische Wörter in der deutschen UI: Vault (13 Keys), Board (18), Tab (8), Regex (2), Cache (2) | `i18n/de.json` (Zählung per Regex, Wortanfang) | keine englischen UI-Wörter (TXT-01, spec/07 §6.4). sebaro selbst schreibt „Board“ (spec/07 §4.5, §4.8), „Reiter“ (spec/02 §4.19) und für novalis „im Ordner links“ (§4.8); `icons.json` führt „Vault“ als Stichwort von `folder` | TXT-01 | Konflikt | F5 |
| Menü „Darstellung ▸ Erscheinungsbild ▸ System/Hell/Dunkel“ | `menu.view.appearance`, `settings.appearance.*`, `menu.rs:384-409` | „Hell oder Dunkel ▸ Wie das System · Hell · Dunkel“ (spec/07 §4.7, spec/09 §13.1, D75) | AKT-09, DSK-05 | anzupassen | Nur Wortänderungen. Der Menüname „Darstellung“ und „Ablage“ stimmen schon. |
| Weitere Menüwörter: „Befehlspalette…“, „Schrift vergrößern“ / „Schrift verkleinern“, „Tab schließen“ | `menu.go.commandPalette`, `menu.view.fontLarger`, `menu.view.fontSmaller`, `menu.file.closeTab` | „Befehle …“, „Schrift größer“, „Schrift kleiner“, „Schließen“ (spec/07 §4.8, spec/09 §13.1) | AKT-04 | anzupassen | Von der ersten Fassung übersehen. Den Aufbau des Menüs (novalis hat „Gehe zu“ und kein „Hilfe“) regelt der Menü-Bereich. |
| Bestätigungstexte | `app.confirmTrash.*`, `board.delete*` | spec/07 §4.4 | AKT-08 | anzupassen | siehe A |
| Leertexte | `editor.emptyState`, `board.empty`, `palette.noResults`, `tree.empty` (unbenutzt), `editor.backlinks.empty` (passt schon) | „Noch keine …“, spec/07 §4.2 und §4.8 | DAT-07 | anzupassen | siehe D |
| Meldungen der exportierten Skripte (`js/sb-controls.js`, `js/sb-window.js` usw.) | – | eigene Tabelle `MESSAGES` (de, en); ein Produkt überschreibt sie mit `window.sbMessages` aus einer klassischen Datei vor den Skripten (spec/09 §6.1); ein Framework darf die Skripte ersetzen (ADOPTION.md §2.3) | TEC-10 | neu zu bauen | Damit jeder Text aus `i18n/*.json` kommt (Lint, Paritätstest), muss novalis die Datei für `window.sbMessages` aus dem Katalog erzeugen oder die Skripte durch React ersetzen. Das ist eine Aufgabe in novalis, keine Lücke in sebaro. |
| Menüpfade im Fließtext | – | „Einstellungen, dann Über“ | TXT-16 | schon im Pilot | Keine Pfeile oder › in den Katalogen. |
| Englisch in Title Case („Open Vault…“, „Always Reduce Motion“) | `i18n/en.json` | Satzanfang groß (spec/07 §3 Regel 10) | TXT-05 | Konflikt | Das macOS-Menü folgt heute Apples Title Case. spec/09 §13.1 zeigt das Menü nur auf Deutsch → F6, L9. |
| Produktname „Novalis“ groß | `banner.legacyVault.title` (de und en) | Produktnamen bleiben unverändert („novalis“; spec/07 §3 Regel 10, §6.1) | – | anzupassen | Die erste Fassung nannte hier ZEI-09; die Regel betrifft nur die Wortmarke „sebaro“. |

**Nicht geprüft:** Rendering hell und dunkel bei 100 % und 200 %; ob CodeMirror oder das native Menü ⌘K, ⇧⌘K und ⌘W zuerst bekommt; ob das vordefinierte `close_window()` ein eigenes ⌘W trägt; deutsche Tastatur auf echter Hardware; Inhalt des englischen Katalogs im Einzelnen; `check_shortcuts.py` wurde nicht ausgeführt; die Größe des eager CSS stammt aus einem vorhandenen `apps/desktop/ui/dist`, dessen Bauzeitpunkt unbekannt ist.

### Prüfung

Ein zweiter Agent hat die Zuordnung gegengeprüft, ohne Code zu ändern. Alle genannten sebaro-Klassen, Tokens, Sprite-Namen, Skripte (`sbToast`, `sbStart`), Abschnitte und Regel-IDs gibt es. Einzige Ausnahme ist `.sb-callout__actions`, ein Vorschlag aus L4. **Korrigiert:**
- Zeilenangaben: `.btn.ghost` steht in `app.css:819`, `.btn.danger` in `:833`; `DocxViewer.tsx:103` meldet `editor.previewExternalLink`; `Sidebar.tsx:204` ist der Fall ohne Vault, nicht der leere Baum.
- Der Klick auf den Scrim ist nach EBE-03 erlaubt; die erste Fassung ließ das offen.
- Die AppTile-Geometrie stimmt mit `tile-novalis-small.svg` überein; die erste Fassung hatte das nicht geprüft.
- Beim Boot-Fehler steht der Code in der zweiten Zeile, nicht in der Hauptzeile.
- Gelöschte Karten werden nur als gelöscht markiert und gehen nicht in den Papierkorb.
- Statt ZEI-09 gilt für den Produktnamen spec/07 §3 Regel 10 und §6.1.
- Zählung der englischen Wörter neu gemacht: Vault 13, Board 18, Tab 8.
- spec/09 §13.1 ist jetzt geprüft: Das Menü steht dort nur auf Deutsch, und ⌘+ / ⌘− haben keinen Accelerator.
- Entfernt sind die Lücken „eye fehlt“ (sebaro sieht `.sb-tabs` „Text · Vorschau“ vor) und „Brücke für Skript-Meldungen fehlt“ (`window.sbMessages`, spec/09 §6.1, TEC-10).
- F1: Die Antwort B lässt sich mit sebaro bauen, weil es den Wartezustand der Nebenaktion gibt (spec/02 §1.7). Die Empfehlung ist jetzt B.
- F7 empfiehlt jetzt B (STA-06 mit D98 entschieden), F9 jetzt A (DSK-02, D67 (5), D91 F10a; „nur in der Palette“ steht im DONT von DSK-02).
- Neue Frage F14 zum Vorschau-Umschalter.
- Der ADR-Punkt zu ADR-0048 ist richtiggestellt: ADR-0048 hält die Fehler-Toasts nicht ausdrücklich fest.
- Ergänzte Zeilen: Board-Hinweis, Viewer-Fehler, `.board-busy`, Status-Punkte und Warnfarbe, Kreuz am Reiter als Taste, fehlende `aria-keyshortcuts` und Tooltips, weitere Menüwörter, Skript-Meldungen, Dialogbreite und -lage, Feldform.

**Nicht verifiziert:** ob muda dem vordefinierten `close_window` ⌘W gibt; ob das Menü oder `event.code` auf QWERTZ greift; die Bauzeit des `dist`. `ContentsPopover.tsx` (Inhaltsverzeichnis der Viewer) und die Fußzeile der Palette sind hier nicht zugeordnet, sie gehören zu den Bereichen Viewer bzw. Palette. Nebenbefund: `icons.json` nennt beim Icon `sidebar` noch „novalis ⌘\“. Das widerspricht DSK-09, wird hier nur vermerkt und in sebaroDesign nicht geändert.


## 9 Querschnitt: Export, Werkzeuge, Folgen im Repo

Folgende Punkte fehlen in den Bereichsabschnitten und wurden bei der Vollständigkeitsprüfung gefunden.

1. **Was der Tauri-Export mitbringt** (`export_system.py`, ADOPTION §2.1):
   - `tokens.css`, `tokens.tailwind.css`, `css/sebaro.css`
   - `fonts/` mit WOFF2 und OFL-Texten
   - `icons/sprite.svg`, `sprite.css`, `icons.json`
   - `brand/logo/`, `brand/inline/`, `js/*.js`
   - `tauri/icon-1024.png`, `tokens.json`
   - `LICENSE.md`, `README.md`, `sebaro-export.json`
   - mit `--product novalis` zusätzlich `brand/site-root/*`, also Favicons und Manifest, die eine Desktop-App nicht braucht

   Nichts davon wird von Hand geändert. Was novalis nicht lädt, bleibt ungenutzt im Ordner liegen.
2. **Öffentliches Repo:**
   - **Fremde Produktnamen:** `tokens.json` (Produktliste), `icons/icons.json` und `js/sb-facts.js` enthalten Namen anderer Produkte, die vielleicht nicht veröffentlicht sind. Exportierte Dateien dürfen nicht geändert werden.
   - **Lizenzen:** Der Ordner bringt eigene Lizenzen mit: MIT, OFL und „alle Rechte vorbehalten“ für Kachel, Zeichen und App-Icons (ADOPTION §9). novalis selbst steht unter AGPL mit kommerzieller Zusatzlizenz. ADOPTION §9 verlangt dafür eine `.license`- oder REUSE-Angabe am Ordner.
   - Beides siehe §11.
3. **App-Icons:** `cargo tauri icon ui/src/sebaro/tauri/icon-1024.png -o src-tauri/icons` schreibt auch `android/` und `ios/`; die beiden Ordner werden danach gelöscht. Der Icon-Satz steht nicht in `sebaro-export.json`. Die heutigen Icons kommen aus dem Pilot.
4. **Lint:**
   - `eslint .` erfasst auch `src/sebaro/js/*.js`. Browser-Globals sind nur für `ts/tsx` gesetzt, deshalb sind `no-undef`-Fehler wahrscheinlich (nicht geprüft). Der Exportordner braucht einen Ignore-Eintrag.
   - `tsconfig` ohne `allowJs` und `scripts/i18n-check.mjs` sind nicht betroffen.
5. **`theme-init.js` im Build:** Ein klassisches `<script src>` in `index.html` bündelt Vite nicht (nicht geprüft). Dann fehlt die Datei in `dist`, und `scripts/bundle-budget.mjs` scheitert. Ein Modulskript dagegen läuft zu spät für das erste Bild.
6. **Abbau von `@novalis/tokens`:** Betroffen sind:
   - `justfile` (`bump`, `tokens-sync`)
   - `scripts/check-versions.mjs`
   - CLAUDE.md (sechs Versionsstempel, Tabelle der erzeugten Dateien, `GENERATED-PENDING`)
   - PLAN.md §5.9
   - `ui/package.json` (`workspace:*`), `main.tsx`, `pnpm-lock.yaml`
   - `packages/tokens/` samt alter Nebendateien
7. **CI-Prüfung des Exports:** Für `--verify --files-only` muss `export_system.py` (Standardbibliothek) mitgeliefert werden, außerdem braucht es python3. Beides ist neu für `just setup`, justfile und `ci.yml`. Der Docstring des Werkzeugs nennt selbst unveröffentlichte Namen, siehe Punkt 2. *Stand 2026-10-26:* entschieden mit ADR-0051 #37 und gebaut: ein eigenes Skript `scripts/check-sebaro-export.mjs` (node, ohne Abhängigkeit) prüft jede Datei gegen `sebaro-export.json`, in `just check` und `ci.yml`. `export_system.py` und python3 kommen nicht dazu.
8. **Budgets außer eager CSS:**
   - `firstPaintMs` (vorläufig 300 ms): Wirkung von etwa 190 kB CSS beim Parsen
   - `eagerJsGzipKb`, falls `sb-*.js` sofort geladen werden
   - `previewChunkGzipKb`, falls Mermaid-Farben aus den Tokens gelesen werden
9. **Veraltete Kommentare**, die der Umbau ohnehin berührt:
   - „20 kB budget“ in `overlay.css`, `board.css`, `preview.css`
   - „Dev-Noir is dark-first“ in `index.html`
   - „Geist Mono“ in `lib/fileTypes.presentation.ts`
10. **Abschneiden:** 13 Regeln mit `text-overflow: ellipsis` widersprechen ZUG-09, D99 (1) und D100 (5)/(6):
    - `app.css`: `.crumb-seg`, `.vault-name`, `.tree-row .name`, `.tab-name`, `.status-item`
    - `board.css`: `.col-name`, `.card-note-name`
    - `backlinks.css`: `.backlink-name`, `.backlink-meta`
    - `preview.css`: `.table-cell`
    - `overlay.css`: `.result-label`, `.result-meta`
    - `viewer.css`: `.epub-title`

    Baum und CSV-Tabelle haben für die Virtualisierung feste Zeilenhöhen.
11. **Einzelheiten ohne eigene Zeile in den Abschnitten:**
    - Body und Fokus:
      - `body { user-select: none; -webkit-font-smoothing: antialiased }` gegen die sebaro-Basis an `body.sb-page`
      - Fokus von `.dialog-input` als 1-px-Schatten statt Fokusring (ZUG-02)
      - Platzhalter als einzige Beschriftung im Palettenfilter (EIN-01)
    - Baum, Reiter und Board:
      - `.tree-row.folder` (Gewicht) und `.tree-row.cloud .name` (muted)
      - ausgeblendete Scrollleiste der Reiter gegen `.sb-doc-tabs` (`scrollbar-width: thin`)
      - `.card-note.missing` gestrichelt (FOR-03)
      - Fläche von `.card-state` (FAR-02)
    - Betrachter:
      - `.pdf-sheet`, eigene Zeiger (`zoom-in`/`zoom-out`, `col-resize`)
      - die pdf.js-Eigenschaften `--total-scale-factor`, `--scale-x` …, die beim Umbenennen bleiben müssen
    - eigene Eigenschaften `--nv-indent`, `--nv-guides`, `--depth`
12. **Editor-Teile mit fremdem DOM:** Das Such- und Gehe-zu-Panel von CodeMirror (`editor/phrases.ts`) und die Liste der Überschriften-Vervollständigung (`editor/headingCompletion.ts`) erzeugt CodeMirror selbst. Siehe §11.
13. **Kürzel und Gesten ohne Zeile:**
    - Kürzel:
      - ⌘Q gehört nach spec/02 §4.19 dem System, ob `check_shortcuts.py` das so meldet, ist nicht geprüft
      - ⌃⌘F (System)
      - Viewer-Tasten ← → ⇞ ⇟ Pos1 Ende ohne `aria-keyshortcuts`
    - Gesten:
      - Pinch und ⌃+Scrollrad
      - Klick auf das Bild für Einpassen oder 1:1
      - Datei in eine Notiz ziehen, Notiz auf eine Spalte oder Karte, Karte auf eine Board-Zeile
      - Bilder und PDFs per ⌘V oder Ablegen

      DSK-11 und spec/02 §4.22 regeln nur Zeilen.
    - Parität: Der Test `apps/desktop/src-tauri/tests/keymap_parity.rs` ändert sich mit jeder Kürzel-ADR.
14. **Natives Menü ohne Zuordnung:**
    - Bearbeiten ▸ Rechtschreibung (= Einstellung `spellcheck`)
    - Darstellung ▸ Sprache
    - das Kontextmenü der Board-Zeile („Im Finder zeigen“)
    - die Bearbeiten-Punkte Weitersuchen, Ersetzen, Gehe zu Zeile, Mehrfachcursor, Zeile verschieben, Kommentar, Fett, Kursiv, Checkbox. DSK-08 nennt für Bearbeiten nur die Systempunkte, „Suchen“, „Verschieben nach …“ und „Löschen …“.
15. **Rückfragen vor der Prüfung:**
    - Vorläufige Regeln: DSK-01, ZUG-07 und BIL-04 sind nicht entschieden. DSK-01 bleibt laut D98 vorläufig, bis es in einer echten Tauri-Webview mit novalis gelaufen ist.
    - ZUG-07 (Erklärung zur Barrierefreiheit) sagt selbst „frag den Inhaber“.

## 10 Widersprüche zwischen den Abschnitten

| # | Thema | Auflösung |
|---|---|---|
| 1 | Höhe der Aktionszone | Grundlagen hat recht: `.sb-primary-action-bar` hat `padding: var(--sb-space-3) …`, und die Taste misst `--sb-size-control-lg` (56 px). Die Zone wird damit etwa 80 px hoch, der Pilot hat 56 px. Nachtrag zu ADR-0048 |
| 2 | `serde_json` in `build.rs` | Das Crate steht schon im Lock. Als `[build-dependencies]` kommt keine neue Lock-Zeile dazu, die PR nennt trotzdem die Umbau-ADR (wie ADR-0015 bei base64) |
| 3 | Unaufgelöster Wiki-Link | Frage in §11 |
| 4 | Neuer Ordner: ⌥⌘N oder kein Kürzel | Frage in §11 |
| 5 | `board.empty` | Inhalte G hat recht: Der Text erscheint, wenn das Board keine Spalten hat (`BoardPane.tsx`). Eine leere Spalte zeigt nur ihren Fuß |
| 6 | Hauptaktion auf dem Board | Entschieden durch D65 und ADR-0050: „Neue Notiz“ bleibt. Die Abweichung von spec/02 §3.16 kommt in die Lückenliste, eine Frage gibt es dazu nicht |
| 7 | Vorschau-Umschalter als `.sb-tabs` | `.sb-tabs` sind 48 px hoch und haben keine Fensterdichte. Unter den 32-px-Dokumentreitern stünden zwei Reiterzeilen. Frage in §11 |
| 8 | Fortschritt im Dialog | hängt an der Frage, ob der Dialog eine lindgrüne Taste behält (§11) |
| 9 | Messwerte für eager CSS | Die Zahlen widersprechen sich: 190,8 kB minifiziert roh / 25,9 kB gzip geschätzt, 49,7 kB gzip unminifiziert, 24,1 kB im vorhandenen `dist`. Gemessen wird erst im echten Build nach dem Export. Nachladen verwirft der Grundlagen-Abschnitt wegen DSK-14 und STR-01 |
| 10 | Menüwort für den Papierkorb | sebaro sagt „Löschen …“ (DSK-08), novalis verschiebt in den Papierkorb. Frage in §11 |
| 11 | Zeilenhöhe im Editor 1.5 oder 1.6 | Frage in §11 |
| 12 | Umbenennen in einem Schritt oder je Ansicht | Frage in §11 |
| 13 | Speicher der Theme-Wahl | DSK-14 verlangt `appearance.json`, novalis hat `settings.json` als einzige Quelle (ADR-0049). Frage in §11 |

## 11 Offene Fragen und Antworten

Am 2026-10-24 hat der Inhaber gesammelt geantwortet, in sieben Runden. Jedes Mal hat er die Empfehlung gewählt. Festgehalten als **ADR-0051**; Abweichungen von sebaro stehen in [`sebaro-luecken.md`](sebaro-luecken.md) Teil A.

| # | Frage | Gewählt | Verworfen |
|---|---|---|---|
| 1 | Wo stehen die Einstellungen? | Ansicht im Hauptfenster mit ⌘, (DSK-02) | Palette bleibt; Ansicht plus „Über“ |
| 2 | Farbton „Kühl · Warm“? | Ja, als sechste Einstellung `tone` | Nein, nicht jetzt |
| 3 | Budget für eager CSS | Messart gzip, die Grenze kommt nach dem ersten Build | Roh auf ~200 kB anheben; einen Teilexport abwarten |
| 4 | Fremde Namen im öffentlichen Repo | Lokal bauen; vor dem Push ein gefilterter Export | Namen gelten als öffentlich; Export nicht ins Git |
| 5 | Fensterteile | Alle vier: Seitenleisten-Werkzeug, Schmal · Normal · Breit, F6 mit Menüpunkten, „Verschieben nach …“ | — |
| 6 | Menüleiste | sebaro-Gruppen, „Gehe zu“ wird aufgelöst, Hilfe ohne Netz | „Gehe zu“ bleibt; nur den Wortlaut angleichen |
| 7 | Papierkorb-Wort | „In den Papierkorb …“, zuletzt in Bearbeiten, ⌘⌫ | „Löschen …“ wie sebaro |
| 8 | Rückverweise | bleiben unten | Inspektor rechts mit ⌥⌘I |
| 9 | ⌘K und Link einfügen | Link auf ⇧⌘K, ⇧⌘P bleibt zweites Kürzel der Palette | Link ohne Kürzel; ⇧⌘P entfällt |
| 10 | Kollidierende Kürzel | ⌃⌘S, ⌃⇥ / ⌃⇧⇥, ⌘+ / ⌘−; ⌘[ / ⌘] bleiben vorerst | alte als zweite behalten; nur Seitenleiste und Reiter umstellen |
| 11 | Neuer Ordner | ⌥⌘N | ohne Kürzel; ⇧⌘N bleibt |
| 12 | Eingabe im Baum | Eingabe öffnet; Umbenennen über Menü, Kontextmenü, Palette | F2 benennt um; Eingabe benennt weiter um |
| 13 | Taste im Eingabedialog | Nebenaktion mit Verb und Wartezustand | lindgrün bleibt |
| 14 | Kurzmeldungen und Fehler | Fehler in die Aktionszone; Kurzmeldung für „Karte hinzugefügt“ und „Kopiert: …“ | „Kopiert“ entfällt; Fehler als Hinweisblock |
| 15 | Zähler | graue Zählerzeile vor dem Stand-Satz | entfallen; nur über die Palette |
| 16 | Vorschau umschalten | kompaktes Icon-Werkzeug mit Tooltip | Reiter „Text · Vorschau“; das Auge behalten |
| 17 | Unaufgelöster Wiki-Link | grau (`text-muted`), ohne Unterstrich | grau mit grauer Linie; wie ein normaler Link |
| 18 | #Tags | Linkstil | umrandeter Tag; reiner Text |
| 19 | Board-Aktionen | „Mehr“-Menüs, „Löschen …“ zuletzt, Kontextmenü gleich geordnet | Knöpfe behalten |
| 20 | Wörter | „Vault“ und „Board“ bleiben, „Tab“ wird „Reiter“ | „Notizordner“; alles bleibt |
| 21 | Fensterskripte | React mit sebaro-Markup; nur `sb-tooltip.js` und `sb-menu.js` werden geladen | sebaro-Skripte laden; alles in React |
| 22 | Speicher der Theme-Wahl | `settings.json` bleibt, Initialisierungsskript aus Rust, Fenstergrund aus `build.rs` | `appearance.json` nach DSK-14 |
| 23 | Umbenennen der Tokens | gleiche Werte auf einmal, neue Rollen je Ansicht | alles je Ansicht |
| 24 | Abschneiden | umbrechen, außer Baum und CSV-Tabelle | überall umbrechen; Abschneiden behalten |
| 25 | „200 % Schrift“ | beides: Editorschrift ×2 und WebView 200 % | nur Editorschrift; nur WebView |
| 26 | Startkachel | `sb-start.js` (Rückfall auf ein angepasstes `StartTile.tsx`, gemeldet) | `StartTile.tsx` anpassen |
| 27 | Paket der Detailpunkte | alle wie empfohlen (Liste unten) | einzeln durchgehen |

**Paket der Detailpunkte (Frage 27):**

1. Text unter 14 px geht auf die sebaro-Rollen caption/label (14/20).
2. Zeilenhöhe in Editor und Vorschau 1.5 (sebaro body). Wirkt sie in den Bildern schlechter, kommt sie als Lücke.
3. 6-px-Abstände werden je Rolle zu 4 oder 8 px.
4. Überschriften: em-Skala zur Editorschrift, Gewicht und Laufweite aus sebaro.
5. Codeblöcke als nacktes `pre.sb-code`, ohne Kopieren-Knopf.
6. Mermaid-Farben aus den `--sb-*`-Tokens.
7. Banner werden `sb-callout--warning`, ihre Aktionen Nebenaktionen, keine lindgrüne Taste.
   *Lesart im Umbau (Schritt 5, offen beim Inhaber):* Gelesen wird Punkt 7 als die Banner für eine externe Änderung (`replacedBySync`, `deletedOnDisk`, `changedOnDisk`), die `--warning` sind. Die Info-Banner (`binary`, `notUtf8`, `hugeFile`, `plainMode`), der Cloud-Hinweis und der Hinweis auf den alten Vault sind `sb-callout--note`, wie die Tabelle in §8 (Zeilen „Info-Banner“, „Cloud-Hinweis“, „Hinweis auf alten Vault“) und STA-05 es vorsehen: Sie warnen vor nichts. Meint der Inhaber alle Banner, werden die Klassen in `Banner.tsx`, `CloudHint.tsx` und `LegacyHint.tsx` und ihre Tests auf `--warning` umgestellt.
8. „Wird geladen …“ nur bei Cloud-Dateien und erst nach 1 s.
9. Das Board-Werkzeug bleibt ein Icon mit Tooltip.
10. Keine Kategorie-Farbe an Spalten.
11. Englisch: das native Menü in Title Case, der Rest mit großem Satzanfang.
12. Keine Fakten oder Belege in novalis.
13. App-Icons aus dem Export neu erzeugen und mit den heutigen vergleichen.
14. Exportordner `apps/desktop/ui/src/sebaro` mit ESLint-Ignore.
15. `@novalis/tokens` wird gelöscht; es bleiben fünf statt sechs Versionsstempel.
16. CI prüft mit `export_system.py --verify --files-only` (python3 kommt in `just setup`), aber erst, wenn die Namen gefiltert sind.
   *Stand 2026-10-26:* Ersetzt durch ADR-0051 #37: `scripts/check-sebaro-export.mjs` in `just check` und `ci.yml` statt `export_system.py`; python3 kommt nicht in `just setup`.
17. Keine Dichtewahl, keine Taste „Menü“ (nur macOS).
18. Keine Erklärung zur Barrierefreiheit (ZUG-07) in diesem Umbau. Vorläufige Regeln (DSK-01, ZUG-07, BIL-04) zählen bei der Prüfung nur als Hinweis.
19. Die CodeMirror-Suchleiste wird ein eigenes Panel mit sebaro-Klassen, die Funktion bleibt gleich.
20. Einstellungsansicht: Hell/Dunkel und Farbton als Auswahlzeilen, Sprache und Schriftgröße als Auswahl, Rechtschreibung und Bewegung als Schalter. Die Dokumente `docs/sebaro-*.md` sind auf Deutsch.

**Erledigt** (stand hier als „Noch offen, kommt vor dem Export“): Der Exportbefehl steht in CLAUDE.md (Tabelle der erzeugten Dateien) und lief in `4cfe4e5`, `e1e6d51` (1.6.0) und `2d141b1` (1.7.0). Die Grenze des CSS-Budgets ist 33 kB gzip, vom Inhaber bestätigt (ADR-0051 #3, `docs/BUDGET.json`).

## 12 Nicht geprüft

Stand 2026-10-29, nach der Übernahme von D110 und D111. Die Punkte der Bestandsaufnahme (Export, Build, ESLint auf die exportierten `.js`, Vite mit klassischem `<script src>`, `check_shortcuts.py`, `--verify`, Kürzen der Reiternamen) sind erledigt: Der Export lief in `4cfe4e5`, mit 1.6.0 in `e1e6d51`, mit 1.7.0 in `2d141b1` (sebaroDesign `829e1ea`), mit 1.8.0 in `de088ab` (sebaroDesign `ef6121d`, D104 und D105) mit 1.13.0 in `6308b34` (sebaroDesign `bb2519e`, D106 und D108) und in `c05ac72` (sebaroDesign `2560ef3`, D110 und D111); `just check` baut und misst bei jedem Schritt; `check_shortcuts.py` steht in [`sebaro-luecken.md`](sebaro-luecken.md) S; die Reiter in H. Offen ist:

- **CI-Prüfung des Exports (ADR-0051 #27.16, #37):** gebaut. `scripts/check-sebaro-export.mjs` prüft in `just check` und `ci.yml` jede Datei des Ordners `apps/desktop/ui/src/sebaro` gegen ihre SHA-256 in `sebaro-export.json` und lehnt Dateien ab, die das Manifest nicht nennt. Ob sebaroDesign weitergegangen ist (Quell-Drift), prüft es nicht; dafür bleibt der volle `--verify` mit einem sebaroDesign-Stand. In CI gelaufen ist das Skript noch nicht (kein Push).
- **Stand von sebaroDesign:** Der Export stammt aus sebaroDesign `2560ef3` (D110, D111; `export_system.py` 1.13.0), übernommen mit `c05ac72`; `sebaro-export.json` nennt diesen Stand, `scripts/check-sebaro-export.mjs` ist grün (83 Dateien). Davor `bb2519e` (D106, D108) mit `6308b34`, dessen voller `--verify` mit `--from-commit bb2519e` am 2026-10-28 „up to date, 83 files, 0 warning(s)“ meldete. Seit `c05ac72` steht der Exportordner wieder in `tsc`, und der Editor importiert `editor/sebaro-codemirror.ts`, statt es zu kopieren (ADR-0051 #59, `bd4954e`); novalis' Teile, die sebaro mit `2560ef3` selbst hat, sind mit `bec10b4` umgestellt ([`sebaro-luecken.md`](sebaro-luecken.md) Z3, Z4, Z5).
- **Bilder:** Die Schlussprüfung des Codes lief ohne Bilder und ohne Laufzeit. Die Schlussprüfung der Bilder, Runde 1 (drei Stapel, hell und dunkel, 100 % und 200 %), fand eine leere Seitenleiste ohne Vault, eine eingepasste Comic-Seite, die über die Ansicht ragte, eine Seitenleiste, die im schmalen Fenster ungefragt offen über dem Inhalt lag, und den Papierkorb mitten im Kontextmenü des Baums; die Korrekturen stehen in [`sebaro-luecken.md`](sebaro-luecken.md) Z. Neu aufgenommen sind die betroffenen Ansichten danach noch nicht (kein Lauf der App in der Korrektur).
- **Bilder, Runde 2 (2026-10-27):** Die Seitenleiste lag bei 640 pt weiter offen über dem Inhalt, ⌃⌘S schaltete `sidebarVisible` um; der Fix aus Runde 1 wirkte in der App nicht. `lib/windowFit.ts` misst jetzt die Fensterbreite gegen sebaros 722 statt den berechneten Stil zu lesen ([`sebaro-luecken.md`](sebaro-luecken.md) Z, Z2). Dazu Kästchen im Aufgabenpunkt, führendes „/“ im Pfad, Einrückungslinien und Kartenlisten (Z2). Nicht bestätigt: Die Beobachtung mit 640 pt (App vorn und im Hintergrund, ⌃⌘S, Escape, Druck daneben) muss der Bild-Agent wiederholen. Ebenso fehlen dunkel-200 für 08, 09, 10, 11, 12, 13, 14, 18 und 26. Die 200-%-Bilder von Editor, EPUB und DOCX zeigten das Vierfache, weil das Rezept `editor.fontSize` 32 mit 200 % Wurzelschrift kombinierte; das ist das Rezept, nicht die App (Z2). Seit ADR-0051 #49 gilt für Bildläufe nur noch die WebView bei 200 %, die Editorschrift bleibt bei ihrem Standard.
- **Wie der Zweig landet (beantwortet, ADR-0051 #50):** ein Squash-Commit auf einem neuen Zweig von `main`, nach der Namenssuche im Diff; `sebaro-umbau` bleibt lokal, kein PR und kein Push ohne das OK des Inhabers. Der Hintergrund: Der Baum des Zweigs ist frei von fremden Produktnamen, seine Geschichte nicht. `f725c49` legte den ungefilterten Export ab (fremde Namen in `tokens.json`, `icons/icons.json`, `js/sb-facts.js`), `e1e6d51` filterte sie, `0c3f5b8` schrieb einen fremden Namen in `sebaro-luecken.md` (seit Runde 2 entfernt). Ein Push des Zweigs oder ein Merge-Commit veröffentlichte das. Deshalb landet der Zweig nur als Squash auf `main`. Davor prüft man `git diff main...HEAD` (ohne `apps/desktop/ui/src/sebaro`) auf die Namen aus ADR-0051 #4. Soll der Zweig selbst gepusht werden, wird die Geschichte vorher umgeschrieben, und für jeden Namen muss `git log -S<Name> main..HEAD` leer sein. Ein Name, der schon in einem wörtlichen Zitat des Inhabers auf `main` steht (ADR-0048, `DECISIONS.md`), ist vor dem Umbau öffentlich und kein Teil dieser Prüfung.
- **Bilder, Schlussprüfung Runde 1 (2026-10-28):** Durch das Anfangspolster der Reiterzeile vor dem angehefteten Board-Reiter liefen die weggescrollten Reiter sichtbar durch; `app.css` deckte den Streifen mit dem Grund des Reiters ab, seit `bec10b4` sind die 16 px wie in sebaro `2560ef3` der Rand des ersten Reiters ([`sebaro-luecken.md`](sebaro-luecken.md) Z4). Ebenso neu und im Bild nicht geprüft: Rollt der Baum eine Zeile ins Bild, rollt `sb-side-nav__scroll` mit, bis der Baum an seinem unteren Rand endet (seit `bec10b4` sebaros `revealInSideNav`, auch beim Fokus); `-webkit-user-select` neben `user-select`. Neu aufgenommen sind die Ansichten danach nicht.
- **Bilder, Schlussprüfung nach D110 und D111, Runde 1 (2026-10-29):** Kein Codefehler gefunden, aber vier Bilder zeigen ihren Zustand nicht sicher, und alle vier entstanden mit der App im Hintergrund, wo in diesem Lauf kein `requestAnimationFrame` lief. 24 (Editor-Suche): bei 200 % liegt der aktuelle Treffer außer Sicht, bei 100 % fehlt ihm die Auswahlfläche. Seit `55f0c00` ändert der Code weder das Scrollen noch die Auswahl: `drawSelection` steht in `editor/setup.ts`, die Fläche `selection` kommt aus `sebaroEditorTheme` (`editor/theme.ts`). 42 (Fußnoten, 100 %): der Chevron des offenen Ordners „projects“ zeigt nach rechts; `aria-expanded` setzt `Sidebar.tsx` unverändert, die Drehung ist eine Transition in sebaro.css. 39 (leerer Vault, 200 %): der Satz des leeren Baums endet ungescrollt am Fuß, ein Bild nach dem Scrollen des oberen Blocks fehlt. 37 (200 %, über das Menü geöffnet): der Block bleibt oben, der Baum zeigt 1,5 Zeilen, wie spec/02 §4.17, weil `revealInSideNav` ohne Fokus nicht läuft ([`sebaro-luecken.md`](sebaro-luecken.md) Z4). Nachzuholen vom Bild-Agenten: 24 in allen vier Kombinationen und 42 bei 100 % mit der App vorn; 39 bei 200 % nach echtem Scrollen des oberen Blocks. Zeigt 24 auch dann keinen Treffer, ist es eine Regression von `bd4954e` (`sebaroEditorTheme`). Dieselbe Ursache kann die übrigen Hintergrundbilder betreffen, die von rAF abhängen (02, 03, 15, 16, 17, 25).
- Der Kontrast der letzten Meldung `sb-fatal` (`main.tsx`, ADR-0051 #62) ist sebaros: Seit D108 trägt sie sebaros Farben, `#fatal-banner` und seine Warnlinie sind weg ([`sebaro-luecken.md`](sebaro-luecken.md) W, Z3). Im Bild gemessen ist er nicht.
- Aus der Bestandsaufnahme, ohne Nachweis in diesen Dokumenten: ob `theme-init.js` unter der CSP in WKWebView vor dem ersten Bild läuft, und ob beim Start im Dunkelmodus ein heller Rahmen erscheint (nur aus dem Code abgeleitet).
- ⌘[ und ⌘] auf der deutschen Tastatur: beantwortet durch ADR-0051 #36. Zurück und Vor sind ⌘← / ⌘→, im Editor und in Textfeldern ⌃⌘← / ⌃⌘→ (`docs/KEYMAP.md`).
- Regel-IDs: Die Bestandsaufnahme nahm sie aus dem Guide 2.9.0; geprüft sind die zitierten IDs gegen den Guide 2.11.0, jede gibt es dort.
- Die Prüfabschnitte „Prüfung“ am Ende von §5–§8 nennen, was die unabhängigen Prüfer berichtigt haben und was sie nicht prüfen konnten.
