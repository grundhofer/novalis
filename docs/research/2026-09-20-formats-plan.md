# novalis — Formatplan (finale Synthese)

Stand: Repository `/Users/sgrundhoefer/Projects/novalis` bei `aeead36` (main, sauber), 2026-09-20. Nichts im Repository wurde geändert. Eingaben: die vier Bestandsberichte `2026-09-20-inventory-{editor,core,product,ux}.md`, die drei Entwürfe `formats-inventory.md`, `formats-architecture.md`, `formats-viewers.md` und die Kritik (Linsen A Performance, B Minimalismus/Owner-Protokoll, C technische Korrektheit). Wo die Kritik mit Beleg widerspricht, gilt die Kritik; jede solche Korrektur ist unten mit ihrer Nummer (A1…C17) benannt. **[gemessen]** = in diesem Durchgang erneut ausgeführt (`critic-keystroke.mjs`, `critic-cm.mjs`, `critic-dist/`), **[Bericht]** = aus den Vorberichten übernommen, dort gemessen, hier nicht wiederholt. Alle `Datei:Zeile`-Angaben wurden in diesem Durchgang im Repository nachgelesen.

Die drei Entwürfe (`formats-inventory.md`, `formats-architecture.md`, `formats-viewers.md`) und die Kritik sind Zwischenstände dieses Durchgangs und nicht im Repository; dieser Plan ersetzt sie. Die Owner-Antworten vom 2026-09-20 stehen in `docs/DECISIONS.md` und in ADR-0022…0025.

Nächste freie ADR-Nummer: **0022** (`docs/decisions/` endet bei `0021-tree-context-menu.md`).

---

## 1. Ziel und Leitsatz

novalis ist ein Texteditor mit Markdown-Komfort und ein Lesegerät für das, was sonst noch im Vault liegt: Quelltexte und Konfigurationen öffnen im Editor mit der passenden Grammatik, Dokumente (PDF, EPUB, DOCX, CBZ, Bilder) öffnen schreibgeschützt im Viewer. Der Leitsatz bleibt schlank und schnell: **novalis öffnet, was der Baum zeigt, und zeigt nur, was es öffnen kann** — keine Sniffing-Heuristik im Baum, keine neue Abhängigkeit ohne ADR, kein Byte mehr eager als heute, und der Tastendruck in einer großen Datei kostet novalis selbst nichts mehr.

---

## 2. Ist-Stand in 8 Fakten

1. **143 Grammatiken** in `@codemirror/language-data 6.5.2` (33 Lezer, 110 legacy-stream). Über eine gelistete Datei erreichbar: **19**; nur über Markdown-Fences: 124. Die Tabelle nennt 224 Endungen, **195 davon versteckt der Baum** (`apps/desktop/ui/src/lib/fileTypes.ts:14-21`, `isSupported`). [Bericht: 2026-09-20-inventory-editor.md §2.1]
2. **Alle 111 Grammatik-Chunks liegen schon in `dist`** (962 kB roh / ≈378 kB gz), weil `codeLanguages: languages` (`editor/setup.ts:84`) jede Grammatik aus einem Fence erreichbar macht. Größter: C/C++ 33,3 kB gz; kleinster: diff 250 B. Eine breitere Liste ändert an `dist` nichts; sie kostet nur den Lazy-Chunk beim ersten Öffnen. [Bericht §3.4; Chunk-Größen in `critic-dist/` bestätigt, A4]
3. **Eager-Budget**: JS 111,0 / 250 kB gz, größter Chunk 83,1 / 120, CSS 20,3 / 24 (nur 3,7 kB Luft), Fonts 120 / 250 (`docs/BUDGET.json`). Kein CodeMirror-Code eager; die fünf Preloads sind `rolldown-runtime`, `preload-helper`, `jsx-runtime`, `fileTypes` (1 448 B / 741 B gz), `editorSave` [gemessen: `critic-dist/index.html`]. Erster Text-Tab ≈ 214 kB gz (Core 103 + Editor 98 + Autocomplete 12) [Bericht §3.3].
4. **Theme-Lücken**: zwölf `--ds-color-syntax-*`-Token; `editor/theme.ts:109-144` färbt Keyword/String/Kommentar/Zahl/Typ/Property, aber **nicht** `variableName`, `function(...)`, `operator`, `punctuation`, `meta/annotation`, `regexp`, `inserted/deleted` (ein `.diff` wäre unfarbig). Der Tag-Chip hängt an `t.labelName` und trifft deshalb CSS-`#id`, YAML-Anker (auch im Frontmatter) und Rust-Labels. Jede Datei steht in Inter (`--ds-font-sans`), 72 ch breit, zentriert (`theme.ts:22,28-29`).
5. **Parität**: zwei handgespiegelte Listen (`fileTypes.ts:14-18` und `src-tauri/src/commands.rs:481-518`, je 36 Endungen), kein Paritätstest. **Vier Zuordnungen sind falsch** [gemessen, C1]: `.text → LaTeX`, `.cfg → TTCN_CFG`, `.zsh → nichts`, `sub/Dockerfile → nichts` (Regex gegen den vollen Pfad, `@codemirror/language/dist/index.js:757-767`); Großschreibung (`X.JSON`) → nichts; `.map` (Source Maps) ist gelistet; `Makefile` bekommt zwei Leerzeichen als Einzug (B7).
6. **Notiz = klein geschriebenes `.md`** (`crates/novalis-core/src/vault/path.rs:101-103`). Quick-Open, Suche, Backlinks, ⌘E und Bild-Einfügen sind `.md`-only; `all_files` existiert in Core und DTO (`search/mod.rs:186-188`), UI (`SearchPanel.tsx:89`) und CLI (`ops/search.rs:54`) setzen es fest auf `false`.
7. **Tastendruck**: `setup.ts:178` ruft `doc.toString()` bei jeder Änderung, `editorSave.setText` (`:187-190`) vergleicht den ganzen Text und erzeugt ein neues `Doc`, `StatusBar.tsx:18-22` splittet den ganzen Text neu. Gemessen (V8) pro Tastendruck: **1 MB 2,8–5,7 ms · 5 MB 18–26 ms · 50 MB 260–360 ms** gegen `keystrokeP50Ms 8` / `keystrokeP95Ms 16` ("in a 1 MB Markdown document"). Der Spiegel allein frisst bei 1 MB ein Drittel bis zwei Drittel des p50-Budgets und sprengt die 5-MB-Zeile. Keine der UI-Perf-Zeilen wird von einem Werkzeug gemessen (`examples/perf.rs:33-58`). [gemessen: `critic-keystroke.mjs`, A1]
8. **Shell/Core**: `read_file`/`read_blob`/`write_file` haben kein Endungs-Gate (`commands.rs:335-374`); `read_blob` liefert bis 50 MiB als base64 (`:361`); keine NUL-Prüfung, kein Sniffing; CSP ohne `frame-src`/`media-src`/`worker-src`, `object-src 'none'` (`tauri.conf.json:27`); IPC **27/30** (`lib.rs:30-61`); `Cargo.lock` **514/581** [gemessen]; DMG 5,6 MB (Budget 12, nirgends geprüft, A8).

---

## 3. Zielbild: die Dateityp-Tabelle

Legende. **Editor**: `prose` = Umbruch an, keine Zeilennummern, Inter, Rechtschreibprüfung · `code2/code4/codeT` = Umbruch aus, Nummern an, Geist Mono, volle Breite, keine Rechtschreibprüfung, Einzug 2 Leerzeichen / 4 Leerzeichen / **Tab** · `data` = wie code2 ohne festen Einzug. **Notiz?**: `Notiz` = Cache, Links, Backlinks, `[[`, CLI (nur `.md`) · `Datei` = öffnen, bearbeiten, Autosave, Quick-Open, Suche mit "Alle Dateien" · `View` = Viewer, nie durchsucht. **Status**: `heute` · `F2` (Fix ohne Owner-Frage) · `F3a` (ADR-0022) · `Frage n` (Abschnitt 8).

### 3.1 Baum zeigt (= Quick-Open zeigt = öffnet)

