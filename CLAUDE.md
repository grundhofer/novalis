# novalis — agent contract

## Purpose

novalis is a minimal, fast Markdown notes tool for macOS: a Sublime-like text editor over a folder of `.md` files, a small Kanban board stored as JSON inside the same vault, and a headless `novalis` CLI built on the same Rust core. Plain files are the truth; the app, the CLI and the user's sync client (OneDrive, Google Drive) all edit the same folder, so every write is atomic and every external change is detected. The plan is `PLAN.md`; the owner's recorded answers are `docs/DECISIONS.md` and `docs/decisions/`.

## The minimalism rule

Nothing is added because it might be useful. A new setting, feature, menu item, shortcut, dependency or outbound connection needs an owner decision: **ask the owner**, then record the answer as `docs/decisions/NNNN-*.md` with the owner's verbatim "yes" quoted, and cite `ADR-NNNN` in the PR body. If `PLAN.md` does not name it and `docs/DECISIONS.md` does not approve it, the answer is no until asked. When two patterns conflict, pick one and say why; do not blend.

## Directory map

```
CLAUDE.md  PLAN.md  justfile  VERSION            # contract, plan, task runner, the one version stamp
Cargo.toml  rust-toolchain.toml  deny.toml  .cargo/audit.toml
pnpm-workspace.yaml  package.json               # pnpm 11 workspace; scripts delegate to just
crates/novalis-core/                            # vault fs, atomic save, watcher, cache, search, links, boards; NO UI deps, NO strings
crates/novalis-cli/                             # `novalis` binary on core; --json; English; src/ops/*.rs one fn per command
apps/desktop/src-tauri/                         # thin Tauri 2 shell: <25 commands, native menu from i18n JSON
apps/desktop/ui/                                # React 19 + Vite + CodeMirror 6
packages/tokens/                                # tokens.css (--ds-*) for the chosen style
packages/agent-skill/novalis/                   # SKILL.md for agents driving the CLI
i18n/en.json  i18n/de.json                      # every user-visible string, flat "namespace.key"
fixtures/demo-vault/  fixtures/gen/             # vendored demo vault; fixture generator
design/variants/                                # the mockup frames (reference, not shipped)
docs/                                           # DECISIONS.md decisions/ SETTINGS.md KEYMAP.md PRIVACY.md RELEASING.md BUDGET.json research/
scripts/                                        # check-versions.mjs bundle-budget.mjs lockfile-adr-check.mjs
.github/workflows/                              # ci.yml (check (macos-latest), check (ubuntu-latest), audit)  release.yml  perf.yml
```

## The only commands

| Command | Does |
|---|---|
| `just setup` | Verifies rustc 1.96 / node 22 / pnpm 11 / `cargo tauri` 2, then `pnpm install` |
| `just dev` | `cargo tauri dev` in `apps/desktop` |
| `just check` | Exactly what CI runs: versions, UI typecheck/lint/build, fmt, clippy `-D warnings`, cargo test, i18n, bundle budget |
| `just test` | Rust + UI tests |
| `just test-cli` | CLI golden tests; `UPDATE_GOLDEN=1 just test-cli` regenerates them |
| `just app` | Release app bundle for this Mac |
| `just bump X.Y.Z` | Writes the version to all four stamps |

Never gate on ad-hoc `cargo …` or `pnpm …` invocations. If a check is missing, add it to the `justfile` **and** to `ci.yml`. "Done" means `just check` is green, with nothing skipped; if a test is skipped, ignored or red, say so.

## Where things live

- **User-visible strings** → `i18n/en.json` and `i18n/de.json`, never inline (the lint and the catalog parity test enforce it). Core and CLI carry no strings, only typed errors.
- **Colours, fonts, radii** → `packages/tokens/tokens.css` (`--ds-*` semantic tokens only). No hard-coded values in components. Light and dark are two token sets.
- **Settings** → exactly the four in `docs/SETTINGS.md` (`language`, `appearance`, `editor.fontSize`, `spellcheck`) mirrored by the `Settings` struct; a cargo parity test compares them. `lastVault` is state, not a setting. No preferences window.
- **Keyboard shortcuts** → `docs/KEYMAP.md` mirrored by the keymap table; a cargo parity test compares them.
- **Decisions** → `docs/decisions/NNNN-*.md` (old ADR voice, owner approval quoted). `docs/DECISIONS.md` is the index.
- **Budgets** → `docs/BUDGET.json` (read by `scripts/bundle-budget.mjs`) and `PLAN.md` §11.3.
- **Data formats** → `PLAN.md` §5.5 and §8.2; the only file v1 writes under `.novalis/` is `vault.json`.
- **CLI contract** → `PLAN.md` §9 (commands, JSON shapes, exit codes 0–8). Contracts are immutable after 1.0: add, never rename.

## Generated files (never hand-edited)

| File | Regenerate with |
|---|---|
| `Cargo.lock`, `pnpm-lock.yaml` | `cargo update -p <crate>`, `pnpm install`. A new top-level entry needs an ADR; CI (`lockfile-adr-check.mjs`) refuses it otherwise |
| `apps/desktop/src-tauri/gen/schemas/` | Tauri CLI on every build; git-ignored |
| `crates/novalis-cli/tests/**/*.golden` | `UPDATE_GOLDEN=1 just test-cli` |
| `packages/tokens/tokens.css` | `just tokens-sync <slug> <commit>` once designSprache ships tokens; until then hand-written with the header `GENERATED-PENDING` |
| `THIRD-PARTY-NOTICES.md` | generated from the lockfiles (`PLAN.md` §11.6) |
| UI ⇄ Rust IPC bindings | the desktop crate's export command; CI diffs the result |

## Local limitations

- Command Line Tools are the default toolchain. `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` only when a task needs Xcode tooling; never make it a requirement.
- No Apple Developer Program enrolment this year (owner decision 2026-09-05): releases are unsigned, ad-hoc signed by the Tauri bundler. The signing and notarization steps in `release.yml` are dormant until the documented secrets exist.
- `just` comes from Homebrew (`brew install just`); rustc 1.96 via rustup (`rust-toolchain.toml`), node 22, pnpm 11 (`packageManager` field), `cargo tauri` 2.
- `~/.cargo/config.toml` points at a shared target directory: never assume `./target` locally. CI uses `./target`.
- Apple Silicon and macOS 14+ only. Linux CI compiles and tests; it does not ship.

## Privacy rule

No telemetry, no analytics, no crash reporting, no update check, no outbound connection of any kind in Mode 1. `docs/PRIVACY.md` keeps the promise and its outbound-connection table is empty; CI greps for HTTP clients. A network call is a feature and needs an ADR.

## What not to do

- No setting beyond the four; no preferences window; no `Cmd-,`.
- No new dependency (crate, npm package, GitHub Action) without an ADR number in the PR body. `Cargo.lock` stays within scaffold + 150 entries (D26); no `*-sys` crates beyond `libsqlite3-sys` and Tauri's own.
- No feature, menu item or shortcut the plan does not name. No split view, folding, minimap, vim mode, version history, multi-vault, images, MCP in v1.
- Never modify the legacy app: `/Users/sgrundhoefer/Projects/novalis` and the `legacy` branch are reference only.
- No attribution trailers, `Claude-Session:` lines or "generated by" notes in commits, PRs, code or docs.
- No textures or images in the UI; no inline strings; no hard-coded colours; no CDN fonts.
- Touch only what the task needs; match the existing style; do not refactor adjacent code. Surface uncertainty instead of hiding it.
