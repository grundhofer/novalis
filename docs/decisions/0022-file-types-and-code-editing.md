# 22. File types: novalis opens what it lists, and lists what it can open

Date: 2026-09-20

## Status

Accepted; built in phases (docs/research/2026-09-20-formats-plan.md §6:
F7, F1, F2, F3b need no decision and go first; F4, F3a, F5, F6 build the
rows below). Amends PLAN.md §7.3 ("Stop there"), §4.2 (editor defaults for
code), §4.3 (indentation guides) and ADR-0015 §3 (the list the tree
shows); amends ADR-0017 and ADR-0020 for `.markdown`, and ADR-0007's font
row (Geist Mono in the editor for the code presets, point 4). No new dependency,
no new setting, no new chord, no new menu item; the IPC count stays 27.

## Context

The editor already ships every grammar `@codemirror/language-data` knows —
143 of them, 111 lazy chunks in `dist` — because a Markdown code fence can
reach any of them, yet the tree lists 36 extensions and hides 195 of the
224 the table names. Two hand-mirrored lists (`apps/desktop/ui/src/lib/
fileTypes.ts`, `src-tauri/src/commands.rs`) decide that without a parity
test; the grammar lookup runs `matchFilename` on the raw path, so `.text`
opens as LaTeX, `.cfg` as TTCN-3, `.zsh` and a `Dockerfile` in a subfolder
get nothing, and `X.JSON` no grammar; code files render in the prose face
inside a 72-character measure with spellcheck on; and quick-open, vault
search, the ⌘E preview and image paste are `.md`-only. On the way the
analysis measured that `doc.toString()` plus the word count run on every
keystroke: 3–5 ms in a 1 MB file, 18–30 ms at 5 MB, against the 8/16 ms
budget of PLAN.md §11.3. The owner asked on 2026-09-19:

> mache bitte einen plan möglichst viele formate zu unterstützen (auch
> syntax highlighting etc) und trotzdem recht schlank und performant zu
> bleiben. die nutzer sollen novalis nicht nur zur organisation ihrer
> notizen sondern auch als texteditor/anzeiger verstehen.

The plan (docs/research/2026-09-20-formats-plan.md) put eight bundled
questions with a recommendation each; asked "Alle Empfehlungen übernehmen /
Nur die ADR-freien Phasen jetzt / Ich antworte einzeln", the owner chose:

> Alle Empfehlungen übernehmen (Recommended)

## Decision

1. **One allow-list, generated.** The shell owns the table of what novalis
   lists and opens — `src-tauri/src/file_types.rs`, rows of
   `{ext | name | pattern, kind: note | text | view}` — and the bindings
   export writes it to `ui/src/lib/fileTypes.generated.ts` next to
   `bindings.ts`; CI diffs both. How a kind is drawn (preset, grammar name,
   MIME) stays a hand-written TS module whose key set a test compares with
   the generated one. `creatable_name` (ADR-0014) reads the same table.
2. **The list widens** to the table in the plan's §3.1: ≈93 extensions and
   ≈21 extensionless names, all with a grammar already in the bundle or
   deliberately plain — C/C++/C#, Go, Java/Kotlin/Scala, Ruby, PHP, Perl,
   Lua, R, Julia, Haskell, OCaml, Clojure, Lisp, Scheme, Erlang, Elm, Dart,
   SQL, ProtoBuf, LaTeX, diff, SCSS/Sass/LESS, Vue, PowerShell, Tcl,
   `json5 jsonc`, `xsl xsd plist`, `dockerfile`/`Dockerfile.*`/
   `Containerfile`, `cmake` + `CMakeLists.txt`, `Makefile`/`GNUmakefile`/
   `mk`, `Justfile`, `Gemfile Rakefile Jenkinsfile`, the doc names `README
   CHANGELOG CONTRIBUTING AUTHORS NOTICE COPYING VERSION TODO CODEOWNERS`,
   and the prose bundle `rst adoc org textile mkd mdx rmd qmd srt vtt`.
   `.map` (source maps) leaves the list. Not added, until someone asks:
   template dialects (`hbs j2 jinja liquid`), `m`, Fortran/SAS, RDF/SPARQL,
   Verilog/VHDL, `bat cmd`, variant spellings (`c++ phtml ksh PKGBUILD`),
   grammar-less `graphql hcl tf nix zig`, single-letter and numeric
   extensions, lock files, secrets, archives, audio and video (ADR-0015:
   "keine wav, mp4 etc").
3. **Grammar by table name, never by path.** `languageFor` resolves the
   row's grammar name with `matchLanguageName(…, false)`; a short pattern
   list (`Dockerfile(\..+)?`, `Containerfile`, `*nginx*.conf`,
   `CMakeLists.txt`, `Jenkinsfile`, `Gemfile|Rakefile`) runs before the
   extension. Indentation is a string per preset (`"\t"` for Makefile, Go,
   Justfile) overridden by a per-file detector over the first 200 lines —
   the "indentation detected per file" PLAN.md §4.2 promised and nothing
   built.
