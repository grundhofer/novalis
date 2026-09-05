# 0009 — Build order: core crate with a thin CLI harness first, desktop app second

**Status:** accepted · **Date:** 2026-09-05 · **Decider:** Sebastian Grundhöfer

## Context

The brief says "start with the desktop app for Mac". Revision 1 of the plan proposed the full 20-command CLI with golden tests before any UI, which contradicts that wording; the review (brief F3) found that the core crate is untestable without some headless harness, and that a thin CLI subset is exactly that harness. The core's failure modes (atomic saves, conflict copies, watcher batches, cloud-only files) are the ones the old app got wrong, so they need tests before a UI depends on them. The owner adopted D24.

## Decision

- **Phase 2 (weeks 2–5):** Spike C (Tauri + CM6) and Spike D (Google Drive) plus the core crate modules with the Rule-13 corpus, and a **thin CLI harness subset** with golden tests: `ls cat new edit mv rm search links tags index init doctor`.
- **Phase 3 (weeks 5–9):** the desktop alpha on top of the tested core; week-7 checkpoint: editor + tree + tabs daily-driveable before the Kanban pane starts.
- **Phase 4 (weeks 9–11):** the remaining CLI commands (`board`, `card`, `relink`, `meta`, `migrate`, `sync status`, `help --json`, `skill --path`) with golden tests and `SKILL.md`, hardening, first unsigned release `v2.0.0-alpha.1`.
- The harness subset does not grow beyond the list above without re-planning; the agent skill marks Phase-4 commands as planned until they ship.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Desktop shell first, core growing underneath | Matches the brief's wording, but the core would be exercised only through a UI and the old app's data-loss bugs are exactly the kind a UI hides |
| Full 20-command CLI with golden tests first (revision 1) | Contradicts "start with the desktop app"; delays the alpha by weeks for commands agents do not need on day one |
| Core with unit tests only, no CLI harness | The harness costs little on top of the core and is the first shipped artefact for agents |

## Consequences

- The Phase 2 exit is measurable: golden tests green on the demo vault and generated fixtures, benchmarks recorded, stack go/no-go decided.
- `SKILL.md` is written against the full §9.2 contract from the start; commands not yet implemented exit 2 (usage) with a hint until Phase 4.
- Under time pressure, Phase 4 commands may slip past the alpha (PLAN.md §14); the harness subset may not.
- Estimates are ASSUMED and re-planned after week 2.

**Owner approval:** 2026-09-05 — "section 4 please make your recommedations" (docs/DECISIONS.md, "Build order: core + thin CLI harness first, desktop alpha second (D24)").

## Sources

PLAN.md D24, §4.5, §12 (Phases 2–4, "First two weeks"), §14 · docs/DECISIONS.md · docs/research/2026-09-05-review-of-plan-rev1.md (brief F3)
