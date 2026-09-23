# 44. Web and mail links open in the default browser or mail app

Date: 2026-09-23

## Status

Accepted. Amends ADR-0020, which refused external links in the preview.
`system_open` (ADR-0043) gains a `url` kind instead of a new `open_url`
command, so the IPC count stays at 28 of 30. One catalog string, one
paragraph in `docs/PRIVACY.md`. No plugin, no setting, no dependency, and
no connection opened by novalis.

## Context

A `https://` link in a note did nothing on `Cmd`-click, and in the preview
a toast said "External links are not opened by novalis" — the strongest
gap the feature-gap analysis found. ADR-0020 had written the refusal as a
consequence of having no opener, not as an owner decision. The owner
answered the feature-gap question on 2026-09-20 (`docs/DECISIONS.md`,
"Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `export-open-external-links`:
"external `https://` links open in the default browser through one
`open_url` command — the 28th — with a sentence in `docs/PRIVACY.md`, by
click in the preview and ⌘-click in the editor" (row B3 of
`docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **`http`, `https` and `mailto` links open outside**: a click in the
  preview, a `Cmd`-click in the editor. They are handed to macOS's
  `/usr/bin/open`, which starts the default browser or mail app; that app
  makes the connection, novalis never does.
- **Through `system_open({kind: "url"})`**, not a separate `open_url`: the
  same opener as Show in Finder and Open in Default App, one command
  instead of two, so the count stays 28 — the one deviation from the
  recorded answer's wording. The shell checks the scheme and refuses
  whitespace and control characters, so nothing reaches `open` as an
  option or a second argument.
- **Any other scheme** (`file:`, `javascript:`, a custom one) is refused
  with a toast, "novalis opens only web and mail links outside itself."
- `docs/PRIVACY.md` says so under "Outbound connections"; its table stays
  empty, since novalis opens no connection. The CSP is unchanged.
- The EPUB reader keeps its own refusal of links out of the book.
- **Not built:** a confirmation before opening, opening links in the app,
  link previews.

## Consequences

- ADR-0020 is amended; `docs/KEYMAP.md`'s `Cmd`-click row says what a web
  link does.
- Tests: the shell's allow-list (allowed schemes, `file:`, `javascript:`,
  a leading `-`, whitespace), the preview handing a web link on and
  refusing a `file:` one. Not clicked by hand: it would open this Mac's
  browser.
