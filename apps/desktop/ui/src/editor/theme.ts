import { HighlightStyle, type TagStyle } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { type Tag, tags as t } from "@lezer/highlight";

import { sebaroEditorTheme, sebaroHighlight, sebaroMarkdownHighlight } from "../sebaro/editor/sebaro-codemirror";
import { codeTag, noteTag } from "./markdownExt";

/**
 * The editor's looks, entirely in tokens.
 *
 * Decorated source mode (PLAN.md §5.3): the markers stay visible and are only
 * dimmed, headings are sized, emphasis is styled, links and tags are
 * underlined. Nothing here hides syntax — that is the "hide-syntax live
 * preview" that was explicitly declined (§4.4).
 *
 * Around the text it is sebaro's editor, imported from the export's
 * `editor/sebaro-codemirror.ts` and never copied (DSK-03, spec/01 §1.8,
 * spec/09 §17; ADR-0051 #59): `sebaroEditorTheme` gives the selection in
 * `selection`, a 2 px accent caret, the current line on `hover-fill`, line
 * numbers `text-muted` (the current one `text`), search matches and the
 * bracket pair a 1 px `border-strong` frame without fill, the invisibles,
 * inline code's look and the completion list; `sebaroSelectionMark`
 * (setup.ts) takes the current line's and inline code's grounds away under
 * a selection. Nothing else puts a colour behind text (FAR-02). What stands
 * here is novalis' own: the writing area's measure and room, the code
 * dress's width, the panels, the decorated lines, the task box.
 */

/** novalis' own rules on top of `sebaroEditorTheme`, exported for the test beside this file. */
export const EDITOR_LOOKS: Readonly<Record<string, Record<string, string>>> = {
  // The writing area fills its pane; its size is sebaro's product variable
  // (spec/01 §1.8.2, D102 (27)), which the shell sets from
  // `editor.fontSize` (stores/ui.ts).
  "&": { height: "100%" },
  ".cm-scroller": {
    padding: "var(--sb-space-5) var(--sb-space-8) 40vh",
  },
  ".cm-content": {
    maxWidth: "var(--sb-size-measure-prose)",
    margin: "0 auto",
    paddingBottom: "0",
  },
  // The code dress (ADR-0022): every preset but prose sets `nv-mono` on the
  // editor and takes sebaro's `sebaroCodeFileTheme` (setup.ts) — sebaro
  // Mono with its tracking — and the full width instead of the measure.
  // Size and line height stay the editor's; there is one of each.
  "&.nv-mono .cm-content": { maxWidth: "none", margin: "0" },
  "&.cm-editor.cm-focused": { outline: "none" },
  // Inline code's room beside its ground; the look is sebaro's `.sb-cm-code`.
  ".sb-cm-code": { padding: "0 var(--sb-space-1)" },
  // The room beside the numbers grows with the editor's text, not in px.
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 0.75em 0 0.5em",
  },
  // A `[[link]]` to no note (ADR-0038, amended by ADR-0051 #17): grey, no
  // line — not the link style, and no dash (FOR-03).
  ".nv-link-unresolved, .nv-link-unresolved span": {
    color: "var(--sb-color-text-muted)",
    textDecoration: "none",
  },
  // The find bar and Go to Line (./findPanel) are sebaro's find bar over
  // the text (spec/02 §4.25.2): its rows carry their own ground and
  // hairline; the panels only keep the editor's text colour.
  ".cm-panels": {
    backgroundColor: "var(--sb-color-bg)",
    color: "var(--sb-color-text)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "none" },
  // Decorated source mode: line-level classes the plugin adds. Headings on
  // sebaro's scale relative to the editor's size (ADR-0051 #27.4):
  // headline 28 / 16, title 20 / 16, and from h3 on body-strong, each with
  // its role's tracking; the weight is the highlighter's, by level.
  ".cm-line.nv-heading-1": {
    fontSize: "1.75em",
    letterSpacing: "var(--sb-type-headline-tracking)",
  },
  ".cm-line.nv-heading-2": {
    fontSize: "1.25em",
    letterSpacing: "var(--sb-type-title-tracking)",
  },
  ".cm-line.nv-heading-3": {
    letterSpacing: "var(--sb-type-body-strong-tracking)",
  },
  // The quote's line is sebaro's: the 2 px ink line, 16 px to the text
  // (TXT-17, `.sb-quote__text`); the text is `text-muted` from its tag.
  ".cm-line.nv-quote": {
    borderLeft: "var(--sb-x-sebaro-layer-line-width) solid var(--sb-x-sebaro-layer-line-color)",
    paddingLeft: "var(--sb-space-4)",
  },
  // Front matter and a code block's lines read in sebaro Mono at the code
  // role's size (14 / 16); their colours are the five looks of their
  // grammar (spec/01 §1.8), plain where there is none.
  ".cm-line.nv-frontmatter": {
    fontFamily: "var(--sb-font-family-mono)",
    fontSize: "0.875em",
    letterSpacing: "var(--sb-type-code-tracking)",
  },
  // A code block's lines, plain or with a grammar: the face inline code
  // gets from its tag, here on the line (markdownExt.ts `codeTag`).
  ".cm-line.nv-code": {
    fontFamily: "var(--sb-font-family-mono)",
    fontSize: "0.875em",
    letterSpacing: "var(--sb-type-code-tracking)",
  },
  // A done task (spec/01 §1.8, D102 (28)): grey, its spans too, which the
  // highlighter's `t.list` rule gives `text`.
  ".cm-line.nv-task-done, .cm-line.nv-task-done span": { color: "var(--sb-color-text-muted)" },
  // The task box looks like sebaro's checkbox (spec/02 §2.4, EIN-03): a
  // 2 px `border-strong` edge, radius 4; done, the edge and the drawn check
  // in accent, no fill. Sized to the text, not 20 px. The check is out of
  // flow, so a done box sits on the line as an open one does.
  ".nv-checkbox": {
    position: "relative",
    display: "inline-block",
    boxSizing: "border-box",
    width: "0.875em",
    height: "0.875em",
    verticalAlign: "-0.08em",
    marginRight: "0.15em",
    border: "2px solid var(--sb-color-border-strong)",
    borderRadius: "var(--sb-radius-small)",
    cursor: "pointer",
  },
  ".nv-checkbox.nv-checked": {
    borderColor: "var(--sb-color-accent)",
  },
  ".nv-checkbox.nv-checked::after": {
    content: '""',
    position: "absolute",
    insetInlineStart: "50%",
    insetBlockStart: "45%",
    width: "0.25em",
    height: "0.5em",
    translate: "-50% -50%",
    boxSizing: "border-box",
    border: "solid var(--sb-color-accent)",
    borderWidth: "0 2px 2px 0",
    transform: "rotate(45deg)",
  },
};

