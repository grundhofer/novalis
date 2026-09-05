---
name: novalis
description: Organize, search, link, create and edit Markdown notes and Kanban cards in a novalis vault with the `novalis` CLI. Use when the user mentions notes, a vault, wikilinks, tags, Kanban boards or novalis.
license: AGPL-3.0-only
allowed-tools: Bash(novalis *)
---

# novalis

`novalis` is a headless command-line tool over the same Rust core as the
novalis desktop app. A vault is a folder of Markdown notes plus, optionally,
Kanban boards under `boards/`. The CLI never prompts, never needs the app
running, and emits JSON whenever stdout is not a terminal. Full flag lists and
JSON shapes: `reference.md`. Worked recipes: `examples.md`.

## Invariants

1. **Plain files are the truth.** A note is a `.md` file; a board is
   `boards/<slug>/board.json` plus one `cards/<ULID>.json` per card. The note
   cache lives outside the vault, is disposable and is never yours: do not
   read, edit or delete anything under `.novalis/` or the app-data cache.
   `novalis index --rebuild` is the only reset.
2. **Link text is the file stem.** `[[Local-First Software]]` resolves to
   `Local-First Software.md` anywhere in the vault, case-insensitively. When
   `doctor` reports duplicate stems, write `[[folder/stem]]`. Never guess a
   link: every note that `ls`, `cat` and `search` return carries
   `linkTarget`, the shortest unambiguous wikilink text. Use it verbatim.
3. **Always `--json`.** Pass it explicitly and parse stdout only. `cat` is
   JSON when piped; `--plain` returns raw text. Errors are one JSON object on
   stderr; the exit code is the contract.
4. **Preconditions.** Every write carries the CLI's own read-time
   precondition. For a note you read earlier and are about to change, add
   `--if-match <sha256>`; after every `edit` or `meta`, take `sha256After`
   from the result as the next `--if-match`. Exit 4 means the file changed
   underneath you: re-read, re-plan.
5. **After every `mv` or `relink`:** check `conflicts` and `cloudOnlySkipped`
   in the result, then run `novalis links --unresolved --json`; it must be
   empty or unchanged from before the operation.
6. **Never `--no-index` on a mutation** (the CLI rejects it, exit 2). Reads
   may use it when speed matters more than freshness.
7. **Dry-run first.** Every mutation takes `--dry-run` and returns the exact
   success shape plus `"dryRun": true` and, for multi-file operations,
   `changes[]`. Show the user the dry run before applying anything that
   touches more than one file.

## Standard loop

```sh
novalis doctor --json                    # 1. healthy? duplicate stems? unresolved links?
novalis ls --json;  novalis search "<q>" --json   # 2. find the notes
novalis cat <note> --json                # 3. read: body, frontmatter, links, sha256
#                                        # 4. plan in words; name every file that changes
novalis <mutation> … --dry-run --json    # 5. inspect changes[]
novalis <mutation> … --json              # 6. apply, with --if-match where you can
novalis links --unresolved --json        # 7. verify; fix anything new
```

## Cheat sheet

Available now (the core harness):

| Command | One line |
|---|---|
| `ls [folder] [--tree] [--tag T] [--sort S] [--limit N] [--fields F]` | list notes: `path stem title linkTarget folder tags modified size sha256 cloudOnly` |
| `cat <note>… [--body\|--frontmatter] [--lines A:B] [--materialize]` | read notes; `links[]` carries `resolvedPath`; exit 8 if cloud-only |
| `new <path> [--tag T]… [--content <text\|->] [--exist-ok]` | create; title = stem; exit 4 if it exists |
| `edit <note> <one edit flag> [--nth N] [--if-match S]` | one atomic text edit (`--append`, `--prepend`, `--replace-section`, `--insert-after-section`, `--find/--replace`, `--set-body -`); frontmatter untouched |
| `mv <from> <to> [--no-relink] [--force] [--materialize]` | rename or move, then rewrite every link form and card reference |
| `rm <note> [--force] [--materialize]` | macOS Trash; exit 5 while backlinks point here |
| `search <query> [--tag T] [--folder F] [--limit 50] [--snippets]` | on-demand scan; `cloudOnlySkipped` counts what was not searched |
| `links <note> [--backlinks\|--outgoing]` · `links --unresolved` · `links --orphans` | link graph, including cards that reference the note |
| `tags [--limit N]` | `{tag, count}` |
| `index --status` · `index --rebuild` | cache state; rebuild only when `doctor` says so |
| `init <dir>` | write `.novalis/vault.json` (idempotent) |
| `doctor` | read-only health report; there is no `--fix` |

