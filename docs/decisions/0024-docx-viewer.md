# 24. DOCX opens read-only through mammoth

Date: 2026-09-20

## Status

Accepted and built (the third viewer pull request in
docs/research/2026-09-20-formats-plan.md §6, independent of ADR-0023).
Builds the 2026-09-15 approval recorded in ADR-0016 ("DOCX (nur lesen)").
Adds one npm package (`mammoth` 1.12.3, BSD-2-Clause, 26 lockfile entries
with its closure) as the second runtime package since the scaffold, as a
lazy chunk. No IPC, no CSP change, no chord, no setting.

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
  CSP (no `unsafe-eval`); if it needs `unsafe-eval`, the own walker
  replaces it and this ADR is amended, since the CSP is not loosened for a
  reader.
- **What the viewer does not do**: edit, show comments or tracked changes,
  lay out pages, export, print, fetch anything.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Own `document.xml` walker (0 dependencies) | The fidelity tail is real and every gap is a bug report; the owner takes the recommended option |
| `docx-preview` (49 kB gz with jszip) | Page layout with the document's CSS and embedded fonts (`font-src blob:`); the wrong shape for a reader in the app's typography |
| Rust `docx-rs` and friends | Larger closure, XML → HTML in the core, which carries no presentation |
| Raising the `read_blob` cap | 50 MB base64 is already ≈230 MB transient in JavaScript; the type cap is lower, not higher |

## What the build found

- **`just dev` is the wrong place for the CSP check.** In development the
  page is served by the Vite dev server over `http://localhost:1420`, and
  Tauri injects the `csp` of `tauri.conf.json` only into the frontend it
  serves itself — so there is no CSP in `just dev` at all. A probe there
  ran `new Function("return 1 + 1")` without complaint. The check was run
  in a **built app** instead (`just app`), where the same probe reports:

  ```
  [csp-probe] mammoth ok: html=1289 messages=1
  [csp-probe] head=<h1>Reiseplan</h1><p>Ein Absatz mit <strong>fettem</strong> …
  [csp-probe] eval: Function() refused (CSP is on): EvalError: Refused to
  evaluate a string as JavaScript because 'unsafe-eval' …
  ```

  mammoth converts a document with headings, emphasis, lists, a table, a
  link and a picture while `eval` is refused. The condition above is met
  and the CSP stays as it is.
- **The cap is where the cost is.** `read_blob` refuses above 50 MB in the
  shell, as it always did; the reader refuses above 15 MB before it hands
  the bytes to mammoth, because the 4.6× blow-up this ADR wants to avoid is
  the conversion and the DOM built from it, not the transfer. The UI knows
  no file's size before reading it, and inventing an IPC for that would
  have cost more than it saves.
- **The sanitizer carries a `data:image/…` source** the way it carries a
  relative one, in `data-src`, and the reader sets it (`lib/sanitize.ts`).
  Word's pictures arrive from mammoth as `data:` URIs, which fetch nothing
  and which `img-src data:` allows; the rule that an `<img>` never gets a
  `src` the reader did not choose is unchanged.
- **One dress for two readers.** The EPUB chapter CSS moved to
  `lib/documentCss.ts` unchanged and the Word document wears it, so a
  foreign document looks the same whichever reader shows it.
- **vitest needed one line.** mammoth picks its Node half or its browser
  half with the `browser` field of its `package.json`; Vite gives the app
  the browser half, vitest resolves as Node does. Without the alias in
  `vite.config.ts` the reader's `arrayBuffer` input reaches the Node unzip,
  which wants a path, and every document in the test is "unreadable". The
  test converts a real hand-written `.docx` — mammoth is not mocked.

## Consequences

- `scripts/lockfile-adr-check.mjs` asks for this ADR's number on the pull
  request that adds `mammoth`. `THIRD-PARTY-NOTICES.md` does not exist yet
  (PLAN.md §11.6 has it generated from the lockfiles before 1.0), so there
  was nothing to regenerate. The closure is 26 packages and every licence
  in it is permissive and AGPL-compatible: MIT, ISC, BSD-2-Clause,
  BSD-3-Clause, `jszip` dual "(MIT OR GPL-3.0-or-later)" taken as MIT, and
  `pako` "(MIT AND Zlib)".
- The DMG grows by ≈0.7 MB raw (5.6 → ≈6.3 of the 12 MB budget); the
  release workflow's budget row is the check.
- PLAN.md §7.3 tier D gains `docx`; `x.docx` flips from negative to
  positive in `fileTypes.test.ts`; `file_types.rs` (ADR-0022) gains a
  `view` row and the `~$` basename exclusion.
- A 5 MB document converts in an estimated 100–300 ms; transient memory
  stays under ≈70 MB at the cap.
- Open until the pull request: the exact transitive closure of `mammoth`
  (counted offline as ≈26; the lockfile diff tells) and the CSP run above.
