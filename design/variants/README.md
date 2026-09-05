# UI/UX variants (2026-09-05)

Same DOM, same German reference content, five stylesheets from the owner's catalog (Swiss, Editorial-Print, Dev-Noir, Warm Editorial, Flat 2.0 control). Each frame is a 1280×800 window with a light/dark token set.

- `gen.py skeletons` writes the skeleton frames, `base.css`, `CLASSES.txt` and per-style specs; `gen.py build` assembles `index.html` from `css/<slug>.css`.
- `validate_css.py <slug> css/<slug>.css` enforces the catalog's scoping rule (every selector starts with `.style-<slug>`, no `:root`/`body`, no `url()`, prefixed `@keyframes`, both token sets present).
- `notes/<slug>.md` records each author's decisions, deviations and the critic's findings.
- Fonts load from Google Fonts on this comparison page only; the app bundles Latin-subset woff2 (PLAN.md D10).
- Palettes for the second colour mode are derived, not catalog data (design report F3–F6).
