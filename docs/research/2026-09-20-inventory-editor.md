# novalis — the editor stack, file-type handling and the JS bundle today

Read-only analysis, 2026-09-19, repository `/Users/sgrundhoefer/Projects/novalis` at `aeead36` (main, clean before and after; `dist/` is git-ignored). Everything under **Verified** was read in code or measured with the commands quoted; **Inferred** is marked as such. Installed versions (pnpm-lock.yaml): `@codemirror/view 6.43.12`, `state 6.7.5`, `language 6.12.4`, `language-data 6.5.2`, `legacy-modes 6.5.4`, `lang-markdown 6.5.2`, `lang-yaml 6.1.3`, `@lezer/markdown 1.7.2`, `@lezer/javascript 1.5.4`, `@lezer/highlight 1.2.3`, Vite 8.3 (rolldown), node 22.23.2, pnpm 11.0.9.

---

## 1. How a path becomes an editor, a viewer, or nothing

### 1.1 The tree filter — `isSupported` (verified)

`apps/desktop/ui/src/lib/fileTypes.ts`:

- `CREATABLE_EXTENSIONS` (lines 14–18): 36 lower-case extensions —
  `md markdown txt text json map yaml yml toml xml svg html htm css js mjs cjs jsx ts mts cts tsx py rs sh bash zsh ini conf cfg properties env swift csv tsv log`.
- `TEXT_NAMES` (line 21): `Dockerfile`, `LICENSE`, `Makefile` (extensionless tier-C names; `.gitignore` is hidden by the core and never listed).
- `VIEW_EXTENSIONS` (lines 25–32): `pdf → "pdf"`, `png jpg jpeg gif webp → "image"`; `MIME` (35–42) mirrors it; `mimeOf` falls back to `application/octet-stream` (line 50).
- `viewKind(rel)` (45–47): tier D or `null` (= text).
- `isSupported(rel)` (54–58): with an extension → `CREATABLE_EXTENSIONS.includes(ext) || ext in VIEW_EXTENSIONS`; without → `TEXT_NAMES.has(fileNameOf(rel))`. `extensionOf` (`lib/paths.ts:25-29`) lower-cases, so `Notes.TXT` and `e.PNG` pass (the test at `fileTypes.test.ts:7` asserts exactly that).

Where the filter is applied:

- `stores/vault.ts:150` — `orderEntries` drops every non-folder entry that is not supported, so the tree never draws it (ADR-0015 §3). Test: `stores/vault.test.ts:112-117` (`song.wav`, `clip.mp4` absent; `a.md`, `scan.pdf`, `photo.jpg` present).
- `stores/vault.ts:223` — `cloudCounts` ignores unsupported files in the status-bar counts.
- `App.tsx:267` — `followLink`: a Markdown destination opens only when `isSupported(destination)`; otherwise it falls through to the wikilink resolver.

Nothing else consults the list: the core (`novalis-core`) and the CLI have no notion of it. The Rust `read_file` command (`src-tauri/src/commands.rs:335-346`) reads whatever path it is given, so the filter is purely a UI drawing decision.

### 1.2 Opening a tab — viewer or buffer (verified)

`stores/tabs.ts:50-58` (`open`): `if (!viewKind(path)) await useEditorSave.getState().open(path)` — tier D never gets a text buffer; everything else is read through `read_file` into `editorSave` (`stores/editorSave.ts:97-116`, `docFromFile`). `back`/`forward` repeat the same test (`tabs.ts:132, 143`).

`App.tsx:323-345` picks the pane in this order:
1. `active && view` → `<Viewer path kind>` (`components/Viewer.tsx`): `read_blob` → base64 → bytes; image → `<img>` from a `blob:` URL (line 41, 59); PDF → lazy `<PdfViewer>` (line 17, pdf.js, `components/PdfViewer.tsx`).
2. `active && doc && previewing && isNote(active)` → `<Preview>` (only `.md`, `lib/paths.ts:35` `isNote = extension === "md"`; `.markdown` is *not* a note for the preview, quick-open, search, backlinks or attachments).
3. `active && doc` → `<Editor>` (`editor/Editor.tsx`) for every other supported file, including `.csv`, `.log`, `LICENSE`.

### 1.3 The editor build — `setup.ts` (verified)

`apps/desktop/ui/src/editor/setup.ts`:

- **`typeOptions(path)`** (lines 64–74):
  - `prose = ext ∈ {md, markdown, txt, text}` → `wrap: prose`, `numbers: !prose || wide` (`wide = csv|tsv`; the `|| wide` term is redundant because csv/tsv are already `!prose`).
  - `indent = "    "` for `py rs swift sh bash zsh`, else `"  "`. There is **no indentation detection** anywhere in `src/editor` (PLAN §4.2 says "indentation detected per file"; grep for `detect` finds nothing). There are also no indentation guides (§4.3 baseline), no `foldGutter`.
- **`languageFor(path)`** (lines 76–93):
  - `md`/`markdown` (via `extensionOf`, lower-cased) → `yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [WikiLink, Tag] }) })`. `@codemirror/lang-markdown` and `@codemirror/lang-yaml` are **static** imports (lines 10–11), so they are always in the Editor chunk.
  - Everything else → `LanguageDescription.matchFilename(languages, path)` then `await description.load()`; `null` when nothing matches. `languages` is the full `@codemirror/language-data` table (static import, line 18).
- **`buildExtensions(path, hooks)`** (lines 152–231): base = history, drawSelection, dropCursor, multiple selections, rectangular selection, crosshair, active line, selection-match highlight, bracketMatching, indentOnInput, indentUnit, search panel, keymaps (closeBrackets, default, search, history, completion, indentWithTab, `Mod-s`), updateListener, editable/readOnly, `spellcheck` content attribute (applies to code files too, line 184). Then `lineWrapping` if `wrap`, `lineNumbers()+highlightActiveLineGutter()` if `numbers`. **Line 196: `if (hooks.plainMode) return base;`** — plain mode stops here. Otherwise: `closeBrackets()`, the language, and for Markdown only (`isMarkdown`, line 154): `decorations`, `completions` (`[[`, `[[#`, `#`), `Mod-b/Mod-i/Mod-Enter`, `Cmd`-click link following, `attachments(path)`.

`editor/Editor.tsx:81`: `extensions: [editorTheme, syntaxHighlighting(markdownHighlight), ...extensions]` — the theme and the one `HighlightStyle` are applied to **every** file type unconditionally, with no `fallback` and no `defaultHighlightStyle` (grep confirms neither is imported anywhere in `src`).

### 1.4 What `matchFilename` actually does with novalis paths (verified by running it)

`@codemirror/language/dist/index.js:757-767`: first every entry's `filename` regex is tested against the string passed, then `/\.([^.]+)$/` extracts the extension **as written** and compares it **case-sensitively** against each entry's `extensions`. `setup.ts:89` passes the full vault-relative path (e.g. `docs/Dockerfile`). Consequences, all confirmed with `node` against the installed table:

