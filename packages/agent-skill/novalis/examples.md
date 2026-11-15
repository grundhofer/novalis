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
novalis doctor --json | jq '.checks[] | select(.id == "duplicate_stems")'   # the count only; doctor names no paths here
novalis ls --json | jq -r '.items[] | select(.linkTarget | contains("/")) | .path'   # the notes whose stem is shared
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

For today's note, `journal` does both steps and picks the local date itself:

```sh
novalis journal --append "- Reviewed [[$T]]" --json
```

## Project work with notes and cards

The recipes below are the use cases of someone who runs their projects on a
board: cards for the work, notes for the thinking, linked both ways. Card
ids, `updated` stamps and dates in them are examples; take every one from
the JSON you just read.

## 9. Today, and due days relative to it

```sh
TODAY=$(novalis journal --dry-run --json | jq -r .stem)     # the local day; writes nothing
IN3=$(date -j -v+3d -f %Y-%m-%d "$TODAY" +%Y-%m-%d)          # macOS date; GNU: date -d "$TODAY +3 days" +%F
```

Never take the day from the model or from UTC: a card due "today" at 23:30
local time is overdue a minute later in UTC.

## 10. Set up a project board

```sh
novalis board new projekte --name "Projekte" --json
novalis board columns projekte --set '[{"id":"offen","name":"Offen"},{"id":"arbeit","name":"In Arbeit"},{"id":"erledigt","name":"Erledigt"}]' --json
```

Column ids are stable and never shown; names are what the user sees and
may change. Keep ids short and lowercase; `card ls --column` takes the id.

## 11. Add a project card with its fields

```sh
novalis card add projekte --title "Angebot Kunde X" --column offen \
  --label Kunde --label Angebot --due "$IN3" --priority high --assignee Anna \
  --note "projects/Kunde X" --dry-run --json      # shows the card it would write
novalis card add projekte --title "Angebot Kunde X" --column offen \
  --label Kunde --label Angebot --due "$IN3" --priority high --assignee Anna \
  --note "projects/Kunde X" --json
```

`--note` must resolve to an existing note; create it first (§14) when it
does not. Labels are kept once regardless of case; their colour is set in
the app.

## 12. Triage: what needs attention

```sh
novalis card ls --board projekte --due overdue --json | jq -r '.items[] | select(.column != "erledigt") | "\(.due) \(.title) (\(.assignee // "–"))"'
novalis card ls --board projekte --due today --json
novalis card ls --board projekte --due 7d --json        # today and the six days after; overdue ones are not in it
novalis card ls --board projekte --priority high --json
novalis card ls --assignee Anna --json                   # exact name; spans every board
novalis card ls --label kunde --json                     # any case
```

The due filters ignore the column: leave out the column the user calls done
(here `erledigt`) and say that you did.

## 13. Change a card, guarded

```sh
C=$(novalis card ls --board projekte --label angebot --json | jq -c '.items[0]')
ID=$(jq -r .id <<<"$C"); U=$(jq -r .updated <<<"$C")
U=$(novalis card mv "$ID" --column arbeit --if-updated "$U" --json | jq -r .card.updated)
U=$(novalis card set "$ID" --priority medium --add-label verhandelt --rm-label Angebot --if-updated "$U" --json | jq -r .card.updated)
novalis card set "$ID" --due "" --if-updated "$U" --json          # clears the due day
```

Each result's `updated` is the next `--if-updated`. Exit 4 means someone
changed the card since you read it: read it again and re-plan. Clear a
field with an empty value (`--due ""`, `--assignee ""`, `--label ""`) or
`--priority none`.

## 14. A note for a card, linked both ways

```sh
C=$(novalis card ls --board projekte --json | jq -c '.items[] | select(.title == "Angebot Kunde X")')
ID=$(jq -r .id <<<"$C"); U=$(jq -r .updated <<<"$C")
printf '# Angebot Kunde X\n\n%s\n\n## Offene Punkte\n\n' "$(jq -r '.description // ""' <<<"$C")" \
  | novalis new "projects/Angebot Kunde X.md" --tag projekt --content - --json
novalis card set "$ID" --add-note "projects/Angebot Kunde X" --if-updated "$U" --json
novalis links "Angebot Kunde X" --json | jq '.cards'     # the card appears here
```

A note cannot link to a card; the link lives in the card's `notes[]`, and
`links <note>` shows it in `cards[]`. Such a note is not an orphan, and
`rm` refuses it (exit 5, the card file in `candidates`) until the card lets
go of it: `card set <id> --rm-note <note>`.

## 15. Weekly review of a board

```sh
novalis board show projekte --json | jq -r --arg today "$TODAY" --arg done erledigt '
  .columns[] as $col
  | "## \($col.name)",
    ( [.cards[] | select(.column == $col.id)][]
      | "- \(.title)" + (if .assignee then " · \(.assignee)" else "" end)
        + (if .due then " · fällig \(.due)"
             + (if .due < $today and $col.id != $done then " (überfällig)" else "" end) else "" end)
        + (if .priority then " · \(.priority)" else "" end) )'
```

`board show` holds the columns in their order and every live card. Due days
compare as text (`YYYY-MM-DD`); a card in the done column is not overdue. Write the review into the journal with
`novalis journal --append -` when the user wants it kept.

## 16. Action items from a meeting note to cards

```sh
novalis cat "meetings/2026-11-15 Kunde X" --json | jq -r '.items[0].body' | grep -E '^\s*- \[ \]'   # open tasks
novalis card add projekte --title "Preise prüfen" --assignee Ben --due "$IN3" \
  --note "meetings/2026-11-15 Kunde X" --json      # one call per task, each linked to the meeting
```

Show the user the tasks you found and the cards you would add before adding
them. The note stays as it is: the card only references it.

## 17. Close a card

```sh
C=$(novalis card ls --board projekte --json | jq -c '.items[] | select(.title == "Angebot Kunde X")')
novalis card mv "$(jq -r .id <<<"$C")" --column erledigt --if-updated "$(jq -r .updated <<<"$C")" --json
novalis journal --append "- Erledigt: Angebot Kunde X" --json
```

`card rm` is for a card that should not exist; a finished one moves to the
done column, so the board keeps its history.
