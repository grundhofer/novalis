import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { type Tag, tags as t } from "@lezer/highlight";

import { codeTag, noteTag } from "./markdownExt";

/**
 * The editor's looks, entirely in semantic tokens (`--ds-*`).
 *
 * Decorated source mode (PLAN.md §5.3): the markers stay visible and are only
 * dimmed, headings are sized, emphasis is styled, links and tags are coloured.
 * Nothing here hides syntax — that is the "hide-syntax live preview" that was
 * explicitly declined (§4.4).
 */

export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--ds-color-fg-default)",
    backgroundColor: "var(--ds-color-bg-canvas)",
    height: "100%",
    fontSize: "var(--ds-font-size-editor)",
  },
  ".cm-scroller": {
    fontFamily: "var(--ds-font-sans)",
    lineHeight: "var(--ds-line-height-editor)",
    padding: "var(--ds-space-7) var(--ds-space-9) 40vh",
  },
  ".cm-content": {
    caretColor: "var(--ds-color-editor-cursor)",
    maxWidth: "var(--ds-measure-editor)",
    margin: "0 auto",
    paddingBottom: "0",
  },
  // The code dress (ADR-0022): every preset but prose sets `nv-mono` on the
  // editor — Geist Mono with its tracking, the full width instead of the
  // measure. Size and line height stay the editor's; there is one of each.
  "&.nv-mono .cm-scroller": {
    fontFamily: "var(--ds-font-mono)",
    letterSpacing: "var(--ds-letter-spacing-mono)",
  },
  "&.nv-mono .cm-content": { maxWidth: "none", margin: "0" },
  "&.cm-editor.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "1.5px solid var(--ds-color-editor-cursor)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--ds-color-editor-selection)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--ds-color-editor-selection-match)" },
  ".cm-activeLine": { backgroundColor: "var(--ds-color-editor-active-line)" },
  ".cm-gutters": {
    backgroundColor: "var(--ds-color-bg-canvas)",
    color: "var(--ds-color-editor-gutter)",
    border: "none",
    fontFamily: "var(--ds-font-mono)",
    fontSize: "var(--ds-font-size-mono)",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ds-color-fg-muted)" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--ds-color-bg-fill)", border: "none" },
  ".cm-searchMatch": { backgroundColor: "var(--ds-color-editor-match)" },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--ds-color-accent-fill)",
    outline: "1px solid var(--ds-color-accent-line)",
  },
  ".cm-matchingBracket, .cm-nonmatchingBracket": {
    backgroundColor: "var(--ds-color-bg-fill-strong)",
    outline: "none",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--ds-color-bg-raised)",
    border: "1px solid var(--ds-color-border-strong)",
    borderRadius: "var(--ds-radius-control)",
    boxShadow: "var(--ds-shadow-modal)",
    color: "var(--ds-color-fg-default)",
    fontFamily: "var(--ds-font-sans)",
    fontSize: "var(--ds-font-size-ui)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--ds-color-bg-fill-strong)",
    color: "var(--ds-color-fg-default)",
  },
  ".cm-panels": {
    backgroundColor: "var(--ds-color-bg-surface)",
    color: "var(--ds-color-fg-default)",
    borderTop: "1px solid var(--ds-color-border-strong)",
  },
  // Decorated source mode: line-level classes the plugin adds.
  ".cm-line.nv-heading-1": { fontSize: "1.55em", letterSpacing: "var(--ds-letter-spacing-title)" },
  ".cm-line.nv-heading-2": { fontSize: "1.24em", letterSpacing: "-0.02em" },
  ".cm-line.nv-heading-3": { fontSize: "1.1em" },
  ".cm-line.nv-quote": {
    borderLeft: "2px solid var(--ds-color-fg-subtle)",
    paddingLeft: "var(--ds-space-5)",
    color: "var(--ds-color-fg-muted)",
  },
  ".cm-line.nv-frontmatter": {
    fontFamily: "var(--ds-font-mono)",
    fontSize: "0.85em",
    color: "var(--ds-color-fg-subtle)",
  },
  // A code block's lines, plain or with a grammar: the face inline code
  // gets from its tag, here on the line (markdownExt.ts `codeTag`).
  ".cm-line.nv-code": { fontFamily: "var(--ds-font-mono)", fontSize: "0.9em" },
  ".cm-line.nv-task-done": { color: "var(--ds-color-fg-subtle)" },
  ".nv-checkbox": {
    display: "inline-block",
    width: "0.85em",
    height: "0.85em",
    verticalAlign: "-0.08em",
    marginRight: "0.15em",
    border: "1px solid var(--ds-color-border-control)",
    borderRadius: "var(--ds-radius-chip)",
    cursor: "pointer",
    position: "relative",
  },
  ".nv-checkbox.nv-checked": {
    backgroundColor: "var(--ds-color-accent-default)",
    borderColor: "var(--ds-color-accent-default)",
  },
});

