//! Filesystem primitives: `list_dir` (readdir + lstat only), `read_file`,
//! `write_atomic` with precondition, `rename` with `RENAME_EXCL` and the
//! case-only/normalization-only two-step, `trash`, conflict-copy naming.
//!
//! Lifted from the old `vault/fs.rs` (`write_atomic`, path guards, case-only
//! rename) and extended per PLAN.md §2.3 rule 4 and §5.2.

use std::fs::File;
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::util::sha256_hex;
use crate::vault::cloud;
use crate::vault::path::{fold, nfc};
use crate::vault::sys;

/// What a directory entry is, from `lstat` (symlinks are never followed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
    Other,
}

/// One `list_dir` row: name is NFC; metadata comes from `lstat` only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    pub mtime_ns: i64,
    pub cloud_only: bool,
}

impl DirEntry {
    pub fn is_hidden(&self) -> bool {
        crate::vault::path::is_hidden(&self.name)
    }
}

/// `lstat` summary of one path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStat {
    pub kind: EntryKind,
    pub size: u64,
    pub mtime_ns: i64,
    pub cloud_only: bool,
}

/// The identity of a file's content at read time. A write carries it as its
/// precondition; a mismatch is a [`CoreError::Conflict`]. `hash` is the
/// SHA-256 hex of the bytes; `mtime_ns`/`size` are the fast path, and a
/// differing `(mtime, size)` with an equal hash still passes (self-writes are
/// matched by content, never by a clock window).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Precondition {
    pub mtime_ns: i64,
    pub size: u64,
    pub hash: String,
}

impl Precondition {
    /// A hash-only precondition (`--if-match`): the fast path never matches,
    /// so the content hash is always compared.
    pub fn hash_only(hash: impl Into<String>) -> Self {
        Precondition {
            mtime_ns: -1,
            size: u64::MAX,
            hash: hash.into(),
        }
    }

    /// Read `path` and capture its precondition.
    pub fn of(path: &Path) -> CoreResult<Self> {
        Ok(read_bytes(path)?.1)
    }
}

/// A file read into memory with its precondition and a UTF-8 verdict.
/// Invalid UTF-8 is returned lossily with `utf8 == false`; callers treat such
/// files as read-only (PLAN.md §7.3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileContent {
    pub text: String,
    pub mtime_ns: i64,
    pub size: u64,
    pub hash: String,
    pub utf8: bool,
}

impl FileContent {
    pub fn precondition(&self) -> Precondition {
        Precondition {
            mtime_ns: self.mtime_ns,
            size: self.size,
            hash: self.hash.clone(),
        }
    }
}

fn kind_of(meta: &std::fs::Metadata) -> EntryKind {
    let ft = meta.file_type();
    if ft.is_symlink() {
        EntryKind::Symlink
    } else if ft.is_dir() {
        EntryKind::Dir
    } else if ft.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    }
}

/// Nanoseconds since the epoch of the metadata's mtime.
pub fn mtime_ns_of(meta: &std::fs::Metadata) -> i64 {
    meta.mtime() * 1_000_000_000 + meta.mtime_nsec()
}

fn stat_of(meta: &std::fs::Metadata) -> FileStat {
    FileStat {
        kind: kind_of(meta),
        size: meta.len(),
        mtime_ns: mtime_ns_of(meta),
        cloud_only: cloud::is_dataless(meta),
    }
}

/// `lstat` one path.
pub fn stat(path: &Path) -> CoreResult<FileStat> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| CoreError::from_io(path, e))?;
    Ok(stat_of(&meta))
}

