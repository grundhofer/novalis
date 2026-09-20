# 25. Viewer follow-ups: more image types, PDF outline and keys, image zoom, CSV table and SVG behind the eye

Date: 2026-09-20

## Status

Accepted; not yet built, each item its own small pull request after the
ADR-0022 phases, none of them a prerequisite for ADR-0023/0024. Amends
ADR-0015 (image types; `svg` "stays XML text"), ADR-0016 ("one page,
previous/next, zoom, fit width" was the asked scope), ADR-0020 ("a preview
for anything but Markdown: not built") and ADR-0008 (a `viewer` keymap
scope with its first rows). No dependency, no IPC, no setting.

## Context

The format plan listed the gaps of the viewers built under ADR-0015/0016
and the second representations that cost nothing but a decision: images
the WebView can decode but the tree hides, a PDF without outline, keyboard
paging or search, an image viewer without zoom, a CSV that opens only as
text, an SVG that opens only as XML. Each is a feature under the
minimalism gate, so the plan put them as questions 9–12 with a
recommendation, not as build order; the owner chose:

> Alle Empfehlungen übernehmen (Recommended)

The recommendations were: HEIC/HEIF/AVIF yes after a decode check; PDF
outline and keyboard paging yes, PDF search and continuous scroll later;
image zoom yes without touching the font-size chords; CSV table and
rendered SVG yes, both read-only behind the existing eye glyph.

## Decision

1. **Images `heic heif avif`** join tier D once a check in `just dev`
   shows WebKit decodes them in the app's WebView (they are rows in
   `file_types.rs` plus MIME entries; nothing else). `bmp`, `tiff`, `ico`
   stay out.
2. **PDF (ADR-0016 amendment)**: an outline popover from
   `doc.getOutline()` + `getPageIndex(dest)` — the same popover the EPUB
   reader uses for its table of contents (ADR-0023) — and keyboard paging
   `← → PageUp PageDown Home End` inside the pane. These are the first
   rows of a new keymap scope `viewer` in `docs/KEYMAP.md` (parity test).
   PDF text search and continuous scrolling are **later**, each its own
   question: search would be a `Cmd+F` row in the viewer scope, continuous
   scroll replaces "one page" and is worth ≈200 lines with
   `IntersectionObserver` and the existing virtualiser, not
   `pdf_viewer.mjs` (+71 kB gzip).
3. **Image zoom** in the image viewer and the CBZ viewer: wheel and pinch
   (`ctrlKey` wheel on macOS trackpads), a click toggles fit ↔ 1:1, and
   the bar reuses the existing `viewer.zoomIn` / `viewer.zoomOut` /
   `viewer.zoom` / `viewer.fitWidth` strings. **`Cmd+=` / `Cmd+-` / `Cmd+0`
   stay the global font-size chords** (ADR-0004/0008; the owner: shortcuts
   must work in every mode) — the viewer never claims them. In the ⌘E
   preview a click on an image opens the file in the viewer (a mouse-
   gesture row in `docs/KEYMAP.md`).
4. **A second, read-only representation behind the eye glyph / ⌘E** for two
   text types, so `note.togglePreview` widens from `.md` to "files with a
   second representation" (a `docs/KEYMAP.md` prose line, no new chord):
   - `csv tsv` as a table — an RFC 4180 parser of ≈40 lines (quotes,
     doubled quotes, CR/LF, embedded newlines; TSV splits on tab), header
     row, sticky header, rows through `@tanstack/react-virtual` (already a
     direct dependency), tabular numerals. No cell editing, no sorting or
     filtering that writes, no formulas — PLAN.md §7.3 "not a table editor"
     holds; the text buffer stays the truth.
   - `svg` rendered as `<img src="blob:" type="image/svg+xml">` — safe by
     construction (no scripts, no external references in SVG-as-image);
     `svg` stays XML text in the editor.
5. **Not built, and why**: audio and video (ADR-0015: "keine wav, mp4
   etc"; if ever, a custom scheme with `Range`, never base64); HTML files
   rendered (a saved page without its remote resources renders broken by
   design; the editor shows the source); a JSON tree (the JSON grammar in
   the editor is the viewer); `ipynb` and `xlsx` (ask again only if
   notebooks or workbooks appear in the vault — XLSX would reuse the CSV
   table on `read_packed`); RTF, ODT, Pages, Numbers, eml/mbox, ics/vcf
   (calendar is on the PLAN.md §2.2 not-list); a "reader mode" for text
   (a mode is a feature, §4.4).

## Rejected alternatives

| Alternative | Why not |
|---|---|
| `pdf_viewer.mjs` (`PDFViewer`, `PDFFindController`) | +71 kB gzip and its stylesheet for what ≈80–200 lines on the public API do |
| Rebinding `Cmd+=` / `-` / `0` inside the viewer | Global chords; the owner wants shortcuts that work everywhere |
| papaparse, a JSON-viewer package, SheetJS | A dependency each for 40–120 lines of own code |
| Rendering SVG in the editor pane | The editor shows source; the second representation lives behind the eye like the Markdown preview |

## Consequences

- `docs/KEYMAP.md` gains the `viewer` scope with the PDF paging rows and
  the mouse-gesture rows (image click in the preview; click toggles zoom);
  the keymap parity test covers them. New strings for the outline popover
  and the page keys go into both catalogs; the zoom strings exist.
- `file_types.rs` (ADR-0022) gains three `view` rows after the decode
  check and a `preview` flag for `csv tsv svg` in the presentation module.
- Eager budgets are untouched; the CSV table and the SVG toggle are ≈3 kB
  and ≈30 lines in the lazy viewer/preview chunks.
- ADR-0020's "not built" sentence for non-Markdown previews is amended by
  this record: CSV/TSV and SVG have one; everything else still does not.