/** One look the code grammars can ask for: the tags that get it, its name, its style. */
export interface CodeRule {
  readonly tag: Tag | readonly Tag[];
  /** The class the preview's fences wear (`tok-<name>`, styles/preview.css). */
  readonly name: string;
  /** What the look is, in tokens; the editor styles it, the stylesheet mirrors it. */
  readonly style: Readonly<Record<string, string>>;
}

/**
 * The code rules (ADR-0022 point 4), on the tokens that exist: function
 * names by weight, not colour; operators and punctuation dimmed like markers;
 * the rest borrowed from the nearest of the twelve. A plain `variableName`
 * stays uncoloured on purpose. Loaded lazily per grammar (PLAN.md §7.3),
 * the same rules colour the editor and the preview's fences (point 8), so
 * the two surfaces never disagree about what a keyword looks like.
 */
export const CODE_RULES: readonly CodeRule[] = [
  {
    tag: [t.keyword, t.meta, t.annotation, t.macroName],
    name: "keyword",
    style: { color: "var(--ds-color-syntax-keyword)" },
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.escape],
    name: "string",
    style: { color: "var(--ds-color-syntax-string)" },
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    name: "comment",
    style: { color: "var(--ds-color-syntax-comment)" },
  },
  {
    tag: [t.number, t.bool, t.null, t.changed],
    name: "number",
    style: { color: "var(--ds-color-syntax-number)" },
  },
  {
    tag: [t.typeName, t.className, t.definition(t.variableName), t.namespace],
    name: "type",
    style: { color: "var(--ds-color-syntax-type)" },
  },
  { tag: [t.propertyName, t.attributeName], name: "property", style: { color: "var(--ds-color-fg-muted)" } },
  { tag: t.invalid, name: "invalid", style: { color: "var(--ds-color-syntax-invalid)" } },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))],
    name: "function",
    style: { fontWeight: "var(--ds-font-weight-medium)" },
  },
  { tag: [t.operator, t.punctuation], name: "marker", style: { color: "var(--ds-color-syntax-marker)" } },
  { tag: t.inserted, name: "inserted", style: { color: "var(--ds-color-success-text)" } },
  { tag: t.deleted, name: "deleted", style: { color: "var(--ds-color-warning-text)" } },
];

export const markdownHighlight = HighlightStyle.define([
  // Markers stay visible, only dimmed — the decorated-source rule.
  { tag: t.processingInstruction, color: "var(--ds-color-syntax-marker)" },
  { tag: t.heading, color: "var(--ds-color-syntax-heading)", fontWeight: "500" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--ds-color-syntax-link)" },
  { tag: t.url, color: "var(--ds-color-syntax-link)" },
  {
    tag: noteTag,
    color: "var(--ds-color-syntax-tag)",
    backgroundColor: "var(--ds-color-accent-fill)",
    border: "1px solid var(--ds-color-accent-line)",
    borderRadius: "var(--ds-radius-chip)",
    padding: "0 0.28em",
    fontFamily: "var(--ds-font-mono)",
    fontSize: "0.86em",
  },
  {
    tag: t.monospace,
    fontFamily: "var(--ds-font-mono)",
    fontSize: "0.9em",
    color: "var(--ds-color-syntax-code)",
  },
  { tag: codeTag, color: "var(--ds-color-syntax-code)" },
  { tag: t.quote, color: "var(--ds-color-syntax-quote)" },
  { tag: t.list, color: "var(--ds-color-fg-default)" },
  ...CODE_RULES.map(({ tag, style }) => ({ tag, ...style })),
]);