/** sebaro's editor theme with novalis' own rules on top: the earlier theme outranks the later one. */
export const editorTheme: Extension = [EditorView.theme(EDITOR_LOOKS), sebaroEditorTheme];

/** One look the code grammars can ask for: the tags that get it, its name, its style. */
export interface CodeRule {
  readonly tag: Tag | readonly Tag[];
  /** The class the preview's fences wear (`sb-tok-<name>`, colored by sebaro.css §6). */
  readonly name: string;
  /** What the look is, in tokens; the editor styles it, sebaro.css says the same. */
  readonly style: Readonly<Record<string, string>>;
}

/** The name of each of sebaro's code looks in sebaro.css's `sb-tok-<name>`, by the look's value. */
const LOOK_NAMES: Readonly<Record<string, string>> = {
  "var(--sb-syntax-keyword)": "keyword",
  "var(--sb-syntax-string)": "string",
  "var(--sb-syntax-constant)": "constant",
  "var(--sb-color-text-muted)": "comment",
  "underline wavy var(--sb-color-danger) 2px": "invalid",
};

/**
 * sebaro's code looks (D67, D69; spec/01 §1.8, TEC-08): three tones, comments
 * grey, everything else plain ink, no bold or italic in code. They are the
 * export's `sebaroHighlight` (spec/09 §17), read from its specs; a tag not
 * listed is plain. The same rules colour the editor and the preview's
 * fences, which wear them as `sb-tok-<name>` (editor/fences.ts) for
 * sebaro.css to colour, so the two surfaces never disagree about what a
 * keyword looks like. A look the names do not know fails here, at load.
 */
