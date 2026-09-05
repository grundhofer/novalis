//! novalis-core: the shared, UI-free core of novalis.
//!
//! Everything here operates on plain files under a vault root plus a small,
//! disposable SQLite cache in app-data. The crate has no user-visible strings:
//! failures are typed [`CoreError`] values whose [`CoreError::code`] the CLI
//! maps to exit codes and the desktop app maps to catalog keys.
//!
//! Module map (PLAN.md §5.2):
//! - [`vault::path`]  — NFC at ingress, vault-relative path guards, symlink-aware
//! - [`vault::fs`]    — `list_dir`, `read_file`, `write_atomic`, `rename`, `trash`
//! - [`vault::cloud`] — dataless detection, materialize-off guard, conflict copies
//! - [`notes::frontmatter`] — lenient reader plus surgical key edits
//! - [`notes::links`] / [`notes::relink`] — link extraction, resolution, rewriting
//! - [`cache`]        — incremental SQLite cache (files, links, tags, meta)
//! - [`search`]       — parallel on-demand scan, streaming results
//! - [`boards`]       — Kanban board/card store with fractional ordering and LWW
//! - [`migrate`]      — one-time migration of vaults written by the old app
//! - [`settings`]     — the four settings plus `lastVault`, `deny_unknown_fields`

#![forbid(unsafe_op_in_unsafe_fn)]

pub mod boards;
pub mod cache;
pub mod error;
pub mod migrate;
pub mod notes;
pub mod search;
pub mod settings;
pub mod util;
pub mod vault;

/// The vendored demo vault (PLAN.md §11.1), the fixture three tests scan.
/// It lives in the repository, so a missing directory is a broken checkout,
/// not a reason to skip.
#[cfg(test)]
pub(crate) fn demo_vault_fixture() -> std::path::PathBuf {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/demo-vault");
    assert!(
        p.is_dir(),
        "the demo vault fixture is missing at {}",
        p.display()
    );
    p
}

pub use error::{CoreError, CoreResult, PathReason};
pub use vault::fs::Precondition;