/// List a directory with readdir + lstat only (never canonicalize, never
/// follow symlinks, never read bodies). Entries are sorted by name; hidden
/// entries are included and flagged by [`DirEntry::is_hidden`].
pub fn list_dir(dir: &Path) -> CoreResult<Vec<DirEntry>> {
    let rd = std::fs::read_dir(dir).map_err(|e| CoreError::from_io(dir, e))?;
    let mut out = Vec::new();
    for entry in rd {
        let entry = entry.map_err(|e| CoreError::from_io(dir, e))?;
        // `DirEntry::metadata` is an lstat on unix: it never follows symlinks
        // and never hydrates a dataless file.
        let Ok(meta) = entry.metadata() else { continue };
        let name = nfc(&entry.file_name().to_string_lossy());
        let st = stat_of(&meta);
        out.push(DirEntry {
            name,
            kind: st.kind,
            size: st.size,
            mtime_ns: st.mtime_ns,
            cloud_only: st.cloud_only,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Read a file's bytes and capture its precondition from the same open
/// descriptor. Under the materialize-off policy a dataless file fails with
/// [`CoreError::CloudOnly`] instead of downloading.
pub fn read_bytes(path: &Path) -> CoreResult<(Vec<u8>, Precondition)> {
    let map = |e| CoreError::from_io(path, e);
    let mut f = File::open(path).map_err(map)?;
    let meta = f.metadata().map_err(map)?;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    f.read_to_end(&mut bytes).map_err(map)?;
    let pre = Precondition {
        mtime_ns: mtime_ns_of(&meta),
        size: meta.len(),
        hash: sha256_hex(&bytes),
    };
    Ok((bytes, pre))
}

/// Read a text file. See [`FileContent`] for the UTF-8 rule.
pub fn read_file(path: &Path) -> CoreResult<FileContent> {
    let (bytes, pre) = read_bytes(path)?;
    let (text, utf8) = match String::from_utf8(bytes) {
        Ok(s) => (s, true),
        Err(e) => (String::from_utf8_lossy(e.as_bytes()).into_owned(), false),
    };
    Ok(FileContent {
        text,
        mtime_ns: pre.mtime_ns,
        size: pre.size,
        hash: pre.hash,
        utf8,
    })
}

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// A hidden, same-directory temp name. Never `.lock` (OneDrive refuses it),
/// dot-prefixed so the watcher, the tree and the cache ignore it.
fn temp_path(target: &Path, suffix: &str) -> CoreResult<PathBuf> {
    let parent = parent_of(target)?;
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(".{name}.{}-{seq}.{suffix}", std::process::id())))
}

fn parent_of(path: &Path) -> CoreResult<&Path> {
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| CoreError::internal(format!("no parent directory for {}", path.display())))
}

fn fsync_dir(dir: &Path) -> CoreResult<()> {
    let d = File::open(dir).map_err(|e| CoreError::from_io(dir, e))?;
    d.sync_all().map_err(|e| CoreError::from_io(dir, e))
}

/// Write `bytes` to a hidden same-directory temp file and fsync it. The
/// original's permission bits are copied when it exists.
fn write_temp(target: &Path, bytes: &[u8]) -> CoreResult<PathBuf> {
    let tmp = temp_path(target, "tmp")?;
    let result = (|| -> std::io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        if let Ok(meta) = std::fs::symlink_metadata(target) {
            if meta.file_type().is_file() {
                let _ = f.set_permissions(meta.permissions());
            }
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(CoreError::from_io(&tmp, e));
    }
    Ok(tmp)
}

/// Check `expected` against the target's current state. Passes when the
/// `(mtime, size)` fast path matches, or when the on-disk hash equals the
/// expected hash; anything else is a `Conflict`.
fn check_precondition(path: &Path, expected: Option<&Precondition>) -> CoreResult<()> {
    let Some(exp) = expected else { return Ok(()) };
    let rel = path.to_string_lossy().into_owned();
    match std::fs::symlink_metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(CoreError::Conflict {
            path: rel,
            expected: Some(exp.clone()),
            actual: None,
        }),
        Err(e) => Err(CoreError::from_io(path, e)),
        Ok(meta) => {
            if mtime_ns_of(&meta) == exp.mtime_ns && meta.len() == exp.size {
                return Ok(());
            }
            let actual = Precondition::of(path)?;
            if actual.hash == exp.hash {
                Ok(())
            } else {
                Err(CoreError::Conflict {
                    path: rel,
                    expected: Some(exp.clone()),
                    actual: Some(actual),
                })
            }
        }
    }
}

/// Atomic, verified write: same-directory hidden temp → fsync → rename over
/// the target → fsync parent. With `expected`, the target must still match
/// (see [`Precondition`]) or the write is refused with `Conflict` and nothing
/// is touched. Returns the precondition of the written file so the caller
/// can record its own write.
pub fn write_atomic(
    path: &Path,
    bytes: &[u8],
    expected: Option<&Precondition>,
) -> CoreResult<Precondition> {
    check_precondition(path, expected)?;
    let parent = parent_of(path)?;
    let tmp = write_temp(path, bytes)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(CoreError::from_io(path, e));
    }
    fsync_dir(parent)?;
    let meta = std::fs::symlink_metadata(path).map_err(|e| CoreError::from_io(path, e))?;
    Ok(Precondition {
        mtime_ns: mtime_ns_of(&meta),
        size: meta.len(),
        hash: sha256_hex(bytes),
    })
}

