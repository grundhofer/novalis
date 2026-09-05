# 0008 — The v1 keymap is hard-coded and documented

**Status:** accepted · **Date:** 2026-09-05 · **Decider:** Sebastian Grundhöfer

## Context

The old app shipped configurable keybindings, which the rewrite drops (PLAN.md §2.2). A Sublime-like editor needs a fixed, predictable set of chords, and the Apple standard bindings must stay untouched. Three chords needed an explicit decision because conventions disagree: `Cmd-P` (Print vs quick-open), `Cmd-K` (command palette vs link) and the sidebar/board toggles. A keymap that lives only in code drifts; a documented table with a parity test does not.

## Decision

The complete v1 keymap is the table in `docs/KEYMAP.md`, one row per binding, with a parity test against the app's keymap table. No rebinding UI, no user keymap file. The decided chords:

| Chord | Command |
|---|---|
| `Cmd-P` | Quick-open (no Print in v1) |
| `Shift-Cmd-P` | Command palette |
| `Cmd-K` | Insert/wrap Markdown link |
| `Shift-Cmd-B` | Toggle board pane (`Cmd-B` stays bold) |
| `Cmd-\` | Toggle sidebar (old novalis) |
| `Cmd-,` | Unbound (no preferences window, ADR-0004) |
| `Cmd-B` / `Cmd-I` | Wrap selection in `**` / `_` (Markdown only) |

Everything else follows PLAN.md §7.4: Apple standard (`Cmd-Z`, `Shift-Cmd-Z`, `Cmd-F`, `Cmd-G`, `Cmd-S`, `Cmd-N/O/W/Q`, `Ctrl-Cmd-F`), the Sublime editor set (`Ctrl-G`, `Cmd-D`, `Shift-Cmd-L`, `Alt-Cmd-F`, `Shift-Cmd-F`, `Cmd-/`, `Ctrl-Shift-↑/↓`, `Ctrl-Cmd-↑/↓`, `Shift-Cmd-D`, `Ctrl-Shift-K`), tabs (`Shift-Cmd-[`/`]`, `Cmd-1…9`, `Shift-Cmd-T`), navigation (`Cmd-[`/`]`), `Cmd-Enter` checkbox toggle, `Cmd-=`/`Cmd--`/`Cmd-0` font size, and the tree (`Enter` rename, `Cmd-Delete` trash, `Shift-Cmd-N` new folder). Adding or changing a chord needs an ADR, a `docs/KEYMAP.md` row and the menu label in both catalogs.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| `Cmd-K` command palette (Dev-Noir signature) | Owner chose link insertion; the palette stays on `Shift-Cmd-P`; the title-bar badge shows `⇧⌘P` |
| `Cmd-P` Print, quick-open on `Cmd-O` / `Cmd-T` | No Print in v1; `Cmd-O` is Open Vault |
| `Alt-Cmd-S` (Finder) or `Cmd-K Cmd-B` (Sublime) for the sidebar | Old novalis used `Cmd-\`; chords with two strokes are a mode |
| Palette-only board toggle | A chord is cheaper than a palette round-trip for the second most used surface |
| Configurable keybindings, vim mode | Modes with their own state (PLAN.md §7.1 NO tier) |

## Consequences

- `docs/KEYMAP.md` defines the canonical chord notation (`Ctrl+Alt+Shift+Cmd+Key`) so the parity test compares strings, not prose.
- Menus display the chord from the same table; the i18n catalogs carry the labels, never the chords.
- `Cmd-E` is reserved for the v1.1 read-only preview (PLAN.md §4.4) and is not bound in v1.
- Editor chords are scoped (`editor`, `editor:markdown`, `editor:code`); the same key outside its scope falls through to the system.

**Owner approval:** 2026-09-05 — "section 4 please make your recommedations" (docs/DECISIONS.md: "`Cmd-P`: quick-open (no Print in v1)", "`Cmd-K`: insert/wrap Markdown link", "Board toggle: `Cmd-Shift-B`", "Sidebar toggle: `Cmd-\`", "Preferences window: no").

## Sources

PLAN.md §4.5, §7.1, §7.4, §11.5 · docs/DECISIONS.md · docs/KEYMAP.md
