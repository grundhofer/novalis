# 20. The read-only preview: ⌘E, rendered in Rust, Mermaid for diagrams

Date: 2026-09-15

## Status

Accepted. Builds the v1.1 yes of PLAN.md §4.4 ("Read-only rendered Markdown
preview (`Cmd-E`)"); amends ADR-0008 (`Cmd-E` was reserved and unbound) and
PLAN.md §2.3 rule 8 (the IPC cap is 30, not 25).

## Context

The editor is decorated source (D3): a `![](attachments/…)` link written by
ADR-0017 is a line of text, and the image behind it is not shown. Testing
the sidebar branch on 2026-09-15, the owner wrote:

> der screenshot wird als zeile hinzugefügt, ist aber nicht sichtbar

> wir sollten zwischen editier und view mode für .md umschalten können mit
> einem kleinen button

Asked "Bilder im Editor sichtbar machen?":

> Erst im Lesemodus ⌘E

The preview needs one IPC command for the rendering, and ADR-0015 and
ADR-0017 had used the 23rd and 24th of the 25 rule 8 allowed. Asked
"IPC-Obergrenze: PLAN §2.3 Regel 8 sagt „unter 25 Befehle", die Vorschau
bräuchte den 25. Wie weiter?":

> Grenze auf 30 anheben (Recommended)

Earlier the same day, asked which extras the preview should draw (each a
dependency with its own ADR; KaTeX on the list, PlantUML explained as needing
Java or a server, which the privacy rule forbids):

> Mermaid (Recommended)

## Decision

- **`Cmd+E` toggles the preview of the open note** (`note.togglePreview`,
  scope `global`); the `docs/KEYMAP.md` row changes from `unbound` and the
  parity test is green. A small button at the end of the tab strip does the
  same and reads "View" or "Edit" (`editor.preview`, `editor.edit`); the
  View menu label (`menu.view.togglePreview`) is in both catalogs, as
  ADR-0008 asks for a chord. The mode is per tab and session state only —
  not persisted in `state.json`, not a setting (ADR-0004).
- **Rendering happens in Rust**: `novalis_core::notes::render::to_html` on
  `pulldown-cmark 0.13` with the `html` feature only — the crate PLAN.md
  §4.4 had named, three lockfile entries (`pulldown-cmark`,
  `pulldown-cmark-escape`, `unicase`). CommonMark plus the §7.2 GFM pieces
  (tables, task lists, strikethrough), footnotes and `[[wikilinks]]`; the
  frontmatter is skipped. Raw HTML in a note is emitted as text, so the
  fragment contains only markup the renderer wrote and the WebView can insert
  it as it is — nothing a note carries becomes a script, a frame or a form.
- **One new IPC command, `render_markdown(text) -> html`**, the 25th. Rule 8
  now reads "under 30"; CLAUDE.md and `lib.rs` say the same.
- **In the preview:** relative images — the ADR-0017 attachments — are read
  through `read_blob` (ADR-0015) and shown as `blob:` URLs, the way the
  viewer shows an image; an internal link is followed like ⌘-click in the
  editor (wikilink or relative Markdown path, `lib/links.ts`); an external
  link is not opened — there is no opener plugin and no outbound anything
  (docs/PRIVACY.md), so a toast says so (`editor.previewExternalLink`).
- **`mermaid` fenced blocks are drawn by Mermaid 12** (MIT), in the
  WebView, `securityLevel: "strict"`. It is its own chunk, loaded only when
  a note in preview has such a block; none of it is in the eager bundle. It
  is the largest npm addition since the scaffold: 117 packages in
  `pnpm-lock.yaml` (33 of them `@types/*`), among them `d3`, `cytoscape`,
  `chevrotain`, `dompurify`, `elkjs` and `katex` — the last one because
  Mermaid renders math inside diagram labels with it. That is not the KaTeX
  the owner did not select: `$…$` in note text is not rendered. Mermaid
  makes no network call; the CSP's `connect-src` would refuse one anyway.
- **Not built:** KaTeX for notes (not selected), PlantUML (rejected),
  inline images in the editor (D3), a persisted preview state, a preview for
  anything but Markdown.

## Consequences

- PLAN.md §4.4's row reads "yes, built 2026-09-15 (ADR-0020)"; §7.2's
  "Mermaid" clause says the ⌘E preview renders it; rule 8's cap is 30.
- `scripts/lockfile-adr-check.mjs` will ask for this ADR's number on the pull
  request that adds `pulldown-cmark` and `mermaid`.
- The preview renders footnotes, which PLAN.md §7.2 lists as "not in v1" for
  the editor's parser; the editor still does not know them. The two parsers
  (`@lezer/markdown` in the editor, `pulldown-cmark` in the preview) can
  disagree at the edges; the preview is read-only, so a disagreement costs a
  look, never bytes.
- Mermaid draws into inline SVG with inline styles, which the CSP's
  `style-src 'unsafe-inline'` already allows for the app's own styles.
- Approved for later, each with its own ADR when built (ADR-0016): EPUB,
  DOCX, CBZ.

**Amended 2026-09-16** — the owner, testing: "der vorschau/bearbeiten button
kann je nach breite ausgeblendet werden, wenn viele notizen offen sind. der
sollte immer sichtbar sein und ein icon, keinen text haben, weil weniger
infos." The toggle is a glyph (an eye) in a fixed cell beside the scrolling
tab strip, pressed while previewing, its state in the tooltip. That and the
day's other controls exhausted the 20 KB eager-CSS budget of PLAN.md §11.3
even after the duplicated tool rules were merged; the owner raised it to
24 KB ("Budget auf 24 kB anheben (Recommended)"), `docs/BUDGET.json` and
§11.3 say so.

**Amended 2026-09-16 (chords)** — the same day the owner wrote: "die
shortcuts sollten auch im view mode funktionieren, nicht nur im edit mode."
Asked "Welche Shortcuts sollen in der Vorschau (Ansehen-Modus) wirken?":
"Suchen ⌘F / ⌘G / ⇧⌘G (Recommended), es sollte auch möglich sein im vorschau
modeus mit command b zum beispiel etwas fett zu markieren". (A formatting
toolbar, asked about in the same breath, was declined — PLAN.md §2.2 and
§7.1 keep it out, the palette lists the four formatting chords;
`docs/DECISIONS.md`.) So the preview answers five of the editor's chords,
routed by `lib/commands.ts` through `lib/previewBridge.ts` while a preview is
mounted. `Cmd+F` opens a find bar over the rendered text — the editor's own
find strings (`editor.find.*`), the matches marked, `Cmd+G` / `Shift+Cmd+G`
moving between them, `Escape` closing it; its rules are in the lazy
`preview.css`, not the eager sheet. `Cmd+B` and `Cmd+I` take the selected
rendered text and find it in the source of its block: the renderer now tags
paragraphs, headings and list items with the block's source span
(`data-pos="start-end"`, UTF-16 units of the whole note text, frontmatter
included), and `lib/previewEdit.ts` (`toggleMarkInSource`) toggles `**` or
`_` around the one occurrence of the selection in that span — in the buffer
(`editorSave.setText`), so the preview re-renders from it and the autosave
writes it. When the selection cannot be placed — across blocks, split by
markup, more than one occurrence, or empty — the tab switches to the editor
instead of guessing; every other editor chord (`Cmd+K`, `Cmd+Enter`,
`Ctrl+G`, `Cmd+D`, …) switches to the editor too, so the chord lands where
it applies, and is not replayed there. Nothing is typed into the preview,
and a mark lands only where the selected text occurs exactly once in the
block's source, so a disagreement between the two parsers still costs a
look, never bytes. No new dependency, string key, command id or chord;
`docs/KEYMAP.md` "Not listed" says which chords the preview answers.

