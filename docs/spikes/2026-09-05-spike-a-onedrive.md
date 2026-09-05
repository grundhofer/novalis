# Spike A — OneDrive File Provider, automated part

Date: 2026-09-05, 15:27–15:36 local. Machine: Apple Silicon, macOS 26.6 (25G72), OneDrive 26.153.0809, File Provider domain `com.microsoft.OneDrive.FileProvider/OneDrive` at `~/Library/CloudStorage/OneDrive-Persönlich` (referred to as "the domain" below).

Probe: a throwaway Rust binary (rustc 1.96; crates `notify` 8.2.0 with the FSEvents backend, `trash` 5.2.7, `libc` 0.2.189) plus `ls -la@`, `xattr -l`, `stat -f %Xf` and `fileproviderctl evaluate` (which prints the provider's `isUploaded` / `isUploading` state per item). Source and raw logs live in the session scratchpad, not in the repo.

Scope discipline: everything was created inside `novalis-spike-a/` at the domain root; no other item in the domain was opened, renamed, modified or deleted. Step 5 used `readdir` + `lstat` only under the materialize-off IO policy. The domain root had 49 entries before cleanup and 48 after (only the test folder gone).

Legend: **verified** = observed directly by this run; **unverified** = needs a second client, the OneDrive web UI or the Finder GUI (collected in step 7). PLAN.md §12 Phase 0 item 3 names `docs/FILE-PROVIDER-CHECKLIST.md` as the output; this file is the raw run, the checklist is to be distilled from it plus the manual steps.

## Step 1 — create a note, save via hidden same-dir temp + fsync + rename

Procedure per save: `.note.md.tmp-<pid>` opened with `O_CREAT|O_EXCL`, `write`, `fsync`, `rename` onto `note.md`, `fsync` of the directory. Three saves: create (15:28:07), overwrite of the already-uploaded file (15:30:00), overwrite after adding a custom xattr (15:31:28). After saves 1 and 2 the folder was polled 13 × every 5 s (60 s): `ls -A`, `stat`, `xattr`, `fileproviderctl evaluate`.

| Item | Observed | Status |
|---|---|---|
| Save latency | 12.1 ms (create), 10.5 ms (overwrite), including both fsyncs | verified |
| `st_flags` around the create | file absent → `0x0` immediately after the rename → `0x40` (`UF_TRACKED`) at the first poll 14 s later, together with `isUploaded = 1` | verified |
| `st_flags` around the overwrite | old inode `0x40` → new inode already `0x40` at the first `lstat` after the rename; unchanged for 60 s | verified |
| xattrs (`ls -la@`, `xattr -l`) | only `com.apple.provenance` (kernel-set on create). OneDrive attaches no xattr of its own to synced files; the domain root carries `com.apple.file-provider-domain-id`, the folder `com.apple.macl` + `com.apple.provenance` | verified |
| Does temp+rename drop xattrs? | a user xattr `user.novalis-test` set on the old inode is gone after the save (the rename replaces the inode). No provider-owned xattr exists that could be lost | verified |
| Provider upload state | create: `isUploaded = 0, isUploading = 0` right after the rename, `isUploaded = 1` 14 s later. Overwrite: `isUploading = 1` at the first poll, `isUploaded = 1` 5 s later | verified |
| Conflict copy or duplicate within 60 s | none. The listing stayed `note.md` for all 13 polls after each save; no `note-<Mac>.md`, no `note (1).md` | verified (single client) |
| Item identity across the inode change | inode changed on every save (104201494 → 104202664 → 104203011); the provider kept `filename = "note.md"` and reported it as an upload of the same item, not a delete + create | verified |
| Version history / second client view of the overwrite | — | unverified (step 7) |

Consequence: temp+rename behaves on this client; the §14 fallback (write-in-place with a `.bak` pre-copy) is not needed for OneDrive. `UF_TRACKED` is set by the provider after the write (14 s on first create, at once on overwrite of a tracked item) and must not be read as "synced".

## Step 2 — renames: case-only and NFC/NFD

`rename(2)` via `std::fs::rename`; directory entries dumped as bytes; 60 s poll afterwards.

| Item | Observed | Status |
|---|---|---|
| Case-only `note.md` → `Note.md` | ok, same inode 104203011, the directory entry is now `Note.md`; `note.md` still resolves (case-insensitive APFS). Provider: `filename = "Note.md"`, `isUploaded = 1` immediately; no duplicate within 60 s | verified |
| Create `ä.md` with the NFC name (`c3 a4 2e 6d 64`) | stored as given, NFC bytes in the directory entry (APFS is normalization-preserving) | verified |
| Rename NFC `ä.md` → NFD `ä.md` (`61 cc 88 2e 6d 64`) | ok, same inode 104203012, the entry now holds the NFD bytes; both spellings resolve (normalization-insensitive lookup). Provider: `filename = "a\U0308.md"` — the NFD name is forwarded verbatim — `isUploaded = 1` within 5 s; no duplicate, no conflict within 60 s | verified |
| Name the server stores for the NFD item and what a second client shows | — | unverified (step 7) |
| Case-only rename as seen by a second client | — | unverified (step 7) |

Consequence for §5.6.8: the local file system performs a same-inode rename for case-only and normalization-only changes directly; the temp-name two-step is not required by `rename(2)` here (keep it only if a second provider needs it, Spike D). Because the provider forwards NFD unchanged, novalis must write NFC names (as planned) so the server never receives NFD from the app.

## Step 3 — `boards/test/cards/<ulid>.json` rewritten 5× quickly

| Item | Observed | Status |
|---|---|---|
| Five atomic rewrites of the same card (pretty-printed JSON, sorted keys, trailing newline) | 42.6 ms total, 8.0–10.6 ms each | verified |
| Result on disk | one file with the last content (`"title": "rewrite 4"`), `st_flags` `0x0` → `0x40` after upload | verified |
| Upload | card `isUploaded = 1` at the second poll (≤ 5 s after the last write); `boards/`, `boards/test/`, `boards/test/cards/` all `isUploaded = 1` | verified |
| Duplicates or conflict copies within 60 s | none, listing stayed at one file | verified |
| Same card edited on two clients | — | unverified (step 7) |

## Step 4 — trash a normal note (`trash` 5.2.7, `DeleteMethod::NsFileManager`)

| Item | Observed | Status |
|---|---|---|
| Call | `trashItemAtURL:resultingItemURL:error:` returned ok after 57 ms; no prompt, no Automation dialog | verified |
| Destination | `~/.Trash/Note.md` (the user's home Trash), not the domain's `.Trash`; same inode 104203011 (a move, not a copy); content intact | verified |
| xattrs / flags after the move | gained `com.apple.decmpfs` (`fpmc`) and `com.apple.macl`, kept `com.apple.provenance`; `st_flags` stayed `0x40` | verified |
| Provider view afterwards | `fileproviderctl evaluate ~/.Trash/Note.md` → "No item for URL" (NSFileProviderErrorDomain -1005): the item left the domain | verified |
| Put Back metadata | `~/.Trash/.DS_Store` gained a `ptbL` record with the full original path (`…/OneDrive-Persönlich/novalis-spike-a/`, stored NFD) and a `ptbN` record `Note.md` | verified (record present) |
| Finder shows "Put Back" and restores into the domain | — | unverified (GUI) |
| Trashing a folder (the cleanup, step "what remains") | same behaviour: `~/.Trash/novalis-spike-a` with all children, 62 ms, put-back records written | verified |
| `trash` crate canonicalizes the path first | `trash-5.2.7/src/lib.rs:228` `canonicalize_paths` before deleting | verified (source). Harmless for one materialized file; note against PLAN rule "never canonicalize below the root" — the app should pass an already-resolved path and never a dataless directory |
| Trash of a dataless note | — | unverified (step 7; no CLI can make a file dataless: `fileproviderctl` on 26.6 offers only `dump`, `diagnose`, `evaluate`, `check|repair`, `obfuscate`) |
| Finder-method Automation prompt | not exercised (NsFileManager is the decided method, DECISIONS.md) | unverified |
| OneDrive online recycle bin receives the deletion | — | unverified (web UI) |

## Step 5 — `SF_DATALESS` state of the existing domain (stat only)

Method: recursive `readdir` + `lstat` from the domain root on a thread with `setiopolicy_np(IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES, IOPOL_SCOPE_THREAD, IOPOL_MATERIALIZE_DATALESS_FILES_OFF)` (returned 0); dataless directories are not descended; no file was opened.

| Item | Observed | Status |
|---|---|---|
| Scan time | 1.93 s for 1,598 directories / 53,777 files | verified |
| Dataless files | 44,851 of 53,777 (465.1 GB nominal), every one with `st_flags = 0x40000060` = `SF_DATALESS \| UF_TRACKED \| UF_COMPRESSED` and `st_blocks = 0` | verified |
| Materialized files | 8,800 with `0x40` (`UF_TRACKED`), 125 with `0x8000` (`UF_HIDDEN`), 1 with `0x8040`; 140.4 GB | verified |
| Dataless directories | 1 (flags `0x40000020`) at the top level, skipped; its subtree is not in the counts | verified |
| Symlinks, other types, errors | 0 / 0 / 0 | verified |
| Nothing hydrated by the scan | the policy call succeeded and no file was opened; the domain was not re-scanned afterwards to prove the counts unchanged | verified (policy), unverified (re-count) |

Consequence: the §5.6.3 rule (`SF_DATALESS` → cloud-only) is exact on this domain; the old `st_blocks == 0` heuristic would agree here but is redundant. Files novalis writes start with `st_flags = 0x0` and turn `0x40` after the provider picks them up.

## Step 6 — FSEvents delivery (`notify` 8.2.0 `FsEventWatcher`, `kFSEventStreamCreateFlagFileEvents | NoDefer`, latency 0, recursive on the test folder)

Watcher 1 ran 15:27:46–15:34:26 (400 s, steps 1–4); watcher 2 ran 15:32:50–15:36:10 (200 s, steps 3, 4 and the cleanup).

| Item | Observed | Status |
|---|---|---|
| Event count, watcher 1 | 83: 10 `Create(File)`, 3 `Create(Folder)`, 9 `Modify(Data(Content))`, 15 `Modify(Metadata(Any))`, 19 `Modify(Metadata(Extended))`, 27 `Modify(Name(Any))` | verified |
| Event count, watcher 2 | 45 in total (card rewrites, trash of `Note.md`, trash of the folder at 145.6 s, nothing after): 6 `Create(File)`, 3 `Create(Folder)`, 5 `Modify(Data(Content))`, 7 `Modify(Metadata(Any))`, 10 `Modify(Metadata(Extended))`, 14 `Modify(Name(Any))` | verified |
| One atomic save yields | in one batch (identical timestamp): `Create(File)` tmp, `Modify(Name)` tmp, `Modify(Metadata(Extended))` tmp, `Modify(Data(Content))` tmp, `Modify(Name)` on `note.md`; then 1–3 `Modify(Metadata(Any))`/`(Extended)` on `note.md` 0.2–1.0 s later, emitted by the provider when it sets `UF_TRACKED` | verified |
| Five card rewrites in 42 ms | coalesced, not five clean sequences: 6 `Create(File)` for the same temp name and 7 `Modify(Name)` for the card within 24 ms; then provider metadata events on the card and on the three new folders ~1 s later | verified |
| Case-only rename | `Modify(Name)` for `note.md` and for `Note.md` in one batch | verified |
| NFC → NFD rename | `Modify(Name)` `ä.md` (NFC) and `Modify(Name)` `a\u{308}.md` (NFD) in one batch | verified |
| Trash via NSFileManager | one `Modify(Name)` on the file (rename out of the tree), one `Modify(Metadata(Any))` on the folder 2 s later | verified |
| Trash of the watched root | one `Modify(Name)` on the root path, nothing further | verified |
| Path normalization | FSEvents reports paths in NFD (`OneDrive-Perso\u{308}nlich`) although the watch was registered with the NFC path; `Path::strip_prefix` against the NFC root fails | verified — NFC at ingress (§5.6.8) is mandatory in the watcher |
| Dropped events, `Rescan` flag | none (`flag = None` on every event) | verified for this load |
| Event for a remote change arriving from the server | — | unverified (step 7) |

Consequence: self-write suppression must cover the provider's `Modify(Metadata)` follow-ups for about 1 s after an own save (compare size + mtime or hash, not "any event on my path"), and a burst of saves must be handled per path, not per event.

## Step 7 — manual steps (second client, web UI, Finder GUI)

1. Edit `note.md` in the OneDrive web UI while the same file is edited locally (offline, then reconnect) → record the conflict-copy name the client produces (Microsoft documents `<name>-<DeviceName>.md`; unverified here) and whether the web keeps one item with versions.
2. Edit the same card `boards/test/cards/<ulid>.json` on two clients → does a sibling copy appear in `cards/` (§8.4 assumes yes)?
3. Create `ä.md` in the web UI and check the local bytes (NFC or NFD); check what the web shows for the locally NFD-renamed `ä.md`; round trip both.
4. Case-only rename seen from a second client.
5. Dataless note: on a second Mac or after "Remove Download" in Finder on this one, `trash` the dataless file with `NsFileManager` → does the call hydrate, fail, or move the placeholder; does Put Back work.
6. Finder "Put Back" of `~/.Trash/Note.md` (GUI) and whether the file is re-uploaded.
7. `DeleteMethod::Finder` once, to document the Automation prompt text (not the decided method).
8. FSEvents on this Mac for a change made in the web UI (kind and delay).
9. OneDrive online recycle bin: confirm the trashed test items are there and empty them to finish the cleanup.

## What remains after cleanup

- Domain: `novalis-spike-a/` is gone (moved to `~/.Trash/novalis-spike-a/` with `ä.md` and `boards/test/cards/01K4G9Z2Q7M3N8RSTV5WXY6ZAB.json`); `~/.Trash/Note.md` from step 4. Root entry count 49 → 48. No other item in the domain was touched.
- Server side: the folder and its files had been uploaded, so OneDrive's online recycle bin should now hold them (unverified, manual step 9).
- Repo: only this file. Probe source (`spike-a/`), `poll.sh` and the logs `poll1-4.log`, `watch1.log`, `watch2.log` are in the session scratchpad under `/private/tmp/claude-501/`.