| Kategorie | Endungen / Namen | Editor | Grammatik (`language-data`-Name) | Notiz? | Viewer | Status |
|---|---|---|---|---|---|---|
| Notiz | `md` | prose | Markdown (+Frontmatter, `[[`, `#`) | **Notiz** | ⌘E Preview | heute |
| Markdown-Datei | `markdown` | prose | Markdown | Datei | ⌘E Preview (**neu**), Bild-Einfügen (**neu**) | heute; ⌘E: Frage 8 |
| Klartext | `txt` `text` | prose | keine (`.text` heute fälschlich LaTeX) | Datei | — | heute; Fix F2 |
| Prosa-Formate | `rst` `adoc` `org` | prose | keine | Datei | — | F3a |
| Daten | `json` `json5` `jsonc` | data | JSON (Kommentare in `jsonc` als `invalid` gefärbt, kosmetisch) | Datei | — | heute / F3a |
| Daten | `yaml` `yml` | data | YAML | Datei | — | heute |
| Daten | `toml` | data | TOML | Datei | — | heute |
| Daten | `xml` `xsl` `xsd` `plist` | data | XML | Datei | — | heute / F3a |
| Daten | `svg` | data | XML | Datei | ⌘E gerendert (`<img>`) | heute; Rendern: Frage 12 |
| Daten | `csv` `tsv` | data | keine | Datei | ⌘E Tabelle (read-only) | heute; Tabelle: Frage 12 |
| Daten | `log` | data | keine | Datei | — | heute |
| Daten | `diff` `patch` | data | diff | Datei | — | F3a |
| Daten | `bib` | data | keine | Datei | — | F3a |
| Konfiguration | `ini` `properties` `cfg` `env` | data | Properties files (`.cfg` heute fälschlich TTCN_CFG; `.env` heute keine) | Datei | — | heute; Fix F2 |
| Konfiguration | `conf` | data | keine; Muster `*nginx*.conf` → Nginx (C3) | Datei | — | heute; Muster F2 |
| Web | `html` `htm` | code2 | HTML | Datei | — | heute |
| Web | `css` `scss` `sass` `less` | code2 | CSS / SCSS / Sass / LESS | Datei | — | heute / F3a |
| Web | `js` `mjs` `cjs` `jsx` | code2 | JavaScript / JSX | Datei | — | heute |
| Web | `ts` `mts` `cts` `tsx` | code2 | TypeScript / TSX | Datei | — | heute |
| Web | `vue` | code2 | Vue | Datei | — | F3a |
| Skript | `py` | code4 | Python | Datei | — | heute |
| Skript | `rb` + Namen `Gemfile` `Rakefile` | code2 | Ruby | Datei | — | F3a |
| Skript | `pl` `pm` | code4 | Perl | Datei | — | F3a |
| Skript | `lua` | code2 | Lua | Datei | — | F3a |
| Skript | `tcl` | code4 | Tcl | Datei | — | F3a |
| Skript | `ps1` | code4 | PowerShell | Datei | — | F3a |
| Shell | `sh` `bash` `zsh` | code4 | Shell (`.zsh` heute keine) | Datei | — | heute; Fix F2 |
| System | `c` `h` | code4 | C | Datei | — | F3a |
| System | `cpp` `cc` `cxx` `hpp` `hh` `hxx` | code4 | C++ | Datei | — | F3a |
| System | `rs` | code4 | Rust | Datei | — | heute |
| System | `go` | **codeT** | Go | Datei | — | F3a |
| System | `swift` | code4 | Swift | Datei | — | heute |
| JVM/.NET | `java` | code4 | Java | Datei | — | F3a |
| JVM/.NET | `kt` `kts` | code4 | Kotlin | Datei | — | F3a |
| JVM/.NET | `scala` | code2 | Scala | Datei | — | F3a |
| JVM/.NET | `cs` | code4 | C# | Datei | — | F3a |
| JVM/.NET | `groovy` `gradle` + Name `Jenkinsfile` | code4 | Groovy | Datei | — | F3a |
| Mobile | `dart` | code2 | Dart | Datei | — | F3a |
| Funktional | `hs` | code2 | Haskell | Datei | — | F3a |
| Funktional | `ml` `mli` | code2 | OCaml | Datei | — | F3a |
| Funktional | `elm` | code4 | Elm | Datei | — | F3a |
| Funktional | `erl` | code4 | Erlang | Datei | — | F3a |
| Lisp | `clj` `cljs` `edn` | code2 | Clojure | Datei | — | F3a |
| Lisp | `lisp` `el` | code2 | Common Lisp | Datei | — | F3a |
| Lisp | `scm` | code2 | Scheme | Datei | — | F3a |
| Wissenschaft | `r` | code2 | R | Datei | — | F3a |
| Wissenschaft | `jl` | code4 | Julia | Datei | — | F3a |
| Wissenschaft | `tex` `ltx` | prose (Umbruch an) | LaTeX | Datei | — | F3a |
| Datenbank | `sql` | code2 | SQL | Datei | — | F3a |
| Schnittstellen | `proto` | code2 | ProtoBuf | Datei | — | F3a |
| Build | `dockerfile`, Muster `Dockerfile.*`, Namen `Dockerfile` `Containerfile` | code2 | Dockerfile (unterhalb der Wurzel heute keine) | Datei | — | heute; Fix F2 / F3a (C14) |
| Build | `cmake` + Name `CMakeLists.txt` | code2 | CMake (heute als `.txt` prose) | Datei | — | F3a |
| Build | Namen `Makefile` `GNUmakefile` `makefile`, `mk` | **codeT** | keine (kein Modus vorhanden) | Datei | — | heute (Tab: Fix F2) / F3a |
| Build | Namen `Justfile` `justfile` | **codeT** | keine | Datei | — | F3a |
| Doku-Namen | `LICENSE` | prose | keine | Datei | — | heute |
| Doku-Namen | `README` `CHANGELOG` `CONTRIBUTING` `AUTHORS` `NOTICE` `COPYING` `VERSION` `TODO` `CODEOWNERS` | prose | keine | Datei | — | F3a (Frage 3) |
| Bild | `png` `jpg` `jpeg` `gif` `webp` | — | — | View | `<img>` aus `blob:` | heute |
| Bild | `heic` `heif` `avif` | — | — | View | `<img>` | Frage 9 |
| Dokument | `pdf` | — | — | View | pdf.js, eigene Leiste | heute (ADR-0016) |
| Buch | `epub` | — | — | View | eigener Reader (Shadow DOM) | ADR-0023, Frage 13 |
| Comic | `cbz` | — | — | View | Seiten-Viewer | ADR-0023, Frage 14 |
| Dokument | `docx` | — | — | View | mammoth → HTML, ≤ 15 MB | ADR-0024, Frage 15 |

Zählung: heute 36 Endungen + 3 Namen + 6 View. Nach F3a: **93 Endungen** (36 − `map` + 58), **20 Namen** (3 + 17; `CMakeLists.txt` ist eine Grammatik-Regel, kein Listen-Name), 1 Listen-Muster (`Dockerfile.*`), 6 View (+3 Bilder, +3 Dokumente je nach Antwort). Eager-Kosten der Tabelle ≈ **+1,0 kB gz** (synthetische 111-Zeilen-Tabelle 1,05 kB gz [gemessen, A4]; die Architektur hatte "2–3 kB" geschätzt, das war zu hoch).

Bewusst **nicht** in der Ja-Liste (Abweichung von `formats-inventory.md` §1.1, damit der Owner **eine** Liste beantwortet, nicht zwei — B3): Varianten-Endungen `c++ h++ php3-7 phtml pyw ksh mkd`, Template-Dialekte `hbs handlebars j2 jinja jinja2` und `PKGBUILD` — alle in den Frage-Bündeln (Frage 4), jede später eine Tabellenzeile. `.map` wird entfernt (B2: Inventar und Architektur widersprachen sich; eine Antwort: raus, als Owner-Zeile in ADR-0022).

### 3.2 Nur beim Öffnen per Quick-Open/Finder — **leer, mit Absicht**

Es gibt heute keinen Weg, eine ungelistete Datei zu öffnen: Quick-Open liest `list_notes` (`Palette.tsx:55`), der Baum filtert (`stores/vault.ts:150`), `tauri.conf.json` hat keine `fileAssociations`, `followLink` verlangt `isSupported` (`App.tsx:267`). Ein "Öffnen mit novalis" aus dem Finder wäre ein Feature (Dateizuordnung + Open-URL-Handler) mit eigener Entscheidung. Deshalb gilt: **Baum = Quick-Open = öffnet**; ein Sniff-beim-Öffnen für unbekannte Endungen hat keinen Aufrufer und wird nicht gebaut. Was nicht in 3.1 steht, ist in 3.3.

### 3.3 Nie

| Klasse | Endungen / Namen | Warum |
|---|---|---|
| Audio / Video | `wav mp3 m4a aac flac ogg opus aiff mp4 mov m4v mkv avi webm` | Owner: "keine wav, mp4 etc" (ADR-0015); CSP ohne `media-src`; base64 ist der falsche Transport |
| Archive | `zip tar gz tgz bz2 xz zst 7z rar dmg pkg iso jar war` | Binär; `cbr` (RAR) braucht `unrar` (`*-sys`, unfreie Lizenz) |
| Binaries / Objekte | `exe dll so dylib a o obj class pyc wasm bin msi deb rpm apk whl` | — |
| Datenbanken | `db sqlite sqlite3 mdb parquet arrow` | — |
| Build-Ausgabe | **`map`** (heute gelistet → raus, Frage 2), `d s in o`, `nb` | Source Maps, Dependency-Files, Autotools-Templates (`Makefile.in` → Properties [gemessen]), Mathematica-Notebooks: Maschinen-Artefakte |
| Ein-Buchstaben / Ziffern | `b d e p q s v t f`, `1`–`9` | Brainfuck/D/Eiffel/Pascal/Q/Gas/Verilog/Fortran/Troff beanspruchen sie; `syslog.1` würde Troff [gemessen] |
| Mehrdeutig | `m` (Mathematica/Objective-C/Octave), `sig` (PGP/SML), `spec`, `pro`, `mo`, `ls`, `st`, `msc`, `fun` | Erste Tabellenzeile gewinnt; falsche Grammatik wäre sichtbar |
| Lock-Dateien | `yarn.lock Gemfile.lock flake.lock Package.resolved` (`.lock`) | Generiert, groß; `pnpm-lock.yaml`/`package-lock.json` sind über `yaml`/`json` gelistet — bekannte, akzeptierte Inkonsistenz, kein Namens-Ausschluss |
| Minified | `*.min.js *.min.css *.bundle.js` | Endung ist `js`/`css`; ein Basename-Muster wäre ein neuer Begriff — nicht jetzt |
| Sicherung / Rest | `bak orig rej swp swo old *~ tmp partial crdownload` | `~`/`.tmp` ignoriert schon der Watcher (`watcher.rs:78-81`) |
| Office-Sperrdateien | `~$name.docx` | Nicht punkt-präfigiert → `visible_entries` würde sie listen; Basename-Regel `~$` kommt mit ADR-0024 |
| Geheimnisse | `pem crt cer der key csr p12 pfx jks gpg kdbx` | Ein Notiz-Werkzeug zeigt keine Schlüssel |
| Fonts, Design, Disk-Images | `ttf otf woff woff2 psd ai sketch fig vmdk qcow2` | — |
| Cloud-Stubs | `gdoc gsheet gslides gdraw gform`, `*.icloud` | Zeiger ohne Inhalt; `.icloud` ist ohnehin versteckt |
| Dotfiles / Dot-Ordner | `.gitignore .editorconfig .env .git .novalis .venv` | Versteckt durch den Core (`path.rs:26-28`); `gitignore` in PLAN §7.3 Tier C ist toter Text (C17); die Policy bleibt |
| Projekt-Ordner | `node_modules target dist build __pycache__ venv` | **Keine Denylist im Walker** (B1): `walk_files` speist Cache, Suche, Relink, CLI-Stammindex, `doctor`; `build/` oder `target/` können Notiz-Ordner sein; "plain files are the truth". Stattdessen ein Satz in PLAN §4.2 im F3a-PR: "Projekte gehören nicht in den Vault." |

