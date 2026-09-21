import { kindOf } from "./fileTypes";
import { extensionOf, fileNameOf } from "./paths";

/**
 * How the editor dresses each row of the shell's file-type table
 * (`fileTypes.generated.ts`, ADR-0022): a preset for wrap, line numbers and
 * the indent unit (PLAN.md §4.2), and the `@codemirror/language-data` grammar
 * by its *name*. The grammar used to be looked up by path, which took every
 * upstream claim with it — `.text` opened as LaTeX, `.cfg` as TTCN-3 — and
 * missed a `Dockerfile` in a subfolder and an upper-case extension. A name
 * resolves exactly or not at all; the test beside this file checks every
 * name against the installed table, so an upstream rename cannot silently
 * turn a grammar off.
 *
 * Only the editor imports this module, so it lives in the editor's chunk,
 * not the eager one. Its key set must equal the generated table's text and
 * note rows (a viewer type never reaches the editor); the parity test says
 * when a row lacks a dress or a dress lacks a row.
 */

export type Preset = "prose" | "data" | "code2" | "code4" | "codeT";

export interface Presentation {
  readonly preset: Preset;
  /** The `language-data` name, or null for plain text. */
  readonly grammar: string | null;
}

/**
 * What a preset means in the editor. `mono` is the code dress of ADR-0022:
 * Geist Mono at full width, indentation guides, no spellcheck. `data` and
 * `code2` read the same; the rows use the plan's vocabulary so the widened
 * list (F3a) lands without renaming.
 */
export const PRESETS: Readonly<
  Record<Preset, { wrap: boolean; numbers: boolean; mono: boolean; indent: "  " | "    " | "\t" }>
> = {
  prose: { wrap: true, numbers: false, mono: false, indent: "  " },
  data: { wrap: false, numbers: true, mono: true, indent: "  " },
  code2: { wrap: false, numbers: true, mono: true, indent: "  " },
  code4: { wrap: false, numbers: true, mono: true, indent: "    " },
  codeT: { wrap: false, numbers: true, mono: true, indent: "\t" },
};

const p = (preset: Preset, grammar: string | null): Presentation => ({ preset, grammar });

export const EXTENSION_PRESENTATION: Readonly<Record<string, Presentation>> = {
  // Notes and prose. The prose formats are plain: a Markdown grammar for
  // `mkd mdx rmd qmd` would bring the whole note bundle with it.
  md: p("prose", "Markdown"),
  markdown: p("prose", "Markdown"),
  txt: p("prose", null),
  text: p("prose", null),
  rst: p("prose", null),
  adoc: p("prose", null),
  org: p("prose", null),
  textile: p("prose", null),
  mkd: p("prose", null),
  mdx: p("prose", null),
  rmd: p("prose", null),
  qmd: p("prose", null),
  srt: p("prose", null),
  vtt: p("prose", null),
  tex: p("prose", "LaTeX"),
  ltx: p("prose", "LaTeX"),
  // Data
  json: p("data", "JSON"),
  json5: p("data", "JSON"),
  jsonc: p("data", "JSON"),
  yaml: p("data", "YAML"),
  yml: p("data", "YAML"),
  toml: p("data", "TOML"),
  xml: p("data", "XML"),
  xsl: p("data", "XML"),
  xsd: p("data", "XML"),
  plist: p("data", "XML"),
  svg: p("data", "XML"),
  csv: p("data", null),
  tsv: p("data", null),
  log: p("data", null),
  diff: p("data", "diff"),
  patch: p("data", "diff"),
  bib: p("data", null),
  // Configuration
  ini: p("data", "Properties files"),
  properties: p("data", "Properties files"),
  cfg: p("data", "Properties files"),
  env: p("data", "Properties files"),
  conf: p("data", null),
  // Web
  html: p("code2", "HTML"),
  htm: p("code2", "HTML"),
  css: p("code2", "CSS"),
  scss: p("code2", "SCSS"),
  sass: p("code2", "Sass"),
  less: p("code2", "LESS"),
  js: p("code2", "JavaScript"),
  mjs: p("code2", "JavaScript"),
  cjs: p("code2", "JavaScript"),
  jsx: p("code2", "JSX"),
  ts: p("code2", "TypeScript"),
  mts: p("code2", "TypeScript"),
  cts: p("code2", "TypeScript"),
  tsx: p("code2", "TSX"),
  vue: p("code2", "Vue"),
  // Scripts and shells
  py: p("code4", "Python"),
  rb: p("code2", "Ruby"),
  pl: p("code4", "Perl"),
  pm: p("code4", "Perl"),
  lua: p("code2", "Lua"),
  tcl: p("code4", "Tcl"),
  ps1: p("code4", "PowerShell"),
  sh: p("code4", "Shell"),
  bash: p("code4", "Shell"),
  zsh: p("code4", "Shell"),
  // Systems
  c: p("code4", "C"),
  h: p("code4", "C"),
  cpp: p("code4", "C++"),
  cc: p("code4", "C++"),
  cxx: p("code4", "C++"),
  hpp: p("code4", "C++"),
  hh: p("code4", "C++"),
  hxx: p("code4", "C++"),
  rs: p("code4", "Rust"),
  go: p("codeT", "Go"),
  swift: p("code4", "Swift"),
  // JVM and .NET
  java: p("code4", "Java"),
  kt: p("code4", "Kotlin"),
  kts: p("code4", "Kotlin"),
  scala: p("code2", "Scala"),
  cs: p("code4", "C#"),
  groovy: p("code4", "Groovy"),
  gradle: p("code4", "Groovy"),
  // Mobile, functional, Lisp
  dart: p("code2", "Dart"),
  hs: p("code2", "Haskell"),
  ml: p("code2", "OCaml"),
  mli: p("code2", "OCaml"),
  elm: p("code4", "Elm"),
  erl: p("code4", "Erlang"),
  clj: p("code2", "Clojure"),
  cljs: p("code2", "Clojure"),
  edn: p("code2", "Clojure"),
  lisp: p("code2", "Common Lisp"),
  el: p("code2", "Common Lisp"),
  scm: p("code2", "Scheme"),
  // Science, databases, interfaces
  r: p("code2", "R"),
  jl: p("code4", "Julia"),
  sql: p("code2", "SQL"),
  proto: p("code2", "ProtoBuf"),
  // Build
  dockerfile: p("code2", "Dockerfile"),
  cmake: p("code2", "CMake"),
  // `make` accepts nothing but a tab; there is no grammar for it.
  mk: p("codeT", null),
};

