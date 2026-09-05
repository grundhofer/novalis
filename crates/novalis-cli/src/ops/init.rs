//! `novalis init <dir>` — write `.novalis/vault.json`, the one file v1 puts
//! under `.novalis/` (D23). Idempotent: an existing marker keeps its
//! `migrated` stamp.

use std::io::Write;
use std::path::PathBuf;

use novalis_core::migrate::{self, VAULT_FORMAT, VAULT_MARKER};
use schemars::JsonSchema;
use serde::Serialize;

use crate::ctx::Ctx;
use crate::error::CliError;
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InitOut {
    /// The absolute vault path.
    pub vault: String,
    /// The marker, vault-relative.
    pub marker: String,
    pub format: u32,
    /// False when the marker was already there.
    pub created: bool,
    /// The migration stamp, when the vault carries one.
    pub migrated: Option<String>,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
}

/// `init` runs before a vault exists, so it takes its directory as an
/// argument and does not use vault discovery.
pub fn run(ctx: &Ctx, dir: &str) -> Result<InitOut, CliError> {
    let path = PathBuf::from(dir);
    if !path.exists() && !ctx.dry_run {
        std::fs::create_dir_all(&path)
            .map_err(|e| CliError::internal(format!("cannot create {}: {e}", path.display())))?;
    }
    let vault = std::fs::canonicalize(&path).unwrap_or(path);
    if !ctx.dry_run && !vault.is_dir() {
        return Err(CliError::usage(format!(
            "{} is not a directory",
            vault.display()
        )));
    }
    let created = !vault.join(VAULT_MARKER).is_file();

    let migrated = if ctx.dry_run {
        migrate::migrated_stamp(&vault)
    } else {
        migrate::write_marker(&vault, None)?.migrated
    };

    Ok(InitOut {
        vault: vault.to_string_lossy().into_owned(),
        marker: VAULT_MARKER.to_string(),
        format: VAULT_FORMAT,
        created,
        migrated,
        dry_run: ctx.dry_run,
    })
}

impl Render for InitOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        writeln!(
            w,
            "{} {}/{}",
            if self.created { "created" } else { "kept" },
            self.vault,
            self.marker
        )
    }
}
