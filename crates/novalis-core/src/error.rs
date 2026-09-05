//! Typed core errors. No user-visible strings live here: the `Display`
//! output is developer text for logs, and [`CoreError::code`] is the stable
//! identifier the CLI maps to exit codes and the UI maps to catalog keys.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::vault::fs::Precondition;

pub type CoreResult<T> = Result<T, CoreError>;

/// Why a caller-supplied path was rejected by the vault path guards.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PathReason {
    /// An absolute path; `PathBuf::join` would replace the vault root.
    Absolute,
    /// A `..` component.
    ParentDir,
    /// An empty path where a file was required, or an empty component (`a//b`).
    Empty,
    /// A hidden (dot-prefixed) component on the note API.
    Hidden,
    /// The note API requires a `.md` extension.
    NotMarkdown,
    /// A component below the vault root is a symlink.
    Symlink,
}

/// All failures the core can produce.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("not found: {path}")]
    NotFound { path: String },

    #[error("already exists: {path}")]
    AlreadyExists { path: String },

    /// The target changed since it was read (precondition mismatch). `actual`
    /// is `None` when the target no longer exists.
    #[error("conflict: {path} changed on disk")]
    Conflict {
        path: String,
        expected: Option<Precondition>,
        actual: Option<Precondition>,
    },

    #[error("ambiguous: {name} ({} candidates)", candidates.len())]
    Ambiguous {
        name: String,
        candidates: Vec<String>,
    },

    /// The file is a cloud-only (dataless) placeholder and the operation
    /// refused to materialize it.
    #[error("cloud-only: {path}")]
    CloudOnly { path: String },

    #[error("no vault")]
    NoVault,

    #[error("io: {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("parse: {}{detail}", path.as_deref().map(|p| format!("{p}: ")).unwrap_or_default())]
    Parse {
        path: Option<String>,
        detail: String,
    },

    #[error("cache busy")]
    CacheBusy,

    #[error("invalid path: {path} ({reason:?})")]
    InvalidPath { path: String, reason: PathReason },

    #[error("internal: {0}")]
    Internal(String),
}

impl CoreError {
    /// Stable identifier per kind (snake_case). The CLI maps these to exit
    /// codes (PLAN.md §9.2); the UI maps them to catalog keys.
    pub fn code(&self) -> &'static str {
        match self {
            CoreError::NotFound { .. } => "not_found",
            CoreError::AlreadyExists { .. } => "already_exists",
            CoreError::Conflict { .. } => "conflict",
            CoreError::Ambiguous { .. } => "ambiguous",
            CoreError::CloudOnly { .. } => "cloud_only",
            CoreError::NoVault => "no_vault",
            CoreError::Io { .. } => "io",
            CoreError::Parse { .. } => "parse",
            CoreError::CacheBusy => "cache_busy",
            CoreError::InvalidPath { .. } => "invalid_path",
            CoreError::Internal(_) => "internal",
        }
    }

    /// The path the error is about, when it has one.
    pub fn path(&self) -> Option<&str> {
        match self {
            CoreError::NotFound { path }
            | CoreError::AlreadyExists { path }
            | CoreError::Conflict { path, .. }
            | CoreError::CloudOnly { path }
            | CoreError::Io { path, .. }
            | CoreError::InvalidPath { path, .. } => Some(path),
            CoreError::Parse { path, .. } => path.as_deref(),
            _ => None,
        }
    }

    /// Map an `io::Error` for `path` onto the matching kind: `NotFound`,
    /// `AlreadyExists`, `CloudOnly` (EDEADLK under the materialize-off
    /// policy), else `Io`.
    pub fn from_io(path: impl AsRef<Path>, source: std::io::Error) -> Self {
        let path = path.as_ref().to_string_lossy().into_owned();
        match source.kind() {
            std::io::ErrorKind::NotFound => CoreError::NotFound { path },
            std::io::ErrorKind::AlreadyExists => CoreError::AlreadyExists { path },
            _ if crate::vault::cloud::is_edeadlk(&source) => CoreError::CloudOnly { path },
            _ => CoreError::Io { path, source },
        }
    }

    pub fn parse(path: Option<&str>, detail: impl Into<String>) -> Self {
        CoreError::Parse {
            path: path.map(str::to_owned),
            detail: detail.into(),
        }
    }

    pub fn internal(detail: impl Into<String>) -> Self {
        CoreError::Internal(detail.into())
    }

    pub fn is_not_found(&self) -> bool {
        matches!(self, CoreError::NotFound { .. })
    }
}

impl From<rusqlite::Error> for CoreError {
    fn from(e: rusqlite::Error) -> Self {
        use rusqlite::ErrorCode;
        if let rusqlite::Error::SqliteFailure(ffi, _) = &e {
            if matches!(
                ffi.code,
                ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked
            ) {
                return CoreError::CacheBusy;
            }
        }
        CoreError::Internal(format!("sqlite: {e}"))
    }
}

impl From<serde_json::Error> for CoreError {
    fn from(e: serde_json::Error) -> Self {
        CoreError::Parse {
            path: None,
            detail: e.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_has_a_distinct_code() {
        let errors = vec![
            CoreError::NotFound { path: "a".into() },
            CoreError::AlreadyExists { path: "a".into() },
            CoreError::Conflict {
                path: "a".into(),
                expected: None,
                actual: None,
            },
            CoreError::Ambiguous {
                name: "a".into(),
                candidates: vec![],
            },
            CoreError::CloudOnly { path: "a".into() },
            CoreError::NoVault,
            CoreError::Io {
                path: "a".into(),
                source: std::io::Error::other("x"),
            },
            CoreError::Parse {
                path: None,
                detail: "x".into(),
            },
            CoreError::CacheBusy,
            CoreError::InvalidPath {
                path: "a".into(),
                reason: PathReason::Absolute,
            },
            CoreError::Internal("x".into()),
        ];
        let mut codes: Vec<&str> = errors.iter().map(CoreError::code).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), errors.len());
        assert!(codes
            .iter()
            .all(|c| c.chars().all(|ch| ch.is_ascii_lowercase() || ch == '_')));
    }

    #[test]
    fn io_errors_map_to_kinds() {
        let nf = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert!(CoreError::from_io("x.md", nf).is_not_found());
        let ex = std::io::Error::from(std::io::ErrorKind::AlreadyExists);
        assert_eq!(CoreError::from_io("x.md", ex).code(), "already_exists");
        let dl = std::io::Error::from_raw_os_error(libc::EDEADLK);
        assert_eq!(CoreError::from_io("x.md", dl).code(), "cloud_only");
        let other = std::io::Error::other("boom");
        assert_eq!(CoreError::from_io("x.md", other).code(), "io");
    }

    #[test]
    fn sqlite_busy_maps_to_cache_busy() {
        let busy = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            None,
        );
        assert_eq!(CoreError::from(busy).code(), "cache_busy");
        let other = rusqlite::Error::InvalidQuery;
        assert_eq!(CoreError::from(other).code(), "internal");
    }
}
