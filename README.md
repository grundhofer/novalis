# novalis

A minimal, fast desktop app for **organizing, writing and editing Markdown**, with
a Sublime-like text editor for the everyday file types and a small Kanban board
whose data lives **outside** the notes. Your vault is a plain folder; put it in
your OneDrive or Google Drive folder and it syncs between devices. macOS first.

> **Status: early rewrite (`v2.0.0-alpha.0`).** This branch replaces the previous
> Novalis, which was a notes + tasks + calendar app with AI, voice, PDF, canvas
> and plugins. That code lives on the `legacy` branch and in releases up to
> `v0.2.1-rc2`; it is unsupported. The plan for this rewrite is [PLAN.md](PLAN.md)
> and every decision behind it is in [docs/decisions/](docs/decisions/).

## What it is

- **Notes.** A folder tree, tabs, fuzzy quick-open, vault-wide search, rename
  with link rewriting, and the macOS Trash. `[[wikilinks]]` resolve by filename.
- **An editor, not a word processor.** Decorated source mode: every Markdown
  character stays visible and the file on disk is exactly what you typed. The
  same editor opens `.md`, `.json`, `.yaml`, `.toml`, `.rs`, `.py` and the rest.
- **A Kanban board.** One JSON file per card under `boards/`, so two devices
  editing different cards offline never collide. Cards can link to notes.
- **Sync without a server.** The vault is a folder. novalis knows about
  cloud-only files, conflict copies and File Provider folders, and never holds a
  lock on your files.
- **A CLI for AI agents.** `novalis ls|cat|new|edit|mv|search|links|…` with
  `--json`, stable exit codes and `--dry-run`, sharing the same Rust core.
- **German and English.**

## What it deliberately is not

No AI, no telemetry, no analytics, no crash reporting, no update check, no
accounts, no plugins, and no settings beyond four. See
[docs/PRIVACY.md](docs/PRIVACY.md); the outbound-connection table is empty.

## Build it

```sh
just setup     # checks tool versions and installs dependencies
just dev       # run the app
just check     # everything CI runs
just app       # build novalis.app
```

Requires Rust 1.96, Node 22, pnpm 11 and macOS 14 or newer.
[CLAUDE.md](CLAUDE.md) is the short version for contributors and coding agents;
[CONTRIBUTING.md](CONTRIBUTING.md) is the long one.

## License

AGPL-3.0-only, with the section 7 permissions recorded in
[docs/decisions/0001-licensing.md](docs/decisions/0001-licensing.md). Commercial
terms are available separately — see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).