---

## 4. Architektur-Entscheidungen

Jede Zeile: Entscheidung · Warum · verworfene Alternative.

**A1 — Eine Allowlist in Rust, generiert nach TS; die Darstellung bleibt in TS (Variante b′, C9).**
`apps/desktop/src-tauri/src/file_types.rs` trägt genau das, was die Shell entscheidet: `{ext | name | pattern, kind: note | text | view}`. `export_bindings()` (`lib.rs:64-79`, `examples/gen_bindings.rs`) schreibt daneben `ui/src/lib/fileTypes.generated.ts`; `justfile:154-164 _bindings-check` und `ci.yml:146-150` diffen beide Dateien. Die UI hält handgeschrieben `fileTypes.presentation.ts` mit `{preset: prose|code2|code4|codeT|data, grammar, preview?, mime?}` je Schlüssel; ein vitest-Test prüft, dass die Schlüsselmengen gleich sind. `creatable_name` (`commands.rs:525-537`) liest `file_types::is_creatable_ext`; `const CREATABLE_EXTENSIONS` entfällt.
*Warum:* Der Mechanismus (Generieren + Diff) existiert; die Shell entscheidet, was ein getippter Name wird (ADR-0014: "the shell decides, this one only tells"), der Editor entscheidet, wie er zeichnet. Sechs Spalten durch Rust zu schleusen, die die Shell nie liest, wäre Ballast (C9). Ein Typ hinzufügen = eine Rust-Zeile + eine TS-Zeile; der Test fängt das Vergessen.
*Verworfen:* (b) die volle Tabelle in Rust mit `wrap numbers indent mono grammar mime` (Architektur §1.3) — tote Spalten in der Shell; (a) Tabelle im Core → Bootstrap-Payload — Laufzeitabhängigkeit für eine Compile-Zeit-Tatsache, `isSupported` würde store-abhängig, jeder UI-Test bräuchte eine Fixture-Tabelle; (c) zwei Listen + Paritätstest — bewacht nur eine Spalte.

**A2 — Grammatik per Tabellenname, nie per Pfad; Muster-Regeln für Namen.**
`languageFor` löst `presentation.grammar` mit `LanguageDescription.matchLanguageName(languages, name, false)` auf (51 von 51 Namen exakt [gemessen, C2]; nur `Makefile` → keine, deshalb ohne Grammatik). Für Namen ohne Endung und für Muster gibt es eine kleine Regel-Liste in TS, vor der Endung geprüft: `/^Dockerfile(\..+)?$|^Containerfile$/ → Dockerfile`, `/nginx.*\.conf$/i → Nginx`, `/^CMakeLists\.txt$/ → CMake`, `/^Jenkinsfile$/ → Groovy`, `/^(Gemfile|Rakefile)$/ → Ruby`. Damit: `zsh → Shell`, `sub/Dockerfile → Dockerfile`, `X.JSON → JSON`, `text → keine`, `cfg/env → Properties files`, `sub/nginx.conf → Nginx` (C3: ohne die Regel wäre das eine Regression gegen heute), `Dockerfile.dev → Dockerfile` (C14).
*Warum:* `matchFilename` prüft die Regex gegen den vollen Pfad und die Endung case-sensitiv; jede Upstream-Zuordnung (`text → LaTeX`, `cfg → TTCN_CFG`) käme mit.
*Verworfen:* direkter Import von `@codemirror/legacy-modes/mode/*` — macht `legacy-modes` zur direkten Abhängigkeit (`ui/package.json` listet heute nur `language-data`), `lockfile-adr-check.mjs` verlangt ein ADR (B12); `matchFilename(fileNameOf(path))` — behält die falschen Claims.

**A3 — Einzug als String, Erkennung pro Datei.**
`preset codeT` ⇒ `indentUnit.of("\t")`; `indentWithTab` fügt dann Tabs ein (B7: heute bekommt `Makefile` zwei Leerzeichen, was `make` ablehnt; `typeOptions` kann Tab nicht ausdrücken). Dazu ein ≈20-Zeilen-Detektor über die ersten 200 Zeilen (Tab vs. 2 vs. 4), der den Tabellen-Default überschreibt — PLAN §4.2 verspricht "indentation detected per file" und nichts im Code tut es (B8, `grep detect src/editor` → nichts).
*Verworfen:* `indent: u8` (kann Tab nicht ausdrücken); den Detektor als "nicht gebaut" in §4.2 streichen — die Codepfad-Umbauten F1/F2 sind der billigste Moment, ihn zu bauen; Baseline-Item, kein ADR.

**A4 — Der Baum ist die Allowlist; kein Sniffing beim Listen; das Binär-Urteil fällt beim Öffnen im selben Read.**
Core `vault/fs.rs` bekommt `read_text(path) -> TextRead::{Text(FileContent), Binary{size}}`: ein Deskriptor, 8 KiB Kopf; **BOM-Prüfung vor NUL-Prüfung** (B10): `EF BB BF` → BOM überspringen, dann NUL-Test; `FF FE` / `FE FF` → `Text{utf8:false}` (Banner "nicht UTF-8", wie PLAN §4.2 verspricht: "other encodings open read-only with a banner") ohne NUL-Test; sonst NUL im Kopf → `Binary`, Datei nie weiter gelesen. `FileDto.binary: bool`, `text: ""` für Binärdateien (kein 2×-Lossy-String über IPC); UI `readOnly`, neues Banner `banner.binary` (de/en). Suche unter `all_files` (`search/mod.rs:239`) und **der Cache** (`cache/mod.rs:494`) nutzen dieselbe Primitive, damit eine `.md` mit NUL überall gleich behandelt wird (schreibgeschützt; im Cache indexiert mit Stamm-Titel ohne Links, wie heute nicht-UTF-8).
*Warum:* Listing liest nie Inhalte (PLAN §2.3 Regel 1, 7, 12); ein Sniff eines Cloud-Platzhalters wäre ein Download; der Owner hat die Allowlist in Worten bestellt. 0 IPC, ein zusätzlicher `read`-Syscall pro Text-Öffnung; ein `all_files`-Scan wird **billiger** als heute (kein `read_to_end` einer 40-MB-`.mp4`, dann verworfen).
*Verworfen:* eigener `sniff`-IPC (28.); `infer`-Crate direkt (Importer-Eintrag = ADR); Magic-Bytes im Listing.

**A5 — Notiz bleibt `.md`; "Datei" ist alles Gelistete.**
Quick-Open (`list_notes → list_files`, 27 bleibt 27), Suche ("Alle Dateien"), ⌘E (`grammar === "Markdown"`, also auch `.markdown`) und Bild-Einfügen (`.markdown`) weiten sich. Cache, Titel, Tags, Links, Backlinks, `[[`, Relink, `Link Note…`, Today, CLI `ls/cat/edit/meta/mv/rm/links/tags/new`, `doctor`-Zählungen ("63 notes indexed") und das `.novalis`-Schema bleiben `.md`. Die Umbenennung `list_notes → list_files` und Bild-Einfügen in `.markdown` (ADR-0017 sagt "neben der Notiz", `.markdown` ist keine Notiz) stehen **ausdrücklich im ADR-0022-Text** (B9). `Todo.MD`: **so lassen** (B14) — die UI bleibt case-insensitiv (`extensionOf` kleinschreibend), der Core nicht; `creatable_name` erzeugt nie eine `.MD` (`commands.rs:526-538`); ein Satz im F1-PR, keine Owner-Frage, weil sich nichts ändert.
*Warum:* PLAN §2.1/§7.2 definieren die Notiz als `.md`; der CLI-Vertrag ist notizförmig und nach 1.0 unveränderlich; der Cache würde sonst Körper ohne Links indexieren und jeden Golden ändern.
*Verworfen:* `.markdown`/`.MD` als Notiz im Core (Vertrag); `novalis cat notes.txt` (ändert die Bedeutung eines Arguments, `ctx.rs:146`); UI an den Core angleichen (`typeOf("x.MD")` → text) — Verhaltenswechsel ohne Anlass.

**A6 — "Alle Dateien" in der Suche = die Dateien, die der Baum zeigt; die CLI ist bewusst ungefiltert.**
Die UI filtert Treffer mit `isSupported` nach (A3 der Kritik: `all_files` im Core ist jede reguläre nicht-versteckte Datei aus `walk_files`, `search/mod.rs:185-188`; ohne Filter erschienen und öffneten `.go`, `.rtf`, `node_modules/**/*.js` über `tabs.open(hit.path)` → `read_file` als Text-Tabs, obwohl der Baum sie nie zeigt — Bruch der ADR-0015-Regel und der eigenen Regel 1). Der Schalter heißt "Alle Dateien" (`editor.search.allFiles`), session-only, keine Einstellung; die Fußzeile bekommt `editor.search.notUtf8Skipped_one/_other` neben `cloudOnlySkipped_*` (`en.json:97-98`) und nennt die weggefilterten Treffer. CLI `search --all-files` liefert alles (Agenten wollen alles) — das ADR sagt das.
*Warum:* Ein Filter, der dieselbe Funktion wie der Baum nutzt, ist exakt; ein DTO-Parameter müsste Endungen, Namen und Muster transportieren.
*Verworfen:* Allowlist-Parameter `SearchQueryDto.include: Vec<String>` — Muster nicht ausdrückbar, Core-Semantik driftet von der UI-Semantik; Mischform (beides) — globale Regel 3.

