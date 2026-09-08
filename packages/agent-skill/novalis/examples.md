# novalis recipes

Every recipe follows the standard loop from `SKILL.md`: `doctor` → find →
read → plan → `--dry-run` → apply → `links --unresolved`. Commands marked
*planned* are not in the core harness yet (PLAN.md §12 Phase 4); each recipe
shows the harness-only fallback.

Conventions: `$V` is the vault (`--vault "$V"` or `export NOVALIS_VAULT=$V`);
`jq` is used only to read results, never to write files.

## 0. Start of every session

```sh
novalis doctor --json | jq '.ok, [.checks[] | select(.status != "ok")]'
novalis links --unresolved --json | jq '.items | length'     # remember this number
```

If `doctor` lists duplicate stems, write links as `[[folder/stem]]` for those
notes and take `linkTarget` from `ls`.

## 1. Merge two notes

Goal: fold `reading/Local-First Notes.md` into `reading/Local-First Software.md`
and leave no broken link behind.

```sh
# read both, keep the target's hash for --if-match
A=$(novalis cat "reading/Local-First Notes" --json)
B=$(novalis cat "reading/Local-First Software" --json)
SHA_B=$(echo "$B" | jq -r '.items[0].sha256')

# 1. append the source body under a heading in the target
{ printf '\n## Aus „Local-First Notes“\n\n'; echo "$A" | jq -r '.items[0].body'; } \
  | novalis edit "reading/Local-First Software" --append - --if-match "$SHA_B" --json

# 2. point every link at the target (planned: relink)
novalis relink "Local-First Notes" "reading/Local-First Software" --dry-run --json | jq '.changes'
novalis relink "Local-First Notes" "reading/Local-First Software" --json

# 2'. harness-only fallback: rewrite per file
novalis links "reading/Local-First Notes" --backlinks --json | jq -r '.backlinks[].path' | sort -u | while read -r p; do
  novalis edit "$p" --find '[[Local-First Notes' --replace '[[Local-First Software' --expect 1 --dry-run --json | jq -c '{path, changed}'
done
# inspect, then run the same lines without --dry-run; use --expect N when a file holds N links

# 3. trash the source; exit 5 means a backlink survived — fix it, do not --force
novalis rm "reading/Local-First Notes" --json

# 4. verify
novalis links --unresolved --json | jq '.items | length'
```

Merge the frontmatter by hand: `meta --add-tag` (planned) or leave tags as
the target has them; never paste a second `---` block into the body.

## 2. Build a map of content (MOC)

Goal: a note `Atlas MOC.md` that links every note tagged `atlas`, grouped by
folder.

```sh
novalis ls --tag atlas --sort path --json \
  | jq -r '.items | group_by(.folder)[] | "## \(.[0].folder // "/")\n" + (map("- [[\(.linkTarget)]] — \(.title)") | join("\n")) + "\n"' \
  > /tmp/moc-body.md

novalis new "Atlas MOC.md" --tag atlas --tag moc --content - --json < /tmp/moc-body.md
# re-run later: replace the body instead of creating again
novalis edit "Atlas MOC" --set-body - --json < /tmp/moc-body.md
novalis links "Atlas MOC" --outgoing --json | jq '[.outgoing[] | select(.resolvedPath == null)]'   # must be []
```

`linkTarget` already contains `folder/stem` where a stem is duplicated, so the
generated links resolve without further checks.

## 3. Retag a folder

Goal: every note under `archive/2024/` gets the tag `archiv` and loses
`entwurf`.

Planned (`meta`):

```sh
novalis ls archive/2024 --json | jq -r '.items[].path' | while read -r p; do
  novalis meta "$p" --add-tag archiv --rm-tag entwurf --dry-run --json | jq -c '{path, frontmatter}'
done
# then the same without --dry-run; each call returns sha256After for later --if-match
```

Harness-only fallback: report which notes need the change and ask the user to
approve a `--find/--replace` on the `tags:` line per note, one dry run each.
Do not rewrite frontmatter blocks with `--set-body`; that touches every byte
of the file.

```sh
novalis ls archive/2024 --json | jq -r '.items[] | select(.tags | index("entwurf")) | .path'
novalis edit "archive/2024/Kaputt eins" --find 'tags: [entwurf' --replace 'tags: [archiv' --expect 1 --dry-run --json
```

