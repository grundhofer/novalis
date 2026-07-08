//! API-key storage for AI connections. Mirrors the git-token storage in
//! [`crate::commands`]: keys are stored via [`crate::secrets`] keyed by
//! `ai:<connection_id>`, and the key value never crosses the IPC boundary
//! back to the frontend.

use crate::engine::CommandError;
use crate::secrets;

fn account(id: &str) -> String {
    format!("ai:{id}")
}

/// Store the key, or remove it when `key` is blank.
pub fn set_key(id: &str, key: &str) -> Result<(), CommandError> {
    secrets::set(&account(id), key)
}

/// Remove any stored key for `id`.
pub fn clear_key(id: &str) -> Result<(), CommandError> {
    secrets::delete(&account(id))
}

/// Read the stored key for `id`, if any. Never exposed over IPC.
pub fn read_key(id: &str) -> Option<String> {
    secrets::get(&account(id))
}

/// Whether a key is stored for `id`.
pub fn has_key(id: &str) -> bool {
    read_key(id).is_some()
}
