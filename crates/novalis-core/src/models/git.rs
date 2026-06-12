use serde::{Deserialize, Serialize};
use specta::Type;

/// One commit, as surfaced in the Sync settings panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    /// Full commit id (hex); the UI shortens it for display.
    pub id: String,
    /// First line of the commit message.
    pub message: String,
    /// Commit time, RFC 3339 in UTC.
    pub time: String,
}

/// Local repository state of the open vault.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// Whether the vault root is a git repository.
    pub initialized: bool,
    /// Working-tree paths differing from HEAD (untracked + modified +
    /// deleted), with `.gitignore` respected.
    pub dirty: u32,
    /// HEAD branch shorthand (`main` for repos Novalis created).
    pub branch: Option<String>,
    pub last_commit: Option<GitCommitInfo>,
    /// URL of the `origin` remote (the repo's git config is the single
    /// source of truth — not duplicated into prefs).
    pub remote_url: Option<String>,
    /// Local commits the remote tracking ref doesn't have. Computed from
    /// local refs only (no network) — current as of the last fetch.
    pub ahead: u32,
    /// Remote-tracking commits the local branch doesn't have (as of the
    /// last fetch).
    pub behind: u32,
}

/// What one sync cycle did (P2a: fast-forward or push only — divergence
/// stops the cycle and is surfaced; Novalis never force-pushes).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncOutcome {
    pub kind: GitSyncKind,
    /// Local commits the remote was missing at decision time.
    pub ahead: u32,
    /// Remote commits the local branch was missing at decision time.
    pub behind: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum GitSyncKind {
    /// Nothing to transfer in either direction.
    UpToDate,
    /// Local commits were pushed.
    Pushed,
    /// The local branch fast-forwarded onto the remote (incl. first
    /// adoption of a populated remote into a fresh vault).
    Pulled,
    /// Both sides have new commits — P2a stops here (merge is P2b).
    Diverged,
    /// No `origin` remote is configured.
    NoRemote,
}
