//! `novalis rm <note>` — macOS Trash, never an in-vault trash folder (D8).
//! Backlinks that would dangle stop the deletion unless `--force`.

use std::io::Write;

use novalis_core::vault::fs::{stat, trash};
use novalis_core::vault::path::fold;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::RmArgs;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::note::{materialize_within, DEFAULT_TIMEOUT};
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RmOut {
    pub path: String,
    /// Notes whose links point here and will not resolve after the delete.
    pub dangling_backlinks: Vec<String>,
    /// The note was a cloud placeholder before this command ran.
    pub cloud_only: bool,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
}

pub fn run(ctx: &Ctx, args: RmArgs) -> Result<RmOut, CliError> {
    let path = ctx.resolve_note(&args.note)?;
    let abs = ctx.abs(&path);
    let cloud_only = stat(&abs)?.cloud_only;

    let index = ctx.index()?;
    let mut dangling: Vec<String> = index
        .cache
        .backlinks(&path)?
        .into_iter()
        .map(|l| l.src)
        .collect();
    drop(index);
    dangling.sort();
    dangling.dedup_by(|a, b| fold(a) == fold(b));

    // Refused before anything is deleted, so a re-run with --force is the
    // same command against the same vault.
    if !dangling.is_empty() && !args.force {
        return Err(CliError::needs_force(format!(
            "{} note(s) still link to {path}",
            dangling.len()
        ))
        .with_path(&path)
        .with_candidates(dangling));
    }

    if ctx.dry_run {
        return Ok(RmOut {
            path,
            dangling_backlinks: dangling,
            cloud_only,
            dry_run: true,
        });
    }

    if cloud_only {
        if !args.materialize {
            return Err(CliError::from_core(novalis_core::CoreError::CloudOnly {
                path: path.clone(),
            }));
        }
        materialize_within(&abs, DEFAULT_TIMEOUT).map_err(|e| e.with_path(&path))?;
    }
    trash(&abs)?;
    Ok(RmOut {
        path,
        dangling_backlinks: dangling,
        cloud_only,
        dry_run: false,
    })
}

impl Render for RmOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        writeln!(w, "trashed {}", self.path)?;
        for p in &self.dangling_backlinks {
            writeln!(w, "  dangling backlink in {p}")?;
        }
        Ok(())
    }
}
