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
- Done in a second step the same day:
  - **External links:** a link in the preview that leaves the app (web, mail, phone) ends in the 16 px `external-link` icon (sebaro D56). The editor shows the Markdown source and gets no icon there.
  - **Progress in the primary action** (sebaro D48), in the dialog's lime OK, which is where every create and rename runs:
    - while `submit` runs, OK says what runs ("Wird angelegt …", otherwise "Wird gesichert …") and an ink bar sweeps inside it; under reduced motion the bar stands still;
    - a failure stays in the dialog as a sentence in danger and OK becomes "Noch mal versuchen", instead of a toast;
    - there is no "✓ Angelegt" step, because on success the dialog closes and the result (the opened note, the new card) is shown;
    - confirmation dialogs close at once as before.
  - **App icons:** generated with `cargo tauri icon` from sebaroDesign `brand/dist/novalis/tauri/icon-1024.png` (the flower with `nvs` on petrol). They replace the Dev-Noir placeholder and its generator script.
- Checked in the real window on 2026-10-19 (`just dev`) by the owner.
- Eager CSS is 23.5 of 24 kB: the next stylesheet change of any size needs room made first.

**Amended 2026-10-24** — ADR-0051 #27: the fonts are the sebaro export's own, sebaro Sans (variable 400–700, normal and italic) and sebaro Mono in its one Medium 500 face (sebaroDesign D68, D70, D71), registered only by `ui/src/sebaro/fonts/fonts.css` with the OFL texts beside them; `apps/desktop/ui/src/fonts/` and `styles/fonts.css` are gone. The page text now takes the regular weight token, so the dark mode's 30 units reach running text too, and no weight is synthesized.

**Amended 2026-10-25** — ADR-0051 #13 (sebaro view step 7): the dialog is sebaro's `.sb-dialog`, a native `<dialog>` opened with `showModal()` over the scrim (radius 16, at most 560 px, title in the `title` role); focus moves in when it opens and back to where it came from when it closes, and Escape or a press on the scrim cancels. The field is sebaro's `.sb-field` with a visible label instead of a placeholder (EIN-01) and the hint under it. There is no lime action in a dialog any more (EBE-03, AKT-01): the submit verb („Anlegen“, „Umbenennen“, „Sichern“) is a secondary action, and the dialog's progress (the D48 bullet above) is now sebaro's waiting state of a secondary action (spec/02 §1.7) — only after `submit` has run for a second, the turning `loader`, the word of what runs („Wird angelegt …“) and `aria-busy`; no ink bar. A failure still stays in the dialog and the verb still becomes „Noch mal versuchen“, but the sentence is in text colour with the error sign before it (D83 (2)); a taken or impossible name is said at the field (`.sb-field__error`, `aria-invalid`, EIN-02). A confirmation has „Abbrechen“ first and with the initial focus (AKT-08); its verb is still the danger action with the cut, now sebaro's `.sb-danger-action` with the 24 px trash.

**Owner approval:** 2026-10-18 — "ja, bitte committen! danach entweder retrobeam oder novalis umbauen, keine der billo android apps", then "ja, mach das genau so. denk bitte dran, dass die andere zeichen auch weitere designregeln festgelegt, die wir beim umbau auch berücksichtigen müssen. starte mit novalis". 2026-10-19, on the sketch's questions (1 petrol out of the UI, 2 the reduce-motion setting, 3 the fonts, 4 the danger hue): "1 ja passt / 2 die Einstellung ermöglichen / 3 Warum brauchen wir beide Schriftarten? / 4 ja, nach das / Die Skizze könnte näher an den Anforderungen sein. Der Hauptbutton für neue Notiz ist nicht überall. Bitte nochmal prüfen ob alles beachtet wird wie Tintenlinie lindgruner Hauptbutton etc" ("nach das" read as "mach das"); after the second sketch and the font answer: "ja, dann fang bitte damit an, wir behalten beide schriftarten und merke dir diese entscheidung für unsere anderen projekte" (sebaroDesign DECISIONS D65, D66).

## Sources

ADR-0007 · ADR-0012 · ADR-0049 · sebaroDesign `DECISIONS.md` D37–D40, D46, D48, D50–D52, D55–D57, D62, D65, D66 · sebaroDesign `systems/sebaro/dist/tokens.css` (commit 8b8d4a7) · sebaroDesign `concepts/runde-4-novalis/skizze.html` and `notes.html`
