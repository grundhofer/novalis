# Novalis

A local-first, open-source **notes + tasks + calendar** app. Your data stays on
your device as plain Markdown files; it syncs between devices via OneDrive (or
any file-sync tool). Built with **Tauri v2** (Rust core + web UI) for
macOS/Linux/Windows today, and Android/iOS later — from one codebase.

> Status: early development. The foundation (notes/editor/vault/search, tasks,
> calendar, export/media/templates, plugin system, mobile-ready base) is complete,
> plus a large set of specialized capabilities (AI, canvas, PDF, voice, graph,
> query engine, sync). See `crates/`/`apps/` for structure.

## Features

Novalis is a **notes + tasks + calendar** app first. That core is always on.
On top of it sits a set of **specialized, opt-in capabilities** — you only turn
on what you need, so a plain-notes user is never overwhelmed by features they
won't use.

### Core (always on)

- **Editor** — Markdown with a formatting toolbar and `/` slash menu,
  `[[wikilinks]]` with autocomplete, tables, image paste/drop, find & replace,
  callouts, an outline panel, code-block syntax highlighting, and `#tag`
  autocomplete. Reading mode and spellcheck included.
- **Vault & navigation** — plain `.md` files in a folder, a file tree, tag
  browser, backlinks / linked references, and full-text + fuzzy search.
- **Tasks** — Markdown checkboxes with `@due` / `@remind` / `@start` (natural-
  language dates), a Today/agenda view, and a Kanban board.
- **Calendar** — month/week/day views over your own events (stored as Markdown),
  with reminders and notifications.
- **Safety** — autosave, version history, in-vault trash, and external-change
  conflict detection for cloud-synced vaults.

### Specialized & opt-in

These are off by default and enabled per need. Some need a one-time setup
(connect an AI provider, build the semantic index); a couple download a model on
first use. Grouped as they'll appear in onboarding and **Settings › Features**:

- **AI** *(needs an AI connection; runs nothing until you use it)* — summarize /
  compose / rewrite actions in the editor, "chat with your vault" (RAG with
  citations), ambient link & tag suggestions while you write, note → task
  extraction, an AI weekly review, and metadata suggestions. **Semantic search**
  ("related notes") builds an index of note embeddings — on-device (a ~130 MB
  local model, downloaded once) or via an OpenAI-compatible endpoint — after
  which lookups stay local.
- **Spatial & media** — **Canvas** boards (portable `.canvas` files), a **PDF**
  reader with highlighting/annotation that links back into notes, and **voice /
  meeting capture** with on-device Whisper transcription (a ~142 MB model,
  downloaded once) that saves a note and can extract tasks.
- **Knowledge graph** — an interactive **link graph**, **typed properties &
  relations** in frontmatter, and AI **entity extraction** (people/orgs/projects).
- **Query engine** — saved database-style views ("Bases++"): filter your notes
  like a query and see them as a table, kanban, or calendar.
- **Editor extras** — math (KaTeX), Mermaid diagrams, block references
  (`^id` / `((^id))`), and transclusion (`![[embed]]`).
- **Sync** — optional Git version history + remote sync, direct **peer-to-peer**
  end-to-end-encrypted sync between your own devices, and read-only calendar
  import (`.ics` subscriptions or Google/Outlook sign-in).
- **Power-user** — a JavaScript **plugin** system (sandboxed in Web Workers),
  reusable templates, daily notes, and fully configurable keybindings.

> A unified onboarding step and a **Settings › Features** panel to turn these
> groups on and off in one place are on the near-term roadmap; today several are
> already gated individually (an AI connection, the git-sync toggle, building the
> semantic index, etc.).

## Releases