If `doctor` reports a frontmatter parse failure for a note, leave that note
alone and tell the user.

## 4. Find and remove duplicates

Goal: two notes with the same content or the same stem in different folders.

```sh
# same stem, different folders
novalis doctor --json | jq '.checks[] | select(.id == "duplicate-stems")'
# same bytes (hash groups with more than one path)
novalis ls --json | jq -r '.items[] | select(.sha256 != null) | "\(.sha256) \(.path)"' \
  | sort | awk '{ n[$1]++; l[$1] = l[$1] "\n" $0 } END { for (h in n) if (n[h] > 1) print l[h] }'

# decide the keeper with the user; then, for each duplicate D (path) and keeper K (path):
novalis links "$D" --backlinks --json          # who points at D?
novalis relink "<linkTarget of D>" "$K" --dry-run --json    # planned; harness fallback as in recipe 1
novalis rm "$D" --json                          # exit 5 → a backlink is still there
novalis links --unresolved --json
```

Cloud-only notes have `sha256: null` and cannot be compared without
downloading; ask before `cat --materialize`.

## 5. Repair unresolved links

```sh
novalis links --unresolved --json | jq -c '.items[] | {target, form, n: (.sources | length)}'
```

For each `target`:

1. `novalis ls --json | jq '.items[] | select(.stem | ascii_downcase == ("<target>" | ascii_downcase))'`
   — a case or normalization mismatch resolves already (resolution is
   case-insensitive after NFC); if it is listed as unresolved, the stem differs.
2. Find the intended note with `novalis search "<target>" --json` or by asking
   the user.
3. Rewrite: `novalis relink "<target>" "<intended path>" --json` (planned), or
   per source file `novalis edit "<path>" --find '[[<target>' --replace
   '[[<linkTarget>' --expect N --json` (harness).
4. If the note should exist instead: `novalis new "<folder>/<target>.md"
   --json` creates it with the title = stem, and the link resolves.
5. Verify with `links --unresolved` again.

Never "fix" a link by renaming a note the user did not ask to rename; `mv`
changes what everyone else sees.

## 6. Move a card when a note ships

Goal: the note `projects/Atlas Rendering Spec.md` is done; move its card to
`done` and record the date in the note.

```sh
novalis card ls --note "projects/Atlas Rendering Spec" --json           # find the card id, board and updated
novalis card mv 01K4G9Z2Q7M3N8RSTV5WXY6ZAB --column done --last \
  --if-updated 2026-09-05T08:41:12.345Z --json                          # one file changes
novalis edit "projects/Atlas Rendering Spec" --append "Shipped 2026-09-05." --json
```

`card mv` takes no board argument: the id is a ULID and finds its own board.
Exit 4 means someone moved the card while you were reading it — run `card ls`
again and re-plan.

Do not edit the card JSON by hand: the app and the CLI write these files
atomically with preconditions and a re-keyed `order`; a hand edit that
changes `updated` starts a conflict on the next sync.

## 7. Rename a note safely

```sh
novalis mv "Draft Ideas" "projects/atlas/Rendering Ideas.md" --dry-run --json | jq '{relinked, cardsUpdated, conflicts, cloudOnlySkipped}'
novalis mv "Draft Ideas" "projects/atlas/Rendering Ideas.md" --json
novalis links --unresolved --json | jq '.items | length'
```

- `conflicts` non-empty → those files changed between scan and write; re-run
  `cat` on each and apply the rewrite with `edit --find --replace`.
- `cloudOnlySkipped` non-empty (exit 5) → ask before `--materialize`; never
  `--force` on the user's behalf.
- Exit 4 → the target exists, or differs only by case or accent from an
  existing file; choose another name.

## 8. Create a note with links that resolve

```sh
T=$(novalis ls --json | jq -r '.items[] | select(.stem == "Atlas Rendering Spec") | .linkTarget')
printf '# Daily 2026-09-05\n\n- Reviewed [[%s]]\n' "$T" | novalis new "journal/2026-09-05.md" --tag journal --content - --exist-ok --json
```

`--exist-ok` returns `existing: true` instead of failing; append to an
existing daily note with `edit --append` instead.
