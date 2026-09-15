# 15. PDF and images open read-only; the tree shows only what the app opens

Date: 2026-09-15

## Status

Accepted.

## Context

The owner's vault is a folder that also holds recordings, videos and PDFs.
The tree listed every file, so a `.wav` opened as a read-only text tab with a
"not UTF-8" banner after reading the whole file, and a PDF — the one type
among them a notes app is asked to show — could not be read at all. PLAN.md
§2.2 had put "PDF" on the not-list and §7.3 says "Stop there" after the text
types; both were written for editing, not for reading a file the vault already
holds.

Testing the sidebar branch on 2026-09-15, the owner wrote:

> wir sollten hier unterstützte dateitypen anzeigen

(of the New Note dialog, whose typed-extension rule of ADR-0014 was invisible),

> macht es sinn beim lesen der dateien pdf zu unterstützen? bitte einfach
> möchlich machen. gerne auch epub etc. alles was sinnvoll zum lesen ist.

and

> bitte in der seitenleiste ganz links nur unterstützte dateitypen anzeigen
> lassen. keine wav, mp4 etc

Asked which read-only types, with PDF recommended and EPUB priced as a new
dependency and its own reader:

> "Bilder (png, jpg, gif, webp, svg)", PDF (Recommended)

EPUB was not selected.

## Decision

1. **A read-only viewer for PDF and images** (`pdf`, `png`, `jpg`, `jpeg`,
   `gif`, `webp` — tier D of PLAN.md §7.3). A click in the tree opens the file
   as a tab; the pane shows it through the WebView's own PDF view or an
   `<img>`, from a `blob:` URL that lives as long as the tab shows the file.
   Nothing is parsed, bundled or annotated. `svg` stays what §7.3 already
   makes it: XML text in the editor. EPUB is not added: it needs a reader of
   its own and a new dependency, and gets its own decision if wanted.
2. **One new IPC command, `read_blob`**, the 23rd of the 25 PLAN.md §2.3
   rule 8 allows: the same explicit-open rule as `read_file` (a cloud-only
   file is downloaded on purpose), refused above 50 MB, base64 over the typed
   IPC because it has no raw-bytes return. The `base64` crate becomes a
   direct dependency of the desktop crate; it was already in `Cargo.lock`
   through Tauri, so the lockfile gains no entry. The CSP gains `frame-src
   blob:` and `blob:` under `img-src`; no filesystem or asset-protocol
   permission is granted to the page.
3. **The tree lists only the file types the app opens**: §7.3 tiers A–C and
   tier D, plus the extensionless tier-C names. Everything else in the folder
   stays where it is, is never read, and is not drawn. A folder that holds
   nothing the app opens shows as empty.
4. **The New Note dialog shows its rule**: one muted line under the field
   names what a typed extension does (ADR-0014) and lists the extensions it
   keeps.

## Consequences

- PLAN.md §2.2 loses "PDF" from the not-list with a pointer here (viewing
  only; no annotation, no export); §7.3 gains tier D and the sentence that the
  tree lists nothing outside the table.
- `apps/desktop/ui/src/lib/fileTypes.ts` is the UI's one list of what opens
  and how; its `CREATABLE_EXTENSIONS` mirrors the shell's list of the same
  name (ADR-0014) by hand.
- A viewer tab has no text buffer: word count, autosave and the
  external-change banner do not apply to it. Rename and trash work as for any
  file. Quick-open lists notes only, as before; a PDF is reached from the tree.
- Not added: EPUB, DOCX, audio, video, image paste into notes (§4.4), any
  editing of a viewed file.
