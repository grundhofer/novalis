# docs/

Everything that is a contract or a decision lives here; code follows these
files, never the other way round. Each file below names the CI check that keeps
it honest.

| File | What it is | Kept honest by |
|---|---|---|
| `PLAN.md` (repo root) | The rewrite plan, revision 2 | Owner review |
| `DECISIONS.md` | Verbatim owner answers of 2026-09-05; the index the ADRs quote | — |
| `decisions/NNNN-*.md` | Architecture decision records in the old ADR voice, each with a quoted owner yes (PLAN.md §11.5) | PR checklist: no setting, feature, menu item, shortcut, dependency or outbound call without an ADR number |
| `SETTINGS.md` | The allow-list of persisted settings (four keys + `lastVault` + `version`) | settings-parity test against the `Settings` struct |
| `KEYMAP.md` | The complete v1 keymap, one row per chord | keymap-parity test against the app's keymap table |
| `PRIVACY.md` | No telemetry, no analytics, no crash reporting, no update check; empty outbound table in Mode 1 | Hand-checked before each release with the greps in the file; the CI gate PLAN.md §11.5 asks for is not written yet |
| `BUDGET.json` | Performance and size budgets from PLAN.md §11.3 as machine-readable numbers | `scripts/bundle-budget.mjs` (the four bundle rows). `perf.yml` is still a placeholder and the D26 `Cargo.lock` budget (scaffold 431 + 150) is not enforced by any script yet |
| `FILE-PROVIDER-CHECKLIST.md` | Manual checklist for OneDrive and Google Drive (Stream and Mirror); every unverified §5.6 item | Executed before each release; results recorded in the file |
| `RELEASING.md` | Tag → draft → publish; unsigned builds this year; how to enable signing later | `release.yml` |
| `research/` | The ten research reports and the review of plan revision 1 (read-only history) | — |

## ADR index

| ADR | Title |
|---|---|
| [0001](decisions/0001-licensing.md) | Licensing: AGPL-3.0-only with a plugin and an app store exception (carried over verbatim) |
| [0002](decisions/0002-no-update-check.md) | No update check, no auto-update |
| [0003](decisions/0003-identifier.md) | App identifier `io.github.grundhofer.novalis`, keychain service, fresh app-data |
| [0004](decisions/0004-settings-allow-list.md) | Settings allow-list: four keys, no preferences window |
| [0005](decisions/0005-wikilink-resolution-and-migration.md) | Wikilink resolution by file stem, identity by path, one-time migration |
| [0006](decisions/0006-kanban-store.md) | Kanban store: one folder per board, one JSON file per card |
| [0007](decisions/0007-design-direction.md) | Design direction: Dev-Noir primary, Swiss alternative, tabs |
| [0008](decisions/0008-v1-keymap.md) | The v1 keymap is hard-coded and documented |
| [0009](decisions/0009-build-order.md) | Build order: core + CLI harness first, desktop second |
| [0010](decisions/0010-unsigned-releases-2026.md) | Releases ship unsigned for the coming year |

## Writing a new ADR

Copy the shape of 0002: `# NNNN — Title`, the Status/Date/Decider line,
Context (≤ 5 sentences), Decision, Rejected alternatives table, Consequences,
**Owner approval** with the date and the owner's verbatim yes, Sources. Number
sequentially; never renumber. A decision that changes an earlier ADR amends
that ADR's Consequences with a dated note and links the new one.

## Related files outside docs/

- `i18n/en.json`, `i18n/de.json` — every user-visible string (`i18n/README.md`).
- `packages/agent-skill/novalis/` — the agent skill (`SKILL.md`, `reference.md`, `examples.md`).
- `fixtures/demo-vault/`, `fixtures/gen/gen_vault.py` — test vaults.
- `design/variants/` — the eleven mockup frames and per-style specs.