/// Atomic create: like [`write_atomic`] but the final step is a
/// `RENAME_EXCL` rename, so an existing target is never clobbered
/// (`AlreadyExists`). Parent directories are created.
pub fn create_atomic(path: &Path, bytes: &[u8]) -> CoreResult<Precondition> {
    let parent = parent_of(path)?;
    std::fs::create_dir_all(parent).map_err(|e| CoreError::from_io(parent, e))?;
    if std::fs::symlink_metadata(path).is_ok() {
        return Err(CoreError::AlreadyExists {
            path: path.to_string_lossy().into_owned(),
        });
    }
    let tmp = write_temp(path, bytes)?;
    if let Err(e) = rename_excl(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    fsync_dir(parent)?;
    let meta = std::fs::symlink_metadata(path).map_err(|e| CoreError::from_io(path, e))?;
    Ok(Precondition {
        mtime_ns: mtime_ns_of(&meta),
        size: meta.len(),
        hash: sha256_hex(bytes),
    })
}

/// Rename without clobbering: `renamex_np(RENAME_EXCL)`, falling back to
/// link + unlink (files) or an lstat check + rename (directories) on volumes
/// without the flag. An existing destination is `AlreadyExists`.
pub fn rename_excl(from: &Path, to: &Path) -> CoreResult<()> {
    match sys::rename_excl(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(CoreError::AlreadyExists {
            path: to.to_string_lossy().into_owned(),
        }),
        Err(e) if matches!(e.raw_os_error(), Some(code) if code == libc::ENOTSUP || code == libc::EINVAL) =>
        {
            let meta = std::fs::symlink_metadata(from).map_err(|e| CoreError::from_io(from, e))?;
            if meta.file_type().is_file() {
                sys::link_unlink(from, to).map_err(|e| CoreError::from_io(to, e))
            } else {
                if std::fs::symlink_metadata(to).is_ok() {
                    return Err(CoreError::AlreadyExists {
                        path: to.to_string_lossy().into_owned(),
                    });
                }
                std::fs::rename(from, to).map_err(|e| CoreError::from_io(to, e))
            }
        }
        Err(e) => Err(CoreError::from_io(from, e)),
    }
}

fn same_inode(a: &Path, b: &Path) -> bool {
    match (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) {
        (Ok(ma), Ok(mb)) => ma.dev() == mb.dev() && ma.ino() == mb.ino(),
        _ => false,
    }
}

/// Whether a sibling of `to` exists whose name equals `to`'s under NFC +
/// casefold but is spelled differently (a case/normalization twin).
fn has_twin(to: &Path) -> CoreResult<Option<PathBuf>> {
    let parent = parent_of(to)?;
    let name = nfc(&to.file_name().unwrap_or_default().to_string_lossy());
    let key = fold(&name);
    let rd = match std::fs::read_dir(parent) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(CoreError::from_io(parent, e)),
    };
    for entry in rd.flatten() {
        let other = nfc(&entry.file_name().to_string_lossy());
        if other != name && fold(&other) == key {
            return Ok(Some(entry.path()));
        }
    }
    Ok(None)
}

