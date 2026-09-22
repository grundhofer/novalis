# 23. EPUB and CBZ open read-only on a Rust archive primitive

Date: 2026-09-20

## Status

Accepted. The EPUB half is built (`vault/archive.rs`, `read_packed`,
`EpubViewer.tsx`); CBZ is still the next pull request
(docs/research/2026-09-20-formats-plan.md §6, step V2). Builds the
2026-09-15 approval recorded in ADR-0016 ("EPUB (Recommended) … CBZ").
Adds one crate (`rawzip`, MIT; Cargo.lock 514 → 515 of 581) and one IPC
command (`read_packed`, 28 of the 30 PLAN.md §2.3 rule 8 allows). No CSP
change, no npm package, no chord, no setting.

## Context

ADR-0015 declined EPUB in the morning of 2026-09-15 as "a reader of its own
and a new dependency"; the same afternoon, asked which reading formats to
plan next, the owner wrote:

> EPUB (Recommended), Markdown-Lesemodus ⌘E (Recommended), DOCX (nur
> lesen), CBZ

and ADR-0016 recorded EPUB and CBZ as approved for later, "each with its
own ADR when built". The format plan priced them: no zip, EPUB or DOCX
reader is in either lockfile today; `flate2` (inflate) is; `read_blob`
serves any file as base64 over JSON with a 50 MB cap, which is the wrong
transport for a container whose chapters are 60 kB each (≈230 MB of
transient JavaScript memory for a 50 MB book); the `epub` crate is
GPL-3.0 and out under ADR-0001; foliate-js and epub.js would need `frame-src
blob:` back (removed by ADR-0016) and the whole file through `read_blob`.
Asked with all viewer questions bundled, the owner chose:

> Alle Empfehlungen übernehmen (Recommended)

## Decision

- **A Rust archive primitive in the core**, `vault/archive.rs`, on
  `rawzip` (0.5.x, MIT, zero dependencies; inflate from the `flate2` already
  in the lock): list entries, read named entries, a per-entry cap enforced
  with `take()` against lying headers (zip bombs), `META-INF/
  encryption.xml` naming an entry → typed "protected" error. It follows the
  explicit-open and cloud-only rules of `read_bytes` (a dataless book is
  downloaded on purpose, never at listing time).
- **One IPC command, `read_packed(path, entries)`**: an empty `entries`
  returns the table of contents (`{name, size}` rows); otherwise the
  requested parts, base64, in **one** call — a chapter and its twenty images
  are two round trips (XHTML, then everything it references), which is
  the plan's reading of PLAN.md §2.3 rule 8 ("one IPC per user action").
  The 28th command; CBZ and any later container format (XLSX, ODT) reuse
  it.
- **The EPUB reader is the app's own** (`EpubViewer.tsx`, a lazy chunk of
  a few kB): `container.xml` → OPF (manifest, spine, `dc:title`) → nav
  (`nav.xhtml`, EPUB 3) or NCX (EPUB 2) → one chapter at a time, parsed
  with `DOMParser` and copied into a Shadow-DOM host through an allow-list
  (block and inline text, images, tables, lists, links only as fragment or
  relative; `script`, `iframe`, `object`, event handlers, external URLs
  and book fonts dropped). Images and stylesheets resolve against the
  chapter's directory and arrive as `blob:` URLs, revoked on chapter
  change. Scrolled flow, the app's typography and `editor.fontSize`,
  appearance-following colours; in-book links jump, external links show
  the preview's toast. The bar: a table-of-contents popover and
  ‹ chapter N of M ›. Reading position is session-only. No `Cmd+F` until a
  KEYMAP row for a `viewer` scope exists (ADR-0025). A DRM-protected book
  shows a banner.
- **CBZ** on the same primitive: the image entries (`png jpg jpeg gif
  webp`) in natural sort order, one page as `<img>` from a `blob:` URL
  with the next page prefetched, a bar with ‹ page N of M ›; zoom shares
  ADR-0025's image-zoom work. CBR (RAR) is not built: `unrar` is a `*-sys`
  crate with a non-free licence.
