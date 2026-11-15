# 0055 — The CLI sets and filters the card fields

**Status:** accepted · **Date:** 2026-11-15 · **Decider:** Sebastian Grundhöfer

## Context

ADR-0054 gave cards labels, a due day, a priority and an assignee, set in the app's „Karte bearbeiten“ and filtered in a board's „Filter“. The CLI printed the four keys but could not set or filter by them, so an agent could read a project board but not keep it.

## Decision

- **`card add`** takes `--label L` (repeatable), `--due YYYY-MM-DD`, `--priority high|medium|low` and `--assignee NAME`. The card is written once, with the fields checked and tidied as the app's change of them does (`NewCard` carries them).
- **`card set`** takes the same fields. `--label` (repeatable) replaces the labels, and `--label ""` alone clears them. `--add-label` and `--rm-label` (regardless of case) change the card's own list and are refused together with `--label`. An empty `--due` or `--assignee` and `--priority none` clear the field. It stays one file per change, in a fixed order after the existing ones.
- **`card ls`** filters by `--label` (regardless of case), `--priority`, `--assignee` and `--due overdue|today|7d|none`. Days are local, and `7d` is today and the six days after, as in the app.
- A due day that is no real day, a priority that is no step, or an unknown `--due` filter is a usage error (exit 2) before anything is written.

Output shapes only gain keys (PLAN.md §9, add-only). No setting, no dependency. The board's view (collapsed, filter, sort, label tones) stays the app's: the owner did not choose `board view`.

## Consequences

- PLAN.md §9.2 and the agent skill name the flags.
- The core's own day check from ADR-0054 part 3a gave way to the existing `util::is_iso_day`.

**Owner approval:** 2026-11-15 — „kannst du die cli entsprechend erweitern?“, then, of four offered parts, „Felder setzen (card set), Felder beim Anlegen (card add), Filtern in card ls“ (not „Board-Ansicht (board view)“).

## Sources

ADR-0054 · PLAN.md §9.2
