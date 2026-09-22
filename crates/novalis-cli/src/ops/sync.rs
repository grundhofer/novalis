//! `novalis sync status` — what the sync client left in the vault (PLAN.md
//! §9.2): which kind of folder it is, which notes are not on this Mac yet,
//! and which conflict copies the client wrote. Read-only (Mode 1); nothing
//! is downloaded, not even to look at a copy. An agent asks this before a
//! bulk `cat --materialize`, to know how much it would pull.

use std::io::Write;

use novalis_core::vault::cloud::{self, VaultKind};
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::SyncCommand;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::output::Render;

/// The core's `VaultKind`, with the schema the contract publishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    FileProvider,
    Mirrored,
    Local,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SyncOut {
    pub vault_kind: Kind,
    /// Vault-relative paths of the files that are only in the cloud.
    pub cloud_only: Vec<String>,
    /// Vault-relative paths of the conflict copies the sync client wrote.
    pub conflict_copies: Vec<String>,
}

pub fn run(ctx: &Ctx, command: SyncCommand) -> Result<SyncOut, CliError> {
    match command {
        SyncCommand::Status => status(ctx),
    }
}

fn status(ctx: &Ctx) -> Result<SyncOut, CliError> {
    let vault_kind = match cloud::vault_kind(&ctx.vault) {
        VaultKind::FileProvider => Kind::FileProvider,
        VaultKind::Mirrored => Kind::Mirrored,
        VaultKind::Local => Kind::Local,
    };
    let mut cloud_only: Vec<String> = cloud::cloud_only_files(&ctx.vault)?
        .into_iter()
        .filter_map(|path| {
            let rel = path.strip_prefix(&ctx.vault).ok()?;
            Some(rel.to_string_lossy().replace('\\', "/"))
        })
        .collect();
    cloud_only.sort();
    let mut conflict_copies: Vec<String> = cloud::find_conflict_copies(&ctx.vault)?
        .into_iter()
        .map(|copy| copy.path)
        .collect();
    conflict_copies.sort();
    Ok(SyncOut {
        vault_kind,
        cloud_only,
        conflict_copies,
    })
}

impl Render for SyncOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        let kind = match self.vault_kind {
            Kind::FileProvider => "fileProvider",
            Kind::Mirrored => "mirrored",
            Kind::Local => "local",
        };
        writeln!(w, "vault\t{kind}")?;
        writeln!(w, "cloud-only\t{}", self.cloud_only.len())?;
        for path in &self.cloud_only {
            writeln!(w, "  {path}")?;
        }
        writeln!(w, "conflict copies\t{}", self.conflict_copies.len())?;
        for path in &self.conflict_copies {
            writeln!(w, "  {path}")?;
        }
        Ok(())
    }
}