export const NAME_PRESENTATION: Readonly<Record<string, Presentation>> = {
  Gemfile: p("code2", "Ruby"),
  Rakefile: p("code2", "Ruby"),
  Jenkinsfile: p("code4", "Groovy"),
  Dockerfile: p("code2", "Dockerfile"),
  Containerfile: p("code2", "Dockerfile"),
  Makefile: p("codeT", null),
  GNUmakefile: p("codeT", null),
  makefile: p("codeT", null),
  Justfile: p("codeT", null),
  justfile: p("codeT", null),
  // Documentation names read like notes.
  LICENSE: p("prose", null),
  README: p("prose", null),
  CHANGELOG: p("prose", null),
  CONTRIBUTING: p("prose", null),
  AUTHORS: p("prose", null),
  NOTICE: p("prose", null),
  COPYING: p("prose", null),
  VERSION: p("prose", null),
  TODO: p("prose", null),
  CODEOWNERS: p("prose", null),
};

/** The dress of each pattern row, keyed by the generated regex source. */
export const PATTERN_PRESENTATION: Readonly<Record<string, Presentation>> = {
  "^Dockerfile\\..+$": p("code2", "Dockerfile"),
};

const PATTERNS: ReadonlyArray<readonly [RegExp, Presentation]> = Object.entries(PATTERN_PRESENTATION).map(
  ([source, dress]) => [new RegExp(source), dress] as const,
);

/**
 * Grammars that key on a file-name pattern inside a row that has none of its
 * own: `language-data` claims these by regex over the path, which the name
 * lookup would otherwise lose (`nginx.conf` is a `conf`, `CMakeLists.txt` a
 * `txt`). A row with a grammar is never overruled — `Dockerfile.md` is a
 * note.
 */
const NAME_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/nginx[^/]*\.conf$/i, "Nginx"],
  [/^CMakeLists\.txt$/, "CMake"],
];

/** The dress of a listed path, or null when the table does not list it. */
export function presentationOf(rel: string): Presentation | null {
  if (kindOf(rel) === null) return null;
  const name = fileNameOf(rel);
  const extension = extensionOf(rel);
  return (
    (extension ? EXTENSION_PRESENTATION[extension] : NAME_PRESENTATION[name]) ??
    PATTERNS.find(([pattern]) => pattern.test(name))?.[1] ??
    null
  );
}

/** The `language-data` name to load for a path, or null for plain text. */
export function grammarNameOf(rel: string): string | null {
  const row = presentationOf(rel);
  if (row?.grammar) return row.grammar;
  const name = fileNameOf(rel);
  for (const [pattern, grammar] of NAME_PATTERNS) {
    if (pattern.test(name)) return grammar;
  }
  return null;
}