- **What neither viewer does** (the ADR-0015/0016 line): annotate,
  highlight, bookmark, edit, export, print, fetch anything, or remember
  anything outside `state.json`.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| `zip` 8 crate | +2 lock entries (`typed-path`); its default features pull `zstd-sys` / `libbz2-rs-sys`, which D26 forbids |
| `epub` crate | GPL-3.0, incompatible with ADR-0001 |
| epub.js (92 kB gz, 31 packages) / foliate-js (60 kB gz) | Need `frame-src blob:` back and the whole book through `read_blob`; pagination and CFI are not worth the surface |
| `<iframe sandbox srcdoc>` as the chapter host | Links inside the book cannot reach the app; `frame-src` behaviour of `srcdoc` in WKWebView unverified |
| A custom URI scheme with `Range` (asset protocol) | The page surface ADR-0015 §2 declined; only media would need it, and media is no |
| `tauri::ipc::Response` (raw bytes) | No `specta::Type`, outside `bindings.ts` |
| One IPC per entry | 21 round trips for a chapter with 20 images |

## Consequences

- PLAN.md §7.3 tier D gains `epub` and `cbz`; `book.epub` flips from
  negative to positive in `fileTypes.test.ts`; `file_types.rs` (ADR-0022)
  gains two `view` rows.
- PLAN.md §2.3 rule 8 counts 28; `docs/PRIVACY.md` is unchanged (nothing
  leaves the machine; book fonts and remote resources are dropped, not
  fetched).
- `scripts/lockfile-adr-check.mjs` asks for this ADR's number on the pull
  request that adds `rawzip`; `deny.toml` needs nothing (MIT).
- Memory stays at one chapter (≈1 MB) or one page; a 500 MB comic is fine
  because only entries are capped. The DMG does not grow measurably.
- Open until the pull request: `rawzip`'s API stability (0.5.x, young) —
  the ADR names it as the recommendation, the pull request pins the
  version; the allow-list copy is reviewed against the sanitizer tests
  (`script`, `on*`, `iframe`, `object` removed; fragment links kept).
  DOMPurify (already in the lock through Mermaid, 10.9 kB gz) is the
  fallback if the review finds the allow-list wanting — then it becomes a
  direct dependency and this ADR is amended.

## What the EPUB pull request settled (2026-09-22)

- `rawzip` is pinned at **0.5.1** and `flate2` 1.1.10 (`rust_backend`, no
  `*-sys`) became a direct dependency of `novalis-core`; `flate2` was
  already in the lock through `png`, so `Cargo.lock` went 514 → 515 exactly
  as priced. `deny.toml` needed nothing (both MIT / MIT OR Apache-2.0).
- **`encryption.xml` alone is not DRM.** The decision above reads "an
  entry named in `META-INF/encryption.xml` → protected", but the same file
  declares IDPF and Adobe *font obfuscation*, which ordinary unprotected
  books written by InDesign and Sigil carry. Taking presence as DRM would
  refuse those books. So the core reads that one small entry and refuses
  the book only when it names an algorithm that is not one of the two
  obfuscation schemes — and refuses it when it cannot make sense of the
  file at all. The reader drops book fonts anyway, so an obfuscated font
  costs nothing. `CoreError::Protected` (code `protected`, exit 1 in the
  CLI, which has no container command) is the typed error.
- **SVG is dropped**, `math` with it: both carry their own scripting and
  fetching surface. A cover drawn as SVG is what this costs; a cover
  referenced as `<img src="cover.svg">` still shows, because an `<img>`
  runs nothing of what it draws.
- A chapter is parsed as `text/html`, not `application/xhtml+xml`: a book
  whose XHTML is not well formed would otherwise show a parser error
  instead of its text, and the allow-list copy cares about elements, not
  about syntax.
- Two caps, not one: the core refuses an entry above 64 MiB (declared size
  first, `take()` second), the shell refuses a single `read_packed` call
  whose parts exceed `HUGE_FILE_BYTES` (50 MB) — the same reason
  `read_blob` has one, the IPC carries base64 in a JSON string.
