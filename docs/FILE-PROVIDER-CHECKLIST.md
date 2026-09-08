# File Provider checklist (manual)

Run before every release on the real cloud folders (PLAN.md §11.1), and once
during Spike A (OneDrive) and Spike D (Google Drive, both modes). Each row is an
item PLAN.md §5.6 marks **unverified**; tick the box, fill the Result column
with what actually happened (one line, date, client version), and copy the row
into the spike write-up. An empty Result means "not run", never "passed".

**Run header** (fill in per run):

| Field | Value |
|---|---|
| Date | 2026-09-05 (Spike A, section A only) |
| macOS | 26.6 (25G72), Apple Silicon |
| Machine / hostname (appears in conflict-copy names) | MacBook-Pro-von-Sebastian |
| OneDrive client version | 26.153.0809 |
| Google Drive for desktop version | 130.0.2.0; sections B (Stream) and C (Mirror) both run 2026-09-07 |
| Second client used for concurrent edits | none — every section A row needing one is marked "not run" |
| novalis build | pre-`v2.0.0-alpha.1` (`2.0.0-alpha.0`); section A used a standalone probe binary, not the app |

**Test vault:** a copy of `fixtures/demo-vault` plus `boards/test/` created by
the app, placed at the path in the section header. Never use a personal vault.

## Already verified (2026-09-05, this Mac, OneDrive)

| Item | Result |
|---|---|
| `SF_DATALESS` in `st_flags` identifies cloud-only files; `stat` does not materialize | verified |
| `setiopolicy_np(IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES, IOPOL_SCOPE_THREAD, OFF)` makes `read()` fail with `EDEADLK` (errno 11) and the file stays dataless | verified |
| File Provider domain at `~/Library/CloudStorage/OneDrive-Persönlich` contains dataless files | verified |

## A. OneDrive (File Provider) — `~/Library/CloudStorage/OneDrive-Persönlich/novalis-test`

