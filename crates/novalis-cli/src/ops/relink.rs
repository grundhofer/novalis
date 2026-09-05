//! `novalis relink <from> <to>` — rewrite one literal link target across the
//! whole vault, notes and card `notes[]` alike (§4.4, approved).

use std::io::Write;

use novalis_core::notes::relink::{self, RelinkOptions, RelinkReport, RelinkSpec};
use novalis_core::vault::fs::stat;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::RelinkArgs;
use crate::ctx::Ctx;
use crate::error::{CliError, EXIT_NEEDS_FORCE, EXIT_OK};
use crate::note::{materialize_within, DEFAULT_TIMEOUT};
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct Rewritten {
    pub path: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct CardRef {
    pub board: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct ChangeOut {
    pub path: String,
    pub line: usize,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RelinkOut {
    pub rewritten: Vec<Rewritten>,
    pub cards_updated: Vec<CardRef>,
    pub conflicts: Vec<String>,
    pub cloud_only_skipped: Vec<String>,
    /// Notes that could not be read as UTF-8 and were left alone.
    pub skipped: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub changes: Vec<ChangeOut>,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
    /// `--force` was given, so cloud-only skips are accepted (exit 0).
    #[serde(skip)]
    pub forced: bool,
}

pub fn rewritten_of(report: &RelinkReport) -> Vec<Rewritten> {
    report
        .rewritten
        .iter()
        .map(|r| Rewritten {
            path: r.path.clone(),
            count: r.count,
        })
        .collect()
}

pub fn cards_of(report: &RelinkReport) -> Vec<CardRef> {
    report
        .cards_updated
        .iter()
        .map(|c| CardRef {
            board: c.board.clone(),
            id: c.id.clone(),
        })
        .collect()
}

pub fn changes_of(report: &RelinkReport) -> Vec<ChangeOut> {
    report
        .changes
        .iter()
        .map(|c| ChangeOut {
            path: c.path.clone(),
            line: c.line,
            before: c.before.clone(),
            after: c.after.clone(),
        })
        .collect()
}

/// Hydrate every cloud-only note a dry run reported, so the real pass can
/// rewrite it (`--materialize`).
pub fn materialize_all(ctx: &Ctx, paths: &[String]) -> Result<(), CliError> {
    for rel in paths {
        let abs = ctx.abs(rel);
        if stat(&abs).map(|s| s.cloud_only).unwrap_or(false) {
            materialize_within(&abs, DEFAULT_TIMEOUT).map_err(|e| e.with_path(rel))?;
        }
    }
    Ok(())
}

pub fn run(ctx: &Ctx, args: RelinkArgs) -> Result<RelinkOut, CliError> {
    // `<to>` must resolve; `<from>` is a literal target string and need not.
    let to = ctx.resolve_note(&args.to)?;
    let spec = RelinkSpec::new(&args.from, &to);

    let report = if ctx.dry_run {
        relink::relink(&ctx.vault, &spec, &RelinkOptions { dry_run: true })?
    } else {
        if args.materialize {
            // One dry pass names the placeholders; hydrating them first is
            // what turns the cloud-only skips into real rewrites.
            let dry = relink::relink(&ctx.vault, &spec, &RelinkOptions { dry_run: true })?;
            materialize_all(ctx, &dry.cloud_only_skipped)?;
        }
        relink::relink(&ctx.vault, &spec, &RelinkOptions { dry_run: false })?
    };

    Ok(RelinkOut {
        rewritten: rewritten_of(&report),
        cards_updated: cards_of(&report),
        conflicts: report.conflicts.clone(),
        cloud_only_skipped: report.cloud_only_skipped.clone(),
        skipped: report.skipped.clone(),
        changes: if ctx.dry_run {
            changes_of(&report)
        } else {
            Vec::new()
        },
        dry_run: ctx.dry_run,
        forced: args.force,
    })
}

impl Render for RelinkOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        for r in &self.rewritten {
            writeln!(w, "{}\t{}", r.path, r.count)?;
        }
        for c in &self.cards_updated {
            writeln!(w, "{}/{}\tcard", c.board, c.id)?;
        }
        for p in &self.cloud_only_skipped {
            writeln!(w, "cloud-only, skipped: {p}")?;
        }
        for p in &self.conflicts {
            writeln!(w, "conflict, not written: {p}")?;
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