| Path | `isSupported` | Grammar loaded | Note |
|---|---|---|---|
| `x.txt`, `x.csv`, `x.tsv`, `x.log`, `x.env`, `x.conf` | yes | none | intended (tier C / no mode exists) |
| `x.zsh` | yes | **none** | PLAN §7.3 lists `zsh` under tier B, but the Shell entry's extensions are `sh ksh bash` only |
| `x.text` | yes (prose, wrap on) | **LaTeX** (`legacy-modes/mode/stex`) | `text` is an extension of entry #119 LaTeX — a `.text` note gets TeX highlighting |
| `x.cfg` | yes | **TTCN_CFG** (`legacy-modes/mode/ttcn-cfg`) | entry #128 claims `cfg` |
| `x.ini`, `x.properties` | yes | Properties files | as intended |
| `x.JSON`, `x.Py`, `x.RS` | yes (`extensionOf` lower-cases) | **none** | `matchFilename` compares the raw extension; only `R`/`r` list both cases. `creatable_name` keeps `Notes.TXT` as typed (`commands.rs:1166`), so a user *can* create upper-case names |
| `Dockerfile` at vault root | yes | Dockerfile | `/^Dockerfile$/` tested against `"Dockerfile"` |
| `sub/Dockerfile` | yes | **none** | the same anchored regex is tested against `"sub/Dockerfile"` |
| `Makefile`, `LICENSE` | yes | none | there is no Makefile mode in legacy-modes at all |
| `x.svg` | yes | XML | intended (§7.3) |
| `x.map` | yes | JSON | intended |
| `x.swift` | yes | Swift (legacy) | intended |

### 1.5 The hand-mirrored Rust list (verified)

`apps/desktop/src-tauri/src/commands.rs:481-518`: `const CREATABLE_EXTENSIONS: &[&str]` — the same 36 entries in the same order. `creatable_name` (526–538) keeps a typed extension from the list case-insensitively, lower-cases `.md`, and appends `.md` to anything else; unit test `typed_extensions_are_kept_and_md_is_lower_cased` (1163–1179) pins eleven examples (`clip.wav` → `clip.wav.md`, `.env` → `.env.md`, `archive.tar.gz` → `archive.tar.gz.md`). No test compares the two lists with each other; `fileTypes.ts:9-11` documents the mirror as "kept in step by hand; the shell decides, this one only tells". The UI list is also rendered into the New Note hint (`lib/commands.ts:31-34`, key `tree.newNoteHint`, `i18n/en.json:271`).

### 1.6 Note-only features (verified)

`isNote` (`lib/paths.ts:35-37`) is `.md` only, and the core's `is_note_name` (`crates/novalis-core/src/vault/path.rs:101-103`) agrees. Therefore for every non-`.md` file: no quick-open entry (`Palette.tsx:55` reads `useNotes`, which is `list_notes`), no vault search hit (`SearchPanel.tsx:89` sends `allFiles: false`; `crates/novalis-core/src/search/mod.rs:186` skips non-notes unless `all_files`), no backlinks, no `[[` target, no preview (`App.tsx:327`), no image paste (`editor/attachments.ts:39`). Non-note files are "open from the tree, edit, autosave" and nothing more.

### 1.7 Looks that are Markdown-shaped even for code (verified)

`editor/theme.ts:14-107` (`editorTheme`) applies to all files: `.cm-scroller` uses **`--ds-font-sans`** (Inter, line 22) and `.cm-content` is capped at **`--ds-measure-editor` = 72ch** centred (`tokens.css:210`; theme.ts:28-29). Only the gutter is mono (line 45). So a `.rs` or `.csv` file today is drawn in a proportional font inside a 72-character prose column. No per-type theme exists.

---

## 2. The full `@codemirror/language-data` table as installed (6.5.2)

Source: `node_modules/.pnpm/@codemirror+language-data@6.5.2/node_modules/@codemirror/language-data/dist/index.js` (1016 lines, 32,830 B). Enumerated by importing the module and reading each `LanguageDescription` (`name`, `alias`, `extensions`, `filename`, `loadFunc.toString()`). **143 entries: 33 Lezer (`@codemirror/lang-*`, 21 distinct packages; the seven SQL dialects share `lang-sql`), 110 legacy stream modes (`@codemirror/legacy-modes/mode/*`, 94 distinct mode files).** `LanguageDescription.of` appends the lower-cased name to `alias` automatically; the alias column below omits that.

