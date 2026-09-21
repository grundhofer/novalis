import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightCode, tagHighlighter } from "@lezer/highlight";

import { EXTENSION_PRESENTATION } from "../lib/fileTypes.presentation";
import { CODE_RULES } from "./theme";

/**
 * Fenced code, in the editor and in the preview (ADR-0022 point 8).
 *
 * A fence names its grammar in one word, and the word resolves exactly or
 * not at all: `language-data`'s fuzzy lookup made ```text LaTeX and ```py
 * nothing. A listed extension (lib/fileTypes.presentation) means what it
 * means for a file, so ```py is Python and ```txt plain; a grammar's own
 * name or alias is next; the few names fences use that neither knows are
 * in `ALIASES`. The editor hands `fenceLanguage` to `lang-markdown` and the
 * preview highlights through it, so both colour the same fences the same
 * way — with the editor's code rules (editor/theme.ts `CODE_RULES`), which
 * the preview wears as classes that styles/preview.css dresses.
 *
 * The preview imports this module with `await import()` inside its render
 * and never statically, so its chunk stays free of CodeMirror
 * (scripts/bundle-budget.mjs holds it there).
 */

/** Names fences use that neither the grammars nor the file table know. */
const ALIASES: Readonly<Record<string, string | null>> = {
  plaintext: null,
  console: "Shell",
  "shell-session": "Shell",
  golang: "Go",
};

/**
 * A fence past this stays as the core wrote it: the preview parses a fence
 * in one go on the main thread, and a snippet is what a fence is for.
 */
const FENCE_MAX_CHARS = 64 * 1024;

/** The grammar a fence names, or null for a plain block. Own keys only, like `kindOf`. */
export function fenceLanguage(info: string): LanguageDescription | null {
  const name = info.toLowerCase();
  if (!name) return null;
  const grammar = Object.hasOwn(ALIASES, name)
    ? ALIASES[name]
    : Object.hasOwn(EXTENSION_PRESENTATION, name)
      ? EXTENSION_PRESENTATION[name]?.grammar
      : name;
  if (!grammar) return null;
  return LanguageDescription.matchLanguageName(languages, grammar, false);
}

/** A piece of a fence's text: `classes` is empty for text no rule styles. */
export interface Run {
  readonly text: string;
  readonly classes: string;
}

const highlighter = tagHighlighter(CODE_RULES.map(({ tag, name }) => ({ tag, class: `tok-${name}` })));

/**
 * A fence's text in runs, each with the classes its tokens wear, in order
 * and with nothing lost: joined, the runs are `code` again. Null when the
 * fence names no grammar or is too long to parse here; the block then stays
 * as it is. The grammar's chunk loads on the first fence that names it.
 */
export async function highlightFence(code: string, info: string): Promise<Run[] | null> {
  if (code.length > FENCE_MAX_CHARS) return null;
  const description = fenceLanguage(info);
  if (!description) return null;
  const support = await description.load();
  const tree = support.language.parser.parse(code);
  const runs: Run[] = [];
  highlightCode(
    code,
    tree,
    highlighter,
    (text, classes) => runs.push({ text, classes }),
    () => runs.push({ text: "\n", classes: "" }),
  );
  return runs;
}
