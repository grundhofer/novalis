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
| Google Drive for desktop version | not installed — sections B and C have never been run |
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
| [ ] | B1 | Vault kind detection | Open the vault | Detected as **File Provider**; cloud hint shown once | |
| [ ] | B2 | Dot-folder policy | Create `.novalis/vault.json` in the app; check the web UI and a second client | Record whether `.novalis/` syncs at all (decides nothing for v1, D23 needs only local presence) | |
| [ ] | B3 | Conflict-copy naming | Same procedure as A4 | Record the exact sibling name pattern (undocumented by Google); app detects it | |
| [ ] | B4 | temp + rename write | Same as A2 | No conflict copies, no duplicate versions in the web UI | |
| [ ] | B5 | `boards/` behaviour | Create a board in the app; edit cards on two clients | `board.json` and `cards/*.json` sync as files; no renaming, no `(1)` copies from idle saves | |
| [ ] | B6 | NFD names | Same as A5 | Record the normalization form Drive stores and returns | |
| [ ] | B7 | FSEvents delivery | Same as A1 | One batch per change window | |
| [ ] | B8 | Dataless detection and open | Same as A12–A13 | `SF_DATALESS` set for cloud-only files; open downloads with visible state | |
| [ ] | B9 | `trash` of normal and dataless notes | Same as A8–A9 | Same expectations as OneDrive; record Put Back behaviour | |
| [ ] | B10 | Case-only rename | Same as A6 | Record; Drive is case-sensitive server-side | |

## C. Google Drive for desktop — Mirror mode (plain folder) — `~/Google Drive/My Drive/novalis-test` (or the chosen mirror root)

| Done | ID | Item | How to test | Expected | Result |
|---|---|---|---|---|---|
| [ ] | C1 | Vault kind detection ("mirrored" heuristic, ASSUMED) | Open the vault | Detected as **mirrored** (record how the mirror root was identified); no dataless files | |
| [ ] | C2 | Conflict-copy naming | Same as A4 | Record the pattern; app detects it even without File Provider | |
| [ ] | C3 | temp + rename write | Same as A2 | No conflict copies or duplicate versions | |
| [ ] | C4 | `boards/` behaviour | Same as B5 | Same expectations | |
| [ ] | C5 | Dot-folder policy | Same as B2 | Record | |
| [ ] | C6 | NFD names | Same as A5 | Record | |
| [ ] | C7 | FSEvents delivery | Same as A1 | One batch per change window | |
| [ ] | C8 | `trash` and Put Back | Same as A8, A10 | Record | |

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
| Google Drive Stream | — | **Never run.** Spike D was not carried out and Google Drive for desktop is not installed. | Unknown: no Google Drive behaviour has been observed at all, on either mode. |
| Google Drive Mirror | — | **Never run.** | Unknown, as above. |

A release cannot be tagged from this table: `docs/RELEASING.md` "Before tagging"
item 1 requires the checklist executed on OneDrive **and** on Google Drive in
both modes with this table filled in. Two of the three rows have never been
run, and the OneDrive row is partial.
