//! Vault-relative path handling. Every path is NFC-normalized at ingress
//! (PLAN.md §5.2 `vault::path`); the guards are lexical plus a symlink check
//! on the components that exist, and never `canonicalize` (Rule 7).

use std::path::{Path, PathBuf};

use unicode_normalization::{is_nfc_quick, IsNormalized, UnicodeNormalization};

use crate::error::{CoreError, CoreResult, PathReason};

/// NFC-normalize a string (fast path when it already is NFC).
pub fn nfc(s: &str) -> String {
    match is_nfc_quick(s.chars()) {
        IsNormalized::Yes => s.to_string(),
        _ => s.nfc().collect(),
    }
}

/// The casefolded shadow of a path or stem: NFC then Unicode lowercase.
/// Used for case-insensitive resolution and the `path_fold` cache column.
pub fn fold(s: &str) -> String {
    nfc(s).to_lowercase()
}

/// Dot-prefixed names are hidden (`.novalis`, `.git`, temp files).
pub fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Normalize a caller-supplied vault-relative path: NFC, `./` and trailing
/// `/` stripped, `.` components dropped. Rejects absolute paths, `..`, and
/// empty components. An empty result denotes the vault root.
pub fn normalize_rel(relative: &str) -> CoreResult<String> {
    let raw = nfc(relative);
    let invalid = |reason| CoreError::InvalidPath {
        path: raw.clone(),
        reason,
    };
    if raw.starts_with('/') {
        return Err(invalid(PathReason::Absolute));
    }
    let mut parts: Vec<&str> = Vec::new();
    for (i, comp) in raw.split('/').enumerate() {
        match comp {
            "" if i == 0 => {}
            // A trailing slash yields one empty component at the end.
            "" if i > 0 && raw.ends_with('/') && i == raw.matches('/').count() => {}
            "" => return Err(invalid(PathReason::Empty)),
            "." => {}
            ".." => return Err(invalid(PathReason::ParentDir)),
            other => parts.push(other),
        }
    }
    Ok(parts.join("/"))
}

/// Join a caller-supplied relative path under `root`, rejecting anything
/// that could escape it (absolute, `..`) and any component below the root
/// that is a symlink. The empty path is the root itself.
pub fn vault_rel(root: &Path, relative: &str) -> CoreResult<PathBuf> {
    let rel = normalize_rel(relative)?;
    let mut cur = root.to_path_buf();
    for comp in rel.split('/').filter(|c| !c.is_empty()) {
        cur.push(comp);
        match std::fs::symlink_metadata(&cur) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(CoreError::InvalidPath {
                    path: rel,
                    reason: PathReason::Symlink,
                });
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => break,
            Err(e) => return Err(CoreError::from_io(&cur, e)),
        }
    }
    Ok(root.join(rel))
}

/// [`vault_rel`] plus the invariants of a *note* path: non-empty, no hidden
/// component, `.md` extension.
pub fn vault_note_rel(root: &Path, relative: &str) -> CoreResult<PathBuf> {
    let rel = normalize_rel(relative)?;
    let invalid = |reason| CoreError::InvalidPath {
        path: rel.clone(),
        reason,
    };
    if rel.is_empty() {
        return Err(invalid(PathReason::Empty));
    }
    if rel.split('/').any(is_hidden) {
        return Err(invalid(PathReason::Hidden));
    }
    if !is_note_name(file_name_of(&rel)) {
        return Err(invalid(PathReason::NotMarkdown));
    }
    vault_rel(root, &rel)
}

/// Whether a file name is a note (`.md`, lowercase extension).
pub fn is_note_name(name: &str) -> bool {
    name.len() > 3 && name.ends_with(".md")
}

/// The vault-relative, NFC, forward-slashed form of `abs` under `root`, or
/// `None` when `abs` is not below `root`.
pub fn rel_of(root: &Path, abs: &Path) -> Option<String> {
    if let Ok(rel) = abs.strip_prefix(root) {
        let s = rel.to_string_lossy();
        return Some(if s.is_empty() { String::new() } else { nfc(&s) });
    }
    // `strip_prefix` compares bytes, and FSEvents reports paths in NFD even
    // when the watch was registered with the NFC root (Spike A, 2026-09-05:
    // `OneDrive-Perso\u{308}nlich`). Every event in a vault whose own path
    // carries non-ASCII would otherwise fail this and be dropped in silence by
    // the watcher's `filter_map`. Retry on the normalized forms.
    let abs_nfc = nfc(&abs.to_string_lossy());
    let root_nfc = nfc(&root.to_string_lossy());
    let rest = abs_nfc.strip_prefix(root_nfc.trim_end_matches('/'))?;
    if rest.is_empty() {
        return Some(String::new());
    }
    // Requiring the separator is what keeps `/a/foobar` from looking like it
    // is under `/a/foo`.
    Some(rest.strip_prefix('/')?.to_string())
}