**A7 — Der Tastendruck kostet novalis nichts: Lazy-Spiegel, F7 zuerst.**
`updateListener` ruft `hooks.onChange()` ohne String. `editorSave` bekommt `attach(path, read)`, `detach`, `touch` (dirty + Autosave-Timer), `flush` (liest `view.state.doc.toString()` einmal); `save`, Tab-Wechsel, Schließen, Quit (`App.tsx:214-219`), Watcher-Merge und `noteText()` rufen `flush` zuerst — 9 Dateien per `grep -rln '\.text\b' src`. `setText` bleibt für die ⌘B/⌘I-Brücke des Previews (`Preview.tsx:396`). Die Statusleiste zählt Wörter **auf dem Autosave-Tick**, in `plainMode` gar nicht (Zeichen bleiben O(1)). Messung: `NOVALIS_PERF=1` (PLAN §11.3 nennt es wörtlich), `BootstrapDto.perf`, `lib/perf.ts` mit keydown → doppeltes rAF, Ring von 200 Proben, `console.info` als JSON; `gen_vault.py --plain-large` schreibt 5-MB-`.txt` und 50-MB-`.log`; `perf.rs --merge ui-perf.json` faltet die Handwerte in `perf.json`, damit `perf-budget.mjs` sie beurteilt. BUDGET.json-Notizen sagen "manuell, nicht gegated" — für die UI-Zeilen **und** `dmgMb` (A8/A10). **PR-Body: Vorher/Nachher bei 1 MB, 5 MB und 50 MB** (A1: die 1-MB-Zeile ist die, die das Budget nennt).
*Warum:* gemessen 2,8–5,7 / 18–26 / 260–360 ms pro Tastendruck (§2.7). F7 ist unabhängig und kommt zuerst.
*Verworfen:* Wortzahl throttlen (behält `toString` pro Tastendruck); Web-Worker (kopiert den Text); CI-Gate mit WebView (kein Runner hat eine).

**A8 — Editor-Kleid für Code ohne neues Farbtoken; eine Owner-Zeile.**
`EditorView.editorAttributes` setzt `nv-mono`/`nv-prose`; `theme.ts` bekommt `&.nv-mono .cm-scroller { fontFamily: var(--ds-font-mono); letterSpacing: var(--ds-letter-spacing-mono) }` und `&.nv-mono .cm-content { maxWidth: none; margin: 0 }`; `spellcheck` = Einstellung ∧ ¬mono. Der Chip wandert auf ein eigenes `noteTag = Tag.define()` (kein Grammatik-Knoten kann es treffen — `noteTag.set` und `labelName.set` sind disjunkt [gemessen, C6]); neun Regeln auf vorhandene Token (`function → weight 450`, `operator/punctuation → syntax-marker`, `meta/annotation/macroName → syntax-keyword`, `namespace → syntax-type`, `regexp/escape → syntax-string`, `inserted → success-text`, `deleted → warning-text`, `changed → syntax-number`); `t.variableName` bleibt absichtlich unfarbig (Dev-Noir ist zurückhaltend). Einzugslinien als ≈60-Zeilen-`ViewPlugin` (`repeating-linear-gradient` mit `--ds-color-border-default`), nur für `mono`; PLAN §4.3/§7.1 nennen sie als Baseline. Alle drei Änderungen — Mono, volle Breite, keine Rechtschreibprüfung in Code — ändern aufgezeichnete Defaults (PLAN §4.2 "editor measure 66–72 ch", ADR-0007 Geist Mono nur für Zähler/Kürzel/Statusleiste, `SETTINGS.md:28` ohne Dateityp-Scope) und bekommen deshalb **eine Zeile in ADR-0022** plus einen Satz in `SETTINGS.md` (B6); der Owner prüft sie ohnehin visuell.
*Verworfen:* `--ds-color-syntax-function` (Farbe erfinden; `dev-noir.css` hat keine Syntaxfarben); `@replit/codemirror-indentation-markers` (Abhängigkeit); Zeilenhöhe 1,5 für Code (dritte typografische Entscheidung ohne Frage); `--ds-font-size-mono` im Inhalt (eine Schriftgröße für den Nutzer).

**A9 — Fences im Lesemodus mit `highlightCode`, dynamisch geladen, exakte Namen.**
`Preview.tsx` lädt `@codemirror/language-data` und `@lezer/highlight` **per `await import(...)` im Fence-Effekt** (A2 der Kritik: der Preview-Chunk ist heute 8 012 B / 3 461 B gz ohne CodeMirror-Import [gemessen]; ein statischer Import koppelte ihn an den 103-kB-Core-Chunk). Auflösung mit `matchLanguageName(…, false)` plus Alias-Map `text/plaintext/txt → keine`, `py → Python`, `console/shell-session → Shell`, `jsonc → JSON`, `golang → Go` (C5: fuzzy macht ` ```text ` zu LaTeX und ` ```py ` zu nichts [gemessen]; mit `fuzzy=false` fällt auch `jsonc` weg, daher der Alias). Der Editor übergibt dieselbe Funktion an `codeLanguages` (lang-markdown akzeptiert eine Funktion), damit Editor und Preview dieselben Fences färben. `highlightCode` existiert in `@lezer/highlight 1.2.3`, Legacy-Modi parsen standalone, pulldown-cmark liefert `class="language-{erstes Wort}"` [gemessen, C4]. Obergrenze 64 KiB pro Fence (Parse < 1 ms für Snippets [gemessen, A9]); `SYNTAX_RULES` einmal in `theme.ts` exportiert, `previewHighlighter = tagHighlighter(...)`, zwölf Regeln in `preview.css` (lazy, nicht im Eager-CSS-Gate). Das Bundle-Gate prüft zusätzlich, dass `Preview-*.js` keinen statischen Core-Import gewinnt.
*Verworfen:* statischer Import; `StyleModule.mount` des Editor-Moduls (hängt am Editor-Mount); Highlighting in `render.rs` (Core trägt keine Präsentation).

**A10 — Viewer-Transport: gebündeltes `read_packed`, Rust `rawzip`, Shadow-DOM-Host, DOCX-Cap.**
Ein IPC `read_packed(path, entries: Vec<String>) -> PackedDto { entries: [{name, size}], parts: [{name, base64}] }` (28/30): leeres `entries` liefert das Inhaltsverzeichnis, sonst die angeforderten Teile in **einem** Aufruf (A6 der Kritik: pro Eintrag wären 21 Roundtrips für ein Kapitel mit 20 Bildern; PLAN §2.3 Regel 8 sagt ein IPC pro Nutzer-Aktion). Pro Kapitel zwei Aufrufe (XHTML; dann alle referenzierten Bilder/Stylesheets gebündelt) — das ADR nennt das als Regel-8-Anmerkung. Core `vault/archive.rs` auf `rawzip 0.5.1` (MIT, +1 Lock-Eintrag, 0 Abhängigkeiten, Inflate aus dem vorhandenen `flate2 1.1.10`; 50-MB-EPUB öffnen + Kapitel lesen 0,05 ms [Bericht]), Pro-Eintrag-Cap `HUGE_FILE_BYTES` per `take()` (Zip-Bomben), `META-INF/encryption.xml` → "geschützt". Host: `DOMParser` → Allowlist-Kopie (Block/Inline-Text, `img`, `table`, Listen, `a` nur Fragment/relativ, `class id style`; `script iframe object embed form link meta base svg math video audio` und alle `on*` weg) → `<style>` aus dem Buch → `attachShadow` mit `contain: layout paint`; CSP bleibt (`'unsafe-inline'` für `<style>`, `blob:` für Bilder, `script-src 'self'` als Rückhalt; C7); Buchfonts werden ignoriert (kein `font-src blob:`). DOCX über `read_blob`, aber **Cap 15 MB mit Banner darüber** (A7 der Kritik: Route A ≈ 4,6× Dateigröße transient, 50 MB → ≈230 MB gegen `idleRssMb 200`; DOCX mit Fotos sind routinemäßig 20–50 MB).
*Verworfen:* `zip 8` (+2 Einträge, `typed-path`; Default-Features zögen `zstd-sys`/`libbz2-rs-sys`, D26); foliate-js/epub.js (`frame-src blob:` zurück, ganze Datei durch Route A, 60–92 kB gz); `<iframe sandbox srcdoc>` (Links im Buch erreichen die App nicht; `frame-src`-Verhalten in WKWebView unverifiziert); Custom-URI-Scheme mit `Range` (Seitenoberfläche, die ADR-0015 §2 abgelehnt hat — nur für Medien nötig, und Medien sind nein); `tauri::ipc::Response` (kein `specta::Type`, außerhalb `bindings.ts`, C8); pro-Eintrag-IPC.

