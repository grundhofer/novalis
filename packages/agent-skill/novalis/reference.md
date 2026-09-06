# novalis CLI reference

The contract is PLAN.md §9 (commands, JSON shapes, exit codes). Contracts are
immutable after 1.0: fields and flags are added, never renamed or removed.
Each command below carries a **Status** line: `harness` commands ship with the
core (PLAN.md §12 Phase 2); `planned` commands ship in Phase 4 and exit 2 with
a hint until then.

## 1. Invocation

```
novalis [--vault <dir>] [--json | --plain] [--no-index] <command> [args] [--dry-run]
```

- **Vault discovery**, in order: `--vault <dir>`; `$NOVALIS_VAULT`; walk up
  from the current directory for `.novalis/vault.json`; otherwise exit 7.
  `novalis init <dir>` writes the marker so discovery works.
- **Output mode:** `--json` forces JSON; JSON is automatic when stdout is not a
  TTY; `--plain` forces text. Always pass `--json` explicitly.
- **`--dry-run`** on every mutation: returns the exact success shape plus
  `"dryRun": true` and, for multi-file operations, `changes: [{path, line,
  before, after}]`; exits with the code the real run would. `migrate` is
  dry-run by default and needs `--apply`.
- **Index:** reads that use the cache run the incremental scan first unless the
  desktop app's heartbeat is younger than 10 s (`index --status` reports
  `indexSource: "app" | "scan"`). `--no-index` skips the scan on reads and is
  rejected with exit 2 on mutations.
- **No prompts, ever.** No colour, no progress bars on stdout. English only.
- **Concurrency:** the CLI does not talk to the app. Both write through the
  same atomic path (same-directory temp file, fsync, rename) and the app's
  watcher picks up CLI writes as external changes: a clean buffer reloads
  silently, a dirty buffer shows the "changed on disk" banner, and a pure link
  rewrite is applied in place.

## 2. Output conventions

- **stdout:** bare JSON, one object. **stderr:** one JSON error object on
  failure, or a warning object such as `{"warning":{"code":"stale_index"}}`
  when a busy cache served stale data on a read.
- **Error shape:** `{"error":{"code","message","path","hint","candidates"}}`.
  `candidates` is present on ambiguity (exit 4); `hint` names the flag that
  would have succeeded (`--materialize`, `--force`, `--exist-ok`, …).
- **Lists:** `{items: […], truncated: bool, total?: number}`. Sort orders are
  deterministic (path ascending unless `--sort` says otherwise). Use `--limit`
  and check `truncated`.
- **Idempotent creates:** `--exist-ok` returns `existing: true` instead of
  exit 4.
- **Paths** are vault-relative, `/`-separated, NFC-normalized. **Dates** are
  ISO 8601 / RFC 3339 in UTC (`2026-09-05T08:41:12.345Z`). **Hashes** are
  lower-case hex SHA-256 of the file bytes.
- **Note fields** on every listed note: `path`, `stem` (file name without
  `.md`), `title` (frontmatter `title` → first `# H1` → stem), `linkTarget`
  (the shortest unambiguous wikilink text: the stem, or `folder/stem` when the
  stem is duplicated).

## 3. Addressing and links

- **`<note>` arguments** accept a vault-relative path (`projects/Atlas.md`,
  with or without `.md`) or a stem (case-insensitive). An ambiguous stem exits
  4 with `candidates`.
- **Wikilink resolution:** `[[X]]` matches file stems case-insensitively after
  NFC; unique match → that note; duplicate stems → `[[folder/stem]]`;
  `[[X#heading]]` and `[[X|label]]` strip their suffixes. Markdown links
  `[text](relative/path.md)` resolve relative to the note, percent-decoded.
  A stem containing `#` or `|` cannot be a target; `doctor` reports it. No
  alias resolution; aliases are neither read nor written.
- **Link forms** in `links[]` results: `form` is one of `wikilink`,
  `wikilink-label`, `wikilink-heading`, `wikilink-path`, `markdown`, `card`.
  `resolvedPath` is `null` when unresolved.
- **Frontmatter:** YAML between `---` fences at the top of the file. Only
  `title` and `tags` are read. The CLI writes frontmatter only through `meta`
  and `new --tag`, as line-level edits of named keys; a frontmatter block that
  does not parse strictly is never modified (exit 1, the error object names the
  parse failure).
