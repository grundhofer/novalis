# 11. A test runner for the UI

Date: 2026-09-08

## Status

Accepted.

## Context

`apps/desktop/ui` had no tests and no way to run any. `apps/desktop/ui/package.json`
carried no `test` script, and `just test` ran
`pnpm -C ui run --if-present test`, so it **reported success while executing
nothing**. CI had no UI test step either. The only automated cover for ~6,000
lines of TypeScript was `tsc --noEmit` and `eslint`.

That is not an abstract gap. On 2026-09-06 and 2026-09-08, six defects were
found in that layer by reading and by running the app, not by any test:

- renaming an open note blanked the editor, because the document map is keyed
  by path and nothing re-keyed it;
- all seven dialog-driven actions failed silently, because `ask()` only stores
  the request and the promise `dispatchCommand` catches has already resolved;
- `Cmd-Delete` trashed the active note with no confirmation;
- board drag never called `setData`, the WebKit precondition, so the drop never
  fired;
- `reportFatal` returned early once React had mounted, so a post-mount crash
  left a blank window with no message anywhere;
- the card and column rename buttons read "Rename Board".

The last one reached a pull request and was caught by the owner from a
screenshot. Three of the six were missed by a first audit pass and only found
when a second reviewer went looking.

The minimalism rule (CLAUDE.md) requires an owner decision for a new
dependency. This is that decision.

## Decision

Add a test runner for the UI: **`vitest`**, with **`jsdom`** as the DOM
environment and **`@testing-library/react`** to render and query components.
Three dev dependencies, no runtime dependency, nothing shipped in the bundle.

`vitest` rather than any alternative because it reads the existing
`vite.config.ts` — the same `@vitejs/plugin-react`, the same `@novalis/tokens`
alias, the same TypeScript settings — so a test compiles the way the app does.
A second toolchain would be a second way for the build to be wrong.

`just test` runs it, and `ci.yml` gains a UI test step, because a check that is
not in both is a check that silently stops running (CLAUDE.md).

The owner's words, 2026-09-08:

> add test runner for missing parts

and, when the gap was put to them earlier the same day as one of two open
decisions:

> please merge everything and clean up

(the runner was named in that summary as the outstanding decision, and this
message answered it directly.)

## Consequences

- `pnpm -C apps/desktop/ui run test` exists and runs. `just test` stops
  reporting a success it did not earn.
- The first tests cover the six defects above as regressions, so the specific
  bugs that shipped cannot come back unnoticed.
- Tests mock the IPC surface (`../ipc/client`) rather than starting a Tauri
  shell. They cover the UI's own logic — stores, dispatch, components — which
  is exactly where every defect above lived. They do **not** cover the Rust
  side, which has its own tests, nor the boundary between them.
- Three dev dependencies enter `pnpm-lock.yaml`. `scripts/lockfile-adr-check.mjs`
  requires an ADR reference for a new top-level entry; this is it.
- What this does not buy: nothing here renders a real WebKit view, so CSS,
  hover states, drag and drop, and layout are still unverified by machine. The
  overlap bug of 2026-09-08 would not have been caught by a jsdom test. Those
  need either a human or a browser-driving harness, which is not in scope here.