**A11 — Tastenkürzel in Viewern nur mit KEYMAP-Zeile, Scope und ADR-Zeile.**
`keymap.ts:15` kennt `global | editor | editor:markdown | editor:code | tree | board`; es gibt keinen Scope `viewer`. Jede vorgeschlagene Viewer-Taste (PDF `←/→ PageUp/Down Home/End`, `Cmd+F` im EPUB) ist eine KEYMAP-Zeile mit neuem Scope und eine Amendment-Zeile zu ADR-0008 (B5). **Bild-Zoom belegt `Cmd+=`/`-`/`0` nicht** — das sind globale Schriftgrößen-Chords (`KEYMAP.md:80-82`, ADR-0004/0008), und der Owner will "shortcuts in jedem Modus"; Zoom läuft über Rad/Pinch und die vorhandenen `viewer.zoom*`-Strings in der Leiste.

**A12 — Governance.**
**ADR-0022** "Dateitypen: novalis öffnet, was es listet" = ein zusammengeführter Fragebogen (Fragen 1–8): erweiterte Liste, `.map`-Entfernung, Doku-Namen, Bündel, Quick-Open/Suche/CLI-Flag, Code-Kleid-Zeile, Fence-Highlighting (mit dem Satz "am 2026-09-15 nicht angeboten; die Optionen waren Mermaid, KaTeX, PlantUML", `DECISIONS.md:298-305`, B11), ⌘E und Bild-Einfügen für `.markdown`. **ADR-0023** EPUB + CBZ (`rawzip`, `read_packed`; Fragen 13–14). **ADR-0024** DOCX (`mammoth`; Frage 15). **ADR-0025** Nachfragen gegen ADR-0015/0016/0020 (Bilder `heic`, PDF-Lücken, Bild-Zoom, CSV-Tabelle, SVG gerendert; Fragen 9–12) — **als Nachfragen zu bestehenden Entscheidungen, nicht als Baureihenfolge** (B4). F1, F2, F3b, F7 brauchen kein ADR: keine Abhängigkeit, Einstellung, Menü, Taste, IPC oder Netz; PLAN §7.3/§4.2/§11.3 nennen das Verhalten; jeder PR zitiert den Abschnitt. Dokumente: PLAN §7.3 (Tier-Tabelle + Satz zur generierten Tabelle), §4.2 (Projekt-Satz), §11.3 ("measured by hand"), CLAUDE.md "Generated files" (+1 Zeile), `SKILL.md:71`/`reference.md:172-175` (`--all-files`, `notUtf8Skipped`), `docs/DECISIONS.md` (datierter Eintrag mit den Owner-Worten).

---

## 5. Viewer-Formate

| Format | Empfehlung | Bibliothek | Größe (lazy, gz) | Lizenz | Privacy / Sandbox | IPC | ADR | Reihenfolge |
|---|---|---|---|---|---|---|---|---|
| **EPUB** | **ja** (Owner: "EPUB (Recommended)") | Rust `rawzip 0.5.1` + eigener Reader in TS (OPF, nav/NCX, Shadow-DOM-Host) | ≈ 6–10 kB TS [Schätzung]; Cargo.lock 514 → 515 | MIT | kein Netz; Skripte im Buch inert (`script-src 'self'`); Fonts ignoriert; Adobe-DRM → Banner | `read_packed` **+1 → 28/30**, gebündelt | **ADR-0023** | 1 |
| **CBZ** | **ja** (Owner: "CBZ") | `read_packed`-Listing, Bild-Einträge natürlich sortiert, eine Seite als `<img blob:>`, Vorabladen der nächsten | ≈ 3 kB TS [Schätzung] | — | wie Bilder | teilt `read_packed`; ein Aufruf pro Seite | ADR-0023 (gleiches Dokument) | 2 |
| **DOCX (nur lesen)** | **ja, mammoth** (Owner: "DOCX (nur lesen)"; ADR-0016 nennt mammoth) | `mammoth 1.12.3` über `read_blob`; Ausgabe durch den Shadow-DOM-Host; **Cap 15 MB**, Banner darüber; `~$*`-Sperrdateien ausblenden | **135,6 kB gz** [gemessen, A8]; +1 direkte npm-Abhängigkeit, 10 direkte Pakete gesehen, "26 transitive" offline **nicht verifizierbar** (C11); DMG +≈0,7 MB roh | BSD-2-Clause | kein Netz; `Function`-Konstruktion im Node-`vm`-Proxy blockiert und trotzdem konvertiert [Bericht]; **vor dem ADR einmal unter der echten CSP in `just dev`** | 0 | **ADR-0024** | 3 |
| Bilder `heic heif avif` | **fragen** (Frage 9) | keine; `MIME` + View-Zeilen | 0 | — | wie Bilder; WebKit-Dekodierung auf macOS 14 hier **unverifizierbar** (C16) | 0 | ADR-0025 | nach Antwort |
| Bild-Zoom | **fragen** (Frage 11) | keine; `transform: scale()`, Rad/Pinch, Leiste mit `viewer.zoom*` | ≈ 2 kB | — | — | 0 | ADR-0025 | nach Antwort; teilt Code mit CBZ |
| PDF-Lücken (Gliederung, Tastatur-Blättern, Suche, fortlaufend) | **fragen** (Frage 10) | pdf.js Public API (`getOutline`, `getPageIndex`, `getTextContent`); kein `pdf_viewer.mjs` (+71 kB gz) | 0 Abhängigkeiten | Apache-2.0 (vorhanden) | — | 0 | ADR-0025 (amendiert 0016: "ganze seite, nächste seite etc zoom etc" war der gefragte Umfang) | nach Antwort |
| CSV/TSV-Tabelle (⌘E, read-only) | **fragen** (Frage 12) | RFC-4180-Parser ≈ 40 Zeilen, `@tanstack/react-virtual` (vorhanden) | ≈ 3 kB | — | — | 0 | ADR-0025 (amendiert 0020 "Not built: … a preview for anything but Markdown") | nach Antwort |
| SVG gerendert (⌘E) | **fragen** (Frage 12) | `<img src=blob: type=image/svg+xml>` (keine Skripte, keine externen Referenzen in SVG-as-image) | ≈ 30 Zeilen; `preview`-Spalte in der Presentation statt zweiter `svg`-Zeile (C15) | — | sicher per Konstruktion | 0 | ADR-0025 (amendiert 0015 "svg bleibt XML" + 0020) | nach Antwort |
| ipynb | später fragen, nur wenn Notebooks im Vault liegen | `render_markdown` für Markdown-Zellen, `<pre>` für Code, `data:`-Bilder | ≈ 250 Zeilen | — | HTML-Ausgaben durch den Host | 0 | eigenes ADR | — |
| XLSX | später fragen, nach der CSV-Tabelle | `read_packed` + `sharedStrings.xml`/`sheetN.xml` → Tabellen-Komponente | ≈ 300 Zeilen | — | — | teilt `read_packed` | eigenes ADR | — |
| Audio / Video | **nein** | — | — | — | Owner: "keine wav, mp4 etc"; wenn je, dann Custom-Scheme mit `Range`, nie base64 | — | — | — |
| HTML gerendert, RTF, ODT/Pages/Numbers, eml/mbox, ics/vcf, JSON-Baum, TXT-Lesemodus | **nein** | — | — | `epub`-Crate 2.1.5 ist **GPL-3.0** und scheidet ohnehin aus (`deny.toml [licenses].allow`, ADR-0001 Req. 4) | ics/vcf: "calendar" steht auf der §2.2-Nicht-Liste | — | — | — |

Was kein Viewer tut (ADR-0015/0016-Linie): annotieren, bearbeiten, exportieren, drucken, laden aus dem Netz, etwas außerhalb `state.json` merken. Leseposition im EPUB ist session-only; sie zu persistieren wäre ein `state.json`-Zusatz mit eigener Frage. `docs/PRIVACY.md` bleibt leer: kein Viewer fügt eine Verbindung hinzu.

---

## 6. Phasenplan

Reihenfolge (Kritik-Zusammenfassung 1): **F7 zuerst**, dann F1/F2/F3b (ADR-frei), parallel die Owner-Frage (Abschnitt 8); F4/F3a/F5/F6 nach ADR-0022; die Viewer nach ADR-0023/0024. Jede Phase endet grün auf `just check`, nichts übersprungen; das Bundle-Gate läuft darin.

