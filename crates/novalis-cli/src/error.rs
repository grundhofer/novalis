//! CLI errors and the exit-code mapping of PLAN.md §9.2.
//!
//! Every failure leaves the process as one JSON object on stderr,
//! `{"error":{"code","message","path","hint","candidates"}}`, plus one of the
//! nine documented exit codes. The codes are part of the contract: they may
//! gain members, never change meaning.

use novalis_core::CoreError;
use serde::Serialize;

pub const EXIT_OK: i32 = 0;
pub const EXIT_INTERNAL: i32 = 1;
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_NOT_FOUND: i32 = 3;
pub const EXIT_CONFLICT: i32 = 4;
pub const EXIT_NEEDS_FORCE: i32 = 5;
pub const EXIT_CACHE_BUSY: i32 = 6;
pub const EXIT_NO_VAULT: i32 = 7;
pub const EXIT_CLOUD_ONLY: i32 = 8;

/// The nine exit codes with the identifier `help --json` publishes.
pub const EXIT_CODES: &[(i32, &str, &str)] = &[
    (EXIT_OK, "ok", "the command succeeded"),
    (EXIT_INTERNAL, "internal", "an unexpected failure"),
    (EXIT_USAGE, "usage", "the arguments were wrong"),
    (
        EXIT_NOT_FOUND,
        "not_found",
        "the note, board or card is gone",
    ),
    (
        EXIT_CONFLICT,
        "conflict",
        "it exists, it is ambiguous, or a precondition did not hold",
    ),
    (
        EXIT_NEEDS_FORCE,
        "needs_force",
        "the change was refused; re-run with --force",
    ),
    (
        EXIT_CACHE_BUSY,
        "cache_busy",
        "another process is writing the cache",
    ),
    (EXIT_NO_VAULT, "no_vault", "no vault was found"),
    (
        EXIT_CLOUD_ONLY,
        "cloud_only",
        "the file is a cloud placeholder; --materialize downloads it",
    ),
];

/// The `error` member of the stderr envelope.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    pub path: Option<String>,
    pub hint: Option<String>,
    pub candidates: Vec<String>,
}

/// What is actually printed: `{"error": {…}}`.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorEnvelope<'a> {
    pub error: &'a ErrorBody,
}

/// The body is boxed: `CliError` travels in every `Result` of the crate, and
/// a 128-byte error variant would bloat every one of them (clippy's
/// `result_large_err`).
#[derive(Debug, Clone)]
pub struct CliError {
    pub body: Box<ErrorBody>,
    pub exit: i32,
}