/// Rename or move a file or directory. Refuses to clobber (`AlreadyExists`,
/// also for a sibling that differs only by case or normalization). A rename
/// whose source and destination are the same inode (case-only or
/// normalization-only) goes through a hidden temp name in two steps.
/// Destination parents are created.
pub fn rename(from: &Path, to: &Path) -> CoreResult<()> {
    std::fs::symlink_metadata(from).map_err(|e| CoreError::from_io(from, e))?;
    if from == to {
        return Ok(());
    }
    let to_parent = parent_of(to)?;
    std::fs::create_dir_all(to_parent).map_err(|e| CoreError::from_io(to_parent, e))?;
    if same_inode(from, to) {
        let tmp = temp_path(to, "renaming")?;
        std::fs::rename(from, &tmp).map_err(|e| CoreError::from_io(from, e))?;
        if let Err(e) = rename_excl(&tmp, to) {
            let _ = std::fs::rename(&tmp, from);
            return Err(e);
        }
        return fsync_dir(to_parent);
    }
    if std::fs::symlink_metadata(to).is_ok() {
        return Err(CoreError::AlreadyExists {
            path: to.to_string_lossy().into_owned(),
        });
    }
    if let Some(twin) = has_twin(to)? {
        if !same_inode(from, &twin) {
            return Err(CoreError::AlreadyExists {
                path: twin.to_string_lossy().into_owned(),
            });
        }
    }
    rename_excl(from, to)?;
    fsync_dir(to_parent)?;
    if let Ok(from_parent) = parent_of(from) {
        if from_parent != to_parent {
            fsync_dir(from_parent)?;
        }
    }
    Ok(())
}

/// Move `path` to the macOS Trash with the prompt-free `NsFileManager`
/// method (D8). A dataless file is refused with `CloudOnly`; materialize it
/// first.
pub fn trash(path: &Path) -> CoreResult<()> {
    let st = stat(path)?;
    if st.cloud_only {
        return Err(CoreError::CloudOnly {
            path: path.to_string_lossy().into_owned(),
        });
    }
    let mut ctx = trash::TrashContext::new();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(path).map_err(|e| match e {
        trash::Error::CouldNotAccess { .. } => CoreError::NotFound {
            path: path.to_string_lossy().into_owned(),
        },
        other => CoreError::Io {
            path: path.to_string_lossy().into_owned(),
            source: std::io::Error::other(other.to_string()),
        },
    })
}

/// `<stem> (conflict <host> <YYYY-MM-DD HHMM>)<ext>` next to `path`.
pub fn conflict_copy_path(path: &Path, host: &str, now: &NaiveDateTime) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name.as_ref(), ""),
    };
    let stamp = now.format("%Y-%m-%d %H%M");
    let new_name = format!("{stem} (conflict {host} {stamp}){ext}");
    match path.parent() {
        Some(p) => p.join(new_name),
        None => PathBuf::from(new_name),
    }
}

