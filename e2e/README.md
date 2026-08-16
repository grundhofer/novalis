# e2e — real-app UI tests

**Status: it gates releases.** `.github/workflows/e2e.yml` runs this on all
three platforms as the `UI gate` in `release.yml`, and on any PR carrying the
`e2e` label. It is the only check in this repo that launches the app.

It started as a spike answering one question, and the answer is yes:

> Can an automation tool reach inside the real Novalis window — the actual
> release-shaped binary, real Rust backend, real system webview — and type into
> the TipTap editor such that the text lands on disk?

The probes below are still written as a spike reports: every one runs and
reports even after an earlier failure, and the tree dumps are printed on
success too. That is deliberate for a suite whose failures are usually about
what a platform's accessibility provider did or did not expose — a bare
assertion failure would not be actionable.

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

**Answered, and this is the one the programme rested on: typed text reaches the
document.** Proven end to end on Windows, once the note body carried an
accessible name:

```
clicking named region: group "Note body: Spike.md"
PASS  probe 6: text typed at the OS level reaches the note on disk
      file changed by 90 chars; contains marker: true
```

So the full chain holds — name the element, address it through the OS
accessibility tree, type with real synthetic input, and the text lands in the
file. ProseMirror accepts OS-level keystrokes. That is precisely the capability
the in-webview approaches cannot offer: their contenteditable input is
`document.execCommand('insertText', …)` with untrusted key events.

It also settles what the naming work buys. Before the label the spike aimed at
a coordinate and could not tell "the click missed" from "the editor refused";
one `aria-label` turned that into a definite yes.

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| webview DOM in the tree | ✅ | ✅ | ✅ |
| onboarding dismissable | ✅ | ✅ | ✅ |
| note opens, editor mounts | ✅ | flaky | ✅ |
| **typing reaches disk** | ✅ | ✅ | ✅ |
| rolled-out names present | 6/6 | 6/6 | 6/6 |
| table in the editor is survivable | ✅ | ✅ | ❌ |

**The approach works on all three platforms.** Text typed with real OS-level
input reaches the file on disk on macOS, Windows and Linux. Nothing goes into
the app to achieve it — no plugin crate, no `withGlobalTauri`, no automation
server — so the same binary that ships is the one under test.

### The one real defect, and it is a user-facing one

A note containing a header-row table, opened in the editor, takes WebKitGTK's
whole accessibility tree down. Sampled eight times over twelve seconds:

```
Linux    105 -> [109, 6, 6, 6, 6, 6, 6, 6]   persistent, does not recover
macOS    125 -> [160, 161, 161, 161, ...]    unaffected
Windows  251 -> [251, 251, ...]              unaffected
```

**Correction to an earlier reading here: `<th>` alone appears to be enough, and
`contenteditable` is not established as necessary.** This file previously said
the opposite, on the strength of xa11y's Tauri fixture "carrying three `<th>`
with green CI". Those three occurrences are inside an HTML *comment* in that
fixture, which exists to record why the header cells were removed:

> "Deliberately NO `<th>` header cells: under WebKitGTK 2.52 … a table
> containing `<th>` sends the web process's accessibility tree into a continuous
> invalidation churn — every content accessible goes defunct moments after being
> exposed, which takes the whole page out of the AT-SPI tree … Verified by
> bisecting this file against a live harness run; `<td>`-only tables are stable."

So a third party reproduced the same symptom on a *static* table with no editor
at all, and bisected it. Their note adds "with a window manager present"; this
CI runs Xvfb, dbus and at-spi2 with no window manager and reproduces anyway,
which is a genuine difference and not yet explained.

For a Linux screen-reader user this means opening a note with a table empties
the page from the accessibility tree. Novalis is a notes app that ships table
editing, so that is a reachable state, and nothing in the repo would have found
it: no test had ever launched the app.

**It is intermittent across runs.** One run showed no collapse at all, which is
why probe 8 samples a series rather than taking a snapshot — a single reading
cannot tell a persistent failure from a window of invalidation that settles, and
an early single reading is what made me first report this as deterministic and
then, one run later, as transient. It is neither: it is a race that lands often
and, when it lands, does not recover.

The suite therefore drives `Plain.md` (no table) for editing and opens
`Spike.md` last, purely as the diagnostic that keeps this measured on every run.

### Known flakiness, honestly

Clicking a file-tree row occasionally does not open the note — Windows in one
run, with `tree_item "Note: Plain.md"` present in the tree and the click
registering. That is an activation problem, not a naming one, and it is the
next thing to fix before any of this becomes a gate.

### What it cost, and what it bought

Seven rounds, nearly all of them spent on the harness rather than the app:
`inputSim` is a factory not an instance; modifier names are capitalised and the
binding throws synchronously so a trailing `.catch()` never fires; the package
is CommonJS so named ESM imports fail; a fixed sleep is not a readiness check.
None of that is a finding about Novalis.

Four things are, and any real suite would have hit all of them:

1. **Both** config structs are `#[serde(rename_all = "camelCase")]` — `Settings`
   (`lastVault`, not `last_vault`) and `Preferences` (`prefsVersion`, not
   `prefs_version`). The snake_case form is silently ignored in each case, and
   this trap was walked into twice: the second time it left the fixture vault on
   the legacy all-on feature profile, switching on the embedding model, AI and
   sync behind the suite's back. The app logged it plainly — "vault predates the
   feature flags" — and nothing was reading the app's output until this script
   started streaming it.
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
