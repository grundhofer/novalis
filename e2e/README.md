# e2e — real-app UI tests

**Status: spike.** Nothing here gates anything yet. It exists to answer one
question before a suite is built on top of it:

> Can an automation tool reach inside the real Novalis window — the actual
> release-shaped binary, real Rust backend, real system webview — and type into
> the TipTap editor such that the text lands on disk?

Everything else about a UI-test programme is downstream of that answer.

## Why this directory is not a pnpm workspace package

`pnpm-workspace.yaml` lists `apps/desktop`, `apps/desktop/frontend` and
`packages/*`. `e2e/` matches none of them, deliberately: `pnpm -r test` is a CI
gate on every PR, and a package here would be swept into it — an E2E suite
needs a built app and would fail or hang in that context. It carries its own
`package.json` and is installed explicitly by the workflow that runs it.

## Why xa11y and not Playwright

Playwright drives only the browser engines it ships and patches. Its WebKit is
a main-branch build, not the WKWebView Novalis renders in on macOS, and
`connectOverCDP` — its only attach mechanism — is documented as Chromium-only,
so WKWebView and WebKitGTK are unreachable. That leaves WebView2 on Windows as
the single Playwright-reachable surface, which is one platform, not three.
A Playwright suite here would have to run against the Vite dev server with the
Tauri IPC mocked: useful, but it stops at the IPC boundary and never touches
Rust, SQLite, the file writes, or the CSP and capabilities in `tauri.conf.json`.

xa11y drives the OS accessibility APIs instead — AXUIElement on macOS, AT-SPI2
on Linux, UI Automation on Windows. Two consequences matter here:

- **No plugin goes into the app.** The alternative (`@wdio/tauri-service`'s
  embedded provider) requires two crates compiled into the binary, a
  `withGlobalTauri: true` config change that exposes `window.__TAURI__` to all
  page script, and an in-process HTTP automation server that must never reach a
  production build — upstream does *not* gate it with `debug_assertions`, so
  gating it would be our responsibility. xa11y needs none of that, and can
  therefore drive the very artifact `release.yml` uploads.
- **Real OS-level input.** The webview-plugin approach synthesizes DOM events
  (`document.execCommand('insertText', …)` and untrusted `KeyboardEvent`s),
  which is the one thing a ProseMirror editor is most likely to reject.

The trade-off, stated plainly: xa11y is pre-1.0 (0.13.0, MIT, ~60 stars). Its
own CI runs a real Tauri app on ubuntu-, macos- and windows-latest, which is
better cross-platform evidence than anything else surveyed — but it is a young
project, and this spike is how we find out whether it holds for our app rather
than for its own test fixture.

## Running the spike

It runs in CI (`.github/workflows/e2e-spike.yml`), on purpose. Running it
locally on macOS means granting your terminal **Accessibility** and, on
macOS 26+, **Screen & System Audio Recording** — the second reads window
content across your whole desktop — and it drives real synthetic keyboard and
mouse events into whatever is frontmost. That is a poor trade for a machine you
are working on. Linux CI is where it has to work anyway.

If you do want it locally:

```sh
pnpm --filter @novalis/desktop tauri build --debug --no-bundle
node e2e/seed.mjs                      # writes the fixture vault + settings.json
node e2e/spike.mjs <path-to-binary>
```

## Verdict (7 CI rounds, 3 platforms each)

**Answered, and positively: the app is drivable from outside.** The webview DOM
is in the accessibility tree on **macOS, Windows and Linux** — not a window
frame, the actual React UI. The spike dismisses onboarding by pressing a button
it found in the tree, then opens the fixture note from the file tree, on Linux
and Windows. macOS reaches the workspace but does not expose the note under a
name the spike matches.

That refutes the assumption this project has carried: WKWebView is not closed
to automation. It was closed to the approach tried before.

**Not answered: whether typed text reaches the document.** OS-level keystrokes
execute without error and the note on disk is unchanged, on all three
platforms. Two explanations remain open and the spike cannot currently tell
them apart:

- the click lands somewhere that is not the editor (it aims at a *coordinate*,
  70% across the web area, because the editor region has no accessible name);
- or the keystrokes arrive and ProseMirror does not accept them.

Distinguishing those needs the editor to be addressable, which is the one piece
of work that sits on the app's side of the line — see below.

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| app visible to the a11y API | ✅ | ✅ | ✅ |
| webview DOM in the tree | ✅ | ✅ | ✅ |
| onboarding dismissable | ✅ | ✅ | ✅ |
| note opens from the file tree | ❌ | ✅ | ✅ |
| typing reaches disk | ❌ | ❌ | ❌ |

### What it cost, and what it bought

Seven rounds, nearly all of them spent on the harness rather than the app:
`inputSim` is a factory not an instance; modifier names are capitalised and the
binding throws synchronously so a trailing `.catch()` never fires; the package
is CommonJS so named ESM imports fail; a fixed sleep is not a readiness check.
None of that is a finding about Novalis.

Four things are, and any real suite would have hit all of them:

1. `Settings` is `#[serde(rename_all = "camelCase")]` — the key is `lastVault`,
   not `last_vault`, and the snake_case form is silently ignored.
   `Preferences` is the opposite: plain snake_case, no rename.
2. `ensure_features_stamp` rewrites a vault to the legacy all-on profile unless
   `.novalis/config.json` carries the current `prefs_version` — which would
   switch on the embedding model, AI and sync behind a test's back.
3. **Role and name are provider-dependent.** The same note is
   `group "Spike.md"` on Linux and `tree_item "Spike"` on Windows — extension
   included in one, dropped in the other. Any suite that pins either shape is
   pinned to one platform.
4. `xa11y/setup-a11y@v1` cannot be used here at all: it calls
   `awalsh128/cache-apt-pkgs-action@v1`, which is not SHA-pinned, and this repo
   requires that of every action. The rejection is workflow-wide, not scoped to
   the job — an `if:`-gated Linux step failed all three platforms in 8 seconds.
   Its work is inlined in `e2e-spike.yml` instead.

### The decision this leaves

The remaining uncertainty has one cheap resolution: give the editor region an
accessible name. That is a few lines, it is a genuine accessibility improvement
independent of testing, and it turns an ambiguous negative into a definite
answer — either the keystrokes arrive or they do not, with no aiming question
left. The spike deliberately did NOT make that change: finding out whether the
work pays off is what it was for, and quietly doing the work first would have
destroyed the evidence.

The alternative, WebdriverIO's embedded provider, is *less* likely to clear the
same bar: its contenteditable input is `document.execCommand('insertText', …)`
and its key events are untrusted, which is exactly what a ProseMirror editor is
most likely to reject.

## What the spike reports

Progressive probes, each independent, all of them printed even when an earlier
one fails — a partial answer is still an answer:

1. the app process starts and stays up
2. xa11y sees the application at all
3. the accessibility tree contains **webview DOM**, not just a window frame
4. named elements from our own UI are addressable
5. text typed into the editor reaches the file on disk

Probe 3 is the one that decides the programme. If the webview's contents do not
appear in the accessibility tree, no selector work can rescue it and the
WebDriver route becomes the fallback.
