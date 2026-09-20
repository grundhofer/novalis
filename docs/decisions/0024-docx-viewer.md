# 24. DOCX opens read-only through mammoth

Date: 2026-09-20

## Status

Accepted; not yet built (the third viewer pull request in
docs/research/2026-09-20-formats-plan.md §6, independent of ADR-0023).
Builds the 2026-09-15 approval recorded in ADR-0016 ("DOCX (nur lesen)").
Adds one npm package (`mammoth`, BSD-2-Clause) as the second runtime
package since the scaffold, as a lazy chunk of ≈136 kB gzip. No IPC, no
CSP change, no chord, no setting.

## Context

The owner approved DOCX read-only on 2026-09-15 (ADR-0016: "DOCX through
`mammoth`"). The format plan compared two builds: an own `word/document.xml`
→ HTML walker in TypeScript (300–500 lines, no dependency, with a long
fidelity tail — numbering formats, nested tables, text boxes, footnotes,
fields) and `mammoth` (1.12.x, BSD-2-Clause, ≈136 kB gzip lazy, ≈10 direct
and ≈26 transitive packages, no network access, no `eval` on its path as
far as a Node `vm` proxy test with `Function` blocked could show).
`docx-preview` renders page-like layout but wants its own CSS and the
document's embedded fonts (`font-src blob:`), the wrong shape for a reader
that follows the app's typography. Asked "mammoth … oder eigener 300–500-
Zeilen-Walker" with mammoth recommended, the owner chose:

> Alle Empfehlungen übernehmen (Recommended)

## Decision

- **`mammoth` becomes a direct dependency of the UI**, loaded only when a
  `.docx` tab opens. The file arrives through the existing `read_blob`
  (base64 over JSON), **capped at 15 MB** for this type — above that the
  tab shows a banner instead of a 4.6× transient copy in JavaScript — and
  mammoth's HTML goes through the same Shadow-DOM allow-list host as an
  EPUB chapter (ADR-0023), so a `<a href="https://…">` in a document is
  inert like everywhere else in the app and images (mammoth emits `data:`
  URIs, allowed by `img-src data:`) render. Headings, lists, tables,
  bold/italic, links as text; the app's typography, `editor.fontSize`,
  appearance-following colours.
- **Word's lock files `~$name.docx`** are not listed: they are not
  dot-prefixed, so `visible_entries` would show them; the `~$` basename
  rule lands with this pull request.
- **Before the pull request is opened**, mammoth runs once under the real
  CSP in `just dev` (no `unsafe-eval`); if it needs `unsafe-eval`, the own
  walker replaces it and this ADR is amended, since the CSP is not loosened
  for a reader.
- **What the viewer does not do**: edit, show comments or tracked changes,
  lay out pages, export, print, fetch anything.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Own `document.xml` walker (0 dependencies) | The fidelity tail is real and every gap is a bug report; the owner takes the recommended option |
| `docx-preview` (49 kB gz with jszip) | Page layout with the document's CSS and embedded fonts (`font-src blob:`); the wrong shape for a reader in the app's typography |
| Rust `docx-rs` and friends | Larger closure, XML → HTML in the core, which carries no presentation |
| Raising the `read_blob` cap | 50 MB base64 is already ≈230 MB transient in JavaScript; the type cap is lower, not higher |

## Consequences

- `scripts/lockfile-adr-check.mjs` asks for this ADR's number on the pull
  request that adds `mammoth`; `THIRD-PARTY-NOTICES.md` regenerates.
- The DMG grows by ≈0.7 MB raw (5.6 → ≈6.3 of the 12 MB budget); the
  release workflow's budget row is the check.
- PLAN.md §7.3 tier D gains `docx`; `x.docx` flips from negative to
  positive in `fileTypes.test.ts`; `file_types.rs` (ADR-0022) gains a
  `view` row and the `~$` basename exclusion.
- A 5 MB document converts in an estimated 100–300 ms; transient memory
  stays under ≈70 MB at the cap.
- Open until the pull request: the exact transitive closure of `mammoth`
  (counted offline as ≈26; the lockfile diff tells) and the CSP run above.