| Done | ID | Item | How to test | Expected | Result |
|---|---|---|---|---|---|
| [ ] | A1 | FSEvents delivery inside CloudStorage | Edit a note from the second client; watch the app's `fs-batch` events | One batch within ~100 ms of the local file changing; no kqueue fallback |  FSEvents fires inside CloudStorage and one atomic save arrives as one batch, plus 1-3 late `Modify(Metadata)` from the provider 0.2-1.0 s later (Spike A, 2026-09-05, single client). **Second-client delivery not tested.** Found here: FSEvents reports NFD paths under an NFC root, which dropped every event; fixed 2026-09-07. |
| [ ] | A2 | temp + rename write does not create a conflict copy | Save a note in the app 20× while the client is idle | Zero `<stem>-<host>.md` siblings appear |  No conflict copy and no duplicate over 13 polls after a create and after an overwrite (Spike A, single client, client idle). **The 20x idle-save run was not done.** |
| [x] | A3 | temp + rename keeps extended attributes | `xattr -l` on a note before and after an app save | Same xattr set (including the provider's own) |  Verified 2026-09-05: OneDrive attaches no xattr of its own; synced files carry only `com.apple.provenance` (kernel-set). No provider-owned xattr can be lost. A *user* xattr on the old inode does not survive, because temp+rename replaces the inode. |
| [ ] | A4 | Conflict-copy naming via the web UI | Edit the same note offline in the app and in the web UI, reconnect | Sibling named `<stem>-<host>.md` (record the exact form); app detects and lists it |  not run - needs the OneDrive web UI as a second client. |
| [ ] | A5 | `ä` / NFD-named note round trip | Create `Ärger mit Sync.md` in the app; rename it on the web; sync back | Name arrives NFC-equal; tree shows one entry; links still resolve |  NFC name stored verbatim; NFC->NFD rename keeps the inode and both spellings resolve; the provider forwards the NFD name unchanged and uploads within 5 s, no duplicate in 60 s (Spike A). **What the server stores and a second client shows was not tested.** |
| [ ] | A6 | Case-only rename | Rename `Readme.md` → `README.md` in the app | Same inode, one file after sync, no duplicate on the web |  Case-only rename keeps the inode (104203011), the directory entry becomes `Note.md`, the provider reports `filename = "Note.md"` and uploads immediately, no duplicate within 60 s (Spike A). **The web view was not checked.** |
| [ ] | A7 | Same-card edit on two clients under `boards/test/cards/` | Edit one card offline on both clients, reconnect | One sibling with the same `id`; app keeps the newer `updated`, moves the loser to `conflicts/`, shows the one-line notice |  not run - needs a second client editing the same card offline. |
| [ ] | A8 | `trash` of a normal note (`NsFileManager` method) | `Cmd+Delete` on a downloaded note | File in macOS Trash; removed on the web after sync |  `trashItemAtURL:` returned ok in 57 ms with no prompt; the note landed in `~/.Trash` with the same inode (a move, not a copy) and left the File Provider domain (Spike A). **Removal in the online recycle bin was not checked.** |
| [ ] | A9 | `trash` of a dataless note | `Cmd+Delete` on a cloud-only note | App materializes first (visible state) or refuses with the cloud-only error; never a silent zero-byte delete |  not run - no CLI on macOS 26.6 can make a file dataless on demand (`fileproviderctl` offers only dump/diagnose/evaluate/check|repair/obfuscate). Needs a genuinely cloud-only note. |
| [ ] | A10 | Put Back from the Trash | Trash a note (A8), then Finder ▸ Put Back | Note returns to its folder; app tree updates via one batch |  Put Back metadata is written: `~/.Trash/.DS_Store` gained a `ptbL` record with the full original path and a `ptbN` record `Note.md` (Spike A). **The Finder Put Back action itself was not exercised (GUI).** |
| [ ] | A11 | Automation prompt of the Finder trash method | Run the Finder-method spike binary once | Record whether "novalis möchte den Finder steuern" appears (informs D8; the app ships `NsFileManager`) |  not exercised - `NsFileManager` is the decided method (docs/DECISIONS.md), and it showed no Automation prompt. |
| [ ] | A12 | Dataless directory enumeration | `ls` a never-opened folder in the app tree | Folder listed without hydrating its children; no download traffic |  A full domain scan read 53,777 files across 1,598 directories in 1.93 s under the materialize-off policy and hydrated nothing; 44,851 were dataless (Spike A). **This was a raw scan, not the app tree.** |
| [ ] | A13 | Open a cloud-only note | Click a cloud-badged note | „Wird geladen…" state, download, editable; cancel works within the timeout |  not run - needs the app against a genuinely cloud-only note. |
| [ ] | A14 | Search skips cloud-only | `Shift+Cmd+F` with cloud-only notes present | Results plus "N Notizen nicht durchsucht (nur online)"; no hydration |  not run - needs the app against a vault containing cloud-only notes. |
| [x] | A15 | Temp file name never `.lock` | Inspect temp names during save | Hidden same-dir temp, no `.lock` suffix (OneDrive forbids it) |  Verified 2026-09-05: the temp names observed in the FSEvents stream are hidden same-dir temps and never carry a `.lock` suffix; `vault::fs::temp_path` constructs them and is unit-tested. |
| [ ] | A16 | Card write under precondition mismatch | Change a card on the web while the app has it open, then move it in the app | Store re-reads, re-applies the single field change, writes again; no banner |  not run - needs the web UI to change a card underneath the app. |

## B. Google Drive for desktop — Stream mode (File Provider) — `~/Library/CloudStorage/GoogleDrive-<account>/My Drive/novalis-test`

| Done | ID | Item | How to test | Expected | Result |
|---|---|---|---|---|---|
| [ ] | B1 | Vault kind detection | Open the vault | Detected as **File Provider**; cloud hint shown once |  Detected as **FileProvider** via the real path `~/Library/CloudStorage/GoogleDrive-<account>/Meine Ablage` (Spike D, 2026-09-07). **But `~/Google Drive` is a symlink to the same domain and is detected as `Local`** — see the spike. Note the root is localized (`Meine Ablage`), not `My Drive`. Cloud-hint-shown-once not checked (needs the app). |
| [x] | B2 | Dot-folder policy | Create `.novalis/vault.json` in the app; check the web UI and a second client | Record whether `.novalis/` syncs at all (decides nothing for v1, D23 needs only local presence) |  `.novalis/vault.json` **does** sync: it gained `com.google.drivefs.item-id#S` like any other file (Spike D). D23 needs only local presence, so nothing is decided by this either way. |
| [ ] | B3 | Conflict-copy naming | Same procedure as A4 | Record the exact sibling name pattern (undocumented by Google); app detects it |  not run - needs the Drive web UI as a second client. |
| [x] | B4 | temp + rename write | Same as A2 | No conflict copies, no duplicate versions in the web UI |  temp+rename leaves exactly one file, no conflict copy and no duplicate over 30 s of polling after create and overwrite; `UF_TRACKED` set immediately (Spike D, single client). Drive attaches its own `com.google.drivefs.item-id#S`, which the inode swap destroys and Drive re-creates within ~10 s. |
| [ ] | B5 | `boards/` behaviour | Create a board in the app; edit cards on two clients | `board.json` and `cards/*.json` sync as files; no renaming, no `(1)` copies from idle saves |  Five rapid atomic rewrites of one card left exactly one file, no duplicates, no conflict copies; `board.json` and `cards/*.json` sync as ordinary files (Spike D). **The two-client half was not run.** |
| [x] | B6 | NFD names | Same as A5 | Record the normalization form Drive stores and returns |  NFC name stored as given; NFC->NFD rename keeps the file and the entry holds the NFD bytes (APFS is normalization-preserving); `novalis ls` returns it NFC-normalized (Spike D). Identical to OneDrive. **What the server stores was not checked.** |
| [ ] | B7 | FSEvents delivery | Same as A1 | One batch per change window |  not run as a separate test - the NFD/NFC path defect this would have caught was found via Spike A and fixed on 2026-09-07 (`rel_of`); FSEvents is a kernel mechanism shared with OneDrive. |
| [x] | B8 | Dataless detection and open | Same as A12–A13 | `SF_DATALESS` set for cloud-only files; open downloads with visible state |  **All 15 pre-existing files in the domain are dataless (`SF_DATALESS`), and a guarded read fails with `EDEADLK` leaving the file dataless** (Spike D). The materialize-off guard works on Drive; this was the largest open risk in the sync design. Open-with-visible-state not checked (needs the app). |
| [ ] | B9 | `trash` of normal and dataless notes | Same as A8–A9 | Same expectations as OneDrive; record Put Back behaviour |  `novalis rm` on a normal note succeeded via `NsFileManager`, but the file landed in the **domain's own `.Trash`, not `~/.Trash`** — a real difference from OneDrive, so Finder Put Back does not apply. **Dataless trash not run.** |
| [x] | B10 | Case-only rename | Same as A6 | Record; Drive is case-sensitive server-side |  Case-only rename keeps the inode, the old name still resolves, no duplicate within 60 s (Spike D). Same as OneDrive. **The second-client/server view was not checked.** |

## C. Google Drive for desktop — Mirror mode (plain folder) — `~/Google Drive/My Drive/novalis-test` (or the chosen mirror root)

| Done | ID | Item | How to test | Expected | Result |
|---|---|---|---|---|---|
| [ ] | C1 | Vault kind detection ("mirrored" heuristic, ASSUMED) | Open the vault | Detected as **mirrored** (record how the mirror root was identified); no dataless files |   **The plan's premise does not hold.** Drive 130 mirrors *in place*: after switching to Mirror the files under `~/Library/CloudStorage/GoogleDrive-<account>/` all became materialized (16 of 16, from 15 of 15 dataless), but the path is unchanged, so `vault_kind` reports **FileProvider, not Mirrored** (Spike D, 2026-09-07). There is no plain-folder mirror root; `~/Google Drive` is still only a symlink. The `Mirrored` heuristic may be unreachable for Drive on this version. Impact is nil: `vault_kind` only gates `keepMine`, and FileProvider is the correct branch for a vault that does have vendor version history. |
| [ ] | C2 | Conflict-copy naming | Same as A4 | Record the pattern; app detects it even without File Provider |   not run as a sync conflict - needs a second client. **But** Drive's collision naming was observed directly: trashing a second `Note.md` produced **`Note 2.md`** (space + digit, no parentheses). `conflict_copy_candidate` does **not** recognise that form; it implements `Note (2).md`. Deliberately not 'fixed': a real note named `Chapter 2.md` beside `Chapter.md` would then be misread as a conflict copy, so the actual sync-conflict name must be confirmed with a second client first. |
| [x] | C3 | temp + rename write | Same as A2 | No conflict copies or duplicate versions |   temp+rename in Mirror mode leaves exactly one file, no conflict copy, `UF_TRACKED` set; identical to Stream (Spike D). |
| [x] | C4 | `boards/` behaviour | Same as B5 | Same expectations |   Three rapid atomic card rewrites left one file, no duplicates; `board.json` and `cards/*.json` sync as ordinary files (Spike D). |
| [x] | C5 | Dot-folder policy | Same as B2 | Record |   `.novalis/vault.json` syncs in Mirror mode as well, gaining the Drive item-id xattr after ~12-24 s (slower than Stream's ~10 s). |
| [x] | C6 | NFD names | Same as A5 | Record |   NFC create and NFC->NFD rename behave exactly as in Stream and on OneDrive: the entry holds the NFD bytes, APFS is normalization-preserving (Spike D). |
| [ ] | C7 | FSEvents delivery | Same as A1 | One batch per change window |   not run as a separate test - same kernel mechanism and same path as Stream mode; the NFC/NFD defect it would have caught was found via Spike A and fixed on 2026-09-07. |
| [ ] | C8 | `trash` and Put Back | Same as A8, A10 | Record |   `novalis rm` moved the note to the **domain's own `.Trash`**, not `~/.Trash` — the same as Stream mode and different from OneDrive, so Finder Put Back does not apply. **Put Back itself not exercised (GUI).** |

## D. Cross-provider (run once per release)

| Done | ID | Item | How to test | Expected | Result |
|---|---|---|---|---|---|
| [ ] | D1 | Rule-13 corpus on a cloud vault | Run the core's save/reopen/save ×3 corpus with the vault in each folder | Byte-identical files; zero conflict copies | |
| [ ] | D2 | Dirty buffer + external change + SIGKILL | Type, edit externally, `kill -9` the app | Conflict copy holds the full buffer; original untouched | |
| [ ] | D3 | 1,000-file burst | Unzip 1,000 notes into the vault from the second client | ≤ 1 tree update per batch window; UI stays responsive | |
| [ ] | D4 | CLI + app concurrently | `novalis edit` a note the app has open | App reloads a clean buffer silently; dirty buffer gets the banner | |

## Outcome

| Provider / mode | Date run | All rows green? | Blocking findings (link to issue or spike note) |
|---|---|---|---|
| OneDrive | 2026-09-05 (partial) | **No — 2 of 16 rows run.** The rest need a second client, the web UI, the Finder GUI, or a genuinely cloud-only note. | **FSEvents reports NFD paths under an NFC root**, so `rel_of` returned `None` and the watcher dropped every event in silence. Measured in `docs/spikes/2026-09-05-spike-a-onedrive.md` (step 6) and marked mandatory there; fixed 2026-09-07 with a regression test. It only ever worked here because this Mac's OneDrive path is stored NFD. |
| Google Drive Stream | 2026-09-07 (partial) | **No — 5 of 10 rows run.** The rest need the Drive web UI as a second client, or a cloud-only note in a test vault. | Two, both recorded in `docs/spikes/2026-09-07-spike-d-google-drive.md`, neither blocking: (1) `~/Google Drive` is a symlink and `vault_kind` reports `Local` through it while the real CloudStorage path reports `FileProvider` — low severity, fails safe (only `keepMine` reads it, and a `local` vault is treated *more* cautiously). (2) Trash lands in the domain's own `.Trash`, not `~/.Trash` as on OneDrive, so Finder Put Back does not apply and `app.confirmTrash.body` is imprecise for Drive vaults. **The critical mechanism passed:** every file is `SF_DATALESS` and a guarded read fails with `EDEADLK` without hydrating. |
| Google Drive Mirror | 2026-09-07 (partial) | **No — 4 of 8 rows run.** The rest need a second client or the Finder GUI. | **The section's premise is wrong, not the app:** Drive 130 mirrors *in place* under the same File Provider path (all files became materialized, 16 of 16, but the path did not change), so `vault_kind` reports `FileProvider` and never `Mirrored`. There is no plain-folder mirror root. Impact nil — that is the correct branch for a vault with vendor version history. Separately, Drive's collision naming is **`Note 2.md`**, which `conflict_copy_candidate` does not recognise; not changed, because the pattern would misread an ordinary `Chapter 2.md`. |

A release cannot be tagged from this table: `docs/RELEASING.md` "Before tagging"
item 1 requires the checklist executed on OneDrive **and** on Google Drive in
both modes with this table filled in. Mirror mode has never been run, and both
other rows are partial. Everything still outstanding needs a human at the
machine: a second client (the provider's web UI), the Finder GUI, a genuinely
cloud-only note in a test vault, or the Drive setting switched to Mirror.