- **Tags:** frontmatter `tags: [a, b]` (or a YAML list) and inline `#tag`
  tokens in the body both count.

## 4. Commands

### `ls [folder]` — Status: harness

Flags: `--tree` (nested `children[]` instead of a flat list), `--tag T`
(repeatable, AND), `--sort path|modified|title|size` (`-` prefix reverses),
`--limit N`, `--fields a,b,c` (project the item fields).

```json
{"items":[{"path":"projects/Atlas Rendering Spec.md","stem":"Atlas Rendering Spec",
  "title":"Atlas Rendering Spec","linkTarget":"Atlas Rendering Spec","folder":"projects",
  "tags":["atlas","rendering"],"modified":"2026-09-01T07:12:03Z","size":4812,
  "sha256":"…","cloudOnly":false}],"truncated":false}
```

`sha256` is `null` for cloud-only notes (the cache never reads them).

### `cat <note>…` — Status: harness

Flags: `--body` (body only), `--frontmatter` (frontmatter only), `--lines A:B`
(1-based, inclusive), `--materialize [--timeout 30s]` (download a cloud-only
note first). Text on a TTY or with `--plain`; JSON otherwise:

```json
{"items":[{"path":"…","title":"…","linkTarget":"…","frontmatter":{"title":"…","tags":["…"]},
  "body":"…","sha256":"…",
  "links":[{"target":"Local-First Software","form":"wikilink","line":12,"resolvedPath":"reading/Local-First Software.md"}]}]}
```

Exit 8 for a cloud-only note without `--materialize`.

### `new <path>` — Status: harness

Flags: `--tag T` (repeatable; writes a `tags:` key), `--content <text|->`
(`-` reads stdin), `--exist-ok`. Title = stem; the file starts with an H1 only
if `--content` provides one. Output `{path, stem, linkTarget, existing}`.
Exit 4 if the path exists (or a name that differs only by case or Unicode
normalization exists) and `--exist-ok` is absent; exit 2 for a path outside
the vault, under `.novalis/`, or without `.md`.

### `edit <note>` — Status: harness

Exactly one edit flag per call:

| Flag | Effect |
|---|---|
| `--append <text\|->` | add at the end of the body (a newline is inserted if the file does not end with one) |
| `--prepend <text\|->` | insert after the frontmatter block (or at the top) |
| `--replace-section "## Heading" <text\|->` | replace from the heading line to the line before the next heading of the same or higher level |
| `--insert-after-section "## Heading" <text\|->` | insert after that section's last line |
| `--find <text> --replace <text> [--regex] [--expect N]` | replace every match; with `--expect N` the edit is refused (exit 4) unless exactly N matches exist; default `--expect 1` |
| `--set-body -` | replace the whole body from stdin; frontmatter kept |

Common flags: `--if-match <sha256>` (exit 4 on mismatch, nothing written),
`--nth N` (choose among duplicate headings; without it a duplicate heading
exits 4 with `candidates` giving line numbers), `--dry-run`.

Output `{path, sha256Before, sha256After, changed}` plus `diff` (unified) in
dry runs. Frontmatter is never touched by `edit`. Line endings of the file are
preserved.

### `meta <note>` — Status: harness

Flags: `--set k=v` (repeatable), `--unset k`, `--add-tag T`, `--rm-tag T`,
`--if-match`, `--dry-run`. Strict YAML parse first; only the named keys are
rewritten as lines; unknown keys and comments are preserved; a missing
frontmatter block is created. Output `{path, frontmatter, sha256After}`.

### `mv <from> <to>` — Status: harness

`<to>` may be a folder (keeps the file name) or a full path. Flags:
`--no-relink`, `--force`, `--materialize`, `--dry-run`.

Rename first (`RENAME_EXCL`, so an existing target is never overwritten: exit
4), then rewrite every link form and card `notes[]` entry that pointed at the
old note, each affected file under its scan-time precondition.

```json
{"from":"…","to":"…","relinked":[{"path":"…","count":2}],
 "cardsUpdated":[{"board":"atlas","id":"01K4…"}],"conflicts":["…"],"cloudOnlySkipped":["…"]}
```

Exit 5 if `cloudOnlySkipped` is non-empty, or with `--no-relink` while
backlinks exist, unless `--force`. `conflicts` lists files whose precondition
failed during the rewrite; fix those by hand (`cat`, then `edit --find
--replace`).

### `rm <note>` — Status: harness

