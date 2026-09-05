//! `novalis mv <from> <to>` — rename first, then rewrite every link and card
//! reference in one idempotent pass (D5).

use std::io::Write;

use novalis_core::notes::relink::{self, RelinkOptions, RelinkReport, RelinkSpec};
use novalis_core::vault::fs::{rename, stat};
use novalis_core::vault::path::{fold, stem_of};
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::MvArgs;
use crate::ctx::Ctx;
use crate::error::{CliError, EXIT_NEEDS_FORCE, EXIT_OK};
use crate::ops::relink::{
    cards_of, changes_of, materialize_all, rewritten_of, CardRef, ChangeOut, Rewritten,
};
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MvOut {
    pub from: String,
    pub to: String,
    pub relinked: Vec<Rewritten>,
    pub cards_updated: Vec<CardRef>,
    pub conflicts: Vec<String>,
    pub cloud_only_skipped: Vec<String>,
    /// Notes that could not be read as UTF-8 and were left alone.
    pub skipped: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub changes: Vec<ChangeOut>,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
    #[serde(skip)]
    pub forced: bool,
}

pub fn run(ctx: &Ctx, args: MvArgs) -> Result<MvOut, CliError> {
    let from = ctx.resolve_note(&args.from)?;
    let to = ctx.note_target(&args.to)?;
    if from == to {
        return Err(CliError::usage(format!("{from} is already its own target")));
    }

    // Backlinks decide both exit-5 rules, so they are read before anything
    // moves. `mv` is a mutation, so `--no-index` is already refused and the
    // cache has just been scanned.
    let index = ctx.index()?;
    let mut sources: Vec<String> = index
        .cache
        .backlinks(&from)?
        .into_iter()
        .map(|l| l.src)
        .collect();
    sources.sort();
    sources.dedup_by(|a, b| fold(a) == fold(b));
    drop(index);

    if args.no_relink && !sources.is_empty() && !args.force {
        return Err(CliError::needs_force(format!(
            "--no-relink would leave {} backlink(s) pointing at {from}",
            sources.len()
        ))
        .with_path(from)
        .with_candidates(sources));
    }

    if args.materialize {
        materialize_all(ctx, &sources)?;
    }
    let blocked: Vec<String> = sources
        .iter()
        .filter(|p| stat(&ctx.abs(p)).map(|s| s.cloud_only).unwrap_or(false))
        .cloned()
        .collect();
    if !blocked.is_empty() && !args.force && !args.no_relink {
        return Err(CliError::needs_force(format!(
            "{} note(s) linking to {from} are cloud-only and cannot be rewritten",
            blocked.len()
        ))
        .with_path(from)
        .with_hint("re-run with --materialize to download them, or --force to accept the skips")
        .with_candidates(blocked));
    }

    let spec = RelinkSpec::new(stem_of(&from), &to).with_old_path(&from);

    if ctx.dry_run {
        let report = if args.no_relink {
            RelinkReport {
                dry_run: true,
                ..Default::default()
            }
        } else {
            relink::relink(&ctx.vault, &spec, &RelinkOptions { dry_run: true })?
        };
        return Ok(out(&from, &to, &report, true, args.force));
    }

    rename(&ctx.abs(&from), &ctx.abs(&to))?;
    let report = if args.no_relink {
        RelinkReport::default()
    } else {
        relink::relink(&ctx.vault, &spec, &RelinkOptions { dry_run: false })?
    };
    Ok(out(&from, &to, &report, false, args.force))
}

fn out(from: &str, to: &str, report: &RelinkReport, dry_run: bool, forced: bool) -> MvOut {
    MvOut {
        from: from.to_string(),
        to: to.to_string(),
        relinked: rewritten_of(report),
        cards_updated: cards_of(report),
        conflicts: report.conflicts.clone(),
        cloud_only_skipped: report.cloud_only_skipped.clone(),
        skipped: report.skipped.clone(),
        changes: if dry_run {
            changes_of(report)
        } else {
            Vec::new()
        },
        dry_run,
        forced,
    }
}

impl Render for MvOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        writeln!(w, "{} -> {}", self.from, self.to)?;
        for r in &self.relinked {
            writeln!(w, "  relinked {}\t{}", r.path, r.count)?;
        }
        for c in &self.cards_updated {
            writeln!(w, "  card {}/{}", c.board, c.id)?;
        }
        for p in &self.cloud_only_skipped {
            writeln!(w, "  cloud-only, skipped: {p}")?;
        }
        for p in &self.conflicts {
            writeln!(w, "  conflict, not written: {p}")?;
        }
        Ok(())
    }

    fn exit_code(&self) -> i32 {
        if !self.cloud_only_skipped.is_empty() && !self.forced {
            EXIT_NEEDS_FORCE
        } else {
            EXIT_OK
        }
    }
}