/// Write `bytes` to a fresh conflict copy next to `path` (never clobbering;
/// a second copy in the same minute gets a ` 2`, ` 3`… suffix).
pub fn write_conflict_copy(
    path: &Path,
    bytes: &[u8],
    host: &str,
    now: &NaiveDateTime,
) -> CoreResult<PathBuf> {
    let base = conflict_copy_path(path, host, now);
    let mut candidate = base.clone();
    for n in 2..100u32 {
        match create_atomic(&candidate, bytes) {
            Ok(_) => return Ok(candidate),
            Err(CoreError::AlreadyExists { .. }) => {
                let name = base.file_name().unwrap_or_default().to_string_lossy();
                let (stem, ext) = match name.rfind(')') {
                    Some(i) => (&name[..i], &name[i..]),
                    None => (name.as_ref(), ""),
                };
                candidate = base.with_file_name(format!("{stem} {n}{ext}"));
            }
            Err(e) => return Err(e),
        }
    }
    Err(CoreError::AlreadyExists {
        path: base.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn write_atomic_writes_complete_content_and_replaces_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.md");
        let pre = write_atomic(&p, b"first content", None).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "first content");
        assert_eq!(pre.size, 13);
        assert_eq!(pre.hash, sha256_hex(b"first content"));
        write_atomic(&p, b"second", None).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "second");
        assert_eq!(
            names(tmp.path()),
            vec!["a.md".to_string()],
            "no temp files left behind"
        );
    }

    #[test]
    fn write_atomic_precondition_conflict_leaves_target_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.md");
        let pre = write_atomic(&p, b"v1", None).unwrap();
        // An external writer changes the file.
        std::fs::write(&p, b"external").unwrap();
        let err = write_atomic(&p, b"mine", Some(&pre)).unwrap_err();
        match err {
            CoreError::Conflict {
                expected, actual, ..
            } => {
                assert_eq!(expected.unwrap().hash, pre.hash);
                assert_eq!(actual.unwrap().hash, sha256_hex(b"external"));
            }
            other => panic!("expected Conflict, got {other:?}"),
        }
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "external");
        assert_eq!(names(tmp.path()), vec!["a.md".to_string()]);
    }

    #[test]
    fn write_atomic_self_write_matches_by_hash_not_clock() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.md");
        let pre = write_atomic(&p, b"same", None).unwrap();
        // Rewritten with identical bytes but a different mtime: not a conflict.
        std::fs::write(&p, b"same").unwrap();
        let far = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000);
        File::open(&p).unwrap().set_modified(far).unwrap();
        assert!(write_atomic(&p, b"next", Some(&pre)).is_ok());
        // Hash-only precondition works the same way.
        let only = Precondition::hash_only(sha256_hex(b"next"));
        assert!(write_atomic(&p, b"after", Some(&only)).is_ok());
        let stale = Precondition::hash_only(sha256_hex(b"next"));
        assert!(matches!(
            write_atomic(&p, b"x", Some(&stale)),
            Err(CoreError::Conflict { .. })
        ));
    }

    #[test]
    fn write_atomic_with_precondition_on_missing_target_is_a_conflict() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("gone.md");
        let pre = Precondition::hash_only("00");
        match write_atomic(&p, b"x", Some(&pre)) {
            Err(CoreError::Conflict { actual: None, .. }) => {}
            other => panic!("got {other:?}"),
        }
        assert!(!p.exists());
    }

    #[test]
    fn write_atomic_preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, "x").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)).unwrap();
        write_atomic(&p, b"y", None).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn create_atomic_never_clobbers() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("sub/new.md");
        create_atomic(&p, b"one").unwrap();
        assert!(matches!(
            create_atomic(&p, b"two"),
            Err(CoreError::AlreadyExists { .. })
        ));
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "one");
        assert_eq!(names(&tmp.path().join("sub")), vec!["new.md".to_string()]);
    }

    #[test]
    fn read_file_reports_hash_and_utf8() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("a.md");
        std::fs::write(&p, "hällo").unwrap();
        let c = read_file(&p).unwrap();
        assert_eq!(c.text, "hällo");
        assert!(c.utf8);
        assert_eq!(c.size, 6);
        assert_eq!(c.hash, sha256_hex("hällo".as_bytes()));
        std::fs::write(&p, [0xff, 0xfe, b'a']).unwrap();
        let c = read_file(&p).unwrap();
        assert!(!c.utf8);
        assert!(c.text.ends_with('a'));
        assert!(read_file(&tmp.path().join("missing.md"))
            .unwrap_err()
            .is_not_found());
    }

    #[test]
    fn list_dir_uses_lstat_and_reports_kinds() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("b.md"), "bb").unwrap();
        std::fs::create_dir(tmp.path().join("a")).unwrap();
        std::fs::write(tmp.path().join(".hidden"), "").unwrap();
        std::os::unix::fs::symlink("/nonexistent/target", tmp.path().join("link")).unwrap();
        let entries = list_dir(tmp.path()).unwrap();
        let by_name: Vec<(&str, EntryKind)> =
            entries.iter().map(|e| (e.name.as_str(), e.kind)).collect();
        assert_eq!(
            by_name,
            vec![
                (".hidden", EntryKind::File),
                ("a", EntryKind::Dir),
                ("b.md", EntryKind::File),
                ("link", EntryKind::Symlink),
            ]
        );
        let b = entries.iter().find(|e| e.name == "b.md").unwrap();
        assert_eq!(b.size, 2);
        assert!(b.mtime_ns > 0);
        assert!(!b.cloud_only);
        assert!(entries[0].is_hidden());
    }

    #[test]
    fn list_dir_names_are_nfc() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("U\u{0308}ber.md"), "x").unwrap();
        let entries = list_dir(tmp.path()).unwrap();
        assert_eq!(entries[0].name, "Über.md");
    }

    #[test]
    fn rename_allows_case_only_rename_via_two_step() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("note.md");
        std::fs::write(&from, "body").unwrap();
        rename(&from, &tmp.path().join("Note.md")).unwrap();
        assert_eq!(names(tmp.path()), vec!["Note.md".to_string()]);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("Note.md")).unwrap(),
            "body"
        );
    }

    #[test]
    fn rename_allows_normalization_only_rename() {
        let tmp = tempfile::tempdir().unwrap();
        let from = tmp.path().join("U\u{0308}ber.md");
        std::fs::write(&from, "body").unwrap();
        rename(&from, &tmp.path().join("Über.md")).unwrap();
        let listed = list_dir(tmp.path()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Über.md");
    }

    #[test]
    fn rename_rejects_collisions_and_twins() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.md"), "a").unwrap();
        std::fs::write(tmp.path().join("b.md"), "b").unwrap();
        let err = rename(&tmp.path().join("a.md"), &tmp.path().join("b.md")).unwrap_err();
        assert!(
            matches!(err, CoreError::AlreadyExists { .. }),
            "got {err:?}"
        );
        // A different file whose name is a case twin of the destination.
        std::fs::write(tmp.path().join("c.md"), "c").unwrap();
        let err = rename(&tmp.path().join("c.md"), &tmp.path().join("B.md")).unwrap_err();
        assert!(
            matches!(err, CoreError::AlreadyExists { .. }),
            "got {err:?}"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("a.md")).unwrap(),
            "a"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("b.md")).unwrap(),
            "b"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("c.md")).unwrap(),
            "c"
        );
        assert!(
            rename(&tmp.path().join("missing.md"), &tmp.path().join("x.md"))
                .unwrap_err()
                .is_not_found()
        );
    }

    #[test]
    fn rename_moves_into_new_folder_and_moves_directories() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.md"), "a").unwrap();
        rename(&tmp.path().join("a.md"), &tmp.path().join("deep/er/a.md")).unwrap();
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("deep/er/a.md")).unwrap(),
            "a"
        );
        rename(&tmp.path().join("deep"), &tmp.path().join("Deep")).unwrap();
        assert_eq!(names(tmp.path()), vec!["Deep".to_string()]);
        rename(&tmp.path().join("Deep"), &tmp.path().join("moved")).unwrap();
        assert!(tmp.path().join("moved/er/a.md").exists());
    }

    #[test]
    fn conflict_copy_naming() {
        let now =
            NaiveDateTime::parse_from_str("2026-09-05 14:02:33", "%Y-%m-%d %H:%M:%S").unwrap();
        assert_eq!(
            conflict_copy_path(Path::new("/v/notes/Foo.md"), "MacBook", &now),
            PathBuf::from("/v/notes/Foo (conflict MacBook 2026-09-05 1402).md")
        );
        assert_eq!(
            conflict_copy_path(Path::new("LICENSE"), "h", &now),
            PathBuf::from("LICENSE (conflict h 2026-09-05 1402)")
        );
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("Foo.md");
        let first = write_conflict_copy(&target, b"one", "h", &now).unwrap();
        let second = write_conflict_copy(&target, b"two", "h", &now).unwrap();
        assert_eq!(
            first.file_name().unwrap().to_string_lossy(),
            "Foo (conflict h 2026-09-05 1402).md"
        );
        assert_eq!(
            second.file_name().unwrap().to_string_lossy(),
            "Foo (conflict h 2026-09-05 1402 2).md"
        );
        assert_eq!(std::fs::read_to_string(&second).unwrap(), "two");
    }

    /// Moves a real file into the user's Trash, so it is opt-in:
    /// `cargo test -p novalis-core -- --ignored trash_moves_file_to_system_trash`.
    #[test]
    #[ignore = "moves a temp file into the user's macOS Trash"]
    fn trash_moves_file_to_system_trash() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("novalis-core-trash-test.md");
        std::fs::write(&p, "trash me").unwrap();
        trash(&p).unwrap();
        assert!(!p.exists());
        assert!(trash(&p).unwrap_err().is_not_found());
    }
}
