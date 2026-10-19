# 0048 — Design: sebaro replaces Dev-Noir

**Status:** accepted · **Date:** 2026-10-19 · **Decider:** Sebastian Grundhöfer

## Context

The owner built one design system for all sebaro apps and sites in the sebaroDesign repo (`systems/sebaro`: cobalt and lime, Radio Canada and sebaro Mono, app tiles by purpose group) and chose novalis as the first app to be rebuilt in it. Before any code, a sketch of novalis in sebaro was shown (sebaroDesign `concepts/runde-4-novalis/skizze.html`, two rounds). The owner answered its four questions and asked for the primary action in every view. A font-budget worry from the sketch turned out to rest on the wrong font files. ADR-0007 says a change of accent or title bar needs an amendment to it; this ADR is that amendment.

## Decision

| Question | Decision |
|---|---|
| Style | **sebaro** (sebaroDesign token contract 1.5) instead of Dev-Noir; light and dark stay two equal token sets in `packages/tokens/tokens.css` under the existing `--ds-*` names, hand-mapped until sebaroDesign exports them |
| Colour jobs | Cobalt = place, link, focus. Lime = the one primary action of a view. Status = glyph plus word. The petrol app colour `#0F8186` appears only in the app tile, nowhere else in the UI (sebaro D40) |
| Danger | A danger hue for destructive actions (`--ds-color-danger-*`); warning keeps "needs attention". Every confirmation dialog guards a destructive action, so its button is the danger button |
| Depth | 2 px ink lines between layers (title bar, sidebar, action zone, palette, dialogs, popovers); no fills between surfaces, no shadows (`--ds-shadow-modal` is `none`) |
| Place | The current note, tab, palette row and pressed tool carry the 3 px cobalt place line, no fill |
| Primary action | A 56 px action zone at the bottom of the window, under a 2 px ink line: the state sentence (the former status bar) on the left, the lime primary on the right. "New Note" in every view; "Open Vault…" while no vault is open. The empty state's own button goes |
| Destructive actions | Danger text, a 1 px danger frame, and the 45-degree cut at the top-right corner, the only place the cut appears |
| Links | Text colour with a 2 px cobalt underline, in the editor, the preview and on cards |
| Fonts | **Radio Canada** (UI and prose, variable 400–700, normal and italic) and **sebaro Mono** (a renamed IBM Plex Mono, code, front matter and code files only), as the Latin-plus-German WOFF2 subsets from sebaroDesign `systems/sebaro/fonts/web/`, bundled under `apps/desktop/ui/src/fonts/` with their OFL texts; 57.5 kB together against the 250 kB budget. Dark mode sets text 30 weight units heavier. `@fontsource-variable/inter` and `@fontsource-variable/geist-mono` are removed |
| Title bar | 48 px instead of 38 px; the 32 px app tile (the flower on petrol, no code) before the breadcrumb; the `⇧⌘P` badge stays (removed the same day by ADR-0050) |
| Start | At launch the 96 px tile flies from the window's middle into the title bar's tile in 200 ms, without the code; with reduced motion it is simply there |
| Icons | The sebaro icon set, inline SVG in `currentColor` (`components/Icon.tsx`), for the sidebar tools, the settings button, the primary action and the trash button; no icon font, no image file |
| Motion | One rule: 160 ms standard ease, 200 ms for the start; every duration collapses to 1 ms under reduced motion (macOS or ADR-0049) |

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Keep Dev-Noir and only swap the accent | The owner chose to rebuild novalis in sebaro ("starte mit novalis") |
| Petrol as novalis's UI accent | Owner: product colour only in the tile (answer 1, "ja passt") |
| Raise the font budget to 330 kB, or SF Mono, or only the three day weights | All three came from counting the six hinted desktop TTFs; the variable web files carry every weight in 57.5 kB, and the owner keeps both families ("wir behalten beide schriftarten") |
| One merged sebaro font for UI and code | A merged file weighs the same; a real mono companion to Radio Canada is weeks of type design |
| Warning for destructive actions (Dev-Noir rule) | Owner: a danger hue (answer 4) |
| Remove the sidebar's `+` because the action zone has New Note | It is an ADR-0012 control; not removed without the owner's word |

## Consequences

- `--ds-*` names are unchanged, so components did not need new names; new tokens were added for the line widths, the primary action, danger, focus, the tile and the start.
- Mono for metadata (counts, dates, status, palette foot, board counts) is gone: sebaro keeps mono for code (sebaro D38); paths in quick-open and on card chips stay mono.
- The status bar's look changed, its content did not: the same counts and cloud state, now the action zone's state sentence.
- Not done in this step and still open: the external-link icon after web links (sebaro D56), progress shown inside the primary action (sebaro D48), the app icon set from sebaroDesign `brand/dist/novalis/tauri`, a check on screen in the real window.
- Eager CSS is 22.6 of 24 kB.

**Owner approval:** 2026-10-18 — "ja, bitte committen! danach entweder retrobeam oder novalis umbauen, keine der billo android apps", then "ja, mach das genau so. denk bitte dran, dass die andere zeichen auch weitere designregeln festgelegt, die wir beim umbau auch berücksichtigen müssen. starte mit novalis". 2026-10-19, on the sketch's questions (1 petrol out of the UI, 2 the reduce-motion setting, 3 the fonts, 4 the danger hue): "1 ja passt / 2 die Einstellung ermöglichen / 3 Warum brauchen wir beide Schriftarten? / 4 ja, nach das / Die Skizze könnte näher an den Anforderungen sein. Der Hauptbutton für neue Notiz ist nicht überall. Bitte nochmal prüfen ob alles beachtet wird wie Tintenlinie lindgruner Hauptbutton etc" ("nach das" read as "mach das"); after the second sketch and the font answer: "ja, dann fang bitte damit an, wir behalten beide schriftarten und merke dir diese entscheidung für unsere anderen projekte" (sebaroDesign DECISIONS D65, D66).

## Sources

ADR-0007 · ADR-0012 · ADR-0049 · sebaroDesign `DECISIONS.md` D37–D40, D46, D48, D50–D52, D55–D57, D62, D65, D66 · sebaroDesign `systems/sebaro/dist/tokens.css` (commit 8b8d4a7) · sebaroDesign `concepts/runde-4-novalis/skizze.html` and `notes.html`