| Schritt | Umfang | Dateien | Größe | Risiko | Tests | ADR | Budget-Effekt |
|---|---|---|---|---|---|---|---|
| **F7 Lazy-Spiegel + Perf-Haken** | `onChange()` ohne String; `attach/detach/touch/flush` in `editorSave`, `setText` bleibt für die Preview-Brücke; alle 9 `doc.text`-Leser flushen zuerst; Wortzahl auf dem Tick, keine in `plainMode`; `BootstrapDto.perf` aus `NOVALIS_PERF`; `lib/perf.ts`; `gen_vault.py --plain-large`; `perf.rs --merge`; BUDGET-Notizen "manuell" für UI-Zeilen und `dmgMb`; PLAN §11.3 annotiert. **PR-Body: Vorher/Nachher bei 1 MB, 5 MB, 50 MB** | `editor/{setup.ts,Editor.tsx}`, `stores/editorSave.ts`, `components/{StatusBar,Preview}.tsx`, `lib/perf.ts` (neu), `src-tauri/src/{commands.rs,dto.rs}`, `ipc/bindings.ts` (generiert), `fixtures/gen/gen_vault.py`, `crates/novalis-core/examples/perf.rs`, `docs/BUDGET.json`, `PLAN.md` | M | **Mittel**: Save-Zustandsmaschine; jeder Leser muss flushen | `editorSave.test.ts`: Text nach letztem Flush wird gespeichert, `detach` flusht, Schließen nach Tippen verliert nichts, Preview-`setText` speichert; Konfliktkopie-Tests unverändert; Handwerte im PR | nein (PLAN §11.3 nennt `NOVALIS_PERF`) | Tastendruck: novalis-Anteil 0 (vorher 2,8–5,7 / 18–26 / 260–360 ms); eager unverändert |
| **F1 Eine Allowlist, generiert** | `file_types.rs` mit heutigen 36 + 3 + 6 Zeilen und `kind`; `export_ts`; `creatable_name` liest es; `fileTypes.generated.ts`; `fileTypes.presentation.ts` (Presets, Grammatik-Namen, MIME); `typeOf/isSupported/viewKind/mimeOf/CREATABLE_EXTENSIONS` abgeleitet; Schlüsselmengen-Test; Rezept + CI-Diff für beide Dateien; eslint-ignore; CLAUDE.md-Zeile "Generated files"; PLAN §7.3-Satz. **Kein Verhaltenswechsel**; `X.MD`-Satz im PR (B14) | `src-tauri/src/{file_types.rs (neu), lib.rs, commands.rs}`, `ui/src/lib/{fileTypes.generated.ts (neu), fileTypes.presentation.ts (neu), fileTypes.ts}`, `ui/eslint.config.js`, `justfile`, `.github/workflows/ci.yml`, `CLAUDE.md`, `PLAN.md` | M | Niedrig: `fileTypes.test.ts`, `vault.test.ts:110-117`, `commands.rs:1163-1179` pinnen das Verhalten (C13: alle unverändert) | Cargo: Endungen klein und eindeutig, genau eine von `ext/name/pattern`, `md` einzige `Note`; vitest: Schlüsselparität; `just check`-Diff | nein | 0 |
| **F2 Grammatik per Name + Muster + Einzug** | `languageFor` via `matchLanguageName(…, false)`; Muster-Regeln (`Dockerfile.*`, `Containerfile`, `*nginx*.conf`, `CMakeLists.txt`, `Jenkinsfile`, `Gemfile/Rakefile`); `typeOptions` entfällt; `isMarkdown = grammar === "Markdown"`; `indent` als `"\t" | "  " | "    "`, Makefile auf Tab (Go/Justfile/`*.mk` folgen mit F3a); ≈20-Zeilen-Einzugs-Detektor über 200 Zeilen | `ui/src/editor/{setup.ts, indentDetect.ts (neu)}`, `fileTypes.presentation.ts`, `setup.test.ts` (neu), `indentDetect.test.ts` (neu) | S | Niedrig; `setup.test.ts` ist die erste vitest-Datei, die `language-data` importiert (Node-ESM lädt [gemessen], vitest-Transform plausibel, nicht bewiesen — C13) | Auflösungs-Tabelle: `a.zsh → Shell`, `sub/Dockerfile → Dockerfile`, `Dockerfile.dev → Dockerfile`, `sub/nginx.conf → Nginx`, `X.JSON → JSON`, `notes.text → null`, `app.cfg → Properties files`, `dev.env → Properties files`, `data.csv → null`, `Makefile → null` + Tab; Detektor auf 2/4/Tab-Proben; jeder `grammar`-Name löst auf (Schutz vor Upstream-Umbenennung); Assertion auf `matchLanguageName(...)?.name`, nicht auf `load()` | nein (Defekte gegen §7.3/§4.2) | 0 |
| **F3b Binär-Urteil beim Öffnen** | Core `read_text` (BOM vor NUL, 8 KiB, ein Deskriptor); `FileDto.binary`, `text: ""`; Suche und **Cache** auf `read_text`; UI `readOnly` + `banner.binary` (de/en) | `crates/novalis-core/src/{vault/fs.rs, search/mod.rs, cache/mod.rs}`, `src-tauri/src/{commands.rs,dto.rs}`, `ipc/bindings.ts`, `stores/editorSave.ts`, `components/Banner.tsx`, `i18n/{en,de}.json` | S–M | Niedrig; 0 IPC; **Semantik-Notiz im PR** (B13/C13): eine `.md` mit NUL trifft heute in der Suche, danach nicht mehr | Core: `PK\x03\x04\0…` → Binary; `[0xff,0xfe,'a']` → Text{utf8:false}; `EF BB BF # H` → Text utf8; `nul\0inside` → Binary; Suche zählt Binär in `not_utf8_skipped` ohne Regex-Scan (`search/mod.rs:342-376` erweitert); Cache-Zeile mit Stamm-Titel; UI: `binary → readOnly`, Banner | nein | ein `read`-Syscall mehr pro Text-Öffnung; `all_files`-Scan billiger als heute |
| *(Owner-Frage → ADR-0022, `docs/DECISIONS.md`-Eintrag)* | | | | | | | |
| **F4 Code-Kleid** | `nv-mono`-Klasse + Theme-Regeln (Mono, volle Breite, `letter-spacing-mono`); Rechtschreibprüfung nur prose; `noteTag`-Chip; neun Highlight-Regeln auf vorhandene Token; **F4b** `indentationGuides.ts` für `mono`; `SETTINGS.md`-Satz zum Scope der Rechtschreibprüfung | `editor/{setup.ts,theme.ts,markdownExt.ts,indentationGuides.ts (neu)}`, `theme.test.ts` (neu), `indentationGuides.test.ts` (neu), `docs/SETTINGS.md` | M | Niedrig–mittel: visuell, jsdom sieht es nicht — Owner prüft `.rs`, `.css` mit `#id`, Frontmatter-Anker, `.diff`, `Makefile` | Chip-Scoping via `HighlightStyle.style` (öffentliche Funktion [gemessen, C6]); `indentLevels` rein; Bundle-Gate | **ja, eine Zeile in ADR-0022** (B6) | Editor-Chunk +≈1–2 kB gz (lazy); eager 0 |
| **F3a Tabelle erweitern** | Zeilen aus §3.1; `map` raus; `tree.newNoteHint` umformuliert (de/en, Beispiel statt Liste: "Ohne Endung wird die Datei .md. Eine getippte Endung bleibt, wenn novalis sie öffnet (.txt .json .rs …)"); `fileTypes.test.ts` Positive/Negative (`README` kippt, `.wav .mp4 .epub .zip .docx .m .s .1` bleiben negativ); PLAN §7.3 Tiers; PLAN §4.2 "Projekte gehören nicht in den Vault"; ADR-0022 + DECISIONS-Eintrag | `file_types.rs`, `fileTypes.generated.ts`, `fileTypes.presentation.ts`, `fileTypes.test.ts`, `i18n/*.json`, `lib/commands.ts:31-34`, `PLAN.md`, `docs/decisions/0022-*.md`, `docs/DECISIONS.md` | S | Niedrig | Tabellen-Invarianten; Hint-Assertion; Bundle-Gate | **ja, ADR-0022** | eager `fileTypes`-Chunk **+≈1 kB gz** (741 B → ≈1,8 kB); `dist` 0 |
| **F5 Notiz vs. Datei** | `list_notes → list_files` (27 bleibt 27); `stores/files.ts` mit abgeleitetem `notes`; Quick-Open über `isSupported` mit Endung im Label; Such-Schalter "Alle Dateien" + **Post-Filter `isSupported`** + `notUtf8Skipped`-Fußzeile; ⌘E/Auge/Anhänge auf `grammar === "Markdown"`; Watcher-Refresh (`App.tsx:162`) auf `isSupported`; CLI `search --all-files` + `notUtf8Skipped` (add-only); `SKILL.md:71`, `reference.md:172-175`; `search`-Golden; `palette.quickOpenPlaceholder` "Datei öffnen" | `src-tauri/src/{commands.rs,lib.rs}`, `ui/src/stores/{notes.ts → files.ts}`, `components/{Palette,SearchPanel,TabStrip}.tsx`, `App.tsx`, `lib/commands.ts`, `editor/{setup.ts,attachments.ts}`, `crates/novalis-cli/src/{cli.rs,ops/search.rs}`, `crates/novalis-cli/tests/cli/search/stdout.golden`, `packages/agent-skill/novalis/{SKILL,reference}.md`, `i18n/*.json` | M | Mittel: Quick-Open-Pool und `[[`-Quelle trennen sich; Golden-Diff muss add-only sein (Shape per Auge prüfen); `help --json` ist strukturell, kein Golden | `Palette.test.tsx` listet `.txt`/`.pdf`, `[[` bleibt notes-only; `SearchPanel.test.tsx` (neu) sendet `allFiles: true` und filtert einen `.go`-Treffer weg; Core-Test `search/mod.rs:372-375`; `just test-cli`; Tree-interactive ≤ 500 ms unberührt (A5: kein neues IO, `orderEntries` bleibt zwei `Map.get`, `list_files` läuft nach `setReady`; nur die IPC-Nutzlast wächst um die Nicht-Notiz-Zahl — im PR sagen) | **ja, ADR-0022** | IPC 27; 0 IO mehr |
| **F6 Preview-Fences** | `SYNTAX_RULES` geteilt; `await import("@codemirror/language-data")`/`@lezer/highlight` im Fence-Effekt; `matchLanguageName(…, false)` + Alias-Map (`text/plaintext/txt → null`, `py → Python`, `console/shell-session → Shell`, `jsonc → JSON`, `golang → Go`), Editor-`codeLanguages` nutzt dieselbe Funktion; ≤ 64 KiB pro Fence; `preview.css`-Token-Regeln | `editor/theme.ts`, `editor/setup.ts`, `components/Preview.tsx`, `styles/preview.css`, `Preview.test.tsx`, ADR-0022 | M | Niedrig–mittel: Chunk-Graph — Gate prüft, dass `Preview-*.js` keinen statischen Core-Import bekommt (`grep -c codemirror Preview-*.js` = 0) | Fence-Span-Assertion (JSON-Grammatik 1,2 kB gz lädt in vitest; sonst über exportierten `highlightFence`-Helfer); 100-KB-Fence bleibt roh; ` ```text ` bleibt ungefärbt; ` ```py ` wird Python | **ja, in ADR-0022** ("am 15.09. nicht angeboten") | Preview-Chunk +≈1 kB gz; Core-Chunk lazy, nur bei Fences geladen; Parse < 1 ms für Snippets [gemessen] |
| **V1 EPUB** | `rawzip` in `crates/novalis-core` (`vault/archive.rs`, nur Bytes, typisierte Fehler); `read_packed` gebündelt (28/30); `EpubViewer.tsx` lazy: `container.xml → OPF → nav/NCX → Kapitel`; Shadow-DOM-Host mit Allowlist-Kopie; Leiste: TOC-Popover · ‹ Kapitel N von M › (**ohne `Cmd+F`**, bis KEYMAP-Zeile entschieden); `epub` als View-Zeile; DMG-Größe nach Build im PR | `crates/novalis-core/{Cargo.toml, src/vault/archive.rs (neu)}`, `Cargo.lock` (+1), `deny.toml` (nichts neu, MIT), `src-tauri/src/{commands.rs,dto.rs,lib.rs}`, `ipc/bindings.ts`, `ui/src/components/{EpubViewer.tsx (neu), Viewer.tsx}`, `ui/src/lib/{epub.ts, sanitize.ts (neu)}`, `file_types.rs`, `fileTypes.presentation.ts`, `fileTypes.test.ts` (`book.epub` kippt), `i18n/*.json`, `docs/decisions/0023-*.md`, `PLAN.md` §7.3 Tier D | **L** | Mittel: Sanitizer-Allowlist, OPF-Varianten, EPUB-2-NCX; Zip-Bomben (Pro-Eintrag-Cap); `rawzip` 0.5.x jung | Core: Listing/Entry/Cap/`encryption.xml`; UI: Sanitizer entfernt `script on* iframe object`, behält Fragment-Links; `Viewer.test`: `.epub` → EpubViewer | **ja, ADR-0023** | IPC 28; Cargo.lock 515; RSS +≈1 MB pro Kapitel; `dmgMb` +0 |
| **V2 CBZ** | Listing → Bild-Einträge natürlich sortiert → eine Seite als `<img blob:>`, Vorabladen; Leiste ‹ Seite N von M › (Zoom nur, wenn Frage 11 ja) | `ui/src/components/CbzViewer.tsx` (neu), `Viewer.tsx`, `file_types.rs`, Presentation, Tests, ADR-0023 | S | Niedrig | Sortierung (`page-2` vor `page-10`), Cap-Verhalten | ja, ADR-0023 (gleiches Dokument) | 0 zusätzlich |
| **V3 DOCX** | `mammoth` direkt (+1 Importer, ADR); über `read_blob` mit **Cap 15 MB** + Banner; Ausgabe durch den Shadow-DOM-Host; `~$*`-Basename-Ausschluss in `isSupported`; `docx` View-Zeile; **vorher**: mammoth einmal unter der echten CSP in `just dev` | `ui/package.json`, `pnpm-lock.yaml`, `ui/src/components/DocxViewer.tsx` (neu), `Viewer.tsx`, `file_types.rs`, Presentation, `fileTypes.test.ts` (`x.docx` kippt), `i18n/*.json`, `docs/decisions/0024-*.md`, `THIRD-PARTY-NOTICES.md` | M | Mittel: Closure-Größe offline unverifiziert; `unsafe-eval`-Freiheit in WKWebView nur per Node-Proxy gezeigt | Konvertierung von `small.docx` im Test; Banner über 15 MB; `~$x.docx` nicht gelistet | **ja, ADR-0024** | lazy +135,6 kB gz; DMG +≈0,7 MB roh (5,6 → ≈6,3 von 12); RSS ≤ 15 MB × 4,6 ≈ 69 MB transient |

