# File Provider checklist (manual)

Run before every release on the real cloud folders (PLAN.md §11.1), and once
during Spike A (OneDrive) and Spike D (Google Drive, both modes). Each row is an
item PLAN.md §5.6 marks **unverified**; tick the box, fill the Result column
with what actually happened (one line, date, client version), and copy the row
into the spike write-up. An empty Result means "not run", never "passed".

**Run header** (fill in per run):

| Field | Value |
|---|---|
| Date | |
| macOS | |
| Machine / hostname (appears in conflict-copy names) | |
| OneDrive client version | |
| Google Drive for desktop version | |
| Second client used for concurrent edits | (web UI / second Mac) |
| novalis build | |

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
| [ ] | A1 | FSEvents delivery inside CloudStorage | Edit a note from the second client; watch the app's `fs-batch` events | One batch within ~100 ms of the local file changing; no kqueue fallback | |
| [ ] | A2 | temp + rename write does not create a conflict copy | Save a note in the app 20× while the client is idle | Zero `<stem>-<host>.md` siblings appear | |
| [ ] | A3 | temp + rename keeps extended attributes | `xattr -l` on a note before and after an app save | Same xattr set (including the provider's own) | |
| [ ] | A4 | Conflict-copy naming via the web UI | Edit the same note offline in the app and in the web UI, reconnect | Sibling named `<stem>-<host>.md` (record the exact form); app detects and lists it | |
| [ ] | A5 | `ä` / NFD-named note round trip | Create `Ärger mit Sync.md` in the app; rename it on the web; sync back | Name arrives NFC-equal; tree shows one entry; links still resolve | |
| [ ] | A6 | Case-only rename | Rename `Readme.md` → `README.md` in the app | Same inode, one file after sync, no duplicate on the web | |
| [ ] | A7 | Same-card edit on two clients under `boards/test/cards/` | Edit one card offline on both clients, reconnect | One sibling with the same `id`; app keeps the newer `updated`, moves the loser to `conflicts/`, shows the one-line notice | |
| [ ] | A8 | `trash` of a normal note (`NsFileManager` method) | `Cmd+Delete` on a downloaded note | File in macOS Trash; removed on the web after sync | |
| [ ] | A9 | `trash` of a dataless note | `Cmd+Delete` on a cloud-only note | App materializes first (visible state) or refuses with the cloud-only error; never a silent zero-byte delete | |
| [ ] | A10 | Put Back from the Trash | Trash a note (A8), then Finder ▸ Put Back | Note returns to its folder; app tree updates via one batch | |
| [ ] | A11 | Automation prompt of the Finder trash method | Run the Finder-method spike binary once | Record whether "novalis möchte den Finder steuern" appears (informs D8; the app ships `NsFileManager`) | |
| [ ] | A12 | Dataless directory enumeration | `ls` a never-opened folder in the app tree | Folder listed without hydrating its children; no download traffic | |
| [ ] | A13 | Open a cloud-only note | Click a cloud-badged note | „Wird geladen…" state, download, editable; cancel works within the timeout | |
| [ ] | A14 | Search skips cloud-only | `Shift+Cmd+F` with cloud-only notes present | Results plus "N Notizen nicht durchsucht (nur online)"; no hydration | |
| [ ] | A15 | Temp file name never `.lock` | Inspect temp names during save | Hidden same-dir temp, no `.lock` suffix (OneDrive forbids it) | |
| [ ] | A16 | Card write under precondition mismatch | Change a card on the web while the app has it open, then move it in the app | Store re-reads, re-applies the single field change, writes again; no banner | |

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
| OneDrive | | | |
| Google Drive Stream | | | |
| Google Drive Mirror | | | |
