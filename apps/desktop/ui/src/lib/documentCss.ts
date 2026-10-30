import { tableNames, type TableWords } from "./tableNames";

/**
 * The dress a foreign document gets inside its Shadow-DOM host — an EPUB
 * chapter (ADR-0023) and a Word document (ADR-0024) wear the same one.
 *
 * Neither brings its own stylesheet with it: a book's would carry fonts and
 * remote URLs, and a document's page layout is not what a reader in this app
 * shows. So this is the whole dress the text gets. sebaro.css does not reach
 * into a shadow root, but its custom properties do, so this is sebaro's
 * prose written again on its tokens (ADR-0051; docs/sebaro-luecken.md O),
 * at the editor's size as the Markdown preview is (styles/preview.css,
 * `editor.fontSize` included, with no wiring): the measure and the 12 px
 * stack of `.sb-prose`, headings on the editor's em scale with D105's room
 * above them (h1 48 px, h2 40, h3 32, h4 to h6 the stack), lists indented
 * 1.5em with D105's spacing inside an item (a nested list 4 px under its
 * line, 8 px between the blocks of a loose item), the one link
 * style (LNK-01: the word in text colour over the 2 px cobalt line), the
 * quote's 2 px ink line at its start without ground or italics (TXT-17),
 * code on `surface-sunken` like `pre.sb-code`, tables as `sb-table`
 * (DAT-05: label heads over the `border-strong` line, hairline rows, no
 * vertical lines, no stripes, tabular figures; a `th` in `tbody` in
 * body-strong over the row's hairline, as sebaro.css has it — the HTML
 * parser puts a table's rows there when it has no `thead`, so its first
 * row's `th` are row headers too; the XML parser an EPUB chapter is read
 * with leaves such rows directly under `table`, so a `th` in a `tr` there
 * counts as one in `tbody`; a cell's own paragraphs, as mammoth writes
 * them, lose their stack margin at the cell's edges) in a scrolling
 * region, the caption in caption and text-muted at the start, the
 * selection in
 * `--sb-color-selection` (FAR-03). sebaro's focus ring does not reach in
 * either, so a link, a code block and a table's region get it here.
 */
