//! Vault filesystem layer: path guards, atomic file operations, cloud-only
//! detection. Pure functions over a vault root; no shared state.

pub mod cloud;
pub mod fs;
pub mod path;
pub(crate) mod sys;
pub mod walk;
