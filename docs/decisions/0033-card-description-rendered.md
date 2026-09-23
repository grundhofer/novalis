# 33. The card description is rendered as Markdown

Date: 2026-09-23

## Status

Accepted. Reopens the one part of ADR-0013 it deferred ("No Markdown
rendering in v1"). Adds a field to the shell's `CardDto`
(`descriptionHtml`); the card file does not change. No IPC command, no
setting, no dependency, no string.

## Context

ADR-0013 gave cards a `description`, Markdown by convention, and showed it
as plain text because rendering would have been a dependency and its own
decision. Since ADR-0020 the shell renders Markdown for the ⌘E preview
(`notes::render::to_html`, pulldown-cmark), so the reason is gone, while the
placeholder still promised "Description (Markdown)" and a card showed `**`
and `- [ ]` raw. The owner answered the feature-gap question on 2026-09-20
(`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `kanban-description-markdown` — "the
card description rendered as Markdown with links and boxes inert,
reopening ADR-0013 now that the renderer exists" (row B14 of
`docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **The shell renders each card's description** with the preview's
  renderer when it builds the `CardDto` (`descriptionHtml`, `null` without
  a description); raw HTML in the text comes back as text, as in the
  preview. The board pane inserts the fragment under the title.
- **Inert:** links, `[[links]]` and task boxes are drawn, not followed or
  toggled — the description ignores the pointer (`pointer-events: none`)
  and a click on it is the card's click (D21 / ADR-0030). Toggling a box
  from the card would be a write per click and its own decision.
- **At the card's size:** blocks lose their document margins, headings are
  strong text at the body size, pictures are not shown; still three lines,
  now clamped by height (`max-height: 3lh`), because WebKit's
  `-webkit-line-clamp` collapses block children — measured in the app,
  where the first attempt showed nothing.
- Editing is unchanged: the same multi-line dialog over the source text.
- **Not built:** clickable links or boxes on the card, images, a card
  detail view (ADR-0013 still excludes it).

## Consequences

- ADR-0013 is amended to point here. `CardDto` grows a derived field; the
  bindings change, the card format (§8.2) does not.
- A shell unit test checks rendering and escaping; the pane test checks the
  fragment is shown and a click on a link in it opens the card's note.
