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

/// Local repository state of the open vault (Git sync P1 — no remotes yet).
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
}
