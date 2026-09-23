# 31. `novalis board new`

Date: 2026-09-23

## Status

Accepted. Adds one subcommand to PLAN.md §9.2. No IPC, no setting, no
dependency; the core's `validate_slug` becomes public.

## Context

Agents can list, show and re-column boards and move every card, but could
not create a board: `SKILL.md` said the app does that. The owner answered
the feature-gap question on 2026-09-20 (`docs/DECISIONS.md`, "Answered
2026-09-20"):

> Block 1 bauen, B-Empfehlungen übernehmen (Recommended)

which says yes, with its own ADR, to `cli-agents-board-lifecycle` in its
first step, `board new` — rename and move later (row B27 of
`docs/research/2026-09-20-feature-gaps.md`).

## Decision

- **`novalis board new <slug> [--name N]`** does what the app's New Board
  does: `boards/<slug>/` with `cards/` and a `board.json` created
  exclusively, no columns. The name defaults to the slug. The answer is
  the `board show` shape.
- A slug that is not one visible path segment is exit 2 (the core's
  `validate_slug`, now shared); an existing board is exit 4. `--dry-run`
  checks both and writes nothing.
- It is a mutation: `--no-index` is refused.
- **Not built:** `board rename`, `board mv` (ADR-0019 recorded it as a
  later add), `board rm` — the app designs board deletion separately.

## Consequences

- PLAN.md §9.2, `SKILL.md` and `reference.md` name the command; two golden
  cases (a new board with a name, a hidden slug) pin it.