4. **Four editor presets from the table**: `prose` (wrap, no numbers,
   Inter, spellcheck) for Markdown, text and the prose bundle; `data`,
   `code2`, `code4`, `codeT` (Geist Mono, full width instead of the 72 ch
   measure, line numbers, no spellcheck, indentation guides, indent 2 / 4 /
   tab). The `#tag` chip becomes a tag of its own so no grammar node can
   trigger it; nine highlight rules land on the twelve existing
   `--ds-color-syntax-*` tokens (function names by weight, operators and
   punctuation as markers, meta/annotation as keyword, namespace as type,
   regexp/escape as string, inserted/deleted/changed for diffs); no new
   colour token. The Markdown decorations, completion, ⌘B/⌘I/⌘K/⌘Enter,
   attachments and Cmd-click stay Markdown-only.
5. **A note is `.md`; everything listed is a file.** Quick-open lists every
   listed file (extension in the label for non-`.md`) and the boards —
   `list_notes` becomes `list_files`, the count stays 27. Vault search gets
   a third toggle "All files" beside Match Case and Regex, session-only
   (state like the sort legend, ADR-0012, not a setting); the UI keeps only
   hits the tree would list and the footer names the skipped rest. The CLI
   gains `search --all-files` (unfiltered by design — agents want
   everything) and `notUtf8Skipped` in the search JSON, both add-only under
   PLAN.md §9.1. Cache, links, backlinks, `[[` completion, relink, Today,
   `ls/cat/edit/meta/mv/rm/links/tags/new` and `doctor` counts stay `.md`.
   `Todo.MD` stays as it is (UI case-insensitive, core not) and is written
   down in the F1 pull request.
6. **`.markdown` gets ⌘E and image paste** like `.md` (ADR-0017's
   "attachments/ next to the note" reads "next to the file"); it stays a
   file, not a note.
7. **Binary verdict on open, 0 IPC.** The read the shell already does gains
   an 8 KiB head check — BOM first (UTF-16 keeps the "not UTF-8" banner
   PLAN.md §4.2 promises), then NUL — and reports `binary`; the UI opens
   such a file read-only under a `banner.binary`; search under "All files"
   and the cache use the same primitive and skip binaries after 8 KiB.
   Nothing sniffs at listing time: the tree is the allow-list, and a head
   read of a dataless file would be a download (PLAN.md §2.3 rule 7).
8. **Fenced code in the ⌘E preview is highlighted** with `highlightCode`
   from `@lezer/highlight` — loaded with `await import()` inside the fence
   effect so the preview chunk keeps no static CodeMirror import — using
   exact grammar names plus an alias map (` ```text ` stays plain, ` ```py `
   is Python); the editor's fences resolve through the same function. This
   was not on the 2026-09-15 list (the options then were Mermaid, KaTeX,
   PlantUML); it costs no dependency.
9. **The keystroke costs novalis nothing (F7, first).** The editor no longer
   materialises the document on every change; the save store reads it
   once on flush (save, tab switch, close, quit, watcher merge), the status
   bar counts words on the autosave tick and not at all in plain mode.
   `NOVALIS_PERF=1` (PLAN.md §11.3) logs keydown → paint; the 1 / 5 / 50 MB
   numbers before and after go into the pull request, and the BUDGET.json
   notes say those rows are measured by hand, since no CI runner has a
   WebView.
10. **Project folders are a documentation sentence, not a denylist**:
    PLAN.md §4.2 says projects do not belong in a vault; `walk_files` keeps
    listing `build/`, `target/` and the like because they can be note
    folders and plain files are the truth.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| tree-sitter / WASM grammars, LSP, formatters | PLAN.md §7.3 "Stop there", §7.1 NO row; the 143 grammars are already in the bundle |
| Sniffing at listing time (magic bytes, head reads) | PLAN.md §2.3 rules 1, 7 and 12; a head read of a cloud placeholder is a download |
| A folder denylist in the walker | `build/` or `target/` can hold notes; the walker feeds cache, search, relink and the CLI |
| Importing `@codemirror/legacy-modes/mode/*` directly | Makes it a direct dependency (lockfile check, ADR) for a chunk `matchLanguageName` already reaches |
| The full presentation table in Rust, or the table in the core's bootstrap payload | Dead columns in the shell; a compile-time fact as a runtime dependency |
| An extension allow-list parameter on `SearchQueryDto` | Cannot express name patterns; core and UI semantics drift; the UI filter is exact |
| `.markdown` or `.MD` as a note in the core; `novalis cat notes.txt` | The CLI contract is note-shaped and immutable after 1.0; every golden changes |
| A new `--ds-color-syntax-function` token, a code line height, a font setting | Inventing a colour Dev-Noir does not have; a third typographic decision; a fifth setting |
| `@replit/codemirror-indentation-markers` | ≈60 lines of own code do it |
| Static `language-data` import in the preview | Couples the 3.5 kB preview chunk to the 103 kB core chunk |
| A CI gate for keystroke, open time and RSS | No runner has a WebView; honest is "manual, in the PR body" |

## Consequences