Abhängigkeiten: F2 braucht F1; F3a braucht F1 und F2; F5 braucht F3b (sicherer "Alle Dateien"-Schalter); F6 braucht F4s `SYNTAX_RULES` (oder macht es selbst); V2 braucht V1; V3 ist unabhängig von V1. F7 ist unabhängig und geht zuerst.

Summe: 8 PRs ohne Viewer + 3 Viewer-PRs; neue Abhängigkeiten nur `rawzip` (V1) und `mammoth` (V3); IPC 27 → 28; Cargo.lock 514 → 515; drei substanzielle ADRs (0022, 0023, 0024) + ein Nachfrage-ADR (0025).

---

## 7. Was NICHT gemacht wird und warum

| Nicht gemacht | Warum |
|---|---|
| tree-sitter / WASM-Grammatiken | PLAN §7.3 "Stop there": WASM pro Grammatik, kein gepflegtes CM6-Binding; `language-data` hat 143 Einträge, die schon im Bundle liegen |
| LSP, Linting, Formatter, Folding, Minimap, vim | §7.1 NO-Zeile bzw. §4.4 "Modes with own state"; ein Editor, kein IDE |
| Sniffing im Baum (Magic Bytes, Kopf lesen beim Listen) | PLAN §2.3 Regel 1/7/12: Listing liest nie Körper; ein Sniff eines Cloud-Platzhalters ist ein Download; der Owner hat die Allowlist in Worten bestellt |
| Sniff-beim-Öffnen für unbekannte Endungen | Hat keinen Aufrufer (§3.2); "Öffnen mit" aus dem Finder wäre ein eigenes Feature |
| Ordner-Denylist im Walker (`node_modules target dist build …`) | **Gestrichen (B1)**: `walk_files` speist Cache, Suche, Relink, CLI-Stammindex, `doctor`; Alltagswörter wie `build`/`target` können Notiz-Ordner sein; "plain files are the truth"; Core-Verhaltensänderung ohne Owner-Wunsch. Ersatz: ein Doku-Satz in PLAN §4.2 (F3a). Falls je gefragt: nur Namen, die keine Notiz-Ordner sein können (`node_modules`, `__pycache__`), per ADR |
| Direkter `@codemirror/legacy-modes`-Import | Neuer Importer-Eintrag → ADR ohne Nutzen; `matchLanguageName` erreicht denselben Chunk |
| `@replit/codemirror-indentation-markers`, DOMPurify, papaparse, foliate-js, epub.js, docx-preview, SheetJS, JSON-Viewer-Pakete | Je eine Abhängigkeit für etwas, das 40–120 Zeilen eigener Code leisten; DOMPurify nur, wenn der eigene Sanitizer im Review nicht genügt (dann +1 Importer, 0 Lock-Einträge, 10,9 kB gz [gemessen, C12]) |
| `zip 8`-Crate | +2 Lock-Einträge (`typed-path`) gegen +1 bei `rawzip`; Standard-Features zögen `zstd-sys`/`libbz2-rs-sys` (D26 verbietet `*-sys`) |
| `epub`-Crate | GPL-3.0, nicht in `deny.toml`, kollidiert mit ADR-0001 Req. 4 |
| `<iframe sandbox srcdoc>`-Host, `frame-src blob:` zurück, `font-src blob:` | ADR-0016 hat `frame-src blob:` entfernt; Links im Buch erreichen die App nicht; Buchfonts sind kein Lesegewinn gegenüber Inter/Geist |
| Custom-URI-Scheme mit `Range`, `assetProtocol`, `tauri::ipc::Response` | Neue Seitenoberfläche (ADR-0015 §2 abgelehnt) bzw. untypisiert außerhalb `bindings.ts`; nur Medien bräuchten es, und Medien sind nein |
| `read_blob`-Cap anheben | 50 MiB base64 ≈ 230 MB transient in JS; die Container-Formate gehen über `read_packed`, DOCX bekommt ein niedrigeres Cap |
| Audio, Video, HTML gerendert, RTF, ODT/Pages/Numbers, eml/mbox, ics/vcf, JSON-Baum, TXT-Lesemodus, Font-Specimen | Owner-Nein ("keine wav, mp4"), §2.2-Nicht-Liste (calendar), "a mode = a feature", oder die Grammatik im Editor **ist** schon die Leseansicht |
| Fortlaufendes PDF-Scrollen, PDF-Suche, TOC-Popover, Viewer-Chords als Baureihenfolge | Sind Features unter dem Tor (B4); ADR-0016 hat "eine Seite, prev/next/zoom/fit" festgehalten; jede Taste braucht KEYMAP-Zeile + Scope + ADR-Zeile (B5) → Frage 10, nicht Plan |
| `Cmd+=`/`-`/`0` im Bild-Viewer umbelegen | Globale Schriftgrößen-Chords (KEYMAP, ADR-0004/0008); Owner: "shortcuts in jedem Modus" |
| `.markdown`/`.MD` als Notiz im Core; `novalis cat notes.txt`; Cache für Nicht-`.md` | CLI-Vertrag notizförmig, nach 1.0 unveränderlich; Goldens ("63 notes indexed") |
| `X.MD` in der UI an den Core angleichen | Kein Anlass: `creatable_name` erzeugt nie eine `.MD`; Verhalten bleibt, ein Satz im F1-PR (B14) |
| Allowlist-Parameter im `SearchQueryDto` | UI-Post-Filter ist exakt und ohne Core-Änderung (A6) |
| Dotfiles listen (`.gitignore`, `.env`, `.zshrc`) | Änderung der Hidden-Policy, die auch `.novalis/` und `.git/` schützt |
| `*.min.*`-Muster, `.lock`-Namen, `~$`-Regel vor DOCX | Neue Begriffe ohne Anlass; `~$` kommt mit ADR-0024 |
| Neues Farbtoken `--ds-color-syntax-function`, Zeilenhöhe für Code, Font-Familie-Einstellung | Farbe erfinden (Dev-Noir hat keine Syntaxfarben); dritte typografische Entscheidung; fünfte Einstellung |
| Statischer `language-data`-Import im Preview | Koppelt den 3,5-kB-Preview-Chunk an den 103-kB-Core-Chunk (A2) |
| Pro-Eintrag-IPC im EPUB-Reader | 21 Roundtrips pro Kapitel mit 20 Bildern (A6); gebündeltes `read_packed` |
| CI-Gate für Tastendruck/Öffnen/RSS/`dmgMb` | Kein Runner hat eine WebView; ehrlich ist "manuell, `NOVALIS_PERF=1`, im PR-Body" (A8/A10) |
| Grammatik-Chunks vorab laden | Sichere Bandbreite gegen unsichere Nutzung; 25 kB gz einmal pro Session für `.rs` ist der Preis |
| BOM-Fix in `frontmatter::title` (`frontmatter.rs:228-229`) | Echter Core-Bug, aber keine Dateityp-Frage; eigener Einzeiler-PR (`trim_start_matches('\u{feff}')`) |

