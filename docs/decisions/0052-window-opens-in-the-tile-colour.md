# 0052 — The window opens in novalis's tile colour

**Status:** accepted · **Date:** 2026-11-14 · **Decider:** Sebastian Grundhöfer

## Context

Since sebaro's design round 7 (D144 (3), `docs/sebaro-luecken.md` Z14) novalis starts with the whole window in its tile colour and the white sign, which then fades to the app. The window under the page did not follow: `build.rs` gave it the neutral ground of the stored choice (ADR-0051 #22, DSK-14), so the built app stood about 0.1 s in that ground before the start, then in the tile colour, then in the neutral ground again (Z14, measured 2026-11-12). Z14 asked sebaro which ground a window shows before a start in the product's colour.

The owner answered in sebaro on 2026-11-13: the window of a desktop app opens in the product's colour. sebaro's release v2.0.0 (2026-11-14) brings the answer to every desktop app, and says the app's own Rust code does it, since no file of the copy can: `build.rs` reads the tile colour of the product's group (`signTiles.<group>.tile` of the copy's `tokens.json`, the group from `sebaro.product.json`), the window is created with it as its ground, and when the start is over (`sb-start-done`) the window takes the stored light or dark ground. The guide's desktop starter does it with a command `start_ended`.

## Decision

- **`build.rs`** reads `tile` of `sebaro.product.json` (`collaboration`) and writes `signTiles.collaboration.tile` of the copy's `tokens.json` as `SEBARO_START` beside the four grounds. No colour value is copied into Rust; a missing file, group or colour fails the build.
- **The window** is created with `window::start_ground()`, the same in light and dark. It keeps it until the page says the start is over; `setup` no longer paints the stored ground after building it.
- **`start_ended`**, a new IPC command, gives the window the ground of the stored choice (`window::paint_ground`, as `settings_set` does). The page calls it at `sb-start-done`, at once when `sbStart.done` already holds or the script is missing, and when `lib/start.ts` ends a stuck start by hand. 29 commands of the 30 PLAN.md §2.3 rule 8 allows.

Nothing else changes: no setting, menu item, shortcut, string, dependency or outbound connection. The start itself, its markup and its timing are sebaro's as before.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| `backgroundColor` in `tauri.conf.json` | One value for the whole life of the window, and a copy of sebaro's colour in novalis (spec/09 §13.1 does not use it) |
| The page sets the ground through `@tauri-apps/api` | It needs a window permission in the capabilities and the colours in TypeScript; the ground is the shell's (ADR-0051 #22) |
| Keep the neutral ground before the start | Not what the owner decided in sebaro |

## Consequences

- From its first frame the window shows the tile colour the start shows; the stored ground follows when the start is over, and a later resize shows that one at the window's edge.
- macOS switching light and dark (`ThemeChanged`) or a settings change while the start still runs paints the stored ground early. The page covers the window then, so nothing shows; there is no guard for it.
- A build of the desktop crate reads `sebaro.product.json` too, and reruns when it changes.
- Not yet seen in a built app (`docs/sebaro-luecken.md` Z16).

**Owner approval:** 2026-11-13, in sebaro, verbatim „3 ja“, the answer to the question whether the window of a desktop app opens in the product's colour. It applies to novalis through sebaro release v2.0.0, so novalis asks no question of its own.

## Sources

ADR-0051 #22, #26 · `docs/sebaro-luecken.md` Z14, Z16 · `apps/desktop/ui/src/sebaro/CHANGES.md` v2.0.0 and `README.md` („The window opens in the product's colour“) · sebaro spec/03 §14.1, spec/09 §13.1