"Chunk" is the file in `apps/desktop/ui/dist/assets` after `pnpm build` (raw bytes / `gzip -c | wc -c`); "in Editor chunk" means the package is statically reachable from `lang-markdown` or `setup.ts` and rolldown folded it into `Editor-*.js`. "Reachable by file today" means `setup.ts` `languageFor` reaches it for a file the tree lists; every entry is additionally reachable from a Markdown fence (` ```name `) through `codeLanguages: languages` (`lang-markdown/dist/index.js:75-92`, `matchLanguageName` with fuzzy matching), which is why all 111 grammar chunks are shipped whatever the extension list says.

| # | name | alias (lower-case name is added automatically) | extensions | filename regex | load() imports | kind | chunk (raw/gzip B) | reachable by file today |
|---|---|---|---|---|---|---|---|---|
| 1 | C |  | c h ino |  | @codemirror/lang-cpp → cpp() | Lezer | dist-*.js 103865/33286 | fences only |
| 2 | C++ | cpp | cpp c++ cc cxx hpp h++ hh hxx |  | @codemirror/lang-cpp → cpp() | Lezer | dist-*.js 103865/33286 | fences only |
| 3 | CQL | cassandra | cql |  | @codemirror/lang-sql (dialect Cassandra) | Lezer | dist-*.js 32111/12855 | fences only |
| 4 | CSS |  | css |  | @codemirror/lang-css → css() | Lezer | in Editor chunk | yes: .css |
| 5 | Go |  | go |  | @codemirror/lang-go → go() | Lezer | dist-*.js 30688/12286 | fences only |
| 6 | HTML | xhtml | html htm handlebars hbs |  | @codemirror/lang-html → html() | Lezer | in Editor chunk | yes: .html .htm |
| 7 | Java |  | java |  | @codemirror/lang-java → java() | Lezer | dist-*.js 40677/16152 | fences only |
| 8 | JavaScript | ecmascript js node | js mjs cjs |  | @codemirror/lang-javascript → javascript() | Lezer | in Editor chunk | yes: .js .mjs .cjs |
| 9 | Jinja |  | j2 jinja jinja2 |  | @codemirror/lang-jinja → jinja() | Lezer | dist-*.js 20655/9017 | fences only |
| 10 | JSON | json5 | json map |  | @codemirror/lang-json → json() | Lezer | dist-*.js 1959/1241 | yes: .json .map |
| 11 | JSX |  | jsx |  | @codemirror/lang-javascript → javascript() | Lezer | in Editor chunk | yes: .jsx |
| 12 | LESS |  | less |  | @codemirror/lang-less → less() | Lezer | dist-*.js 16204/7204 | fences only |
| 13 | Liquid |  | liquid |  | @codemirror/lang-liquid → liquid() | Lezer | dist-*.js 20919/9374 | fences only |
| 14 | MariaDB SQL |  |  |  | @codemirror/lang-sql (dialect MariaSQL) | Lezer | dist-*.js 32111/12855 | fences only |
| 15 | Markdown |  | md markdown mkd |  | @codemirror/lang-markdown → markdown() | Lezer | in Editor chunk | yes: .md .markdown (static import in setup.ts, not via this table) |
| 16 | MS SQL |  |  |  | @codemirror/lang-sql (dialect MSSQL) | Lezer | dist-*.js 32111/12855 | fences only |
| 17 | MySQL |  |  |  | @codemirror/lang-sql (dialect MySQL) | Lezer | dist-*.js 32111/12855 | fences only |
| 18 | PHP |  | php php3 php4 php5 php7 phtml |  | @codemirror/lang-php → php() | Lezer | dist-*.js 98107/28059 | fences only |
| 19 | PLSQL |  | pls |  | @codemirror/lang-sql (dialect PLSQL) | Lezer | dist-*.js 32111/12855 | fences only |
| 20 | PostgreSQL |  |  |  | @codemirror/lang-sql (dialect PostgreSQL) | Lezer | dist-*.js 32111/12855 | fences only |
| 21 | Python |  | BUILD bzl py pyw | `/^(BUCK\|BUILD)$/` | @codemirror/lang-python → python() | Lezer | dist-*.js 44542/18517 | yes: .py |
| 22 | Rust |  | rs |  | @codemirror/lang-rust → rust() | Lezer | dist-*.js 70755/25067 | yes: .rs |
| 23 | Sass |  | sass |  | @codemirror/lang-sass → sass() | Lezer | dist-*.js 22929/9958 | fences only |
| 24 | SCSS |  | scss |  | @codemirror/lang-sass → sass() | Lezer | dist-*.js 22929/9958 | fences only |
| 25 | SQL |  | sql |  | @codemirror/lang-sql (dialect StandardSQL) | Lezer | dist-*.js 32111/12855 | fences only |
| 26 | SQLite |  |  |  | @codemirror/lang-sql (dialect SQLite) | Lezer | dist-*.js 32111/12855 | fences only |
| 27 | TSX |  | tsx |  | @codemirror/lang-javascript → javascript() | Lezer | in Editor chunk | yes: .tsx |
| 28 | TypeScript | ts | ts mts cts |  | @codemirror/lang-javascript → javascript() | Lezer | in Editor chunk | yes: .ts .mts .cts |
| 29 | WebAssembly |  | wat wast |  | @codemirror/lang-wast → wast() | Lezer | dist-*.js 2577/1457 | fences only |
| 30 | XML | rss wsdl xsd | xml xsl xsd svg |  | @codemirror/lang-xml → xml() | Lezer | dist-*.js 14274/5693 | yes: .xml .svg |
| 31 | YAML | yml | yaml yml |  | @codemirror/lang-yaml → yaml() | Lezer | in Editor chunk | yes: .yaml .yml |
| 32 | APL |  | dyalog apl |  | @codemirror/legacy-modes/mode/apl | legacy stream | apl-*.js 2290/1210 | fences only |
| 33 | PGP | asciiarmor | asc pgp sig |  | @codemirror/legacy-modes/mode/asciiarmor | legacy stream | asciiarmor-*.js 777/422 | fences only |
| 34 | ASN.1 |  | asn asn1 |  | @codemirror/legacy-modes/mode/asn1 | legacy stream | asn1-*.js 3974/1932 | fences only |
| 35 | Asterisk |  |  | `/^extensions\.conf$/i` | @codemirror/legacy-modes/mode/asterisk | legacy stream | asterisk-*.js 4059/1763 | fences only |
| 36 | Brainfuck |  | b bf |  | @codemirror/legacy-modes/mode/brainfuck | legacy stream | brainfuck-*.js 599/340 | fences only |
| 37 | Cobol |  | cob cpy |  | @codemirror/legacy-modes/mode/cobol | legacy stream | cobol-*.js 6195/2931 | fences only |
| 38 | C# | csharp cs | cs |  | @codemirror/legacy-modes/mode/clike | legacy stream | clike-*.js 22054/7670 | fences only |
| 39 | Clojure |  | clj cljc cljx |  | @codemirror/legacy-modes/mode/clojure | legacy stream | clojure-*.js 9406/3980 | fences only |
| 40 | ClojureScript |  | cljs |  | @codemirror/legacy-modes/mode/clojure | legacy stream | clojure-*.js 9406/3980 | fences only |
| 41 | Closure Stylesheets (GSS) |  | gss |  | @codemirror/legacy-modes/mode/css | legacy stream | css-*.js 24664/8253 | fences only |
| 42 | CMake |  | cmake cmake.in | `/^CMakeLists\.txt$/` | @codemirror/legacy-modes/mode/cmake | legacy stream | cmake-*.js 757/471 | fences only |
| 43 | CoffeeScript | coffee coffee-script | coffee |  | @codemirror/legacy-modes/mode/coffeescript | legacy stream | coffeescript-*.js 3847/1700 | fences only |
| 44 | Common Lisp | lisp | cl lisp el |  | @codemirror/legacy-modes/mode/commonlisp | legacy stream | commonlisp-*.js 2314/1113 | fences only |
| 45 | Cypher |  | cyp cypher |  | @codemirror/legacy-modes/mode/cypher | legacy stream | cypher-*.js 3182/1507 | fences only |
| 46 | Cython |  | pyx pxd pxi |  | @codemirror/legacy-modes/mode/python | legacy stream | python-*.js 6272/2676 | fences only |
| 47 | Crystal |  | cr |  | @codemirror/legacy-modes/mode/crystal | legacy stream | crystal-*.js 5019/2091 | fences only |
| 48 | D |  | d |  | @codemirror/legacy-modes/mode/d | legacy stream | d-*.js 3691/1664 | fences only |
| 49 | Dart |  | dart |  | @codemirror/legacy-modes/mode/clike | legacy stream | clike-*.js 22054/7670 | fences only |
| 50 | diff |  | diff patch |  | @codemirror/legacy-modes/mode/diff | legacy stream | diff-*.js 302/250 | fences only |
| 51 | Dockerfile |  |  | `/^Dockerfile$/` | @codemirror/legacy-modes/mode/dockerfile | legacy stream | dockerfile-*.js 1906/676 | yes: Dockerfile (vault root only) |
| 52 | DTD |  | dtd |  | @codemirror/legacy-modes/mode/dtd | legacy stream | dtd-*.js 2092/881 | fences only |
| 53 | Dylan |  | dylan dyl intr |  | @codemirror/legacy-modes/mode/dylan | legacy stream | dylan-*.js 4043/1642 | fences only |
| 54 | EBNF |  |  |  | @codemirror/legacy-modes/mode/ebnf | legacy stream | ebnf-*.js 1979/814 | fences only |
| 55 | ECL |  | ecl |  | @codemirror/legacy-modes/mode/ecl | legacy stream | ecl-*.js 5110/2294 | fences only |
| 56 | edn |  | edn |  | @codemirror/legacy-modes/mode/clojure | legacy stream | clojure-*.js 9406/3980 | fences only |
| 57 | Eiffel |  | e |  | @codemirror/legacy-modes/mode/eiffel | legacy stream | eiffel-*.js 1692/924 | fences only |
| 58 | Elm |  | elm |  | @codemirror/legacy-modes/mode/elm | legacy stream | elm-*.js 1866/809 | fences only |
| 59 | Erlang |  | erl |  | @codemirror/legacy-modes/mode/erlang | legacy stream | erlang-*.js 7846/2879 | fences only |
| 60 | Esper |  |  |  | @codemirror/legacy-modes/mode/sql | legacy stream | sql-*.js 36836/10802 | fences only |
| 61 | Factor |  | factor |  | @codemirror/legacy-modes/mode/factor | legacy stream | factor-*.js 1669/628 | fences only |
| 62 | FCL |  |  |  | @codemirror/legacy-modes/mode/fcl | legacy stream | fcl-*.js 2029/961 | fences only |
| 63 | Forth |  | forth fth 4th |  | @codemirror/legacy-modes/mode/forth | legacy stream | forth-*.js 2539/1318 | fences only |
| 64 | Fortran |  | f for f77 f90 f95 |  | @codemirror/legacy-modes/mode/fortran | legacy stream | fortran-*.js 3862/1942 | fences only |
| 65 | F# | fsharp | fs |  | @codemirror/legacy-modes/mode/mllike | legacy stream | mllike-*.js 4823/1581 | fences only |
| 66 | Gas |  | s |  | @codemirror/legacy-modes/mode/gas | legacy stream | gas-*.js 4550/1288 | fences only |
| 67 | Gherkin |  | feature |  | @codemirror/legacy-modes/mode/gherkin | legacy stream | gherkin-*.js 10156/4979 | fences only |
| 68 | Groovy |  | groovy gradle | `/^Jenkinsfile$/` | @codemirror/legacy-modes/mode/groovy | legacy stream | groovy-*.js 4122/1757 | fences only |
| 69 | Haskell |  | hs |  | @codemirror/legacy-modes/mode/haskell | legacy stream | haskell-*.js 4159/1885 | fences only |
| 70 | Haxe |  | hx |  | @codemirror/legacy-modes/mode/haxe | legacy stream | haxe-*.js 7862/2913 | fences only |
| 71 | HXML |  | hxml |  | @codemirror/legacy-modes/mode/haxe | legacy stream | haxe-*.js 7862/2913 | fences only |
| 72 | HTTP |  |  |  | @codemirror/legacy-modes/mode/http | legacy stream | http-*.js 845/443 | fences only |
| 73 | IDL |  | pro |  | @codemirror/legacy-modes/mode/idl | legacy stream | idl-*.js 9826/4406 | fences only |
| 74 | JSON-LD | jsonld | jsonld |  | @codemirror/legacy-modes/mode/javascript | legacy stream | javascript-*.js 16963/5675 | fences only |
| 75 | Julia |  | jl |  | @codemirror/legacy-modes/mode/julia | legacy stream | julia-*.js 5263/2162 | fences only |
| 76 | Kotlin |  | kt kts |  | @codemirror/legacy-modes/mode/clike | legacy stream | clike-*.js 22054/7670 | fences only |
| 77 | LiveScript | ls | ls |  | @codemirror/legacy-modes/mode/livescript | legacy stream | livescript-*.js 4081/1635 | fences only |
| 78 | Lua |  | lua |  | @codemirror/legacy-modes/mode/lua | legacy stream | lua-*.js 3128/1407 | fences only |
| 79 | mIRC |  | mrc |  | @codemirror/legacy-modes/mode/mirc | legacy stream | mirc-*.js 5917/2671 | fences only |
| 80 | Mathematica |  | m nb wl wls |  | @codemirror/legacy-modes/mode/mathematica | legacy stream | mathematica-*.js 1899/823 | fences only |
| 81 | Modelica |  | mo |  | @codemirror/legacy-modes/mode/modelica | legacy stream | modelica-*.js 2795/1299 | fences only |
| 82 | MUMPS |  | mps |  | @codemirror/legacy-modes/mode/mumps | legacy stream | mumps-*.js 1822/963 | fences only |
| 83 | Mbox |  | mbox |  | @codemirror/legacy-modes/mode/mbox | legacy stream | mbox-*.js 1386/661 | fences only |
| 84 | Nginx |  |  | `/nginx.*\.conf$/i` | @codemirror/legacy-modes/mode/nginx | legacy stream | nginx-*.js 7407/2744 | fences only |
| 85 | NSIS |  | nsh nsi |  | @codemirror/legacy-modes/mode/nsis | legacy stream | nsis-*.js 7061/3054 | fences only |
| 86 | NTriples |  | nt nq |  | @codemirror/legacy-modes/mode/ntriples | legacy stream | ntriples-*.js 2067/739 | fences only |
| 87 | Objective-C | objc | m |  | @codemirror/legacy-modes/mode/clike | legacy stream | clike-*.js 22054/7670 | fences only |
| 88 | Objective-C++ | objc++ | mm |  | @codemirror/legacy-modes/mode/clike | legacy stream | clike-*.js 22054/7670 | fences only |
| 89 | OCaml |  | ml mli mll mly |  | @codemirror/legacy-modes/mode/mllike | legacy stream | mllike-*.js 4823/1581 | fences only |
| 90 | Octave |  | m |  | @codemirror/legacy-modes/mode/octave | legacy stream | octave-*.js 2101/1090 | fences only |
| 91 | Oz |  | oz |  | @codemirror/legacy-modes/mode/oz | legacy stream | oz-*.js 2881/1275 | fences only |
| 92 | Pascal |  | p pas |  | @codemirror/legacy-modes/mode/pascal | legacy stream | pascal-*.js 2256/1185 | fences only |
| 93 | Perl |  | pl pm |  | @codemirror/legacy-modes/mode/perl | legacy stream | perl-*.js 9733/3400 | fences only |
| 94 | Pig |  | pig |  | @codemirror/legacy-modes/mode/pig | legacy stream | pig-*.js 2513/1359 | fences only |
| 95 | PowerShell |  | ps1 psd1 psm1 |  | @codemirror/legacy-modes/mode/powershell | legacy stream | powershell-*.js 7694/3278 | fences only |
| 96 | Properties files | ini properties | properties ini in |  | @codemirror/legacy-modes/mode/properties | legacy stream | properties-*.js 664/363 | yes: .ini .properties |
| 97 | ProtoBuf |  | proto |  | @codemirror/legacy-modes/mode/protobuf | legacy stream | protobuf-*.js 802/524 | fences only |
| 98 | Pug | jade | pug jade |  | @codemirror/legacy-modes/mode/pug | legacy stream | pug-*.js 6646/1969 | fences only |
| 99 | Puppet |  | pp |  | @codemirror/legacy-modes/mode/puppet | legacy stream | puppet-*.js 2517/1201 | fences only |
| 100 | Q |  | q |  | @codemirror/legacy-modes/mode/q | legacy stream | q-*.js 3691/1683 | fences only |
| 101 | R | rscript | r R |  | @codemirror/legacy-modes/mode/r | legacy stream | r-*.js 2920/1358 | fences only |
| 102 | RPM Changes |  |  |  | @codemirror/legacy-modes/mode/rpm | legacy stream | rpm-*.js 1597/818 | fences only |
| 103 | RPM Spec |  | spec |  | @codemirror/legacy-modes/mode/rpm | legacy stream | rpm-*.js 1597/818 | fences only |
| 104 | Ruby | jruby macruby rake rb rbx | rb | `/^(Gemfile\|Rakefile)$/` | @codemirror/legacy-modes/mode/ruby | legacy stream | ruby-*.js 5077/2147 | fences only |
| 105 | SAS |  | sas |  | @codemirror/legacy-modes/mode/sas | legacy stream | sas-*.js 9331/4083 | fences only |
| 106 | Scala |  | scala |  | @codemirror/legacy-modes/mode/clike | legacy stream | clike-*.js 22054/7670 | fences only |
| 107 | Scheme |  | scm ss |  | @codemirror/legacy-modes/mode/scheme | legacy stream | scheme-*.js 6357/2386 | fences only |
| 108 | Shell | bash sh zsh | sh ksh bash | `/^PKGBUILD$/` | @codemirror/legacy-modes/mode/shell | legacy stream | shell-*.js 2434/1204 | yes: .sh .bash |
| 109 | Sieve |  | siv sieve |  | @codemirror/legacy-modes/mode/sieve | legacy stream | sieve-*.js 1613/787 | fences only |
| 110 | Smalltalk |  | st |  | @codemirror/legacy-modes/mode/smalltalk | legacy stream | smalltalk-*.js 1996/871 | fences only |
| 111 | Solr |  |  |  | @codemirror/legacy-modes/mode/solr | legacy stream | solr-*.js 861/467 | fences only |
| 112 | SML |  | sml sig fun smackspec |  | @codemirror/legacy-modes/mode/mllike | legacy stream | mllike-*.js 4823/1581 | fences only |
| 113 | SPARQL | sparul | rq sparql |  | @codemirror/legacy-modes/mode/sparql | legacy stream | sparql-*.js 3331/1605 | fences only |
| 114 | Spreadsheet | excel formula |  |  | @codemirror/legacy-modes/mode/spreadsheet | legacy stream | spreadsheet-*.js 1135/558 | fences only |
| 115 | Squirrel |  | nut |  | @codemirror/legacy-modes/mode/clike | legacy stream | clike-*.js 22054/7670 | fences only |
| 116 | Stylus |  | styl |  | @codemirror/legacy-modes/mode/stylus | legacy stream | stylus-*.js 23515/8516 | fences only |
| 117 | Swift |  | swift |  | @codemirror/legacy-modes/mode/swift | legacy stream | swift-*.js 3762/1820 | yes: .swift |
| 118 | sTeX |  |  |  | @codemirror/legacy-modes/mode/stex | legacy stream | stex-*.js 3092/1190 | fences only |
| 119 | LaTeX | tex | text ltx tex |  | @codemirror/legacy-modes/mode/stex | legacy stream | stex-*.js 3092/1190 | yes: .text |
| 120 | SystemVerilog |  | v sv svh |  | @codemirror/legacy-modes/mode/verilog | legacy stream | verilog-*.js 8182/3436 | fences only |
| 121 | Tcl |  | tcl |  | @codemirror/legacy-modes/mode/tcl | legacy stream | tcl-*.js 2353/1227 | fences only |
| 122 | Textile |  | textile |  | @codemirror/legacy-modes/mode/textile | legacy stream | textile-*.js 6745/2446 | fences only |
| 123 | TiddlyWiki |  |  |  | @codemirror/legacy-modes/mode/tiddlywiki | legacy stream | tiddlywiki-*.js 2760/1090 | fences only |
| 124 | Tiki wiki |  |  |  | @codemirror/legacy-modes/mode/tiki | legacy stream | tiki-*.js 3223/1273 | fences only |
| 125 | TOML |  | toml |  | @codemirror/legacy-modes/mode/toml | legacy stream | toml-*.js 1045/544 | yes: .toml |
| 126 | Troff |  | 1 2 3 4 5 6 7 8 9 |  | @codemirror/legacy-modes/mode/troff | legacy stream | troff-*.js 957/454 | fences only |
| 127 | TTCN |  | ttcn ttcn3 ttcnpp |  | @codemirror/legacy-modes/mode/ttcn | legacy stream | ttcn-*.js 4842/2135 | fences only |
| 128 | TTCN_CFG |  | cfg |  | @codemirror/legacy-modes/mode/ttcn-cfg | legacy stream | ttcn-cfg-*.js 4096/1730 | yes: .cfg |
| 129 | Turtle |  | ttl |  | @codemirror/legacy-modes/mode/turtle | legacy stream | turtle-*.js 1955/905 | fences only |
| 130 | Web IDL |  | webidl |  | @codemirror/legacy-modes/mode/webidl | legacy stream | webidl-*.js 2449/1246 | fences only |
| 131 | VB.NET |  | vb |  | @codemirror/legacy-modes/mode/vb | legacy stream | vb-*.js 3650/1791 | fences only |
| 132 | VBScript |  | vbs |  | @codemirror/legacy-modes/mode/vbscript | legacy stream | vbscript-*.js 5431/2535 | fences only |
| 133 | Velocity |  | vtl |  | @codemirror/legacy-modes/mode/velocity | legacy stream | velocity-*.js 2703/1124 | fences only |
| 134 | Verilog |  | v |  | @codemirror/legacy-modes/mode/verilog | legacy stream | verilog-*.js 8182/3436 | fences only |
| 135 | VHDL |  | vhd vhdl |  | @codemirror/legacy-modes/mode/vhdl | legacy stream | vhdl-*.js 3315/1511 | fences only |
| 136 | XQuery |  | xy xquery xq xqm xqy |  | @codemirror/legacy-modes/mode/xquery | legacy stream | xquery-*.js 6159/2557 | fences only |
| 137 | Yacas |  | ys |  | @codemirror/legacy-modes/mode/yacas | legacy stream | yacas-*.js 2141/1099 | fences only |
| 138 | Z80 |  | z80 |  | @codemirror/legacy-modes/mode/z80 | legacy stream | z80-*.js 1756/804 | fences only |
| 139 | MscGen |  | mscgen mscin msc |  | @codemirror/legacy-modes/mode/mscgen | legacy stream | mscgen-*.js 3499/981 | fences only |
| 140 | Xù |  | xu |  | @codemirror/legacy-modes/mode/mscgen | legacy stream | mscgen-*.js 3499/981 | fences only |
| 141 | MsGenny |  | msgenny |  | @codemirror/legacy-modes/mode/mscgen | legacy stream | mscgen-*.js 3499/981 | fences only |
| 142 | Vue |  | vue |  | @codemirror/lang-vue → vue() | Lezer | dist-*.js 3263/1666 | fences only |
| 143 | Angular Template |  |  |  | @codemirror/lang-angular → angular() | Lezer | dist-*.js 4869/2289 | fences only |

### 2.1 Reachability summary (verified)

- Reachable through a listed file today: **19 of 143 entries** — Markdown (static, not via the table), CSS, HTML, JavaScript, JSX, TypeScript, TSX, JSON, YAML, XML, Python, Rust (Lezer); TOML, Shell, Properties, Swift, Dockerfile (vault root only), plus the two accidental ones LaTeX (`.text`) and TTCN_CFG (`.cfg`) (legacy).
- Reachable only from a Markdown fence: **124 entries** (every other row above).
- Listed by the tree but with **no grammar**: `txt csv tsv log env conf zsh`, `LICENSE`, `Makefile`, `Dockerfile` below the root, and any upper-case extension.
- Not listed by the tree at all (hidden by `isSupported`) although a grammar and chunk exist and a Markdown fence already uses it: every extension in the table that is not in `CREATABLE_EXTENSIONS` — the table names 224 distinct extensions, **195 of which the tree hides** — e.g. `c h cpp go java php sql rb kt cs lua pl r jl hs scala dart diff patch tex proto ps1 vue`. Opening such a file is a one-line change in the UI list plus its Rust mirror; nothing new is downloaded or bundled.

---

## 3. The JS bundle as built today (measured)

Build: `cd apps/desktop/ui && pnpm build` (Vite 8.3.0 / rolldown, `target: "safari17"`, `sourcemap: false`, no `manualChunks` — `vite.config.ts:39-43`). Result: **241 files in `dist/assets`** (231 `.js`, 1 `.mjs`, 6 `.css`, 3 `.woff2`), **8,995,627 B raw (8.6 MiB) / 2,831,678 B gzip** in total. Sizes below are raw bytes / `gzip -c f | wc -c` bytes unless marked "(zlib)" for the numbers the gate itself prints. Package attribution comes from a second build with `--sourcemap --outDir <scratchpad>` (identical chunk names and hashes; verified by `diff` of the file lists) and a VLQ decode of each `.map` (scripts `attrib.mjs`, `persource.mjs`, `classify.mjs` in the scratchpad).

### 3.1 The gate — `node scripts/bundle-budget.mjs` (verified)

The script (`scripts/bundle-budget.mjs`) runs standalone from the repo root once `dist/index.html` exists; it counts `<script type=module src>`, `<link rel=modulepreload>` (gzip via zlib) and `<link rel=stylesheet>` (raw) in `dist/index.html`, plus every font file under `dist` (raw), against four keys of `docs/BUDGET.json`. Output today:

```
  ok    eager JS (gzip)                     111.0 kB /  250 kB  6 file(s)
  ok    largest eager JS chunk (gzip)        83.1 kB /  120 kB  /assets/index-CBQUn-KX.js
  ok    eager CSS (raw)                      20.3 kB /   24 kB  1 file(s)
  ok    fonts (raw)                         120.3 kB /  250 kB  3 file(s)
bundle-budget: within budget
```

Headroom: **139 kB gzip of eager JS, 37 kB for the largest chunk, 3.7 kB of eager CSS**, 130 kB of fonts. The CSS row is the tight one: any global stylesheet for code (e.g. a `.cm-*` rule file) would eat into 3.7 kB; `EditorView.theme` styles are injected by `style-mod` at runtime and are not counted.

### 3.2 Eager payload (the six preloads + one stylesheet in `dist/index.html`)

| File | raw B | gzip B | Contents (sourcemap) |
|---|---:|---:|---|
| `index-*.js` | 280,525 | 85,206 (zlib 83.1 kB) | react-dom 206,975 B, @tanstack/virtual-core 23,350 B, `lib/commands.ts` 7,008 B, `App.tsx` 6,605 B, `Sidebar.tsx` 5,961 B, react-i18next, `lib/keymap.ts`, scheduler, stores, small components |
| `jsx-runtime-*.js` | 74,508 | 24,149 | i18next 43,024 B, `ipc/client.ts` 13,936 B, react 8,318 B, @tauri-apps/api, `stores/ui.ts`, zustand |
| `editorSave-*.js` | 6,350 | 2,264 | `stores/editorSave.ts`, `stores/vault.ts` |
| `fileTypes-*.js` | 1,448 | 741 | `lib/fileTypes.ts`, `lib/paths.ts` |
| `preload-helper-*.js` | 1,218 | 718 | Vite preload helper |
| `rolldown-runtime-*.js` | 1,106 | 658 | module runtime |
| `index-*.css` | 20,795 | 4,268 | `app.css`, `fonts.css`, tokens |

**No CodeMirror code and no `language-data` code is eager.** `grep -c "TiddlyWiki\|legacy-modes" index-*.js` = 0; the table lives only in `Editor-*.js`.

### 3.3 The editor's own chunks (loaded on the first text tab)

| Chunk | raw B | gzip B | Contents |
|---|---:|---:|---|
| `dist-2M_5OPkG.js` (CodeMirror core) | 323,911 | 103,377 | @codemirror/view 181,863 B, state 46,845 B, language 26,957 B, @lezer/common 27,430 B, @lezer/lr 27,132 B, @lezer/highlight 7,053 B, style-mod, w3c-keyname, crelt, find-cluster-break |
| `Editor-*.js` | 273,827 | 98,388 | **@lezer/javascript 77,722 B (30.6 kB gz alone)**, @lezer/markdown 35,477 B (11.8 kB gz), @codemirror/commands 22,886 B, @codemirror/search 20,036 B, **@codemirror/language-data table 18,023 B minified (4.1 kB gz alone; 32,830 B in source)**, @lezer/css 17,125 B (8.0 kB gz), @lezer/html 14,311 B (6.2 kB gz), lang-html 13,877 B, @lezer/yaml 10,742 B (4.8 kB gz), lang-css 9,480 B, lang-markdown 8,158 B, lang-javascript 6,269 B, lang-yaml 1,887 B, and the app's `editor/*.ts` (theme 4,326 B, decorations 2,871 B, setup 2,302 B, commands 2,087 B, Editor.tsx 1,107 B, attachments, markdownExt, headingCompletion) |
| `dist-C-ObFgty.js` (@codemirror/autocomplete) | 35,031 | 12,250 | statically imported by Editor and by the go/python/sql grammar chunks |

So the first note costs **~633 kB raw / ~214 kB gzip** of JS beyond the eager payload (core + Editor + autocomplete). The JavaScript, CSS, HTML, YAML and Markdown grammars are **not** lazy: `@codemirror/lang-markdown` statically imports `@codemirror/lang-html` (`lang-markdown/dist/index.js:6`), which statically imports `lang-css` and `lang-javascript` (`lang-html/dist/index.js:2-3`) — that is the 30 kB gzip of `@lezer/javascript` in the Editor chunk, paid by every Markdown note whether or not it contains a fence. This is inherent to `lang-markdown` (HTML-in-Markdown support), not a novalis choice. Inferred, not measured: parse time of these grammars is zero until a node needs them, so the cost is download/parse of the chunk, not runtime.

### 3.4 Per-language lazy chunks (one per `load()` target, verified)

Rolldown emits **one chunk per dynamically imported module**: 16 Lezer chunks (one per `@codemirror/lang-*` not already in the Editor chunk; the seven SQL dialects share `lang-sql`) and 95 legacy chunks (94 `mode/*.js` files plus `simple-mode.js`, a helper used by the Dockerfile/Factor/NSIS modes). `Editor-*.js` contains 115 distinct ``import(`./…`)`` sites for them. Totals:

| Group | files | raw B | gzip B |
|---|---:|---:|---:|
| Lezer grammar chunks | 16 | 528,394 | 194,121 |
| legacy stream mode chunks | 95 | 457,058 | ~184,300 (zlib) |
| **all lazy grammars** | **111** | **985,452 (962 kB)** | **~378 kB** |

Lezer chunks (raw / gzip B): cpp 103,865 / 33,286 (`dist-CCt7mAgr`; C and C++) · php 98,107 / 28,059 · rust 70,755 / 25,067 · python 44,542 / 18,517 · java 40,677 / 16,152 · sql 32,111 / 12,855 (all seven dialects) · go 30,688 / 12,286 · sass 22,929 / 9,958 (Sass + SCSS) · liquid 20,919 / 9,374 · jinja 20,655 / 9,017 · less 16,204 / 7,204 · xml 14,274 / 5,693 · angular 4,869 / 2,289 · vue 3,263 / 1,666 · wast 2,577 / 1,457 · json 1,959 / 1,241.

Legacy chunks range from `diff` (302 / 250) to `sql` (36,836 / 10,802), `css` (24,664 / 8,253), `stylus` (23,515 / 8,516), `clike` (22,054 / 7,670 — C#, Dart, Kotlin, Objective-C, Scala, Squirrel share it), `javascript` (16,963 / 5,675 — JSON-LD only). The per-row sizes are in the table in §2.

Note on the rust chunk: a `.rs` file today downloads `dist-CFP561px.js` (25 kB gz) on first open; `.py` 18.5 kB; `.json` 1.2 kB; `.toml` 0.5 kB; `.swift` 1.8 kB; `.sh` 1.2 kB. Every grammar chunk also statically imports the CodeMirror core chunk (`grep -l 'from"./dist-2M_5OPkG.js"'` lists all 16 Lezer chunks and the autocomplete chunk; legacy mode chunks are plain objects with no imports, except `dockerfile`, `factor` and `nsis`, which import `simple-mode-*.js`, and `pug`, which imports the legacy `javascript-*.js`).

### 3.5 mermaid and pdf.js (verified)

| Group | files | raw B | gzip B | Entry chunk |
|---|---:|---:|---:|---|
| mermaid 12.0.0 + its dependency graph | 103 | 5,111,245 (4.9 MiB) | ~1,477,700 (zlib) | `mermaid.core-*.js` 84,065 / 28,655, loaded by `Preview.tsx:79` on the first ` ```mermaid ` fence |
| pdfjs-dist 6.3.289 | 2 | 1,698,242 (1.6 MiB) | ~504,600 (zlib) | `PdfViewer-*.js` 432,829 / 128,242 (`Viewer.tsx:17` lazy) + `pdf.worker.min-*.mjs` 1,265,413 / 374,803 (`PdfViewer.tsx:2`, `?url` asset) |

The largest single files in `dist` are all mermaid's: `elk-*.js` 1,456,417 / 446,560 (elkjs layout), `chunk-FOHPRMQF-*.js` 662,109 / 141,726 (@mermaid-js/parser), `cytoscape.esm-*.js` 434,855 / 136,346, `katex-*.js` 258,685 / 76,380, `usecaseDiagram-*.js` 186,675 / 49,616, `architectureDiagram-*.js` 148,909 / 40,754. None is eager; all sit in the app bundle on disk. For the `dmgMb: 12` row of `docs/BUDGET.json` (not measured here) mermaid is ~57 % of `dist` by raw bytes, pdf.js ~19 %, all 111 grammar chunks ~11 %, CodeMirror core + Editor ~7 %, the app itself ~4 %.

### 3.6 Everything else lazy

`de-*.js` 14,585 / 4,619 (the German catalog), `Preview-*.js` 8,012 / ~3,400 + `Preview-*.css` 4,050, `BoardPane-*.js` 8,560 / ~2,400 + `.css` 5,558, `Palette-*.js` 3,804 + `overlay-*.css` 2,746, `SearchPanel-*.js` 3,472, `Backlinks-*.js` 2,120 + `.css` 1,643, `Viewer-*.js` 1,546 + `.css` 2,657. Fonts: `inter-latin-wght-normal` 48,256, `inter-latin-wght-italic` 51,832, `geist-mono-latin-wght-normal` 23,128 (`styles/fonts.css`, Latin subsets only).

---

## 4. `theme.ts` — which `@lezer/highlight` tags are styled (verified)

`editor/theme.ts:109-144`, `markdownHighlight = HighlightStyle.define([...])`, applied to every file via `Editor.tsx:81` with **no `fallback`**. A rule on a parent tag also styles its sub-tags (`Tag.define(parent)` puts the parent in the tag's `set`; `@lezer/highlight/dist/index.js:454` defines the hierarchy). Colours are all `--ds-color-syntax-*` tokens from `packages/tokens/tokens.css:81-93` (light) and `140-151` (dark) — twelve semantic tokens: `marker heading link tag code quote keyword string comment number type invalid` — plus `--ds-color-fg-default` / `fg-muted` and the accent fill/line for the tag chip. No colour is hard-coded in `theme.ts`.

**Styled** (rule → what it covers):

| Rule (theme.ts line) | Token | Also covers via hierarchy |
|---|---|---|
| `t.processingInstruction` (111) | syntax-marker | — (Markdown marks; `WikiLinkMark`) |
| `t.heading` (112) | syntax-heading, weight 500 | heading1–6 |
| `t.strong` (113), `t.emphasis` (114), `t.strikethrough` (115) | weight / italic / line-through | — |
| `t.link` (116), `t.url` (117) | syntax-link | `WikiLink` node (markdownExt.ts:23) |
| `t.labelName` (119) | syntax-tag chip (accent fill/line, mono, 0.86em) | `TagRef` (markdownExt.ts:55) — **and every grammar node styled `labelName`**, see the caveat below |
| `t.monospace` (129) | syntax-code, mono font | inline code |
| `t.quote` (134), `t.list` (135) | syntax-quote / fg-default | — |
| `t.keyword` (137) | syntax-keyword | `self null atom unit modifier operatorKeyword controlKeyword definitionKeyword moduleKeyword` |
| `t.string`, `t.special(t.string)` (138) | syntax-string | `docString character attributeValue` |
| `t.comment` + line/block (139) | syntax-comment | `docComment` |
| `t.number`, `t.bool`, `t.null` (140) | syntax-number | `integer float` |
| `t.typeName`, `t.className`, `t.definition(t.variableName)` (141) | syntax-type | `tagName` (HTML/XML tag names) |
| `t.propertyName`, `t.attributeName` (142) | fg-muted | `definition(propertyName)` |
| `t.invalid` (143) | syntax-invalid | — |

**Not styled at all** (render in `--ds-color-fg-default`, i.e. plain text): `t.variableName` (every plain identifier), `t.name`, `t.namespace`, `t.macroName`, `t.function(t.variableName)` / `t.function(t.propertyName)` (function names and calls — the most visible gap in JS/TS/Python/Rust), `t.local(...)`, `t.constant(...)`, `t.standard(...)`, `t.special(t.variableName)`, `t.operator` and all ten operator sub-tags, `t.punctuation`, `t.bracket`/`paren`/`brace`/`squareBracket`/`angleBracket`, `t.separator`, `t.meta`, `t.documentMeta`, `t.annotation` (decorators/attributes such as `@Override`, `#[derive]`), `t.literal` generic, `t.regexp`, `t.escape`, `t.color`, `t.inserted`/`t.deleted`/`t.changed` (the `diff` mode would show nothing), `t.contentSeparator`, `t.character` only via string. For comparison, `classHighlighter` in `@lezer/highlight` (dist/index.js:895-924) covers 30 rules including `variableName`, `function`, `operator`, `meta`, `punctuation`, `namespace`, `macroName`, `regexp/escape`, `inserted/deleted`.

Caveat on `t.labelName` (verified by grepping the installed grammars' `styleTags`): the tag-chip rule is tag-wide, so these nodes are drawn today as a filled, bordered, monospace chip inside code: CSS `IdName` (`#main` selectors) and `KeyframeName` (`@lezer/css`), YAML `Anchor`/`Alias` (`&x`, `*x`, `@lezer/yaml` — this includes frontmatter in notes), Rust `LoopLabel` (`'outer:`), C/C++ `StatementIdentifier` (goto labels) and `PartitionName`, JavaScript/Java `Label`, Go `LabelName`, PHP `LabelStatement/Name`. `.css`, `.yaml` and `.rs` are listed extensions today, so the chip is already reachable. No legacy stream mode uses `labelName` (grep over `legacy-modes/mode/*.js` finds none).

Net: a non-Markdown grammar today gets keywords, strings, comments, numbers, types and property names coloured; identifiers, function names, operators, punctuation, decorators and regexps are plain — roughly half of what a stock CodeMirror theme distinguishes — in a proportional font (§1.7).

---

## 5. Large files (verified)

- The threshold is decided by the **shell**, from the byte size the core reports: `apps/desktop/src-tauri/src/dto.rs:19-21` `PLAIN_MODE_BYTES = 5 * 1024 * 1024`, `HUGE_FILE_BYTES = 50 * 1024 * 1024` (MiB, the docs say "MB"); `FileDto::new` (dto.rs:339-350) sets `plain_mode: size >= PLAIN_MODE_BYTES`, `huge: size >= HUGE_FILE_BYTES`. The whole file is still read (`crates/novalis-core/src/vault/fs.rs:187-199`, `String::from_utf8` or lossy) and sent as one JSON string through IPC; there is no cap on text reads (only `read_blob` refuses above `HUGE_FILE_BYTES`, `commands.rs:348-366`).
- `stores/editorSave.ts:97-116` copies `plainMode` into the `Doc` and picks **one** banner: `notUtf8` > `hugeFile` > `plainMode` (`i18n/en.json:22,27`: "Larger than 50 MB: editing may be slow." / "Larger than 5 MB: opened in plain mode without Markdown styling or syntax highlighting."). `StatusBar.tsx:33` adds a "Plain" item.
- `setup.ts:196`: plain mode returns the base extensions before `closeBrackets`, the language and the Markdown extras. **CodeMirror is still used** — `Editor.tsx:77-83` always constructs an `EditorView`, and `editorTheme` + `syntaxHighlighting(markdownHighlight)` are still attached (no language → nothing to highlight). Still active in plain mode: history, multi-cursor, active-line, selection-match highlighting (`highlightSelectionMatches` works on the visible viewport per the CM6 docs — inferred, not measured here), search, line wrapping (for `.md`/`.txt`), line numbers (for code), spellcheck attribute. Above 50 MiB nothing else changes except the banner text; there is no refusal and no read-only switch.
- Budgets (`docs/BUDGET.json:21-24`): `openNote100KbP95Ms 16`, `openNote1MbMs 60`, `openNote5MbPlainMs 500`, `openNote50MbPlainMs 2000` ("Summed RSS must stay under idleRssMb [200] with the 50 MB file open", note line 41: "a 50 MB file is ~100 MB as a UTF-16 JS string"). None of the four is measured by any tooling: `crates/novalis-core/examples/perf.rs:40-43` lists them under "needs the shell", and `.github/workflows/perf.yml:11` says the app-side rows are not covered. So the plain-mode thresholds are asserted, not verified — and inferred from the code path, a 50 MiB read means: 50 MiB `Vec<u8>` → `String` → JSON serialisation → WKWebView JS string (~100 MiB UTF-16) → CM6 `Text` rope (another copy) → `editorSave.docs[path].text` mirror on every keystroke (`setup.ts:178-180` calls `update.state.doc.toString()` on **every** doc change, which materialises the whole document as a string per keystroke; at 5–50 MiB that is the likelier keystroke-latency problem than highlighting).

---

## 6. Other facts relevant to "many more formats while staying lean"

1. **`@codemirror/legacy-modes` and all `@codemirror/lang-*` except `lang-markdown` and `lang-yaml` are transitive** — `apps/desktop/ui/package.json:15-37` lists only `autocomplete commands lang-markdown lang-yaml language language-data search state view` plus `@lezer/highlight` and `@lezer/markdown`. `language-data/package.json` pulls in 21 `lang-*` packages, `legacy-modes ^6.4.0` and (through `lang-liquid`/`lang-html`) `@codemirror/lint`. `pnpm-lock.yaml:244-331` has all of them. Consequence for the minimalism gate (`scripts/lockfile-adr-check.mjs`, top-level = direct dependency of a workspace importer): enabling more extensions needs **no new package and no ADR**, only the UI list, its Rust mirror, `PLAN.md §7.3` and `docs/decisions`. Importing `@codemirror/legacy-modes/mode/*` directly from `setup.ts` (to fix `.zsh`, or `Dockerfile` in subfolders) would also add no lock entry, but it would make `legacy-modes` a direct dependency in `package.json`, which the lockfile check counts as new — an ADR would then be needed.
2. **One chunk per grammar is automatic**: `language-data`'s `load()` functions are literal `import('@codemirror/lang-x')` / `import('@codemirror/legacy-modes/mode/x')` calls; rolldown splits each into its own file and rewrites them to `import(\`./x-hash.js\`)` with a `__vite__mapDeps` preload list (the Editor chunk's header lists `dist-sXS6jeTC` … `dist-BzF6hQHu` as the shared preload set). Nothing in `vite.config.ts` steers this; there is no `manualChunks`, and none is needed.
3. **Every grammar chunk already ships** because `codeLanguages: languages` (setup.ts:84) makes all 143 entries reachable from a Markdown fence. Widening the file list therefore changes neither `dist` size nor the eager budget; the only new cost is what §1.7 and §4 show — the editor is not yet dressed for code.
4. **The table itself costs 18 KB raw / ~4 KB gzip in the Editor chunk** (measured, §3.3). Replacing it with a hand-written subset would save at most that, and would lose fence highlighting for the dropped languages; it is not where the weight is.
5. **What pins the extension list today**: `lib/fileTypes.test.ts:6-13` (eight positive, six negative paths — `song.wav clip.mp4 book.epub archive.zip README x.docx` must stay hidden; `README` is a notable negative: an extensionless `README` is *not* listed while `LICENSE` is), `stores/vault.test.ts:112-117` (tree rows), `commands.rs:1163-1179` (`creatable_name`), `Sidebar.test.tsx` (no extension assertions). No test asserts parity between `fileTypes.ts` and `commands.rs`, and no test asserts which extensions get a grammar, which is why `.text → LaTeX`, `.cfg → TTCN_CFG`, `.zsh → nothing` and `sub/Dockerfile → nothing` have gone unnoticed.
6. **Case handling is split**: `extensionOf` lower-cases for the filter and for `typeOptions`, but `matchFilename` receives the raw path (§1.4). A one-line fix would pass `path.toLowerCase()` (or `fileNameOf(path)`) to `matchFilename`; note that would also make the `filename` regexes match by file name rather than full path (fixing `sub/Dockerfile`, `CMakeLists.txt`, `Jenkinsfile`, `Gemfile`, `PKGBUILD`, `BUILD`) — but lower-casing would break the anchored, case-sensitive `/^Dockerfile$/`, so it has to be the file name, not the lower-cased path.
7. **Comment toggling** (`editor/commands.ts:119`, `Cmd-/`) relies on each grammar's `commentTokens` language data; Lezer packages define it, legacy stream modes mostly do too (inferred from `@codemirror/legacy-modes` conventions, not checked per mode).
8. **The preview does not highlight code**: `crates/novalis-core/src/notes/render.rs` emits `<pre><code class="language-x">` (test at line 137-139); `Preview.tsx` only turns `language-mermaid` fences into diagrams (line 284). `preview.css:133-152` styles `code` in `--ds-color-syntax-code` with no per-token colours. A "viewer" story for code would need either the CM6 highlighter on the fragment (`highlightTree` from `@lezer/highlight`, already in the core chunk) or nothing.
9. **Fonts**: the only mono face is Geist Mono Latin (23 KB); the editor uses it for the gutter, inline code and the tag chip only (`theme.ts:45,125,130`).
10. **A `.markdown` file** gets the full Markdown editor (setup.ts:78) but is not a note anywhere else (§1.6): no quick-open, search, backlinks, preview or paste-image.

### Open questions I could not settle from the repository

- Whether the owner considers `.text → LaTeX` and `.cfg → TTCN_CFG` bugs (they are upstream extension claims) — they only matter once code highlighting is visible enough to notice.
- Actual open-time and keystroke numbers for 5 and 50 MiB files: no harness exists (§5).