/// The last path segment.
pub fn file_name_of(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

/// The folder part (`""` at the root).
pub fn folder_of(rel: &str) -> &str {
    match rel.rfind('/') {
        Some(i) => &rel[..i],
        None => "",
    }
}

/// The file name without its `.md` extension (or without the last
/// extension for other files; names without extension stay whole).
pub fn stem_of(rel: &str) -> &str {
    let name = file_name_of(rel);
    match name.rfind('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    }
}

/// Join a folder and a name into a vault-relative path.
pub fn join_rel(folder: &str, name: &str) -> String {
    if folder.is_empty() {
        name.to_string()
    } else {
        format!("{folder}/{name}")
    }
}

/// Resolve `target` (a relative link destination, possibly with `..`)
/// against `from_folder` lexically. `None` when it escapes the vault.
pub fn resolve_relative(from_folder: &str, target: &str) -> Option<String> {
    if target.starts_with('/') {
        return None;
    }
    let mut parts: Vec<&str> = from_folder.split('/').filter(|c| !c.is_empty()).collect();
    for comp in target.split('/') {
        match comp {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    Some(parts.join("/"))
}

/// The relative path from `from_folder` to `to_rel` (both vault-relative).
pub fn relative_from(from_folder: &str, to_rel: &str) -> String {
    let from: Vec<&str> = from_folder.split('/').filter(|c| !c.is_empty()).collect();
    let to: Vec<&str> = to_rel.split('/').filter(|c| !c.is_empty()).collect();
    let common = from
        .iter()
        .zip(to.iter())
        .take_while(|(a, b)| a == b)
        .count();
    let mut out: Vec<&str> = Vec::new();
    out.extend(std::iter::repeat_n("..", from.len() - common));
    out.extend_from_slice(&to[common..]);
    out.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nfc_normalizes_decomposed_umlauts() {
        let nfd = "U\u{0308}ber";
        assert_eq!(nfc(nfd), "Über");
        assert_eq!(nfc("Über"), "Über");
        assert_eq!(fold("U\u{0308}BER"), "über");
    }

    #[test]
    fn normalize_rel_cleans_and_rejects() {
        assert_eq!(normalize_rel("a/b.md").unwrap(), "a/b.md");
        assert_eq!(normalize_rel("./a/./b.md").unwrap(), "a/b.md");
        assert_eq!(normalize_rel("a/").unwrap(), "a");
        assert_eq!(normalize_rel("").unwrap(), "");
        assert!(matches!(
            normalize_rel("/etc/passwd"),
            Err(CoreError::InvalidPath {
                reason: PathReason::Absolute,
                ..
            })
        ));
        assert!(matches!(
            normalize_rel("../x.md"),
            Err(CoreError::InvalidPath {
                reason: PathReason::ParentDir,
                ..
            })
        ));
        assert!(matches!(
            normalize_rel("foo/../../bar.md"),
            Err(CoreError::InvalidPath {
                reason: PathReason::ParentDir,
                ..
            })
        ));
        assert!(matches!(
            normalize_rel("a//b.md"),
            Err(CoreError::InvalidPath {
                reason: PathReason::Empty,
                ..
            })
        ));
    }

    #[test]
    fn vault_rel_rejects_escaping_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let outside = std::env::temp_dir().join("novalis-escape.md");
        let abs_str = outside.to_string_lossy().to_string();
        for bad in ["../escape.md", abs_str.as_str(), "foo/../../bar.md"] {
            assert!(vault_rel(root, bad).is_err(), "must reject {bad}");
        }
        assert_eq!(vault_rel(root, "").unwrap(), root);
        assert_eq!(vault_rel(root, "a/b.md").unwrap(), root.join("a/b.md"));
    }

    #[test]
    fn note_api_rejects_dot_paths_and_non_markdown() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        for bad in [
            ".novalis/config.json",
            ".git/config",
            "notes/.hidden/x.md",
            "shell.sh",
            "notes/script.js",
            "",
            "a/",
            ".md",
        ] {
            assert!(vault_note_rel(root, bad).is_err(), "must reject {bad:?}");
        }
        assert!(vault_note_rel(root, "sub/fine.md").is_ok());
        assert!(vault_note_rel(root, "Ordner/Unter/Über Nötes ✅.md").is_ok());
    }

    #[test]
    fn symlink_components_are_rejected_but_plain_dirs_pass() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let secret = tempfile::tempdir().unwrap();
        std::fs::write(secret.path().join("id_rsa"), "secret").unwrap();
        std::fs::create_dir(root.join("real")).unwrap();
        std::os::unix::fs::symlink(secret.path(), root.join("linked")).unwrap();
        std::os::unix::fs::symlink(secret.path().join("id_rsa"), root.join("real/x.md")).unwrap();

        let err = vault_rel(root, "linked/id_rsa").unwrap_err();
        assert!(matches!(
            err,
            CoreError::InvalidPath {
                reason: PathReason::Symlink,
                ..
            }
        ));
        assert!(vault_note_rel(root, "real/x.md").is_err());
        // A not-yet-existing target under a real directory is fine.
        assert!(vault_note_rel(root, "real/new.md").is_ok());
        assert!(vault_rel(root, "real").is_ok());
    }

    #[test]
    fn helpers_split_paths() {
        assert_eq!(file_name_of("a/b/c.md"), "c.md");
        assert_eq!(folder_of("a/b/c.md"), "a/b");
        assert_eq!(folder_of("c.md"), "");
        assert_eq!(stem_of("a/b/c.md"), "c");
        assert_eq!(stem_of("Makefile"), "Makefile");
        assert_eq!(stem_of("a/.hidden"), ".hidden");
        assert_eq!(join_rel("", "x.md"), "x.md");
        assert_eq!(join_rel("a", "x.md"), "a/x.md");
        assert_eq!(
            rel_of(Path::new("/v"), Path::new("/v/a/b.md")).as_deref(),
            Some("a/b.md")
        );
        assert_eq!(rel_of(Path::new("/v"), Path::new("/w/b.md")), None);
    }

    /// Spike A (2026-09-05) measured FSEvents reporting NFD paths under a
    /// watch registered with the NFC root, which a byte-wise `strip_prefix`
    /// misses — and the watcher drops what it cannot make relative, so the
    /// change vanishes without a trace. The owner's own vault lives under
    /// `OneDrive-Persönlich`, so this is the normal case, not an edge one.
    #[test]
    fn rel_of_survives_an_nfd_event_path_under_an_nfc_root() {
        let root_nfc = Path::new("/Users/x/OneDrive-Persönlich/vault");
        // The same bytes FSEvents delivers: o + combining diaeresis.
        let abs_nfd = PathBuf::from("/Users/x/OneDrive-Perso\u{308}nlich/vault/notes/a.md");
        assert_ne!(
            root_nfc.to_string_lossy(),
            "/Users/x/OneDrive-Perso\u{308}nlich/vault",
            "the two spellings must really differ, or this test proves nothing"
        );
        assert_eq!(
            rel_of(root_nfc, &abs_nfd).as_deref(),
            Some("notes/a.md"),
            "an NFD event path under an NFC root must still resolve"
        );
        // The root itself, in the other normalization.
        assert_eq!(
            rel_of(
                root_nfc,
                Path::new("/Users/x/OneDrive-Perso\u{308}nlich/vault")
            )
            .as_deref(),
            Some("")
        );
        // A sibling that merely shares a prefix is still not inside.
        assert_eq!(
            rel_of(
                root_nfc,
                Path::new("/Users/x/OneDrive-Perso\u{308}nlich/vault-other/a.md")
            ),
            None
        );
    }

    #[test]
    fn relative_resolution() {
        assert_eq!(
            resolve_relative("a/b", "../c.md").as_deref(),
            Some("a/c.md")
        );
        assert_eq!(resolve_relative("", "c.md").as_deref(), Some("c.md"));
        assert_eq!(resolve_relative("a", "./c.md").as_deref(), Some("a/c.md"));
        assert_eq!(resolve_relative("a", "../../c.md"), None);
        assert_eq!(relative_from("a/b", "a/c.md"), "../c.md");
        assert_eq!(relative_from("", "a/c.md"), "a/c.md");
        assert_eq!(relative_from("a", "a/c.md"), "c.md");
        assert_eq!(relative_from("x/y", "z.md"), "../../z.md");
    }
}