Flags: `--force`, `--materialize`, `--dry-run`. Moves the file to the macOS
Trash (never a hard delete). Output `{path, danglingBacklinks: [path],
cloudOnly}`. Exit 5 while `danglingBacklinks` is non-empty unless `--force`;
exit 8 for a cloud-only note unless `--materialize`.

### `search <query>` — Status: harness

Flags: `--tag T`, `--folder F`, `--limit 50`, `--snippets`. Case-insensitive
substring search over note bodies and titles by an on-demand scan; cloud-only
notes are never read.

```json
{"items":[{"path":"…","line":14,"snippet":"…"}],"truncated":false,"cloudOnlySkipped":3}
```

### `links` — Status: harness

- `links <note> [--backlinks | --outgoing]` →
  `{outgoing:[{target,form,line,resolvedPath}], backlinks:[{path,line}],
  cards:[{board,id,title,column}]}`.
- `links --unresolved` → `{items:[{target, form, sources:[{path,line}]}]}`.
- `links --orphans` → `{items:[path]}` (notes with no backlinks and no card
  reference).

Served from the cache (after the incremental scan unless `--no-index`).

### `tags` — Status: harness

`--limit N`. `{items:[{tag, count}]}`, sorted by count descending, then tag.

### `relink <from> <to>` — Status: harness

`<from>` is a **literal link target string** (wikilink text or Markdown path;
case-insensitive; percent-decoded; it does not need to resolve). `<to>` must
resolve to a note. Rewrites `[[from]]`, `[[from|label]]`, `[[from#h]]`,
`[text](from)` and card `notes[]`. Flags: `--force`, `--materialize`,
`--dry-run`. Output `{rewritten:[{path,count}], cardsUpdated, conflicts,
cloudOnlySkipped}`. Exit 5 on cloud-only skips unless `--force`.

### `board` — Status: planned

- `board ls` → `{items:[{slug, name, path, columns:[{id,name}], cards}]}`.
- `board show <b>` → the board plus `cards[]` sorted by `(column order, order, id)`.
- `board columns <b> --set '<json>'` → replaces the column list with
  `[{id, name}]`; a card whose column disappears is shown in the first
  column with a marker, never lost.

### `card` — Status: planned

- `card ls [--board B] [--note <note>] [--column C]` →
  `{items:[{board,id,title,column,order,notes,updated}]}`.
- `card add <b> --title T [--column C] [--note <note>]… [--after ID | --first | --last]`
  → `{card}`. `--column` takes an id, or a name when unambiguous (else exit
  4); default column = first; default position = last.
- `card mv <id> [--column C] [--after ID | --first | --last]`,
  `card set <id> [--title T] [--add-note N] [--rm-note N]`,
  `card rm <id>` → `{card}`. `--if-updated <rfc3339>` refuses (exit 4) when
  the card's `updated` differs. One file per change; `rm` writes a `deleted`
  tombstone.

### `index` — Status: harness

`index --status` → `{cachePath, files, stale, indexSource, appVersion,
cliVersion}`. `index --rebuild` drops and rebuilds the cache (exit 6 while the
app holds it). Never delete the cache file yourself.

### `sync status` — Status: planned

`{vaultKind: "fileProvider" | "mirrored" | "local", cloudOnly: [path],
conflictCopies: [path]}`. Read-only.

### `doctor` — Status: harness

`{ok, checks:[{id, status, detail}]}` with `status` in `ok | warn | fail`.
Checks: vault marker, cache opens, app/CLI version skew, frontmatter parse
failures, unresolved links, duplicate stems, unlinkable stems (`#`, `|`),
notes under board folders, conflict copies, cloud-only notes with unindexed
links, legacy `@due`/`@status` token count. Read-only; there is no `--fix`.

### `migrate` — Status: harness

Dry-run by default; `--apply` executes the plan shown by the dry run.
Flags: `--rename-to-title` (rename each note to its frontmatter title with the
sanitization map `:` → ` –`, `/` → `-`; `#` and `|` reported as unlinkable),
`--import-columns` (legacy `taskView.kanbanColumns` → `boards/kanban/board.json`),
`--force` (accept cloud-only skips), `--materialize` (download them first).
Output `{renames:[{from,to,title,reason}], linksRewritten:[{path,count}],
cardsUpdated, unlinkable:[…], collisions:[{target,sources}], legacyTokens,
cloudOnlySkipped, frontmatterFailures, alreadyMigrated, applied}`.
Exits 4 when collisions refuse the plan whole, 5 on cloud-only skips without
`--force`. Discovery accepts a folder that has only the old app's
`.novalis/config.json`, so it runs inside a legacy vault with no flags. The plan is
all-or-nothing; every rename uses `RENAME_EXCL`; `.novalis/vault.json`
receives a `migrated` timestamp so a second device does not repeat it.

