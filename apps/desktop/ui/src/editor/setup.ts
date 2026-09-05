import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  indentOnInput,
  indentUnit,
  LanguageDescription,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";

import { extensionOf } from "../lib/paths";
import { decorations, linkAt, toggleCheckbox, wrapSelection } from "./decorations";
import { Tag, WikiLink } from "./markdownExt";

/**
 * The editor, assembled once per open document.
 *
 * PLAN.md §5.3: `allowMultipleSelections` + `rectangularSelection` +
 * `selectNextOccurrence`, `closeBrackets`, `bracketMatching`, `history`,
 * GFM Markdown with the two custom inline parsers, YAML frontmatter, and
 * `@codemirror/language-data` for lazily loaded code grammars. Above 5 MB the
 * document opens in plain mode: no Markdown, no highlighting (§4.2).
 */

export interface EditorHooks {
  onChange: (text: string) => void;
  onFollowLink: (target: string) => void;
  onSave: () => void;
  /** Every note in the vault, for `[[` completion. */
  notePaths: () => string[];
  readOnly: boolean;
  plainMode: boolean;
  spellcheck: boolean;
}

/** Soft wrap and line numbers per file type (PLAN.md §4.2). */
function typeOptions(path: string): { wrap: boolean; numbers: boolean; indent: string } {
  const extension = extensionOf(path);
  const prose = extension === "md" || extension === "markdown" || extension === "txt" || extension === "text";
  const wide = extension === "csv" || extension === "tsv";
  const fourSpaces = ["py", "rs", "swift", "sh", "bash", "zsh"].includes(extension);
  return {
    wrap: prose,
    numbers: !prose || wide,
    indent: fourSpaces ? "    " : "  ",
  };
}

async function languageFor(path: string): Promise<Extension | null> {
  const extension = extensionOf(path);
  if (extension === "md" || extension === "markdown") {
    // The GFM bundle plus our two inline parsers; fenced code blocks resolve
    // their grammar lazily out of `language-data`.
    return yamlFrontmatter({
      content: markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [WikiLink, Tag],
      }),
    });
  }
  const description = LanguageDescription.matchFilename(languages, path);
  if (!description) return null;
  const support = await description.load();
  return support;
}

/** `[[` completion from the vault's note list; `#` from tags in this buffer. */
function completions(hooks: EditorHooks) {
  const wiki = (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^[\]]*/);
    if (!match) return null;
    const options = hooks.notePaths().map((path) => ({
      label: path.replace(/\.md$/, ""),
      type: "text",
    }));
    return { from: match.from + 2, options, validFor: /^[^[\]]*$/ };
  };

  const tag = (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/#[\p{L}\p{N}_/-]*/u);
    if (!match || match.from === match.to) return null;
    const seen = new Set<string>();
    for (const found of context.state.doc.toString().matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) {
      if (found[1]) seen.add(found[1]);
    }
    return {
      from: match.from + 1,
      options: [...seen].sort().map((name) => ({ label: name, type: "keyword" })),
      validFor: /^[\p{L}\p{N}_/-]*$/u,
    };
  };

  return autocompletion({ override: [wiki, tag], icons: false });
}

export async function buildExtensions(path: string, hooks: EditorHooks): Promise<Extension[]> {
  const options = typeOptions(path);
  const isMarkdown = extensionOf(path) === "md" || extensionOf(path) === "markdown";

  const base: Extension[] = [
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    indentOnInput(),
    indentUnit.of(options.indent),
    search({ top: true }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...completionKeymap,
      indentWithTab,
      { key: "Mod-s", run: () => (hooks.onSave(), true) },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) hooks.onChange(update.state.doc.toString());
    }),
    EditorView.editable.of(!hooks.readOnly),
    EditorState.readOnly.of(hooks.readOnly),
    EditorView.contentAttributes.of({
      spellcheck: String(hooks.spellcheck),
      // WKWebView hides the red underlines (tauri-apps/tauri#7705); the
      // right-click menu still offers the native suggestions (PLAN.md §7.5).
      autocorrect: "off",
      autocapitalize: "off",
    }),
  ];

  if (options.wrap) base.push(EditorView.lineWrapping);
  if (options.numbers) base.push(lineNumbers(), highlightActiveLineGutter());

  // Plain mode: the buffer is the source of truth and nothing decorates it.
  if (hooks.plainMode) return base;

  base.push(closeBrackets());

  const language = await languageFor(path);
  if (language) base.push(language);

  if (isMarkdown) {
    base.push(
      decorations,
      completions(hooks),
      keymap.of([
        { key: "Mod-b", run: (view) => wrapSelection("**")(view) },
        { key: "Mod-i", run: (view) => wrapSelection("_")(view) },
        { key: "Mod-Enter", run: (view) => toggleCheckbox(view) },
      ]),
      EditorView.domEventHandlers({
        mousedown(event, view) {
          // `Cmd`-click follows a link (docs/KEYMAP.md, mouse gestures).
          if (!event.metaKey && !event.ctrlKey) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;
          const target = linkAt(view.state, pos);
          if (!target) return false;
          hooks.onFollowLink(target);
          event.preventDefault();
          return true;
        },
      }),
    );
  }

  return base;
}
