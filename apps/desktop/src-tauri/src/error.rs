//! The one error shape that crosses IPC.
//!
//! `novalis_core` has no user-visible strings (PLAN.md §5.2): it returns typed
//! [`CoreError`] values whose `code()` the UI maps to a catalog key in
//! `i18n/*.json`. This module keeps that property across the boundary — the
//! shell ships a code plus the data the message needs, never a sentence.

use novalis_core::CoreError;
use serde::{Deserialize, Serialize};
use specta::Type;

/// A failed command. `code` is `CoreError::code()` for core failures, or one of
/// the shell's own codes: `bad_request` (the UI sent something impossible),
/// `no_vault` (no vault is open) and `internal`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    /// Catalog selector, e.g. `not_found`, `conflict`, `cloud_only`.
    pub code: String,
    /// Vault-relative path the failure is about, when there is one.
    pub path: Option<String>,
    /// Free text for `parse`/`io`/`internal`; never shown on its own.
    pub detail: Option<String>,
    /// `ambiguous` only: the note name that matched more than once.
    pub name: Option<String>,
    /// `ambiguous` only: the paths it matched.
    pub candidates: Vec<String>,
}

impl IpcError {
    fn of(code: &str) -> Self {
        IpcError {
            code: code.to_string(),
            path: None,
            detail: None,
            name: None,
            candidates: Vec::new(),
        }
    }

    /// The UI asked for something structurally impossible.
    pub fn bad_request(detail: impl Into<String>) -> Self {
        IpcError {
            detail: Some(detail.into()),
            ..IpcError::of("bad_request")
        }
    }

    /// No vault is open, so there is nothing to act on.
    pub fn no_vault() -> Self {
        IpcError::of("no_vault")
    }

    /// A shell-side failure that is nobody's fault but ours.
    pub fn internal(detail: impl Into<String>) -> Self {
        IpcError {
            detail: Some(detail.into()),
            ..IpcError::of("internal")
        }
    }
}

impl From<CoreError> for IpcError {
    fn from(err: CoreError) -> Self {
        let mut out = IpcError::of(err.code());
        out.path = err.path().map(str::to_string);
        match &err {
            CoreError::Ambiguous { name, candidates } => {
                out.name = Some(name.clone());
                out.candidates = candidates.clone();
            }
            CoreError::Parse { detail, .. } => out.detail = Some(detail.clone()),
            CoreError::Io { source, .. } => out.detail = Some(source.to_string()),
            CoreError::Internal(detail) => out.detail = Some(detail.clone()),
            _ => {}
        }
        out
    }
}

impl From<tauri::Error> for IpcError {
    fn from(err: tauri::Error) -> Self {
        IpcError::internal(err.to_string())
    }
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.code)?;
        if let Some(path) = &self.path {
            write!(f, " ({path})")?;
        }
        if let Some(detail) = &self.detail {
            write!(f, ": {detail}")?;
        }
        Ok(())
    }
}

impl std::error::Error for IpcError {}

/// What every command returns.
pub type IpcResult<T> = Result<T, IpcError>;