impl CliError {
    fn new(code: &str, message: impl Into<String>, exit: i32) -> Self {
        CliError {
            body: Box::new(ErrorBody {
                code: code.to_string(),
                message: message.into(),
                path: None,
                hint: None,
                candidates: Vec::new(),
            }),
            exit,
        }
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.body.path = Some(path.into());
        self
    }

    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.body.hint = Some(hint.into());
        self
    }

    pub fn with_candidates(mut self, candidates: Vec<String>) -> Self {
        self.body.candidates = candidates;
        self
    }

    /// Wrong arguments (exit 2).
    pub fn usage(message: impl Into<String>) -> Self {
        CliError::new("usage", message, EXIT_USAGE)
    }

    /// An unexpected failure of the CLI itself (exit 1).
    pub fn internal(message: impl Into<String>) -> Self {
        CliError::new("internal", message, EXIT_INTERNAL)
    }

    /// No vault could be discovered (exit 7).
    pub fn no_vault(message: impl Into<String>) -> Self {
        CliError::new("no_vault", message, EXIT_NO_VAULT)
            .with_hint("pass --vault <dir>, set $NOVALIS_VAULT, or run `novalis init <dir>` first")
    }

    /// Something the command needed is not in the vault (exit 3). For a note
    /// that does not resolve, `from_core` already produces this; this is for
    /// the parts a `CoreError` has no kind for, such as a missing heading.
    pub fn not_found(message: impl Into<String>) -> Self {
        CliError::new("not_found", message, EXIT_NOT_FOUND)
    }

    /// It exists, it is ambiguous, or an expectation did not hold (exit 4).
    /// Used where the mismatch is the CLI's own, such as `--expect`.
    pub fn conflict(message: impl Into<String>) -> Self {
        CliError::new("conflict", message, EXIT_CONFLICT)
    }

    /// The operation was refused and `--force` would allow it (exit 5).
    pub fn needs_force(message: impl Into<String>) -> Self {
        CliError::new("needs_force", message, EXIT_NEEDS_FORCE)
            .with_hint("re-run with --force to accept this")
    }

    /// A command that is specified but not built yet (Phase 4, PLAN.md §12).
    pub fn not_implemented(command: &str) -> Self {
        CliError::new(
            "not_implemented",
            format!("`{command}` is planned in Phase 4"),
            EXIT_USAGE,
        )
    }

    /// The §9.2 mapping from a typed core failure onto an exit code.
    pub fn from_core(e: CoreError) -> Self {
        let exit = match &e {
            CoreError::NotFound { .. } => EXIT_NOT_FOUND,
            CoreError::AlreadyExists { .. }
            | CoreError::Conflict { .. }
            | CoreError::Ambiguous { .. } => EXIT_CONFLICT,
            CoreError::CloudOnly { .. } => EXIT_CLOUD_ONLY,
            CoreError::NoVault => EXIT_NO_VAULT,
            CoreError::CacheBusy => EXIT_CACHE_BUSY,
            // A rejected path is something the caller typed, so it is usage.
            CoreError::InvalidPath { .. } => EXIT_USAGE,
            CoreError::Io { .. } | CoreError::Parse { .. } | CoreError::Internal(_) => {
                EXIT_INTERNAL
            }
        };
        let hint = match &e {
            CoreError::CloudOnly { .. } => Some("re-run with --materialize"),
            CoreError::Conflict { .. } => {
                Some("re-read the note and retry with the current --if-match")
            }
            CoreError::Ambiguous { .. } => Some("use the vault-relative path instead of the stem"),
            CoreError::CacheBusy => Some("another process is writing the cache; retry"),
            CoreError::AlreadyExists { .. } => Some("pass --exist-ok, or choose another path"),
            _ => None,
        };
        let candidates = match &e {
            CoreError::Ambiguous { candidates, .. } => candidates.clone(),
            _ => Vec::new(),
        };
        CliError {
            body: Box::new(ErrorBody {
                code: e.code().to_string(),
                message: e.to_string(),
                path: e.path().map(str::to_owned),
                hint: hint.map(str::to_owned),
                candidates,
            }),
            exit,
        }
    }
}

impl From<CoreError> for CliError {
    fn from(e: CoreError) -> Self {
        CliError::from_core(e)
    }
}

impl From<serde_json::Error> for CliError {
    fn from(e: serde_json::Error) -> Self {
        CliError::internal(format!("json: {e}"))
    }
}

impl From<std::io::Error> for CliError {
    fn from(e: std::io::Error) -> Self {
        CliError::internal(format!("io: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use novalis_core::PathReason;

    #[test]
    fn core_kinds_map_to_the_documented_exit_codes() {
        let cases: Vec<(CoreError, i32)> = vec![
            (CoreError::NotFound { path: "a".into() }, EXIT_NOT_FOUND),
            (CoreError::AlreadyExists { path: "a".into() }, EXIT_CONFLICT),
            (
                CoreError::Conflict {
                    path: "a".into(),
                    expected: None,
                    actual: None,
                },
                EXIT_CONFLICT,
            ),
            (
                CoreError::Ambiguous {
                    name: "a".into(),
                    candidates: vec!["x".into()],
                },
                EXIT_CONFLICT,
            ),
            (CoreError::CloudOnly { path: "a".into() }, EXIT_CLOUD_ONLY),
            (CoreError::NoVault, EXIT_NO_VAULT),
            (CoreError::CacheBusy, EXIT_CACHE_BUSY),
            (
                CoreError::InvalidPath {
                    path: "a".into(),
                    reason: PathReason::ParentDir,
                },
                EXIT_USAGE,
            ),
            (CoreError::Internal("x".into()), EXIT_INTERNAL),
        ];
        for (err, want) in cases {
            let code = err.code();
            let mapped = CliError::from_core(err);
            assert_eq!(mapped.exit, want, "{code}");
            assert_eq!(mapped.body.code, code);
        }
    }

    #[test]
    fn ambiguity_carries_its_candidates() {
        let e = CliError::from_core(CoreError::Ambiguous {
            name: "Overview".into(),
            candidates: vec!["a/Overview.md".into(), "b/Overview.md".into()],
        });
        assert_eq!(e.body.candidates.len(), 2);
        assert!(e.body.hint.is_some());
    }

    #[test]
    fn exit_code_table_is_complete_and_ordered() {
        let codes: Vec<i32> = EXIT_CODES.iter().map(|(c, _, _)| *c).collect();
        assert_eq!(codes, (0..=8).collect::<Vec<i32>>());
    }
}
