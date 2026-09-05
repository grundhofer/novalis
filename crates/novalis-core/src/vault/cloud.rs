//! Cloud-synced vault support (PLAN.md §2.3 rule 7, §5.6): dataless-file
//! detection, the RAII materialize-off guard, vault kind detection, and
//! generalized conflict-copy detection.

use std::collections::HashSet;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::util::sha256_hex;
use crate::vault::fs::{list_dir, read_bytes, EntryKind};
use crate::vault::path::{is_hidden, join_rel};
use crate::vault::sys;

/// Whether `meta` describes a dataless (cloud-only) file: `SF_DATALESS` in
/// `st_flags`, with the old `size > 0 && blocks == 0` heuristic as fallback.
pub fn is_dataless(meta: &std::fs::Metadata) -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt as MacExt;
        if meta.st_flags() & sys::SF_DATALESS != 0 {
            return true;
        }
    }
    meta.is_file() && meta.len() > 0 && meta.blocks() == 0
}

/// `true` when `e` is `EDEADLK`, the error a read of a dataless file gets
/// under the materialize-off policy.
pub fn is_edeadlk(e: &std::io::Error) -> bool {
    e.raw_os_error() == Some(libc::EDEADLK)
}

/// RAII guard: sets `setiopolicy_np(IOPOL_TYPE_VFS_MATERIALIZE_DATALESS_FILES,
/// IOPOL_SCOPE_THREAD, OFF)` for the current OS thread and restores the
/// previous policy on drop. Reads of dataless files then fail with `EDEADLK`
/// instead of downloading. Pooled threads are reused, so never leak one.
#[must_use = "the policy is restored when the guard drops"]
pub struct MaterializeOff {
    previous: libc::c_int,
}

impl MaterializeOff {
    pub fn new() -> CoreResult<Self> {
        let previous = sys::get_materialize_policy()
            .map_err(|e| CoreError::internal(format!("getiopolicy_np: {e}")))?;
        sys::set_materialize_policy(sys::IOPOL_MATERIALIZE_DATALESS_FILES_OFF)
            .map_err(|e| CoreError::internal(format!("setiopolicy_np: {e}")))?;
        Ok(MaterializeOff { previous })
    }
}

impl Drop for MaterializeOff {
    fn drop(&mut self) {
        let _ = sys::set_materialize_policy(self.previous);
    }
}

/// Whether the current thread runs under the default (materializing) policy.
/// Explicit opens assert this (rule 7).
pub fn materialize_is_default() -> bool {
    matches!(
        sys::get_materialize_policy(),
        Ok(v) if v != sys::IOPOL_MATERIALIZE_DATALESS_FILES_OFF
    )
}

/// Read a cloud-only file under the default policy so it is downloaded.
/// Returns `Internal` when called from a thread under [`MaterializeOff`].
pub fn materialize(path: &Path) -> CoreResult<()> {
    if !materialize_is_default() {
        return Err(CoreError::internal(
            "materialize called under the materialize-off policy",
        ));
    }
    read_bytes(path).map(|_| ())
}

/// Where a vault lives, which decides the sync hints and conflict handling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VaultKind {
    /// Under `~/Library/CloudStorage/` or carrying the File Provider domain
    /// xattr (OneDrive, Google Drive in Stream mode).
    FileProvider,
    /// A plain mirrored cloud folder (Google Drive Mirror mode). Detection is
    /// not implemented yet (PLAN.md §5.6, ASSUMED until Spike D); never
    /// produced today.
    Mirrored,
    Local,
}

/// The xattr File Provider stamps on every item of a domain.
pub const FILE_PROVIDER_XATTR: &str = "com.apple.file-provider-domain-id";

/// Detect the vault kind by the `~/Library/CloudStorage/` prefix or the File
/// Provider domain xattr on the root or any ancestor.
pub fn vault_kind(root: &Path) -> VaultKind {
    if let Some(home) = std::env::var_os("HOME") {
        let cloud = Path::new(&home).join("Library/CloudStorage");
        if root.starts_with(&cloud) && root != cloud {
            return VaultKind::FileProvider;
        }
    }
    let mut cur = Some(root);
    while let Some(p) = cur {
        if sys::has_xattr(p, FILE_PROVIDER_XATTR) {
            return VaultKind::FileProvider;
        }
        cur = p.parent();
    }
    VaultKind::Local
}

/// Which naming pattern a conflict copy matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictCopyKind {
    /// `<stem>-<hostname>.<ext>` (OneDrive).
    Host,
    /// `<stem> (n).<ext>` (OneDrive, Google Drive).
    Numbered,
    /// `<stem> (…conflicted copy…).<ext>` (Dropbox and others).
    ConflictedCopy,
    /// `<stem> (conflict <host> <stamp>).<ext>`, written by novalis itself.
    App,
}

/// A conflict copy found in the vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCopy {
    /// Vault-relative path of the copy.
    pub path: String,
    /// Vault-relative path of the original it shadows.
    pub original: String,
    pub kind: ConflictCopyKind,
    /// Both files were read and hold identical bytes (not a real conflict;
    /// PLAN.md counts only differing copies).
    pub identical: bool,
    /// One side is cloud-only, so the contents could not be compared.
    pub unread: bool,
}

fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

fn host_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9-]*$").unwrap())
}

fn numbered_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(.+) \(\d+\)$").unwrap())
}

fn conflicted_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^(.+) \(.*conflicted copy.*\)$").unwrap())
}

fn app_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(.+) \(conflict \S+ \d{4}-\d{2}-\d{2} \d{4}( \d+)?\)$").unwrap()
    })
}

/// Whether `name` looks like a vendor conflict copy whose original exists
/// (`sibling_exists`). The `-<host>` form is tried at every hyphen from the
/// right; the host part must equal `local_host` or look like a machine name
/// (contain an uppercase letter or a digit) so `project-notes.md` next to
/// `project.md` is not flagged.
pub fn conflict_copy_candidate(
    name: &str,
    sibling_exists: impl Fn(&str) -> bool,
    local_host: Option<&str>,
) -> Option<(String, ConflictCopyKind)> {
    let (stem, ext) = split_ext(name);
    if let Some(c) = app_re().captures(stem) {
        let original = format!("{}{ext}", &c[1]);
        if sibling_exists(&original) {
            return Some((original, ConflictCopyKind::App));
        }
    }
    if let Some(c) = conflicted_re().captures(stem) {
        let original = format!("{}{ext}", &c[1]);
        if sibling_exists(&original) {
            return Some((original, ConflictCopyKind::ConflictedCopy));
        }
    }
    if let Some(c) = numbered_re().captures(stem) {
        let original = format!("{}{ext}", &c[1]);
        if sibling_exists(&original) {
            return Some((original, ConflictCopyKind::Numbered));
        }
    }
    for (i, _) in stem.rmatch_indices('-') {
        if i == 0 {
            break;
        }
        let (base, host) = (&stem[..i], &stem[i + 1..]);
        if !host_re().is_match(host) {
            continue;
        }
        let machine_like = local_host.is_some_and(|h| h.eq_ignore_ascii_case(host))
            || host
                .chars()
                .any(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
        if !machine_like {
            continue;
        }
        let original = format!("{base}{ext}");
        if sibling_exists(&original) {
            return Some((original, ConflictCopyKind::Host));
        }
    }
    None
}

/// Walk the vault (readdir + lstat, hidden names and symlinks skipped) and
/// report every conflict copy, comparing contents under [`MaterializeOff`].
/// Cloud-only pairs are reported with `unread == true`.
pub fn find_conflict_copies(root: &Path) -> CoreResult<Vec<ConflictCopy>> {
    let _guard = MaterializeOff::new()?;
    let host = crate::util::hostname();
    let mut out = Vec::new();
    let mut stack: Vec<String> = vec![String::new()];
    while let Some(folder) = stack.pop() {
        let dir = if folder.is_empty() {
            root.to_path_buf()
        } else {
            root.join(&folder)
        };
        let entries = list_dir(&dir)?;
        let names: HashSet<&str> = entries
            .iter()
            .filter(|e| e.kind == EntryKind::File)
            .map(|e| e.name.as_str())
            .collect();
        for e in &entries {
            if is_hidden(&e.name) {
                continue;
            }
            match e.kind {
                EntryKind::Dir => stack.push(join_rel(&folder, &e.name)),
                EntryKind::File => {
                    let Some((original, kind)) =
                        conflict_copy_candidate(&e.name, |n| names.contains(n), Some(&host))
                    else {
                        continue;
                    };
                    let orig_entry = entries.iter().find(|x| x.name == original);
                    let unread = e.cloud_only || orig_entry.is_some_and(|o| o.cloud_only);
                    // Same size first: a differing size settles it without
                    // reading either file.
                    let identical = !unread
                        && orig_entry.is_some_and(|o| o.size == e.size)
                        && same_bytes(&dir.join(&e.name), &dir.join(&original));
                    out.push(ConflictCopy {
                        path: join_rel(&folder, &e.name),
                        original: join_rel(&folder, &original),
                        kind,
                        identical,
                        unread,
                    });
                }
                _ => {}
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn same_bytes(a: &Path, b: &Path) -> bool {
    match (read_bytes(a), read_bytes(b)) {
        (Ok((x, _)), Ok((y, _))) => sha256_hex(&x) == sha256_hex(&y),
        _ => false,
    }
}

/// Convenience: the paths of all cloud-only files below `root` (readdir +
/// lstat only, hidden names skipped).
pub fn cloud_only_files(root: &Path) -> CoreResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for e in list_dir(&dir)? {
            if is_hidden(&e.name) {
                continue;
            }
            match e.kind {
                EntryKind::Dir => stack.push(dir.join(&e.name)),
                EntryKind::File if e.cloud_only => out.push(dir.join(&e.name)),
                _ => {}
            }
        }
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_and_empty_files_are_not_dataless() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("n.md"), "hello").unwrap();
        std::fs::write(tmp.path().join("e.md"), "").unwrap();
        assert!(!is_dataless(
            &std::fs::metadata(tmp.path().join("n.md")).unwrap()
        ));
        assert!(!is_dataless(
            &std::fs::metadata(tmp.path().join("e.md")).unwrap()
        ));
        assert!(!is_dataless(&std::fs::metadata(tmp.path()).unwrap()));
    }

    #[test]
    fn materialize_off_guard_sets_and_restores_thread_policy() {
        std::thread::spawn(|| {
            let before = sys::get_materialize_policy().unwrap();
            assert!(materialize_is_default());
            {
                let _g = MaterializeOff::new().unwrap();
                assert_eq!(
                    sys::get_materialize_policy().unwrap(),
                    sys::IOPOL_MATERIALIZE_DATALESS_FILES_OFF
                );
                assert!(!materialize_is_default());
                {
                    // Nested guards restore to the outer guard's state.
                    let _inner = MaterializeOff::new().unwrap();
                }
                assert_eq!(
                    sys::get_materialize_policy().unwrap(),
                    sys::IOPOL_MATERIALIZE_DATALESS_FILES_OFF
                );
                // Ordinary files still read fine under the guard.
                let tmp = tempfile::tempdir().unwrap();
                std::fs::write(tmp.path().join("a.md"), "x").unwrap();
                assert!(read_bytes(&tmp.path().join("a.md")).is_ok());
                assert!(matches!(
                    materialize(&tmp.path().join("a.md")),
                    Err(CoreError::Internal(_))
                ));
            }
            assert_eq!(sys::get_materialize_policy().unwrap(), before);
            assert!(materialize_is_default());
        })
        .join()
        .unwrap();
    }

    #[test]
    fn vault_kind_local_for_tempdir_and_file_provider_by_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(vault_kind(tmp.path()), VaultKind::Local);
        let home = std::env::var("HOME").unwrap();
        let fp = Path::new(&home).join("Library/CloudStorage/OneDrive-Test/Notes");
        assert_eq!(vault_kind(&fp), VaultKind::FileProvider);
        assert_eq!(
            vault_kind(&Path::new(&home).join("Library/CloudStorage")),
            VaultKind::Local
        );
    }

    #[test]
    fn candidate_patterns_generalize_to_any_extension() {
        let siblings = |n: &str| {
            [
                "Note.md",
                "board.json",
                "Local-First Software.md",
                "project.md",
            ]
            .contains(&n)
        };
        let c = |name: &str| conflict_copy_candidate(name, siblings, Some("MacBook-Pro"));
        assert_eq!(
            c("Note (1).md"),
            Some(("Note.md".into(), ConflictCopyKind::Numbered))
        );
        assert_eq!(
            c("board (2).json"),
            Some(("board.json".into(), ConflictCopyKind::Numbered))
        );
        assert_eq!(
            c("Note (Sebastian's conflicted copy 2026-09-05).md"),
            Some(("Note.md".into(), ConflictCopyKind::ConflictedCopy))
        );
        assert_eq!(
            c("Note-DESKTOP-AB12CD.md"),
            Some(("Note.md".into(), ConflictCopyKind::Host))
        );
        assert_eq!(
            c("Note-MacBook-Pro.md"),
            Some(("Note.md".into(), ConflictCopyKind::Host))
        );
        assert_eq!(
            c("Local-First Software-MacBook-Pro.md"),
            Some(("Local-First Software.md".into(), ConflictCopyKind::Host))
        );
        assert_eq!(
            c("Note (conflict MacBook-Pro 2026-09-05 1402).md"),
            Some(("Note.md".into(), ConflictCopyKind::App))
        );
        assert_eq!(
            c("Note (conflict MacBook-Pro 2026-09-05 1402 2).md"),
            Some(("Note.md".into(), ConflictCopyKind::App))
        );
        // Not copies: no original, lowercase suffix, regular names.
        assert_eq!(c("Other (1).md"), None);
        assert_eq!(c("project-notes.md"), None);
        assert_eq!(c("Note.md"), None);
        assert_eq!(c("Local-First Software.md"), None);
    }

    #[test]
    fn find_conflict_copies_requires_differing_content() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("vault");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::create_dir_all(root.join(".novalis")).unwrap();
        std::fs::write(root.join("Note.md"), "original").unwrap();
        std::fs::write(root.join("Note (1).md"), "conflict").unwrap();
        std::fs::write(root.join("sub/Same.md"), "same").unwrap();
        std::fs::write(root.join("sub/Same (1).md"), "same").unwrap();
        std::fs::write(root.join("Regular Note.md"), "x").unwrap();
        std::fs::write(root.join(".novalis/Hidden (1).md"), "x").unwrap();
        let found = find_conflict_copies(&root).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].path, "Note (1).md");
        assert_eq!(found[0].original, "Note.md");
        assert!(!found[0].identical);
        assert_eq!(found[1].path, "sub/Same (1).md");
        assert!(found[1].identical);
        assert!(!found[1].unread);
        let real: Vec<_> = found.iter().filter(|c| !c.identical).collect();
        assert_eq!(real.len(), 1);
    }
}
