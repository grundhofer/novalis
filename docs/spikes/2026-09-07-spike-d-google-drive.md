# Spike D — Google Drive for desktop, Stream and Mirror

Date: 2026-09-07. Machine: Apple Silicon, macOS 26.6 (25G72). Google Drive for
desktop 130.0.2.0, running with `use_mac_fileprovider=on`, domain at
`~/Library/CloudStorage/GoogleDrive-<account>/`. Probes: shell (`stat -f %Xf`,
`xattr`, `find`), the workspace CLI binary, and a throwaway
`novalis-core` example for the IO-policy test (removed after the run).

Scope discipline: everything was created inside `Meine Ablage/novalis-spike-d/`
and nothing else in the domain was opened, renamed, modified or deleted. The
domain held 15 files before the run and 15 after. The spike folder was moved to
Drive's trash rather than deleted, so it is recoverable and will appear in the
online bin until emptied.

Legend: **verified** = observed directly by this run; **unverified** = needs a
second client or the Drive web UI. Mirror mode was switched on by the owner
partway through and is covered in its own section at the end.

## Headline: the guard works on Drive

| Item | Result | |
|---|---|---|
| Stream mode marks cloud-only files with `SF_DATALESS` | all 15 pre-existing files in the domain carry `0x40000000`; `is_dataless` agrees | verified |
| `MaterializeOff` + `read()` of a dataless Drive file | refused with `EDEADLK`, and the file was **still dataless afterwards** — nothing hydrated | verified |

This was the largest open risk in the sync design: the materialize-off guard is
what stops a vault-wide search downloading the user's whole Drive. It is a
per-thread kernel IO policy, so it was expected to be provider-agnostic, and it
is. Now verified on both providers.

## Two findings that need action

### 1. `~/Google Drive` is a symlink, and the vault kind flips on it

Drive creates `~/Google Drive` as a symlink to the CloudStorage domain. The
same folder therefore has two paths, and `vault_kind` disagrees between them:

| Path given | `vault_kind` |
|---|---|
| `~/Library/CloudStorage/GoogleDrive-<account>/Meine Ablage` | `FileProvider` |
| `~/Google Drive/Meine Ablage` | `Local` |

`vault_kind` tests the `~/Library/CloudStorage` prefix first, then walks
ancestors looking for `com.apple.file-provider-domain-id` with
`XATTR_NOFOLLOW`. Through the symlink the prefix does not match, and the
symlink itself carries no xattrs, so the walk finds nothing.

**Severity: low, and it fails in the safe direction.** The only consumer is
`keepMine` (`editorSave.ts`), which writes an extra conflict copy before
overwriting when the vault is `local`, because a plain folder has no vendor
version history. A Drive vault misread as local is therefore treated *more*
cautiously, not less. The materialize-off guard is applied unconditionally in
`search`, so there is no hydration risk from this.

### 2. Trash goes to Drive's own trash, not the user's

`NsFileManager` trash (the decided method, D8) moved the note to
`~/Library/CloudStorage/GoogleDrive-<account>/.Trash/`, **not** `~/.Trash`.
Spike A measured OneDrive putting it in `~/.Trash` with Put Back records.

