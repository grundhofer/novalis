/**
 * The dress a foreign document gets inside its Shadow-DOM host — an EPUB
 * chapter (ADR-0023) and a Word document (ADR-0024) wear the same one.
 *
 * Neither brings its own stylesheet with it: a book's would carry fonts and
 * remote URLs, and a document's page layout is not what a reader in this app
 * shows. So this is the whole dress the text gets, and it follows the app's
 * tokens in both appearances, `editor.fontSize` included — a custom property
 * crosses the shadow boundary, so the setting needs no wiring.
 */
export const DOCUMENT_CSS = `
:host { display: block; }
.body {
  max-width: var(--ds-measure-editor);
  margin: 0 auto;
  padding: var(--ds-space-7) var(--ds-space-6) var(--ds-space-9);
  color: var(--ds-color-fg-default);
  font-family: var(--ds-font-sans);
  font-size: var(--ds-font-size-editor);
  line-height: var(--ds-line-height-editor);
  overflow-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 0.6em; line-height: 1.25; font-weight: var(--ds-font-weight-strong); }
h1 { font-size: 1.55em; letter-spacing: var(--ds-letter-spacing-title); }
h2 { font-size: 1.24em; }
h3 { font-size: 1.1em; }
p, ul, ol, dl, blockquote, table, figure { margin: 0 0 1em; }
ul, ol { padding-left: 1.5em; }
li { margin: 0.2em 0; }
blockquote {
  padding-left: var(--ds-space-4);
  border-left: 2px solid var(--ds-color-border-strong);
  color: var(--ds-color-fg-muted);
}
a { color: var(--ds-color-syntax-link); text-decoration: underline; cursor: pointer; }
code, pre, kbd, samp { font-family: var(--ds-font-mono); font-size: 0.9em; }
pre { padding: var(--ds-space-3); overflow-x: auto; background: var(--ds-color-bg-fill); border-radius: var(--ds-radius-control); }
img { display: block; max-width: 100%; height: auto; margin: 1em auto; }
hr { height: 1px; border: 0; margin: 2em 0; background: var(--ds-color-border-default); }
table { border-collapse: collapse; }
th, td { padding: var(--ds-space-2) var(--ds-space-3); border: 1px solid var(--ds-color-border-default); text-align: left; }
figcaption { color: var(--ds-color-fg-muted); font-size: 0.9em; text-align: center; }
`;