export const DOCUMENT_CSS = `
:host { display: block; }
::selection { background: var(--sb-color-selection); }
.body {
  max-inline-size: var(--sb-size-measure-prose);
  margin: 0 auto;
  padding: var(--sb-space-5) var(--sb-space-4) var(--sb-space-8);
  color: var(--sb-color-text);
  font-family: var(--sb-font-family-ui);
  font-size: var(--sb-x-sebaro-editor-size);
  font-weight: var(--sb-type-body-weight);
  line-height: var(--sb-type-body-line-height);
  letter-spacing: var(--sb-type-body-tracking);
  overflow-wrap: break-word;
}
:is(p, ul, ol, dl, blockquote, figure, pre, hr, .table-wrap) { margin: 0 0 var(--sb-spacing-stack); }
:is(h1, h2, h3, h4, h5, h6) { margin: var(--sb-spacing-stack) 0; color: var(--sb-color-text); }
h1 { margin-block-start: var(--sb-space-12); }
h2 { margin-block-start: var(--sb-space-10); }
h3 { margin-block-start: var(--sb-space-8); }
.body > :first-child, .body > :first-child > :first-child { margin-block-start: 0; }
h1 { font-size: 1.75em; font-weight: var(--sb-type-headline-weight); line-height: var(--sb-type-headline-line-height); letter-spacing: var(--sb-type-headline-tracking); }
h2 { font-size: 1.25em; font-weight: var(--sb-type-title-weight); line-height: var(--sb-type-title-line-height); letter-spacing: var(--sb-type-title-tracking); }
:is(h3, h4, h5, h6) { font-size: 1em; font-weight: var(--sb-type-body-strong-weight); line-height: var(--sb-type-body-strong-line-height); letter-spacing: var(--sb-type-body-strong-tracking); }
:is(strong, b) { font-weight: var(--sb-type-body-strong-weight); }
:is(ul, ol) { padding-inline-start: 1.5em; }
li + li { margin-block-start: var(--sb-space-1); }
li :is(ul, ol) { margin-block: var(--sb-space-1) 0; }
li > :is(p, blockquote, pre, div) { margin-block: 0; }
li > * + :is(p, blockquote, pre, div),
li > :is(p, ul, ol, blockquote, pre, div) + :is(ul, ol) { margin-block-start: var(--sb-space-2); }
blockquote {
  padding-inline-start: var(--sb-space-4);
  border-inline-start: var(--sb-x-sebaro-layer-line-width) solid var(--sb-x-sebaro-layer-line-color);
  font-style: normal;
}
blockquote > :last-child { margin-block-end: 0; }
a {
  color: var(--sb-color-text);
  text-decoration: underline var(--sb-color-link) var(--sb-x-sebaro-link-underline-width);
  text-underline-offset: 0.2em;
  cursor: pointer;
}
a:is(:hover, :active) { color: var(--sb-color-link); }
a:focus-visible { outline: var(--sb-focus-ring); outline-offset: var(--sb-focus-offset); }
:is(code, kbd, samp) { font-family: var(--sb-font-family-mono); font-size: 0.875em; letter-spacing: var(--sb-type-code-tracking); }
:not(pre) > code { padding: 0 var(--sb-space-1); border-radius: var(--sb-radius-small); background: var(--sb-color-surface-sunken); }
pre {
  max-inline-size: 100%;
  padding: var(--sb-space-4);
  overflow-x: auto;
  border-radius: var(--sb-radius-container);
  background: var(--sb-color-surface-sunken);
  font-family: var(--sb-font-family-mono);
  font-size: 0.875em;
  letter-spacing: var(--sb-type-code-tracking);
}
pre code { font-size: inherit; }
img { display: block; max-inline-size: 100%; block-size: auto; }
hr { block-size: 0; margin-block: var(--sb-space-8); border: 0; border-block-start: var(--sb-border-width-hairline) solid var(--sb-color-border); }
figcaption { margin-block-start: var(--sb-space-2); color: var(--sb-color-text-muted); font-size: 0.875em; line-height: var(--sb-type-caption-line-height); letter-spacing: var(--sb-type-caption-tracking); }
.table-wrap { max-inline-size: 100%; overflow-x: auto; }
table { border-collapse: collapse; font-variant-numeric: var(--sb-type-numeric-variant); }
caption { padding-block-end: var(--sb-space-2); text-align: start; color: var(--sb-color-text-muted); font-size: 0.875em; line-height: var(--sb-type-caption-line-height); }
:is(th, td) {
  padding: var(--sb-space-3) var(--sb-space-3) var(--sb-space-3) 0;
  text-align: start;
  vertical-align: top;
  border-block-end: var(--sb-border-width-hairline) solid var(--sb-color-border);
}
:is(th, td):last-child { padding-inline-end: 0; }
:is(th, td) > :first-child { margin-block-start: 0; }
:is(th, td) > :last-child { margin-block-end: 0; }
th {
  font-size: 0.875em;
  font-weight: var(--sb-type-label-weight);
  letter-spacing: var(--sb-type-label-tracking);
  border-block-end-color: var(--sb-color-border-strong);
}
:is(tbody, table > tr) th {
  font-size: 1em;
  font-weight: var(--sb-type-body-strong-weight);
  letter-spacing: var(--sb-type-body-strong-tracking);
  border-block-end-color: var(--sb-color-border);
}
:is(pre, .table-wrap):focus-visible { outline: var(--sb-focus-ring); outline-offset: calc(-1 * var(--sb-focus-width)); }
`;

/**
 * The parts of a document that need more than its markup (DAT-05, TXT-08),
 * done on the sanitized copy before it is shown: a table goes into a
 * focusable scrolling region named by its caption, and where it has none
 * after the heading before it as in the preview (`lib/tableNames.ts`,
 * spec/02 §3.9, ADR-0051 #57), so a wide one scrolls in its own frame and by
 * keyboard; a code block is focusable for the same reason. The preview does
 * the same with sebaro's classes (Preview.tsx `dressFragment`).
 */
export function dressDocument(body: HTMLElement, tableWords: TableWords): void {
  for (const pre of body.querySelectorAll("pre")) pre.tabIndex = 0;
  const names = tableNames(body, tableWords);
  for (const table of body.querySelectorAll("table")) {
    const wrap = body.ownerDocument.createElement("div");
    wrap.className = "table-wrap";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", table.caption?.textContent?.trim() || (names.get(table) ?? ""));
    wrap.tabIndex = 0;
    table.replaceWith(wrap);
    wrap.append(table);
  }
}
