# 16. pdf.js renders PDFs, with the app's own controls

Date: 2026-09-15

## Status

Accepted. Supersedes the rendering half of ADR-0015 (the `read_blob` command,
the tree filter and the image viewer stand).

## Context

ADR-0015 showed a PDF through the WebView's own PDF view in a frame. That
works only in the macOS WebView — Windows' WebView2 has a different viewer
with a different bar, Linux' WebKitGTK usually none — and it offers nothing to
build on: no page control, no zoom the app can drive, and an overlay whose
"open in Preview" and "download" icons do nothing inside the app and cannot
be turned off. The owner, testing it:

> die icons funktionieren nicht alle. welche alternative zur darstellung von
> pdf hben wir oder können wir auch steuerungsbutton in novalis einbauen?
> ganze seite, nächste seie etc zoom etc.

and, asked how the stack was chosen:

> können wir etwas nehmen, das auch cross platform verfügbar ist?

Native renderers (pdfium, MuPDF) would be `*-sys` crates with a 10+ MB
binary, which D26 and the DMG budget rule out. pdf.js (Mozilla, Apache-2.0)
is JavaScript, identical in every WebView, and renders to a canvas the app
owns. Asked with that framing and the cost named:

> pdf.js mit eigener Leiste (Recommended)

## Decision

- `pdfjs-dist` becomes a dependency of the UI — the first runtime npm package
  added since the scaffold. Its optional `@napi-rs/canvas` (native Node
  canvas, one binary per platform) is removed through a pnpm override, so the
  lockfile carries the one package. It is its own chunk, loaded only when a
  PDF is opened; the worker file is bundled as an asset and loaded from the
  app itself, so the CSP keeps `script-src 'self'` and needs no `unsafe-eval`
  (pdf.js 6 has no eval path).
- The pane shows one page on a canvas at device resolution with pdf.js's
  text layer over it, so text can be selected and copied. The bar above it is
  the app's: previous, next, page N of M (typed), zoom out, zoom level, zoom
  in, fit to width (the default). Strings in both catalogs, tokens only.
- The `frame-src blob:` CSP entry of ADR-0015 goes again; `blob:` under
  `img-src` stays for images.

## Consequences

- The DMG grows by roughly 1.7 MB of minified JavaScript (`pdf.min.mjs` and
  the worker); the release workflow's DMG budget (PLAN.md §11.3, 12 MB) is
  the check that says whether that still fits.
- `scripts/lockfile-adr-check.mjs` will ask for this ADR's number on the pull
  request that adds `pdfjs-dist`.
- pdf.js renders through JavaScript: fine for reading, slower than the
  platform's own renderer on very large scanned pages.
- Approved for later, each with its own ADR when built (owner, 2026-09-15:
  "EPUB (Recommended), Markdown-Lesemodus ⌘E (Recommended), DOCX (nur
  lesen), CBZ"): an EPUB reader on a Rust `zip` crate, the v1.1 read-only
  Markdown preview on `pulldown-cmark`, DOCX through `mammoth`, CBZ once
  `zip` is there.
