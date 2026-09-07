# novalis task runner — the only supported entry points (PLAN.md §5.1, §11.7).
# CI (.github/workflows/ci.yml) runs the same commands with `--locked` and
# `--frozen-lockfile` added; keep the two in step. Recipes starting with `_`
# are helpers and hidden from `just --list`.

set shell := ["bash", "-euo", "pipefail", "-c"]

root := justfile_directory()
ui := root / "apps/desktop/ui"
desktop := root / "apps/desktop"

# Show this list.
default:
    @just --list --unsorted

# Check tool versions (rustc 1.96, node 22, pnpm 11, cargo tauri 2) and install JS dependencies.
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{root}}"
    status=0
    # check <label> <expected-prefix> <actual> <hint>
    check() {
      if [[ -n "$3" && "$3" == "$2"* ]]; then
        printf '  ok    %-6s %s\n' "$1" "$3"
      else
        printf '  FAIL  %-6s %s (want %s*) -- %s\n' "$1" "${3:-not found}" "$2" "$4"
        status=1
      fi
    }
    check rustc "1.96." "$(rustc --version 2>/dev/null | awk '{print $2}')" "rustup reads rust-toolchain.toml; run any cargo command once"
    check node  "v22."  "$(node --version 2>/dev/null || true)"               "brew install node@22"
    check pnpm  "11."   "$(pnpm --version 2>/dev/null || true)"               "corepack enable && corepack prepare pnpm@11.0.9 --activate"
    check tauri "2."    "$(cargo tauri --version 2>/dev/null | awk '{print $2}')" "cargo install tauri-cli --version ^2 --locked"
    for tool in cargo-deny cargo-audit; do
      command -v "$tool" >/dev/null 2>&1 || echo "  note  $tool not installed (CI's audit job runs it; cargo install $tool --locked)"
    done
    if [[ $status -ne 0 ]]; then
      echo "just setup: fix the FAIL rows above" >&2
      exit 1
    fi
    if [[ -f pnpm-lock.yaml ]]; then
      pnpm install --frozen-lockfile
    else
      pnpm install
    fi

# Run the desktop app with hot reload.
dev:
    cd "{{desktop}}" && cargo tauri dev

# Everything CI checks, in CI's order. Green here means green there.
check: _versions _ui-check _fmt-check _clippy _test-rust _bindings-check _i18n-check _bundle-budget

# Rust and UI tests.
test: _test-rust
    pnpm -C "{{ui}}" run --if-present test

# CLI golden tests (crates/novalis-cli/tests). `UPDATE_GOLDEN=1 just test-cli` regenerates the .golden files.
test-cli:
    cargo test -p novalis-cli

# Core perf budgets (PLAN.md §11.3) on a generated 10k-note vault; reproduces perf.yml locally.
perf:
    #!/usr/bin/env bash
    # Deliberately not part of `just check`: it builds in release and writes
    # 10k files. CI runs it on `main` and tags only, where a number means
    # something and runner noise is not being compared against a PR.
    set -euo pipefail
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    python3 "{{root}}/fixtures/gen/gen_vault.py" "$work/vault" --count 10000
    mkdir -p "$work/cache"
    cargo run --release --locked -p novalis-core --example perf -- \
      "$work/vault" "$work/cache" > "$work/measured.json"
    node "{{root}}/scripts/perf-budget.mjs" "$work/measured.json"

# Build the release app bundle for this Mac (unsigned; ad-hoc signed by the bundler).
app:
    cd "{{desktop}}" && cargo tauri build

# Set the version everywhere: VERSION, Cargo.toml [workspace.package], package.json, tauri.conf.json.
bump version: && _versions
    #!/usr/bin/env node
    const fs = require("node:fs");
    const path = require("node:path");
    const version = "{{version}}";
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
      console.error(`bump: "${version}" is not a SemVer version (example: 2.0.0-alpha.1)`);
      process.exit(2);
    }
    const root = "{{root}}";
    const stamp = (rel, edit) => {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) {
        console.log(`  skip  ${rel} (not present yet)`);
        return;
      }
      fs.writeFileSync(file, edit(fs.readFileSync(file, "utf8")));
      console.log(`  ok    ${rel}`);
    };
    const jsonVersion = (rel) => (text) => {
      const out = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, `$1${version}$2`);
      if (JSON.parse(out).version !== version) throw new Error(`${rel}: no top-level "version" key`);
      return out;
    };
    stamp("VERSION", () => `${version}\n`);
    stamp("Cargo.toml", (text) => {
      const re = /^(\[workspace\.package\][^[]*?^version\s*=\s*")[^"]*(")/ms;
      if (!re.test(text)) throw new Error("Cargo.toml: no version under [workspace.package]");
      return text.replace(re, `$1${version}$2`);
    });
    stamp("package.json", jsonVersion("package.json"));
    stamp("apps/desktop/src-tauri/tauri.conf.json", jsonVersion("tauri.conf.json"));

# Vendor designSprache's generated tokens.css into packages/tokens/ (not available yet, see PLAN.md §5.9).
tokens-sync slug="" commit="":
    @echo "tokens-sync: nothing to sync yet."
    @echo "packages/tokens/tokens.css is hand-written for the chosen style and carries the header"
    @echo "GENERATED-PENDING until designSprache ships DTCG tokens (PLAN.md §5.9, D13). Once its Style"
    @echo "Dictionary build exists, this recipe vendors tokens.css for <slug> at <commit> together with a"
    @echo "SHA-256 manifest, and CI fails on drift. Until then edit the file by hand and keep the header."
    @exit 1

_versions:
    node "{{root}}/scripts/check-versions.mjs"

_ui-check:
    pnpm -C "{{ui}}" run typecheck
    pnpm -C "{{ui}}" run lint
    pnpm -C "{{ui}}" run build

_fmt-check:
    cargo fmt --all --check

_clippy:
    cargo clippy --workspace --all-targets -- -D warnings

# Includes the settings-parity, keymap-parity and i18n catalog tests, which are cargo tests.
_test-rust:
    cargo test --workspace

# PLAN.md §11.2: `ui/src/ipc/bindings.ts` is generated from the Rust command
# surface. CI regenerates it and runs `git diff --exit-code`; there may be no
# git repository here yet, so this compares against a copy taken first.
_bindings-check:
    #!/usr/bin/env bash
    set -euo pipefail
    file="{{ui}}/src/ipc/bindings.ts"
    before="$(mktemp)"
    trap 'rm -f "$before"' EXIT
    cp "$file" "$before"
    cargo run --quiet -p novalis-desktop --example gen_bindings >/dev/null
    if ! diff -u "$before" "$file"; then
      echo "bindings.ts was stale and has just been regenerated -- review and commit it" >&2
      exit 1
    fi

# Catalog shape, en/de parity and key drift, as the UI package's `i18n:check` script.
_i18n-check:
    pnpm -C "{{ui}}" run i18n:check

_bundle-budget:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -f "{{ui}}/dist/index.html" ]]; then
      node "{{root}}/scripts/bundle-budget.mjs"
    else
      echo "bundle-budget: {{ui}}/dist/index.html not found, skipped (just check builds the UI first)"
    fi