So on a Drive vault the note does not appear in the Finder Trash at all, and
the macOS Put Back path does not apply; it goes to Drive's bin and syncs there.
The confirmation string added on 2026-09-07 (`app.confirmTrash.body`, "can be
restored from the Trash") is therefore imprecise for Drive vaults. It is not
wrong that the file is recoverable, only about where from.

## Step results

| Item | Result | |
|---|---|---|
| Domain root name | localized: **`Meine Ablage`**, not `My Drive`. The checklist's section B path assumed the English name | verified |
| temp + rename save | works; one file, no conflict copy and no duplicate over 30 s of polling after create and overwrite | verified (single client) |
| `st_flags` after save | `0x40` (`UF_TRACKED`) immediately, on both create and overwrite. OneDrive took 14 s on create | verified |
| Inode across saves | changes on every save, as the rename replaces it (105856764 → 105856794) | verified |
| Provider xattrs | Drive attaches **`com.google.drivefs.item-id#S`** to synced files, re-created within ~10 s after each save. OneDrive attaches none. So temp+rename does transiently destroy a provider-owned xattr here, and Drive rebuilds it | verified |
| Case-only rename `note.md` → `Note.md` | same inode, old name still resolves (case-insensitive APFS), no duplicate within 60 s | verified |
| NFC create, then NFC → NFD rename | stored as given; after the rename the directory entry holds the NFD bytes (`61 cc 88 2e 6d 64`); APFS is normalization-preserving. `novalis ls` returns the name NFC-normalized | verified |
| Dot-folder policy | `.novalis/vault.json` **does** sync: it gained the Drive item-id xattr like any other file | verified |
| `boards/` behaviour | five rapid atomic rewrites of one card left exactly one file, no duplicates and no conflict copies; `board.json` and `cards/*.json` sync as ordinary files | verified (single client) |
| CLI against a Drive vault | `novalis --vault <drive> ls` and `rm` both work end to end; `rm` reported `cloudOnly: false` and removed the file | verified |
| Conflict-copy naming | — | unverified (needs the web UI as a second client) |
| Same-card edit on two clients | — | unverified (needs a second client) |
| What the server stores for an NFD name | — | unverified (needs the web UI) |
| Trash of a *dataless* note, and Put Back | — | unverified (needs a genuinely cloud-only note in a test vault) |
| Mirror mode (section C) | run separately after the owner switched the setting — see the last section | verified |

## What this changes in the plan

- Nothing about the storage design. Drive behaves like OneDrive on every
  mechanism the app depends on: `SF_DATALESS`, the IO policy, temp+rename,
  case-only and normalization renames, dot-folders, and `boards/`.
- The one design assumption that did **not** hold across providers is where
  trashing lands, which was never in the plan either way.

## Mirror mode (run the same day, after the owner switched the setting)

Switching Drive to Mirror materialized everything in place: the domain went
from 15 of 15 files dataless to 16 of 16 materialized, **and the path did not
change**. There is no plain-folder mirror root; `~/Google Drive` is still only a
symlink to the same File Provider domain.

| Item | Result | |
|---|---|---|
| `vault_kind` in Mirror mode | **`FileProvider`, never `Mirrored`** | verified |
| temp + rename | one file, no conflict copy, `UF_TRACKED` set; identical to Stream | verified |
| Dot-folder policy | `.novalis/vault.json` syncs; item-id xattr after ~12-24 s (Stream: ~10 s) | verified |
| `boards/` | three rapid card rewrites left one file, no duplicates | verified |
| NFC / NFD rename | identical to Stream and to OneDrive | verified |
| Trash | domain's own `.Trash` again, not `~/.Trash` | verified |
| Conflict-copy naming, Put Back, second-client rows | — | unverified |

**PLAN.md §5.6's `Mirrored` heuristic (C1, marked ASSUMED) is unreachable for
Drive 130.** That is a fact about the client, not a defect: `FileProvider` is
the correct branch for a vault that does have vendor version history, and
`vault_kind` only gates `keepMine`. The `Mirrored` variant may still apply to
other clients that use a plain folder.

### A concrete lead on conflict naming

Trashing a second `Note.md` while one was already in the domain trash produced
**`Note 2.md`** — space, digit, no parentheses. `conflict_copy_candidate`
implements `Note (2).md` and does **not** match this form (verified against the
real function).

This is Drive's *collision* naming, observed directly; whether its *sync
conflict* naming is the same is a hypothesis, not a result. The pattern was
deliberately **not** added: `^(.+) (\d+)$` would misclassify an ordinary
`Chapter 2.md` sitting beside `Chapter.md`, which is far more likely in a real
vault than the parenthesised form. Confirm with a second client before changing
the matcher.

## Put Back, settled 2026-09-08

Deleting a note from a Drive vault through the app's own code path puts it in
`~/Library/CloudStorage/GoogleDrive-<account>/.Trash/` and **never** in
`~/.Trash`. macOS writes its put-back records (`ptbL`/`ptbN` in
`~/.Trash/.DS_Store`) only for items that land in the user's Trash, so **Finder's
Put Back does not apply to a Drive vault at all** — the file is not in Finder's
Trash to begin with. Recovery goes through Drive's bin.

This is the one behaviour that differs from OneDrive, where Spike A measured the
note landing in `~/.Trash` with put-back records written. `app.confirmTrash.body`
("can be restored from the Trash") is therefore imprecise on a Drive vault: true
that it is recoverable, wrong about where from.

## Second client (phone), 2026-09-08

The owner's phone supplied the second client the earlier rows were missing. The
Drive mobile app cannot edit a Markdown file's text, so the content-conflict
rows stay open; renaming is available and answered two of them.

| Item | Result | |
|---|---|---|
| How the app shows an NFD filename | cleanly, as `Ärger mit Sync.md`; Drive does not mangle or escape it | verified |
| Renaming there, with the new name typed on the phone keyboard (NFC) | arrives on this Mac **as NFD**: `41 cc 88 … 6f cc 88`. A name that left the second client composed reaches the local filesystem decomposed | verified |
| Is it a rename or a delete plus create? | **same inode** (106585023) — a real rename, so the watcher can stitch it | verified |
| What novalis makes of it | `novalis ls` reports the path NFC-normalized; content untouched | verified |

**This is the same hazard Spike A measured on OneDrive, now confirmed on Drive
and from a real second device.** It is exactly the defect fixed on 2026-09-07:
`rel_of` compared bytes, so an NFD path under an NFC root failed `strip_prefix`
and the watcher discarded the event in silence. Before that fix, a Drive vault
whose root was held NFC would have dropped every one of these renames without a
trace. The rule this settles: **never compare a filename byte-wise across the
sync boundary.**

Still open, and not answerable from a phone: the conflict-copy filename and the
same-card two-client edit. Both need the *same file's content* changed in two
places, and neither the Drive web app nor the mobile app can edit a Markdown
file. That needs a second computer.

### Deleting from the second client

Trashing the note in the Drive mobile app removed the local file and left **no
user-visible local copy**: it is not in `~/.Trash`, and not in the domain's own
`.Trash` where a delete made *by the app* lands. The only local trace was
`<domain>/.tmp/177/Konflikt.md`, an internal staging path of Drive for desktop,
which is transient and not a recovery location.

So the two directions are not symmetric, and the asymmetry is worth knowing:

| Deleted from | Local copy afterwards | Recover via |
|---|---|---|
| novalis (`NsFileManager`) | domain `.Trash` | Drive's bin |
| the second client (phone) | **none** | Drive's bin only |

For a notes app that matters: an accidental delete on the phone takes the local
copy with it, and nothing on the Mac can bring it back. That is Drive's
behaviour, not novalis's, and it is not something the app can change — but it
is the kind of thing a user should be told once rather than discover.

### A note on the rename measurement

The rename was observed twice, as `Ärger gelöst.md` and then as
`Ärger geloest.md`. Both arrived with `Ä` as `41 cc 88` — decomposed — from a
phone keyboard that composes. The finding is the same in both samples.
