# 45. Open With, a drop on the Dock icon, and `novalis://`

Date: 2026-09-23

## Status

Accepted. The bundle declares Markdown and plain-text files (as an
alternate editor, never the default) and the `novalis://` scheme; the
shell handles what macOS hands over. One event, a field on `bootstrap`,
two catalog strings. No IPC command, no plugin, no dependency, no setting,
nothing outbound — the scheme is inbound only.

## Context

`open note.md`, Open With, a file dropped on the Dock icon, Spotlight:
none of them reached novalis, and nothing outside the app — Raycast,
Shortcuts, a calendar entry — could open a note or the day's note in it.
ADR-0003 had said file associations, if ever added, start from zero. The
owner answered the feature-gap question on 2026-09-20
(`docs/DECISIONS.md`, "Answered 2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `macos-open-with-dock-drop` ("Open
With, Dock drop and `open -a novalis` for `md markdown txt`, a toast for
files outside the vault") and, on the same branch, `macos-url-scheme`
("the `novalis://open?path=` and `novalis://today` scheme"; rows A33 and
B36 of `docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **File associations** for `md`, `markdown` and `txt`, role Editor, rank
  **Alternate**: novalis appears under Open With and takes a Dock drop, but
  never becomes the default app for Markdown.
- **`novalis://today`** opens Today's Note; **`novalis://open?path=<vault
  path>`** opens a file the tree lists, or a board (`boards/<slug>`). Any
  other link is refused with a toast. Declared in a hand-written
  `src-tauri/Info.plist` that Tauri merges into the bundle's.
- **Both arrive as `RunEvent::Opened`** and are handed to the UI: a file
  inside the open vault that the tree lists opens as a tab; any other file
  — outside the vault, or a type it does not list — is a toast. Nothing
  switches vaults and nothing is written.
- **Before the page is up** (a launch by a file) requests are kept in a
  static queue that `bootstrap` hands over as `pendingOpen`; later ones go
  out as one `OpenRequested` event, which the UI subscribes to before it
  boots. The queue is a static because macOS delivers a launch's file
  before `setup` has registered any state — the first version kept it in
  the app state and lost that file, measured in the built app.
- **Not built:** a folder opened as a vault, switching vaults for a file
  outside the current one, `novalis://` actions that write (`new`,
  `append`), a CLI `open`.

## Consequences

- ADR-0003's "start from zero" is met here. The behaviour exists only in a
  bundle (`just app`): `cargo tauri dev` runs a bare binary that macOS does
  not route files or links to. Checked there: a cold launch by a vault
  file, a second file while running, a file outside the vault (toast),
  `novalis://open?path=…` and `novalis://today`. The test bundle was
  unregistered from LaunchServices afterwards.
- A Dock drop and Finder's Open With take the same path as `open -a` and
  were not driven separately.
- Tests: the URL-to-request mapping in the shell, the UI's handling of
  each kind.
