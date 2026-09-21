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
  LanguageSupport,
  type LRLanguage,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { styleTags, tags as t } from "@lezer/highlight";
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

import { grammarNameOf, presentationOf, PRESETS } from "../lib/fileTypes.presentation";
import { resolveWikiTarget } from "../lib/links";
import { attachments } from "./attachments";
import { decorations, linkAt, toggleCheckbox, wrapSelection } from "./decorations";
import { fenceLanguage } from "./fences";
import { headingsOf, parseHeadingLink } from "./headingCompletion";
import { detectIndent } from "./indentDetect";
import { indentationGuides } from "./indentationGuides";
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
  /** The buffer changed. No text: the store reads it once, when it needs it. */
  onChange: () => void;
  onFollowLink: (target: string) => void;
  onSave: () => void;
  /** Every note in the vault, for `[[` completion. */
  notePaths: () => string[];
  /** A note's text, for `[[note#` completion; `null` when it cannot be read. */
  noteText: (path: string) => Promise<string | null>;
  /** The document as opened, for the indent detector (its first lines). */
  text: string;
  readOnly: boolean;
  plainMode: boolean;
  spellcheck: boolean;
}

/**
 * The grammar for a path, by the table's name (lib/fileTypes.presentation):
 * exact, never fuzzy, so `text` does not become LaTeX and `cfg` not TTCN-3.
 */
async function languageFor(path: string): Promise<Extension | null> {
  const grammar = grammarNameOf(path);
  if (grammar === "Markdown") {
    // The GFM bundle plus our two inline parsers; a fenced code block resolves
    // its grammar lazily out of `language-data` by the fence's name, exactly,
    // the way the preview does (./fences).
    const bundle = yamlFrontmatter({
      content: markdown({
        base: markdownLanguage,
        codeLanguages: fenceLanguage,
        extensions: [WikiLink, Tag],
      }),
    });
    // The frontmatter's `---` lines are `meta` upstream, which the code rules
    // now colour as a keyword; as a marker they keep the dimmed look every
    // other marker has. `yamlFrontmatter` builds an `LRLanguage`.
    const language = (bundle.language as LRLanguage).configure({
      props: [styleTags({ DashLine: t.processingInstruction })],
    });
    return new LanguageSupport(language, bundle.support);
  }
  if (grammar === null) return null;
  const description = LanguageDescription.matchLanguageName(languages, grammar, false);
  if (!description) return null;
  const support = await description.load();
  return support;
}

/**
 * `[[` completion from the vault's note list, `[[note#` from that note's
 * headings (this note's for `[[#`); `#` outside a link from tags in this
 * buffer.
 */
function completions(hooks: EditorHooks) {
  const wiki = (context: CompletionContext): CompletionResult | null => {
    // Up to a `#` or `|`: past either, the note is named and the heading
    // source or nothing takes over.
    const match = context.matchBefore(/\[\[[^[\]#|]*/);
    if (!match) return null;
    const options = hooks.notePaths().map((path) => ({
      label: path.replace(/\.md$/, ""),
      type: "text",
    }));
    return { from: match.from + 2, options, validFor: /^[^[\]#|]*$/ };
  };

  const heading = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const link = parseHeadingLink(line.text.slice(0, context.pos - line.from));
    if (!link) return null;
    let text: string | null;
    if (link.target.trim() === "") {
      text = context.state.doc.toString();
    } else {
      const path = resolveWikiTarget(link.target, hooks.notePaths());
      text = path ? await hooks.noteText(path) : null;
    }
    if (text === null) return null;
    return {
      from: line.from + link.from,
      options: headingsOf(text).map((name) => ({ label: name, type: "text" })),
      validFor: /^[^[\]#|]*$/,
    };
  };

  const tag = (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/#[\p{L}\p{N}_/-]*/u);
    if (!match || match.from === match.to) return null;
    // Inside `[[note#…` the `#` starts a heading, not a tag.
    const line = context.state.doc.lineAt(context.pos);
    if (parseHeadingLink(line.text.slice(0, context.pos - line.from))) return null;
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

  return autocompletion({ override: [wiki, heading, tag], icons: false });
}

export async function buildExtensions(path: string, hooks: EditorHooks): Promise<Extension[]> {
  // A path the table does not list never reaches the editor; `data` is the
  // safe dress if one ever does.
  const options = PRESETS[presentationOf(path)?.preset ?? "data"];
  const isMarkdown = grammarNameOf(path) === "Markdown";

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
    // PLAN.md §4.2: the file's own indentation wins over the preset's — except
    // a tab that is syntax, not style: `make` rejects a recipe line indented
    // with the spaces an `ifeq` block above it may have taught the detector.
    indentUnit.of(options.indent === "\t" ? "\t" : (detectIndent(hooks.text) ?? options.indent)),
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
      if (update.docChanged) hooks.onChange();
    }),
    EditorView.editable.of(!hooks.readOnly),
    EditorState.readOnly.of(hooks.readOnly),
    EditorView.contentAttributes.of({
      // The setting applies to prose (docs/SETTINGS.md); code is never checked.
      spellcheck: String(hooks.spellcheck && !options.mono),
      // WKWebView hides the red underlines (tauri-apps/tauri#7705); the
      // right-click menu still offers the native suggestions (PLAN.md §7.5).
      autocorrect: "off",
      autocapitalize: "off",
    }),
  ];

  if (options.wrap) base.push(EditorView.lineWrapping);
  if (options.numbers) base.push(lineNumbers(), highlightActiveLineGutter());
  // The code dress (ADR-0022): the class the theme keys its mono rules on,
  // and indentation guides (PLAN.md §4.3).
  if (options.mono) base.push(EditorView.editorAttributes.of({ class: "nv-mono" }), indentationGuides);

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
      // Pasted and dropped images become files next to the note (ADR-0017).
      attachments(path),
    );
  }

  return base;
}