Planned (PLAN.md §12 Phase 4; until they ship these exit 2 with a hint):

| Command | One line |
|---|---|
| `board ls` · `board show <b>` · `board columns <b> --set <json>` | boards, columns, cards |
| `card ls [--board B] [--note N] [--column C]` | which cards reference a note |
| `card add <b> --title T [--column C] [--note N]… [--after ID\|--first\|--last]` | new card; default column = first, default position = last |
| `card mv <id> …` · `card set <id> …` · `card rm <id>` | one file per change; `--if-updated <rfc3339>` guards |
| `relink <from> <to> [--force] [--materialize]` | rewrite a literal link target everywhere (merges, dedupes) |
| `meta <note> [--set k=v] [--unset k] [--add-tag T] [--rm-tag T] [--if-match S]` | line-level frontmatter edit; unknown keys preserved |
| `migrate [--dry-run] [--apply] [--rename-to-title] [--import-columns] [--materialize]` | one-time upgrade of a vault written by the old app |
| `sync status` | `vaultKind`, `cloudOnly[]`, `conflictCopies[]` |
| `help --json` · `skill --path` | command tree; the directory of this skill |

Until `card` and `relink` ship: read `boards/<slug>/cards/*.json` directly when
the user asks about a board, but do not write board files by hand. Do the
equivalent of `relink` with `edit --find --replace --expect N` per file, one
dry run each, then `links --unresolved`.

## Safety

- `rm` moves to the macOS Trash, never deletes. Exit 5 with
  `danglingBacklinks` means other notes still point here: repair or relink them
  first; `--force` only when the user explicitly accepts broken links.
- `mv` relinks every form (`[[stem]]`, `[[stem|label]]`, `[[stem#h]]`,
  `[text](path)`, card `notes[]`). `--no-relink` is for an explicit user
  request only.
- Cloud vaults: exit 8 and `cloudOnlySkipped` mean a note is online-only.
  `--materialize` downloads it; ask before downloading in bulk; never `--force`
  past a skip silently.
- Frontmatter is text. `edit` never touches it; only `meta` and `new --tag`
  write named keys. Do not rewrite a whole note to change one key.
- `migrate` only on the user's request and never while the old app may still
  write the vault from another device; show the dry run first.
- Never edit `.novalis/*`, the cache, conflict copies, or files the user did
  not name.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | ok | |
| 1 | internal error | report `error.message`; do not retry blindly |
| 2 | usage, `--no-index` on a mutation, or a planned command | read `error.hint`; fix the invocation |
| 3 | not found | check the `path`/`stem` with `ls` |
| 4 | conflict: exists, ambiguous, precondition or `--if-match` mismatch | use `error.candidates`; re-read and re-plan |
| 5 | needs `--force`: dangling backlinks on `rm`, `--no-relink` with backlinks, cloud-only skips on `mv`/`relink`/`migrate` | resolve the cause; `--force` only with the user's yes |
| 6 | cache busy (cache mutations only) | the app is writing the cache; retry shortly |
| 7 | no vault | pass `--vault <dir>` or set `NOVALIS_VAULT` |
| 8 | cloud-only | `--materialize` after asking |
