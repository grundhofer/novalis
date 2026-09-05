# @novalis/tokens

Semantic design tokens for the desktop UI. Two files, the same token names in
both:

| File | Style | Used by |
|---|---|---|
| `tokens.css` | **Dev-Noir** (the chosen style, docs/DECISIONS.md §4.6) | `apps/desktop/ui/src/main.tsx` |
| `swiss.tokens.css` | Swiss (the alternative) | nothing yet; swap the import to try it |

Both are marked **GENERATED-PENDING** (PLAN.md §5.9): they are hand-written
from `design/variants/css/<style>.css` until designSprache ships DTCG tokens,
at which point `just tokens:sync <slug> <commit>` vendors the Style Dictionary
output with a SHA-256 manifest and CI fails on drift. Until then, treat them as
generated anyway — change the style spec, then re-derive.

## Rules

- Components use semantic tokens only (`--ds-color-bg-canvas`,
  `--ds-color-fg-default`, `--ds-radius-control`, `--ds-font-sans`, …). No
  component names a raw colour, font, radius or duration; the PR checklist in
  PLAN.md §11.5 makes that a review item.
- Light and dark are two complete sets, never `filter: invert()`. Light is on
  bare `:root` and `[data-theme="light"]`, dark on `[data-theme="dark"]`.
  `index.html` stamps `data-theme` on `<html>` before first paint so there is no
  flash; `settings.appearance` (`system`/`light`/`dark`) drives it afterwards.
- Mode-independent tokens (type, space, radius, motion, metrics) sit in a
  second `:root` block at the end of each file.
- `--ds-font-size-editor` is the one token the user changes, via
  `Cmd+=` / `Cmd+-` / `Cmd+0` writing `editor.fontSize`. The UI sets it as an
  inline style on `<html>`.
- Status is one accent plus green/amber, always with the word (Dev-Noir), and
  form plus the word in one hue (Swiss). There is no `danger` hue in either
  set: destructive states use the warning slot.
