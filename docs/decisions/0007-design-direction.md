# 0007 — Design direction: Dev-Noir primary, Swiss alternative, tabs

**Status:** accepted · **Date:** 2026-09-05 · **Decider:** Sebastian Grundhöfer

## Context

Four directions from the owner's design catalog (Swiss, Editorial-Print, Dev-Noir, Warm Editorial) were built as eleven static frames on one comparison page with identical reference content (PLAN.md §6). The catalog's own finder ranked Swiss first in every scenario and Dev-Noir second for dev-tool use; Dev-Noir is the catalog's stated natural habitat for a Tauri window with a command palette. The catalog's verdict on Dev-Noir demands three own decisions — a non-violet accent, an own type pairing, a signature component — and an equally maintained light theme. The owner chose after seeing the frames.

## Decision

| Question | Decision |
|---|---|
| Family / style | Grotesk; **Dev-Noir** primary; **Swiss** kept as the alternative token set (semantic tokens, so a swap costs tokens only) |
| Layout | Tabs on: **L2** for notes (sidebar + tab strip), **L4** for the board as a pane in the same window; L3 is L2 with the sidebar hidden (`Cmd-\`); L5 (board + note split) stays post-v1 (D21) |
| Status coding | One accent plus green/amber, always accompanied by the word; never colour alone |
| Accent hue | Teal **`#4FB3BF`** (dark) / **`#1F7A83`** (light), as shown in the frames; violet is excluded by the catalog verdict |
| Window chrome | Custom **38 px** title bar with breadcrumb `vault / folder / note.md` and a `kbd` badge on the right; traffic lights inset |
| Textures | **Off**: no film noise, no grid, no radial glow, no gradients |
| Fonts | **Inter** (400–550) + **Geist Mono** for time, ids, counters, shortcuts, status bar; Latin subset, self-hosted woff2, ≤ 250 KB (D10) |
| Colour modes | Dark is the primary set (`#08080B` / `#0D0E12` / `#14151A`); the **light ladder is derived** (`#FAFAFA` / `#FFFFFF` / `#F4F4F5`, hairlines `.08/.12/.30` black) and ships as an equal, maintained theme |
| Mockup language | German first |

Applied rules: exactly one radius per element class (6–8 px controls, 10–12 px containers), no drop shadows between surfaces (depth = lighter layer + 1 px hairline; the deep shadow only under palette/modals), interactive borders one clearly lighter step (≥ 3:1) than decorative hairlines, `tabular-nums` on all numbers, focus ring as one global utility, motion 120–180 ms without scaling above 1.02. `packages/tokens/tokens.css` is written after the Spike C go/no-go (D13) and components use semantic tokens only (`--ds-*`).

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Swiss as primary | Owner: "dev noir first and then as alternative swiss"; Swiss stays as the second token set |
| Editorial-Print, Warm Editorial | The serif/paper pair; not chosen |
| No tabs (L1), palette-only (L3) as the base layout | Owner: "I think we need tabs"; L3 is reachable by hiding the sidebar |
| Board + note split (L5) | A pane-focus model the plan rejects for v1 (D21) |
| Violet accent (Linear) or Swiss red for Dev-Noir | Catalog verdict forbids violet; red is the Swiss signature |
| Native title bar | Loses the Dev-Noir signature; the custom bar carries the breadcrumb |
| Full Dev-Noir texture vocabulary | Noise under prose; the sheet itself names glow/gradient as the part that dates first |
| System fonts only | Erases recognition (owner's own research note); Inter is already in the old pipeline |

## Consequences

- A light theme is mandatory and maintained equal to dark; contrast is checked per token (light green for text darkened to ≈ `#176F49`, unverified on screen).
- The `kbd` badge in the title bar is the signature component; its label is the palette chord from `docs/KEYMAP.md` (`⇧⌘P`), because ADR-0008 binds `Cmd-K` to link insertion. The frames showed `⌘K`; the label follows the keymap, not the frame.
- Accent hue and title bar stand as shown in the mockups: DECISIONS.md records the implementation go of 2026-09-05 ("go with implementation and use subagents where usefull") as closing both formerly pending items. A change needs an amendment to this ADR, not a new token set.
- Hard-coded colours, fonts and radii are forbidden in components (PR checklist); tokens are the only source.

**Owner approval:** 2026-09-05 — "i like two style dev noir first and then as alternative swiss, but what is exactly the difference in layout? I think we need tabs" (docs/DECISIONS.md, "Design (§4.6) — answered 2026-09-05 after the mockups").

## Sources

PLAN.md §4.6, §5.9, §6, D10, D13, D20, D21 · docs/DECISIONS.md · design/variants/specs/dev-noir.md · design/variants/css/dev-noir.css (accent values) · docs/research/2026-09-05-design.md (F5, R2, R4)