- Eager JS grows by ≈1 kB gzip for the generated table; `dist` does not
  grow, since every grammar chunk already ships. Eager CSS is at 20.3 of
  24 kB and must stay there: the code presets are theme rules inside the
  editor chunk.
- PLAN.md §7.3 is rewritten from the generated table when F3a lands, §4.2
  gains the code-preset and project-folder sentences, §4.3's indentation
  guides are built, §11.3 marks the UI rows as measured by hand;
  `docs/SETTINGS.md` says that `spellcheck` applies to prose presets;
  `CLAUDE.md` lists `fileTypes.generated.ts` under generated files.
- New catalog keys in both languages: `editor.search.allFiles`,
  `editor.search.notUtf8Skipped_one/_other`, `banner.binary`; reworded:
  `tree.newNoteHint` (an example instead of the list),
  `palette.quickOpenPlaceholder` ("Open a file by name").
- Tests: the table's invariants in cargo (lower-case, unique, exactly one
  of `ext | name | pattern`, `md` the only note); key parity in vitest; a
  grammar-resolution table (`a.zsh → Shell`, `sub/Dockerfile → Dockerfile`,
  `X.JSON → JSON`, `notes.text → none`, `app.cfg → Properties files`); the
  `fileTypes.test.ts` negatives keep `.wav .mp4 .zip .m .s .1` hidden and
  flip `README`; `search`'s CLI golden regenerates with the new key;
  `SKILL.md` and `reference.md` document `--all-files`.
- Open until measured in the F7 pull request: the real WebKit keystroke and
  open numbers at 1 / 5 / 50 MB; whether vitest imports `language-data`
  without a transform (Node ESM does).
- Not decided here: reading formats (ADR-0023, ADR-0024) and the viewer
  follow-ups (ADR-0025).

**Amended 2026-09-21** — after F3a landed (#134), two rows the table had
left open were put to the owner: `php`, which point 2 above names but the
plan's §3.1 table the owner answered does not carry, and the Markdown
grammar for the prose bundle's dialects `mkd mdx rmd qmd`, which F3a had
opened plain because the grammar brings the note bundle (point 4's
decorations, completion, chords, attachments) with it. Asked "Soll ich die
beiden offenen Zeilen bauen?" with "Beide / Nur php / Nur die
Markdown-Grammatik / Keins von beiden":

> Beide (Recommended)

So `php` is listed (`code4`, the PHP grammar; the variants `php3-7 phtml`
stay out as before), and `mkd mdx rmd qmd` open like `markdown`: the
Markdown grammar and the editor bundle that comes with it (decorations,
completion, the chords, Cmd-click), as files — cache, links, backlinks and
the CLI stay `.md`; image paste (`attachments.ts` keys on `.md`) and ⌘E
stay what point 6 says, `.md` and, when built, `.markdown`.

**Amended 2026-09-21 (F5)** — point 5 said the UI keeps only the hits the
tree would list; the review of the F5 pull request showed that a hit in an
unlisted file then still spends a slot of the core's limit, so a `vendor/`
tree full of matches could end a scan before the notes were reached. The
filter runs in the shell instead, before the limit: `search_where` lets the
caller narrow the walk, and the app passes its table (`file_types::kind_of`,
the UI's `kindOf` in Rust — extension, else name, else the `Dockerfile.`
prefix) so only listed text is read or counted. The CLI's `--all-files`
stays unfiltered. Under `--all-files`, a `--tag` filter still yields notes
only, because the tag index knows notes; the reference says so.

**Amended 2026-09-21 (F6)** — point 8 is built with three details it left
open. The alias map is the file table: a fence's one word is a listed
extension first (`lib/fileTypes.presentation`, so ```py, ```rs and ```jsonc
read as the files do and ```txt stays plain), then a grammar's own name or
alias, and only `plaintext`, `console`, `shell-session` and `golang` are a
hand-written list — no second table of what a short name means. The
highlighting runs inside the preview's render, before the fragment is
shown, not as a swap afterwards like Mermaid's: the code never flashes
plain and the find marks see the final text; a fence over 64 KiB, or one
whose grammar will not load, stays as the core wrote it. And the bundle
gate has a fifth row, `previewChunkGzipKb` (docs/BUDGET.json): the Preview
chunk plus what it imports statically beyond the eager set, so a static
CodeMirror import in the preview fails `just check` instead of quietly
coupling the chunks. The editor's code rules are one exported table
(`CODE_RULES`, `editor/theme.ts`); the preview wears them as `tok-*`
classes that `styles/preview.css` dresses on the same tokens, and a test
compares the two. In the editor, a fence whose grammar was known had read
in the prose face while a plain fence read in mono, because upstream's
`monospace` sits on the `CodeText` node and a grammar's parse mounted over
the text hides that node from the highlighter; the owner asked for this
too ("gleich 2. noch an"). The face and size are now the line's
(`nv-code`, decorations.ts) for every code block, plain or not, and the
node keeps its colour on a tag of its own (`codeTag`, markdownExt.ts);
inline code keeps `monospace`.