Pre-built installers are published on the
[GitHub Releases](https://github.com/grundhofer/novalis/releases) page
for macOS (universal `.dmg`), Linux (`.AppImage`, `.deb`), and Windows
(`.msi`, `.exe`).

Builds are currently **unsigned** — macOS and Windows will show a
"verify the developer" warning on first launch. See
[RELEASING.md](RELEASING.md#unsigned-build-warnings-what-users-see)
for how to bypass it.

## Principles

- **Local-first.** No server we run. Your notes are plain `.md` files on your
  disk, and every core feature — editor, search, tasks, calendar — works fully
  offline.
- **Own your data.** YAML frontmatter, `[[wikilinks]]`, plain Markdown — vaults
  aim to be Obsidian-compatible. No lock-in.
- **Opt-in, not opt-out.** Everything that leaves your machine is a feature you
  switched on. See the table below.
- **Open source (MIT).**

## Privacy & network

Novalis contains **no telemetry, no analytics, no crash reporting, and no
update check** — there is no build in which the app contacts us, because there
is nothing for it to contact. You can verify this: there is no such dependency
in `Cargo.toml` or `package.json`, and `tauri.conf.json` has no `updater` block.

Out of the box, with a fresh vault and nothing enabled, Novalis makes **zero
network requests**. Every connection below exists only if you turn that feature
on, and goes to a host you chose or that is named here:

| Feature (all off by default) | Talks to | What is sent |
|---|---|---|
| Calendar subscriptions | The `.ics` URL you enter | A read-only fetch. Nothing is uploaded. |
| Google / Outlook calendar | `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`, `login.microsoftonline.com`, `graph.microsoft.com` | OAuth sign-in, then read-only event fetches. |
| AI features | The provider you configure — `api.anthropic.com`, `api.openai.com`, `api.deepseek.com`, or any OpenAI-compatible endpoint (including a local one) | The note text or chat context of the action you invoke. Nothing runs until you invoke it. |
| Voice / meeting capture | `huggingface.co`, once | Downloads the Whisper model (~142 MB, SHA-256 pinned). Transcription itself is **on-device** — no audio leaves your machine. |
| Semantic search | `huggingface.co`, once — or your OpenAI-compatible endpoint | Downloads the embedding model (~130 MB) for on-device use. Lookups then stay local. |
| Git sync | The remote **you** configure (HTTPS only) | Your vault, to your own repository. |
| Peer-to-peer sync | Your paired devices directly; n0's public relay mesh assists NAT traversal | End-to-end encrypted. The relay carries only sealed bytes, never plaintext, and stores nothing. |

AI provider keys are stored in your OS keychain (macOS Keychain, Windows
Credential Manager, Linux Secret Service), never in the vault.
[Android is an exception](MOBILE.md) — it currently stores them as plaintext
JSON in app-private storage.

Plugins are the one place this model does not hold: an enabled plugin runs your
JavaScript with vault access. See [PLUGINS.md](PLUGINS.md) — only enable
plugins you trust.

## Repository layout

```
crates/
  novalis-core/        UI-agnostic Rust logic (vault, index, notes, tasks, calendar, ...)
  novalis-extension/   internal extension API (public plugin API later)
apps/
  desktop/
    frontend/          React + Vite + Tailwind UI (the shared web UI)
    src-tauri/         thin Tauri v2 binary wiring core -> commands/events
  mobile/              (later) Android/iOS, reuses core + frontend
packages/
  editor/              @novalis/editor — standalone TipTap-based editor
  ui/                  @novalis/ui — shared UI primitives
```

## Development

Prerequisites: Rust (stable), Node 20+, pnpm 11.

```bash
pnpm install                 # install JS deps
cargo test -p novalis-core   # run core unit tests
pnpm gen:bindings            # regenerate typed IPC bindings (Rust -> TS)
pnpm dev                     # run the desktop app (Tauri)
```

### Calendar accounts (optional)

ICS-URL subscriptions (including Google/Outlook private iCal links) work out of
the box. For interactive **Connect Google / Connect Outlook** sign-in, register
your own OAuth client (desktop / "loopback" type, with a calendar read scope)
and provide its client id via env var before launching:

```bash
export NOVALIS_GOOGLE_CLIENT_ID=…   # Google Cloud OAuth client (Desktop app)
export NOVALIS_MS_CLIENT_ID=…       # Azure app registration (public client)
```

No client secret is needed — the flow uses loopback redirect + PKCE, and tokens
are stored in the OS keychain.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the real prerequisites (including the
Linux system packages), the gates a PR must pass, and the two things that
reliably turn a first PR red: regenerating the IPC bindings, and translating new
strings. [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies.

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md), which also
lists the known limitations (Android secret storage, the plugin trust model).
Never open a public issue for one.

## License

MIT © Sebastian Grundhoefer — see [LICENSE](LICENSE).

Novalis links third-party code with its own terms, including a statically linked
libgit2 (GPL-2.0 with a linking exception). See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