### `init <dir>` — Status: harness

Writes `<dir>/.novalis/vault.json` (`{"format": 1}`), idempotent. Output
`{path, existing}`.

### `help --json` · `skill --path` — Status: planned

`help --json` prints the command tree with flags and output shapes.
`skill --path` prints the directory holding this skill; nothing is installed
automatically.

## 5. Exit codes

| Code | Name | Raised by |
|---|---|---|
| 0 | ok | |
| 1 | internal | I/O, parse or database failures |
| 2 | usage | bad flags, `--no-index` on a mutation, a planned command, a path outside the vault |
| 3 | not found | unknown note, board, card, column |
| 4 | conflict | target exists, ambiguous stem or heading, precondition or `--if-match` / `--if-updated` mismatch, case or normalization collision |
| 5 | needs `--force` | `rm` with dangling backlinks; `mv --no-relink` with backlinks; cloud-only skips on `mv`, `relink`, `migrate` |
| 6 | cache busy | `index --rebuild` or the scan's write step while the app holds the cache; reads instead serve the stale cache with a stderr warning |
| 7 | no vault | discovery failed |
| 8 | cloud-only | a body read on an online-only note without `--materialize`; `--materialize` timed out |

## 6. Cloud vaults (Sync Mode 1)

A vault inside `~/Library/CloudStorage/…` (OneDrive, Google Drive in Stream
mode) can hold **cloud-only** notes: present in listings, `cloudOnly: true`,
`sha256: null`, body never read implicitly. Google Drive in Mirror mode has
plain files but still produces conflict copies.

- Reads: `cat` exits 8; `search` counts them in `cloudOnlySkipped`.
- Writes: `mv`, `relink`, `migrate` count affected cloud-only notes first and
  report `cloudOnlySkipped` (exit 5) unless `--materialize` downloads them or
  `--force` accepts the skip.
- Conflict copies written by a sync client look like `<stem>-<host>.md`
  (OneDrive), `<stem> (1).md`, or `<stem> (<host>'s conflicted copy
  <date>).md` (Dropbox); copies written by the app look like `<name>
  (conflict <host> <YYYY-MM-DD HHMM>).md`. `doctor` and `sync status` list
  them. Never delete a conflict copy; the user decides in the app or by
  telling you which side wins.

## 7. Board files (read-only reference)

Until `board` and `card` ship, read these files directly when asked; do not
write them by hand.

```
<vault>/boards/<slug>/
├─ board.json          # presence of a valid board.json makes the folder a board
├─ cards/<ULID>.json   # one file per card
└─ conflicts/          # losers of a same-card conflict, never deleted automatically
```

`board.json`:

```json
{ "format": 1, "name": "Atlas",
  "columns": [ { "id": "todo", "name": "To Do" }, { "id": "doing", "name": "Doing" }, { "id": "done", "name": "Done" } ],
  "updated": "2026-09-05T08:41:12.345Z" }
```

`cards/01K4G9Z2Q7M3N8RSTV5WXY6ZAB.json`:

```json
{ "id": "01K4G9Z2Q7M3N8RSTV5WXY6ZAB", "title": "Zoom-Stufen für Offline-Bundles festlegen",
  "column": "doing", "order": "a0V",
  "notes": [ "projects/Atlas Rendering Spec.md" ],
  "created": "2026-09-01T07:12:03.010Z", "updated": "2026-09-05T08:41:12.345Z" }
```

- Card id = ULID (26 chars, Crockford base32). Column `id` is a stable slug;
  `name` is the display name.
- `order` is a fractional-index string; cards sort by `(order, id)`. Only the
  moved card is ever re-keyed.
- `notes[]` holds vault-relative note paths; `mv` and `relink` rewrite them.
- An optional `deleted` timestamp is a tombstone (purged after 30 days on the
  next write of that board). Unknown keys round-trip untouched.
- A card whose `column` is missing from `board.json` is shown in the first
  column with a marker, never hidden.
- Files are pretty-printed with sorted keys and a trailing newline; writes are
  atomic with a read-time precondition.