---

## 8. Offene Entscheidungen für den Owner

Eine Frage pro Zeile, Empfehlung fett; die Antworten werden wörtlich in `docs/DECISIONS.md` und im jeweiligen ADR zitiert. Fragen 1–8 → ADR-0022; 9–12 → ADR-0025 (Nachfragen zu ADR-0015/0016/0020); 13–14 → ADR-0023; 15 → ADR-0024.

1. Die erweiterte Endungsliste aus §3.1 (58 neue Endungen + 17 Namen, alle mit vorhandener Grammatik oder bewusst ohne, 0 Bytes im Bundle, 0 Abhängigkeiten) als Tier A/B/C aufnehmen? — **Ja.**
2. `.map` (Source Maps, Build-Ausgabe) aus der Liste entfernen — die einzige Streichung aus PLAN §7.3? — **Ja.**
3. Doku-Namen ohne Endung listen (`README CHANGELOG CONTRIBUTING AUTHORS NOTICE COPYING VERSION TODO CODEOWNERS`; heute ist `LICENSE` drin, `README` nicht und ein Test pinnt das)? — **Ja.**
4. Zusatz-Bündel: (a) Prosa-2 `textile mkd mdx rmd qmd srt vtt`, (b) Templates `hbs handlebars j2 jinja jinja2 liquid`, (c) Apple `m → Objective-C, mm`, (d) Wissenschaft `f f90 f95 for sas`, (e) RDF/DB `ttl rq sparql nt cql pls jsonld`, (f) Hardware `v sv vhd vhdl`, (g) Windows `bat cmd psd1 psm1`, (h) Varianten `c++ h++ php3-7 phtml pyw ksh PKGBUILD`, (i) ohne Grammatik `graphql hcl tf nix zig ex exs`? — **Nur (a); alles andere nein, bis jemand danach fragt.**
5. Quick-Open über alle gelisteten Dateien (Endung im Label), Such-Schalter "Alle Dateien" (session-only, gefiltert auf die Baum-Typen) und CLI `search --all-files` (ungefiltert, add-only, plus `notUtf8Skipped`)? — **Ja.**
6. Code-Kleid: Geist Mono, volle Breite (statt 72 ch), keine Rechtschreibprüfung in Code-Dateien, Einzugslinien, Chip nur für `#tags`, Funktionsnamen fett (kein neues Farbtoken) — ändert PLAN §4.2 / ADR-0007 / SETTINGS.md um je einen Satz? — **Ja.**
7. Syntax-Farben in Code-Fences im Lesemodus ⌘E (am 15.09. nicht angeboten; 0 Abhängigkeiten, lazy, Editor und Preview färben gleich)? — **Ja.**
8. ⌘E-Lesemodus und Bild-Einfügen auch für `.markdown`-Dateien (bleiben Dateien, keine Notizen; `list_notes` wird `list_files`)? — **Ja.**
9. Bilder `heic heif avif` im Viewer (0 Abhängigkeiten; WebKit-Dekodierung vorher in `just dev` prüfen), `bmp tiff` und `ico` nein? — **Ja für die drei, nach dem Check.**
10. PDF-Nachfrage zu ADR-0016: (a) Gliederung als Popover (teilt Code mit dem EPUB-TOC), (b) Tastatur-Blättern `←/→ PageUp/Down Home/End` (neuer Scope `viewer`, KEYMAP-Zeilen), (c) Suche im PDF (`Cmd+F`, Scope `viewer`), (d) fortlaufendes Scrollen (ersetzt "eine Seite")? — **(a) und (b) ja; (c) und (d) später.**
11. Bild-Zoom per Rad/Pinch und Leiste (`viewer.zoom*`-Strings existieren), ohne `Cmd+=`/`-`/`0` zu belegen; teilt Code mit CBZ? — **Ja.**
12. Zweite Darstellung hinter dem Auge/⌘E, beide read-only, 0 Abhängigkeiten (amendiert ADR-0020 "keine Vorschau außer Markdown"): (a) SVG gerendert (du hattest svg unter "Bilder" genannt; ADR-0015 hielt es als XML), (b) CSV/TSV als Tabelle? — **Beide ja, SVG zuerst.**
13. EPUB: Rust `rawzip` (MIT, +1 Lock-Eintrag, 0 Abhängigkeiten) + ein IPC `read_packed` (28/30) + eigener Reader im Shadow DOM (keine CSP-Änderung, keine npm-Abhängigkeit, Buchfonts ignoriert, session-only Leseposition, vorerst ohne `Cmd+F`)? — **Ja, als erster Viewer.**
14. CBZ auf derselben Basis (nur ZIP; CBR/RAR nein)? — **Ja, direkt danach.**
15. DOCX: `mammoth` (BSD-2, +1 npm-Abhängigkeit, ≈10 direkte/≈26 transitive Pakete, 136 kB gz lazy, Cap 15 MB) oder eigener 300–500-Zeilen-Walker (0 Abhängigkeiten, Fidelity-Lücken bei Nummerierung, Tabellen, Fußnoten)? — **mammoth, nach einem CSP-Test in `just dev`.**

---

## 9. Unverifiziertes / Risiken

| Punkt | Status | Was es bedeutet |
|---|---|---|
| Tastendruck-Zahlen stammen aus V8 (Node); JSC in WKWebView nicht gemessen | **unverifiziert** (gleiche Größenordnung erwartet) | F7-PR liefert die ersten echten Zahlen per `NOVALIS_PERF=1`; bis dahin sind 8/16 ms Budget behauptet, nicht bewiesen |
| RSS mit 50-MB-Datei offen (`idleRssMb 200`, "≈100 MB als UTF-16-String") | **nie gemessen** | `/usr/bin/time -l` im F7-Ablauf; ein `read_file`-Cap ist eine Owner-Frage, hier nicht gestellt |
| `setup.test.ts` importiert `@codemirror/language-data` unter vitest/jsdom | **plausibel**, nicht bewiesen (Node-ESM lädt [gemessen]) | Fallback: Test über exportierte reine Funktion ohne Modul-Import |
| WebKit dekodiert `heic heif avif` in `<img>` auf macOS 14 | **unverifizierbar** hier (C16) | ADR-0025-Zeile sagt "in `just dev` verifiziert" oder behauptet keine Nullkosten |
| mammoth: Paket-Closure und `unsafe-eval`-Freiheit unter der echten CSP | Closure offline **unverifizierbar** (10 direkte gesehen); eval-Test nur per Node-`vm` | Einmal in `just dev` laufen lassen, bevor ADR-0024 geschrieben wird |
| `<iframe sandbox srcdoc>` vs. fehlendes `frame-src` in WKWebView | **unverifizierbar**, geparkt | Irrelevant, solange der Shadow-DOM-Host gewählt ist |
| `rawzip 0.5.x` ist jung | API kann sich bewegen | Nur `Read+Seek`-Öffnen, Listing, Entry-Read benutzt; `zip 8` bleibt die benannte Alternative (+2) |
| F7 berührt die Save-Zustandsmaschine | **mittleres Risiko** | Die vier neuen `editorSave`-Tests plus unveränderte Konfliktkopie-Tests; Grep-Liste der 9 `doc.text`-Leser im PR |
| `.jsonc`/`.json5` mit der JSON-Grammatik: Kommentare als `invalid` gefärbt | bekannt | Kosmetisch; eine `json5`-Grammatik gibt es nicht in `language-data` |
| Einzugs-Detektor über 200 Zeilen | Heuristik | Tabellen-Default bleibt der Rückfall; Test mit gemischten Proben |
| F3b ändert Suchtreffer und Cache: eine `.md` mit NUL trifft heute, danach nicht; sie wird schreibgeschützt | Semantik-Änderung, add-only im Vertrag; Demo-Vault-Goldens unberührt (keine NUL-Datei) | Im PR benennen (B13/C13) |
| `fuzzy=false` in Editor-Fences: Fence-Namen ohne Alias (`golang`, `jsonc`) hängen an der Alias-Map | bekannt | Alias-Map ist getestet; ein fehlender Name bleibt ungefärbt, nie falsch gefärbt |
| `dmgMb 12` wird nirgends geprüft; V3 hebt `dist` um ≈0,7 MB | bekannt | Jeder Viewer-PR notiert die DMG-Größe nach dem Build |
| `just perf` sieht nichts hiervon (`all_files: false` in `perf.rs:92`) | bekannt | `--merge` ist das ehrlichste Gate; BUDGET-Notizen "manuell" |
| Chunk-Graph nach F6 | nur per Build prüfbar | Bundle-Gate + `grep -c codemirror Preview-*.js` = 0 als Assertion im PR |
| Owner-Antworten fehlen für alles ab F4 | offen | F7/F1/F2/F3b laufen ohne sie; nichts weiter wird ohne den zitierten "ja" gebaut |
