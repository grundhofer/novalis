# Contributing to Novalis

Thanks for looking. Novalis is a small project maintained by one person, so the
most valuable contributions are ones that arrive already building and already
green — this file exists so that is possible without guessing.

Before a large change, open an issue and describe it. A rejected 2000-line PR
wastes your evening, not the maintainer's.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
Security problems go through [SECURITY.md](SECURITY.md), never a public issue or
PR.

## What this repository is

A Tauri v2 desktop app: a Rust core, a thin Tauri shell around it, and a React
frontend. Two runtimes, one repository.

```
crates/novalis-core/       UI-agnostic Rust logic (vault, index, notes, tasks, calendar, git, …)
apps/desktop/src-tauri/    Tauri v2 binary: commands, events, AI, voice, P2P sync
apps/desktop/frontend/     React + Vite + Tailwind UI
packages/editor/           @novalis/editor — the TipTap-based Markdown editor
packages/ui/               @novalis/ui — reserved for shared UI primitives; still a stub
```

`packages/ui` is a placeholder: it exports one constant and no component
imports it yet. Shared primitives currently live in
`apps/desktop/frontend/src/components/ui/`. Put new ones there and don't assume
the package is a working destination.

The Rust ↔ TypeScript boundary is generated, not hand-written — see
[Generated IPC bindings](#generated-ipc-bindings) below, which is the single
most common way a first PR goes red.

## Prerequisites

**Rust 1.93.0.** Pinned in `rust-toolchain.toml`; `rustup` installs and selects
it automatically the first time you run `cargo` in this directory. Do not
override it — the pin is load-bearing (`specta` 2.0.0-rc.25 needs
`core::fmt::from_fn`).

**Node 22.** CI uses 22, and Vite 7 requires `^20.19 || >=22.12`.

**pnpm 11.0.9.** Pinned via `packageManager` in `package.json`; `corepack enable`
picks up the right version. npm and yarn are not supported — the workspace uses
`pnpm-workspace.yaml`.

**A C/C++ toolchain and CMake**, on every platform. Two dependencies compile
native code from source during `cargo build`: `whisper-rs` builds whisper.cpp
through CMake, and `rusqlite`'s bundled SQLite needs a C compiler. There is no
prebuilt path around either.

### Linux system dependencies

Tauri's Linux build needs the WebKitGTK stack, and `cpal` (native voice capture)
needs the ALSA headers. Without these the build fails at link time with an error
that does not name the missing package. This is the exact list CI installs
(`.github/workflows/ci.yml`):

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  librsvg2-dev \
  libayatana-appindicator3-dev \
  libxdo-dev \
  libasound2-dev \
  patchelf \
  build-essential
```

On non-Debian distributions, install the equivalents of those packages.
`build-essential` covers the C/C++ compiler; install `cmake` separately if your
distribution does not already have it.

### macOS

Xcode Command Line Tools (`xcode-select --install`) and CMake
(`brew install cmake`). Nothing else — WebKit ships with the OS.

### Windows

Visual Studio Build Tools with the "Desktop development with C++" workload,
CMake, and WebView2 (preinstalled on Windows 11; on Windows 10 install the
Evergreen runtime).

### A network dependency worth knowing about

Building `apps/desktop/src-tauri` downloads a **prebuilt ONNX Runtime** (used by
the on-device embedding model) from **`cdn.pyke.io`**. Every entry in `ort-sys`'s
distribution table points at that single host, and it is not a mirror of anything
— if it is unreachable, the build fails.

- Air-gapped or packaging builds: set `ORT_LIB_LOCATION` (or `ORT_LIB_PATH`) to a
  directory holding your own ONNX Runtime, or set `ORT_SKIP_DOWNLOAD` /
  `ORT_OFFLINE`.
- The download is SHA-256 pinned by `ort-sys` and cached outside the repository,
  under the OS cache directory (`~/Library/Caches/ort.pyke.io` on macOS), so it
  happens once per machine rather than once per clean build.

Two ML **models** are also downloaded — but at *runtime*, on first use of the
voice or semantic-search features, never during a build. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Building and running

```bash
pnpm install                            # install JS deps for the whole workspace
pnpm --filter @novalis/frontend build   # produce apps/desktop/frontend/dist
pnpm dev                                # run the desktop app (Tauri dev server)
```

Build the frontend before running any Rust command that compiles
`apps/desktop/src-tauri`: `tauri::generate_context!` embeds the bundle at compile
time, so `cargo build`, `cargo clippy` and `cargo test --workspace` all expect
`apps/desktop/frontend/dist` to exist. This is why CI's "Build frontend" step
comes before its Rust steps. `pnpm dev` runs the Vite dev server itself and needs
no prior build.

`cargo test -p novalis-core` needs none of this — the core crate has no Tauri
dependency at all, which makes it the fastest place to work.

## The gates your PR must pass

CI runs all of these; a PR is not reviewable until they are green. Run them
locally first — in this order, because the cheap ones fail fastest:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo audit
pnpm -r test
pnpm --filter @novalis/frontend lint
pnpm --filter @novalis/frontend i18n:check
pnpm -r --if-present run typecheck
node scripts/check-versions.mjs
```

Notes on the ones that surprise people:

- **`cargo clippy … -D warnings`** — warnings are errors. This includes clippy
  lints on test code (`--all-targets`).
- **`cargo audit`** — a *blocking* gate, not advisory. Accepted advisories live
  in `.cargo/audit.toml`, each with a written justification and a revisit
  condition. If your dependency bump introduces a new advisory, either fix it or
  add a justification that a stranger would find convincing. `cargo audit` is not
  installed by default: `cargo install cargo-audit --locked`. (`pnpm audit` also
  runs in CI, but advisory-only — see the comment on that step.)
- CI passes `--locked` to every cargo invocation, so a change that would
  re-resolve `Cargo.lock` fails there even if it builds locally. Commit the
  updated lockfile with any dependency change.
- **`pnpm --filter @novalis/frontend lint`** — ESLint here is deliberately narrow.
  Its main job is `i18next/no-literal-string`: a user-facing string written
  literally in JSX fails the build. See [i18n](#i18n-every-user-facing-string)
  below.
- **`pnpm --filter @novalis/frontend i18n:check`** — fails if the English catalog
  is out of sync with the `t()` calls in the code, in either direction.
- **`node scripts/check-versions.mjs`** — the three release version stamps
  (`package.json`, `Cargo.toml`, `tauri.conf.json`) must match. Only relevant if
  you touch a version.
- CI additionally runs a gated P2P loopback end-to-end test
  (`cargo test -p novalis-desktop --features p2p-loopback-test`). It drives a real
  two-endpoint QUIC loopback, so it is off by default; run it if you touch
  `apps/desktop/src-tauri/src/sync/`.

The full build matrix is Linux, macOS and Windows. You are not expected to have
all three — say in the PR which one you tested on.

## Generated IPC bindings

`apps/desktop/frontend/src/ipc/bindings.ts` is **generated** from the Rust
command signatures by `tauri-specta`, and it is committed to the repository (the
frontend must build without a Rust toolchain present).

**If you change anything that crosses the IPC boundary** — a `#[tauri::command]`
signature, or any type reachable from one — you must regenerate and commit it:

```bash
pnpm gen:bindings
git add apps/desktop/frontend/src/ipc/bindings.ts
```

CI regenerates the file and fails on any diff. If you skip this, the failure you
get is `git diff --exit-code apps/desktop/frontend/src/ipc/bindings.ts` with no
further explanation — this is what it means. Never hand-edit the file.

## i18n: every user-facing string

The frontend has no hardcoded UI text. Strings live in
`apps/desktop/frontend/src/locales/`, one JSON file per namespace, and are read
through `t("namespace:dotted.key")`.

English (`en/`) is canonical. German, French and Spanish mirror its keys, and a
test enforces that they mirror it exactly — same keys, same `{{variables}}`, no
empty values. So:

1. Write the `t()` call.
2. `pnpm --filter @novalis/frontend i18n:extract` — adds the new key with an
   empty value, prunes orphans. (The script lives on the frontend package; there
   is no root alias, so the bare `pnpm i18n:extract` fails.)
3. Fill in the English text by hand.
4. **Fill in `de/`, `fr/` and `es/` too**, or the catalog test fails. If you
   genuinely cannot translate, say so in the PR and the maintainer will.

`apps/desktop/frontend/src/locales/README.md` is the real reference: conventions
for plurals, interpolation and rich text, what deliberately is *not* translated,
and the five-step recipe for adding a new locale.

## Commits and pull requests

Commits follow **Conventional Commits** with a scope naming the area:

```
feat(help): Feature Guide overlay, onboarding disclosures + contextual links
fix(index): keep the UI responsive during a reindex + bigger progress bar
docs(readme): document the feature list — core vs specialized/opt-in
test(reminders): cover launch digest, event window, and denied permission
style: cargo fmt — clear pre-existing drift
chore: release v0.2.0
```

The types you will need: `feat`, `fix`, `docs`, `test`, `style`, `chore`, `ci`,
`perf`, `revert`. Scopes are feature areas (`editor`, `index`, `calendar`,
`tasks`, `sync`, `plugins`, `readme`, …), not directories. The subject is a
sentence, lowercase after the colon, no trailing period.

There is no squash requirement and no CLA. History is not rewritten on `main`.

For the PR itself: one topic per PR, and fill in the template — it asks three
questions, all of which the reviewer would otherwise have to ask you.

## Code style

- **Comments explain *why*, and name the failure mode being prevented.** This is
  the strongest convention in the codebase; match it. A comment that restates the
  code will be asked about in review.
- Rust: `cargo fmt` decides formatting; don't argue with it. Public items in
  `novalis-core` carry doc comments.
- TypeScript: no formatter is enforced — match the surrounding file.
- **`novalis-core` has zero Tauri references and must keep them.** Logic goes in
  core; the Tauri crate is wiring. If a core change needs `tauri`, it belongs on
  the other side of the boundary.
- Tests live next to the code (`mod tests` in Rust, `__tests__/` in the
  frontend). A bug fix without a regression test will be asked for one.

## Related documents

- [README.md](README.md) — what Novalis is, and its network behaviour
- [PLUGINS.md](PLUGINS.md) — the plugin host API
- [MOBILE.md](MOBILE.md) — the Android/iOS plan and its current limitations
- [RELEASING.md](RELEASING.md) — how a release is cut (maintainer)
- [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) — bundled third-party licenses
