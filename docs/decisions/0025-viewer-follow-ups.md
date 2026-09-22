# 25. Viewer follow-ups: more image types, PDF outline and keys, image zoom, CSV table and SVG behind the eye

Date: 2026-09-20

## Status

Accepted, and all four items are built (2026-09-22), each its own small
pull request: item 1 (`heic heif avif`, checked in `just dev`), item 2
(the PDF outline and page keys), item 3 (image zoom) and item 4 (the CSV
table and the SVG picture behind the eye). Amends
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
   stay out. *Checked 2026-09-22* in `just dev` (macOS 26): a 640×400 and a
   4032×3024 HEIC and AVIF written by `sips`, and the same HEIC renamed
   `.heif`, each show in the image viewer and in the ⌘E preview of a note
   that embeds them. Only macOS 26 was checked; the app's floor, macOS 14,
   was not. Attachments (ADR-0017) and CBZ pages (ADR-0023) keep
   their own five types; this item widens neither.
2. **PDF (ADR-0016 amendment)**: an outline popover from
   `doc.getOutline()` + `getPageIndex(dest)` — the same popover the EPUB
   reader uses for its table of contents (ADR-0023) — and keyboard paging
   `← → PageUp PageDown Home End` inside the pane. These are the first
   rows of a new keymap scope `viewer` in `docs/KEYMAP.md` (parity test).
   *Built 2026-09-22*, with three details the record left open: the
   popover became one component both readers use (`ContentsPopover.tsx`),
   and a nested outline entry is indented by its depth; an entry that leads
   to no page of the file (a web link, a missing named destination, a
   broken reference) is left out and its children move up a level, and the
   contents button is not shown for a PDF without an outline; `PageUp` and
   `PageDown` have their own command ids (`viewer.pageUp`/`pageDown`)
   because the parity test allows one chord per id — with one page on
   screen they turn it like the arrows, and they are the keys that would
   scroll by a screen under continuous scrolling. The pane takes focus when
   it opens, as the editor does, and the window's keymap handler leaves
   `viewer` chords to it, so an arrow key anywhere else is untouched.
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
   *Built 2026-09-22* (`ZoomableImage.tsx`, the image viewer's and each
   comic page's), with what the record left open: *fit* is fit to the pane,
   both sides, and never enlarges past 1:1 — so its button reads
   `viewer.fit` ("Fit" / "Einpassen"), a new string, because "Fit width" /
   "Seitenbreite" would name a different thing; a plain wheel scrolls and
   only a `Ctrl`-wheel zooms, around the pointer, as do WebKit's own pinch
   events (`gesturestart`/`gesturechange`), which are listened to beside
   the wheel because Safari has reported a trackpad pinch that way rather
   than as a `Ctrl`-wheel (which of the two this WebView sends was not
   measured); a comic keeps its zoom as the pages turn, each page
   starting at its top left; in the preview only an image the viewer shows
   opens on a click (an SVG is text to the app), and an image inside a link
   follows the link. Checked in `just dev` for the bar, the click, a
   synthesized `Ctrl`-wheel and a page turn; a real trackpad pinch could
   not be synthesized and was not checked.
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

   *Built 2026-09-22* (`TablePreview.tsx`, `SvgPreview.tsx`,
   `lib/delimited.ts`), with what the record left open: which files have a
   second representation is `previewKind` in `lib/fileTypes.ts`, not a
   flag in the presentation module — that module is the editor's chunk,
   and the tab strip, the command and the pane choice are eager; the CSV
   parser is lenient where files are (a stray quote inside a cell is kept,
   a quote that never closes runs to the end, a byte-order mark is
   dropped); the columns are sized in `ch` by the widest cell of each column
   over every row (a sample cut the ids past its end), clamped to 4–40, one grid template for all rows so they line
   up although only a screenful is drawn, and a cut cell shows in full as
   its tooltip; an empty file is an empty table; an editor chord in the
   table or the picture returns to the text (neither has a find bar or a
   selection to mark), as the ones the rendered note cannot place do.
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
