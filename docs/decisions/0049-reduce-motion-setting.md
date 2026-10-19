# 0049 — A fifth setting: Always Reduce Motion

**Status:** accepted · **Date:** 2026-10-19 · **Decider:** Sebastian Grundhöfer

## Context

ADR-0004 allows four settings and asks for an ADR with the owner's yes for any other. The sebaro design (ADR-0048) has one motion rule and asks every app to offer "Bewegung immer reduzieren" (sebaro D46), for people who want less movement in novalis without turning it off for all of macOS. The sketch asked the owner whether novalis should get it.

## Decision

- **`reduceMotion`**, boolean, default `false`, in `settings.json` and the `Settings` struct; changed via **View ▸ Always Reduce Motion** (a check item, like Check Spelling While Typing) and listed in the settings palette.
- On, the UI stamps `data-motion="reduced"` on the root element and every duration token collapses to 1 ms, the same as macOS's own Reduce Motion (`prefers-reduced-motion`), which keeps working when the setting is off.
- No shortcut, no other place.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Follow macOS only | The owner asked for the setting ("die Einstellung ermöglichen") |
| State in `state.json` | It is a preference the user sets on purpose and expects to keep, not window state |

## Consequences

- `docs/SETTINGS.md` has five rows; the parity test compares them with the struct. CLAUDE.md and PLAN.md §5.5 say five.
- A `settings.json` written by an older version simply lacks the key and gets `false` (`serde(default)`); one written by this version is refused by an older one (`deny_unknown_fields`), which is the existing rule for any settings change.

**Owner approval:** 2026-10-19 — "2 die Einstellung ermöglichen" (answer to the sketch's question 2, sebaroDesign DECISIONS D65).

## Sources

ADR-0004 · ADR-0048 · docs/SETTINGS.md · sebaroDesign `DECISIONS.md` D46, D65
