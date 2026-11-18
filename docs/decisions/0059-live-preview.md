# 0059 — The note's preview is a live preview, written in

**Status:** accepted · **Date:** 2026-11-18 · **Decider:** Sebastian Grundhöfer

## Context

A note shows as decorated source (D3): every Markdown character stays visible. `Cmd+E` switched to a rendered, read-only preview (ADR-0020), in which only bold, italic and a task box reached the source (ADR-0020 amended, ADR-0039). A hide-syntax live preview was declined in the week-1 list (`docs/DECISIONS.md`, „Hide-syntax live preview: no“; PLAN.md D3), because the old WYSIWYG editor lost text five times in its round trip from rendered text back to Markdown. The owner now wants to write while the note looks formatted. Offered: a live preview in the editor, which hides markers but never re-serializes, or an editable rendered preview converted back into Markdown (advised against, the old data loss). Then: whether `Cmd+E` becomes the live preview, whether the live preview becomes the default, or whether there are three modes. Then: the whole set of elements including images, tables and diagrams, or the text formats first.

## Decision

- **`Cmd+E` on a note switches the editor into its live preview** and back; the switch in the tool row, View ▸ Preview and the chord stay as they are (ADR-0020, ADR-0051 #16, #43). It is the same editor view: the cursor, the scroll and the undo history stay. The read-only rendered preview of a note is gone. A CSV, a TSV and an SVG keep their read-only preview (ADR-0025).
- **The text stays its source.** Nothing is converted or rewritten; what is typed is what is saved, byte for byte. The live preview only decorates the parse tree, as the decorated source does.
- **What steps aside.** A heading's `#`s, the marks of bold, italic, strikethrough and inline code, a link's brackets and destination (its words show), a `[[link]]`'s brackets (and its target when it has a `|label`), an autolink's `<>`, an escape's backslash, a quote's `>`. A bullet's `-` becomes `•`; a task's bullet goes, its box stays (§4.3). A rule `---` becomes a line.
- **What is drawn.** An image from the vault (its bytes through `read_blob`; a web address is never fetched, its alt text shows). A table, rendered by the core (`render_markdown`) in sebaro's table look and named after the heading before it, as before (ADR-0051 #52, #53). A ```mermaid fence as its diagram in sebaro's colours (ADR-0020, ADR-0051 #27.6).
- **Where the source comes back.** An inline element shows its marks while a cursor is in it or next to it; a line's markers while a cursor is on the line; a table or a diagram while a cursor is in it. A click on a drawn block puts the cursor there.
- **Clicks.** A plain click on a link that shows only its words follows it, as `Cmd`-click does in the source; a click on an image the viewer shows opens it there (ADR-0025). Everywhere else a click places the cursor.
- **Every editor chord works in it**, the format tools stay on (they were off in the preview, ADR-0051 #74), the status bar shows the cursor, and find is the editor's own.

No setting, no new dependency (CodeMirror and its Markdown parser are already there), no new IPC command.

## Consequences

- Supersedes the note half of ADR-0020 and ADR-0039 and the "Hide-syntax live preview: no" of the week-1 list; PLAN.md D3 and §4.4 say so.
- **Lost with the rendered preview:** footnotes as sebaro's endnotes (`[^1]` stays text), the find bar over rendered text (the editor's find works instead), and the place line a jump drew on a rendered block (the cursor shows the place). The strings `preview.footnote*` are gone.
- Other code blocks, front matter, HTML and footnotes stay source in the live preview.
- `components/Preview.tsx`, `lib/previewBridge.ts` and `lib/previewEdit.ts` are removed; the image, table and diagram drawing moved to `editor/liveBlocks.ts`.
- The bundle budget's fifth row, `previewChunkGzipKb` (the Preview chunk, ADR-0022 point 8), goes with the chunk; the live preview is part of the editor's lazy chunk, and mermaid stays a chunk of its own, loaded on the first diagram.

**Owner approval:** 2026-11-18 — „ich will auch im vorschau modus schreiben können -> bei markdown kann man somit formatiert schreiben“. Then, asked how: „Live-Vorschau (Recommended)“; the modes: „⌘E wird beschreibbar (Recommended)“; the scope: „Alles inkl. Blöcke (Recommended)“.

## Sources

D3 · ADR-0020 · ADR-0025 · ADR-0039 · ADR-0051 · PLAN.md §4.3, §4.4, §5.3
