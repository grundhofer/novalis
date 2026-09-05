# 0005 — Wikilink resolution by file stem, note identity by path, one-time migration

**Status:** accepted · **Date:** 2026-09-05 · **Decider:** Sebastian Grundhöfer

## Context

The old app resolved `[[wikilinks]]` by frontmatter title and alias through its index and never rewrote links on move, so a rename silently broke references. In the demo vault 40 of 63 notes have a stem that differs from the title, 6 titles contain `:` (forbidden on OneDrive), and 16 of 228 links point at those 6. Agents and other tools (Obsidian, plain grep) expect the target to be the file name. A deterministic rule without an index needs a one-time migration of old vaults, which the owner accepted (PLAN.md §4.5).

## Decision

- **Resolution (D4):** `[[X]]` matches file stems case-insensitively after NFC normalization; a unique match is the note; on duplicate stems `[[folder/stem]]` disambiguates and `doctor` reports the duplicates; `[[X#heading]]` and `[[X|label]]` strip their suffixes; Markdown links `[text](relative/path.md)` resolve relative to the note, percent-decoded; a stem containing `#` or `|` cannot be a target and `doctor` reports it. **No alias resolution; aliases are neither read nor written.** The CLI exposes `linkTarget` (shortest unambiguous wikilink text) on every listed note.
- **Identity (D5):** a note is its vault-relative path. Rename/move in the app and `mv` in the CLI rewrite wikilinks, Markdown links and board card `notes[]` in one rename-first, idempotent operation; `relink <from> <to>` is a public CLI command.
- **Migration (§10):** `novalis migrate` is dry-run by default; `--apply` renames files to their frontmatter title (sanitization map: `:` → ` –`, `/` → `-`; `#` and `|` reported as unlinkable), all-or-nothing against the final state, every rename `RENAME_EXCL`, then relinks across notes and cards, counts cloud-only notes first (`--materialize` or exit 5), and writes `.novalis/vault.json` with a `migrated` timestamp. `@due`/`@status` tokens stay as inert text (D18); `--import-status` is not built.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Title-based resolution via the cache | Needs an index on the resolution path, ambiguous for agents, not what Obsidian does |
| Alias fallback | Hides broken references; needs the index to resolve |
| Rewrite links to current file names instead of renaming | Links become slugs like `[[local-first-software]]` in every old note |
| Frontmatter `id` as identity | Writes into notes the user did not edit (PLAN.md Rule 3) |
| Import `@status` cards into the default board | Owner chose "leave as text" (§4.5) |

## Consequences

- Old vaults run `migrate --dry-run` then `migrate --apply` once; a golden test asserts `links --unresolved` is empty after `migrate --apply` on the demo vault.
- Duplicate stems are legal but reported; agents use `linkTarget` from `ls` and never guess.
- Every path is NFC-normalized at ingress (readdir, watcher, IPC, CLI args, card JSON, link targets); a casefolded shadow column serves resolution.
- Cloud-only notes are never read implicitly by relink or migrate; both report `cloudOnlySkipped`.

**Owner approval:** 2026-09-05 — "section 4 please make your recommedations" (docs/DECISIONS.md: "Wikilink migration: rename files to frontmatter title with automatic relink; dry-run first"; "`@status` cards from old notes: leave as text").

## Sources

PLAN.md D4, D5, D18, D22, D23, §7.2, §9.2 (`mv`, `relink`, `migrate`), §10 · docs/DECISIONS.md · docs/research/2026-09-05-editor-scope.md, 2026-09-05-cli.md (F2)
