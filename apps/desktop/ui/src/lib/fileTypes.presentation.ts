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
  md: p("prose", "Markdown"),
  markdown: p("prose", "Markdown"),
  txt: p("prose", null),
  text: p("prose", null),
  json: p("data", "JSON"),
  map: p("data", "JSON"),
  yaml: p("data", "YAML"),
  yml: p("data", "YAML"),
  toml: p("data", "TOML"),
  xml: p("data", "XML"),
  svg: p("data", "XML"),
  html: p("code2", "HTML"),
  htm: p("code2", "HTML"),
  css: p("code2", "CSS"),
  js: p("code2", "JavaScript"),
  mjs: p("code2", "JavaScript"),
  cjs: p("code2", "JavaScript"),
  jsx: p("code2", "JSX"),
  ts: p("code2", "TypeScript"),
  mts: p("code2", "TypeScript"),
  cts: p("code2", "TypeScript"),
  tsx: p("code2", "TSX"),
  py: p("code4", "Python"),
  rs: p("code4", "Rust"),
  sh: p("code4", "Shell"),
  bash: p("code4", "Shell"),
  zsh: p("code4", "Shell"),
  ini: p("data", "Properties files"),
  conf: p("data", null),
  cfg: p("data", "Properties files"),
  properties: p("data", "Properties files"),
  env: p("data", "Properties files"),
  swift: p("code4", "Swift"),
  csv: p("data", null),
  tsv: p("data", null),
  log: p("data", null),
};

export const NAME_PRESENTATION: Readonly<Record<string, Presentation>> = {
  Dockerfile: p("code2", "Dockerfile"),
  LICENSE: p("code2", null),
  // `make` accepts nothing but a tab; there is no grammar for it.
  Makefile: p("codeT", null),
};

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
  const extension = extensionOf(rel);
  return extension
    ? (EXTENSION_PRESENTATION[extension] ?? null)
    : (NAME_PRESENTATION[fileNameOf(rel)] ?? null);
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