**Amended 2026-09-23** — ADR-0039: a task box in a list item of the preview
is clickable and flips its `[ ]` / `[x]` in the note's source, the same
single write the editor's box makes. Nothing else in the preview writes.

**Amended 2026-09-23 (2)** — ADR-0044: an external web or mail link in the
preview is no longer refused; a click hands it to macOS, which opens it in
the default browser or mail app. "Not opened — there is no opener plugin
and no outbound anything" above is superseded for those two schemes;
novalis itself still opens no connection.

**Amended 2026-10-25** — ADR-0051 #16 (sebaro view step 4): the eye glyph
goes. The toggle is sebaro's compact tool (`sb-icon-button--compact`) with
the sprite's `book` icon, one name „Vorschau“ / „Preview“ with its state in
`aria-pressed` instead of a name that switched between „Ansehen“ and
„Bearbeiten“, and sebaro's tooltip „Vorschau ⌘E“. It stays in its fixed cell
beside the scrolling tab strip and only for a file with a second
representation; `Cmd+E` and the command are unchanged. The sprite has no eye;
`book` is what sebaro's own draft of the novalis views took for the reading
view (docs/sebaro-luecken.md H).

**Amended 2026-10-25 (2)** — ADR-0051 #17, #18, #24, #27.2, #27.4–#27.6,
#27.8 (sebaro view step 6): the body is sebaro's `.sb-prose` (line height
1.5, headings on sebaro's scale relative to the editor's size as the editor
draws them, sebaro's link style with the external-link icon, the quote's ink
line, the hairline rule, inline code on `surface-sunken`). The core's
fragment is dressed in the WebView, not in the renderer: a code block is the
bare `pre.sb-code` without a copy button, a table `table.sb-table` in a
focusable `sb-table-wrap` region, a task box sebaro's checkbox box, its
click unchanged (ADR-0039). Mermaid draws with its `base` theme in sebaro's
colours, read from the tokens when a diagram is drawn, instead of its own
`default` / `dark` themes. The find bar is the editor's — sebaro's compact
search field and 32 px tools instead of the glyphs ‹ › × — its hits sebaro's
`mark` with `aria-current` on the current one and the count „Treffer 1 von
2“ / „Match 1 of 2“ in a status line. A jump's target carries the 3 px place
line for a moment and lets it fade, instead of a fill. While the fragment is
on its way the pane is empty, without „Wird geladen …“: rendering is local
work (STA-06). The preview still has no `#tag` and no mark for an
unresolved link: pulldown-cmark knows neither (ADR-0037, ADR-0038), and
#17 / #18 have nothing there to restyle (docs/sebaro-luecken.md K).

**Amended 2026-10-26** — ADR-0051 #40 (D102 (32)): footnotes in the preview
are sebaro's. The WebView turns the core's footnote markup into the digit
`a.sb-note-ref` („Fußnote n“ / „Footnote n“) and the list `section.sb-notes`
„Fußnoten“ / „Footnotes“ at the end of the text, each note led by its way
back „Zurück zur Stelle n“ / „Back to place n“ to the digit it was reached
from. A jump moves focus to the note or back to the digit and marks the
place until the next key or press. The ids are the fragment's own, unique
in the window. The core's HTML and the CLI are unchanged. Owner's yes: „Ja,
in der Vorschau (Empfohlen)“ (ADR-0051).