export const CODE_RULES: readonly CodeRule[] = sebaroHighlight.specs.map(({ tag, ...style }) => {
  const look = Object.values(style).join(" ");
  const name = LOOK_NAMES[look];
  if (!name) throw new Error(`sebaroHighlight: no sb-tok name for ${look}`);
  return { tag, name, style: style as Record<string, string> };
});

/** A code file's looks: sebaro's code rules and nothing of the Markdown source. */
export const codeHighlight = sebaroHighlight;

/** The heading tags: their size is the line's (ADR-0051 #27.4), so sebaro's heading rules stay out. */
const HEADING_TAGS: readonly Tag[] = [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6];

const tagsOf = (spec: TagStyle): readonly Tag[] => (Array.isArray(spec.tag) ? spec.tag : [spec.tag as Tag]);

/**
 * The rules of the export's `sebaroMarkdownHighlight` (spec/09 §17) novalis
 * shares (ADR-0051 #63): all but the headings, whose size sebaro puts on
 * the tag and novalis on the line; both together would grow an H1 to
 * 1.75² em.
 */
export const SHARED_MARKDOWN_RULES: readonly TagStyle[] = sebaroMarkdownHighlight.specs.filter(
  (spec) => !tagsOf(spec).some((tag) => HEADING_TAGS.includes(tag)),
);

/** sebaro's rule for `tag`, from the shared ones; a rule the export no longer has fails here, at load. */
const sebaros = (tag: Tag): TagStyle => {
  const spec = SHARED_MARKDOWN_RULES.find((rule) => tagsOf(rule).includes(tag));
  if (!spec) throw new Error(`sebaroMarkdownHighlight: no rule for ${tag.toString()}`);
  return spec;
};

/** sebaro's link style (LNK-01), as its link rule writes it. */
const { tag: _linkTags, ...LINK_STYLE } = sebaros(t.link);

/**
 * A note's looks: the Markdown source's rules (headings, emphasis, links,
 * tags, inline code, markers), then the code rules for its fenced blocks.
 * Emphasis, strikethrough, links, inline code, the quote and the markers
 * are the export's `sebaroMarkdownHighlight` (ADR-0051 #63); novalis' own
 * are the headings' weight, the `#tag`, a code block's text and lists.
 * Only Markdown files get it (setup.ts): in a code file a heading, strong
 * or emphasis tag of its grammar stays plain, and a processing instruction
 * (`<?php`, `<?xml`) takes the code look of `meta`, its parent tag, instead
 * of the markers' grey.
 */
export const markdownHighlight = HighlightStyle.define([
  // Heading text in `text` at its role's weight: h1 headline, h2 title,
  // h3–h6 body-strong (ADR-0051 #27.4); a Setext heading too. Size and
  // tracking are the line's (EDITOR_LOOKS).
  {
    tag: t.heading,
    color: "var(--sb-color-text)",
    fontWeight: "var(--sb-type-title-weight)",
  },
  {
    tag: t.heading1,
    color: "var(--sb-color-text)",
    fontWeight: "var(--sb-type-headline-weight)",
  },
  {
    tag: [t.heading3, t.heading4, t.heading5, t.heading6],
    color: "var(--sb-color-text)",
    fontWeight: "var(--sb-type-body-strong-weight)",
  },
  sebaros(t.strong),
  sebaros(t.emphasis),
  sebaros(t.strikethrough),
  // Links in sebaro's link style: the text of `[text](url)`, a `[[link]]`,
  // and a URL, bare in the text or as its target.
  sebaros(t.link),
  // A `#tag` in the link style too (ADR-0037, amended by ADR-0051 #18):
  // its `#` is a marker (markdownExt.ts `TagMark`), the word is underlined.
  { tag: noteTag, ...LINK_STYLE },
  // Inline code: its look is the theme's `.sb-cm-code` (spec/09 §17, NV-I14).
  sebaros(t.monospace),
  // A code block's text is plain where its grammar says nothing.
  { tag: codeTag, color: "var(--sb-color-text)" },
  sebaros(t.quote),
  { tag: t.list, color: "var(--sb-color-text)" },
  // Markers stay visible, only dimmed — the decorated-source rule (DSK-03).
  // After the heading, link and list rules, whose marks (`#`, `[`, `-`)
  // carry both classes: the marker's colour wins, and a link's marks lose
  // its line — the word is underlined, not its markup (LNK-01).
  sebaros(t.processingInstruction),
  ...sebaroHighlight.specs,
]);
