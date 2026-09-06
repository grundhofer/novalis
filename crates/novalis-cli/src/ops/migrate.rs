//! `novalis migrate` — the one-time upgrade of a vault written by the old app
//! (PLAN.md §10, ADR-0005). Dry run by default; `--apply` performs exactly the
//! plan the dry run printed.

use std::io::Write;

use novalis_core::migrate::{self, MigrateOptions, MigrateReport};
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::MigrateArgs;
use crate::ctx::Ctx;
use crate::error::{CliError, EXIT_CONFLICT, EXIT_NEEDS_FORCE, EXIT_OK};
use crate::ops::relink::{materialize_all, CardRef, ChangeOut, Rewritten};
use crate::output::Render;

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct RenameOut {
    pub from: String,
    pub to: String,
    pub title: String,
    /// Why the stem changed: `titleDiffersFromStem`, or `titleSanitized` when
    /// the title also carried characters a file name cannot.
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct UnlinkableOut {
    pub path: String,
    pub title: String,
    /// The characters that stopped the title becoming a file name.
    pub chars: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct CollisionOut {
    pub target: String,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
pub struct LegacyTokensOut {
    pub due: usize,
    pub status: usize,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MigrateOut {
    pub renames: Vec<RenameOut>,
    pub links_rewritten: Vec<Rewritten>,
    pub cards_updated: Vec<CardRef>,
    /// Notes whose title cannot become a file name; they keep their stem.
    pub unlinkable: Vec<UnlinkableOut>,
    /// Two notes whose titles want the same file name. Refuses the whole plan.
    pub collisions: Vec<CollisionOut>,
    pub cloud_only_skipped: Vec<String>,
    /// Notes whose frontmatter does not parse as a mapping; left alone.
    pub frontmatter_failures: Vec<String>,
    /// `@due` and `@status` tokens counted, never rewritten (owner decision).
    pub legacy_tokens: LegacyTokensOut,
    /// The `migrated` stamp the vault already carried, if any.
    pub already_migrated: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub changes: Vec<ChangeOut>,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
    pub applied: bool,
    /// `--force` was given, so cloud-only skips are accepted (exit 0).
    #[serde(skip)]
    pub forced: bool,
}

fn out_of(report: &MigrateReport, dry_run: bool, forced: bool) -> MigrateOut {
    MigrateOut {
        renames: report
            .renames
            .iter()
            .map(|r| RenameOut {
                from: r.from.clone(),
                to: r.to.clone(),
                title: r.title.clone(),
                reason: match r.reason {
                    migrate::RenameReason::TitleDiffersFromStem => "titleDiffersFromStem".into(),
                    migrate::RenameReason::TitleSanitized => "titleSanitized".into(),
                },
            })
            .collect(),
        links_rewritten: report
            .links_rewritten
            .iter()
            .map(|r| Rewritten {
                path: r.path.clone(),
                count: r.count,
            })
            .collect(),
        cards_updated: cards_of_report(report),
        unlinkable: report
            .unlinkable
            .iter()
            .map(|u| UnlinkableOut {
                path: u.path.clone(),
                title: u.title.clone(),
                chars: u.chars.clone(),
            })
            .collect(),
        collisions: report
            .collisions
            .iter()
            .map(|c| CollisionOut {
                target: c.target.clone(),
                sources: c.sources.clone(),
            })
            .collect(),
        cloud_only_skipped: report.cloud_only_skipped.clone(),
        frontmatter_failures: report.frontmatter_failures.clone(),
        legacy_tokens: LegacyTokensOut {
            due: report.legacy_tokens.due,
            status: report.legacy_tokens.status,
        },
        already_migrated: report.already_migrated.clone(),
        changes: if dry_run {
            changes_of_report(report)
        } else {
            Vec::new()
        },
        dry_run,
        applied: report.applied,
        forced,
    }
}

/// `relink::cards_of` and `changes_of` take a `RelinkReport`; the migrate
/// report carries the same two vectors under its own type, so map them here
/// rather than converting one report into the other.
fn cards_of_report(report: &MigrateReport) -> Vec<CardRef> {
    report
        .cards_updated
        .iter()
        .map(|c| CardRef {
            board: c.board.clone(),
            id: c.id.clone(),
        })
        .collect()
}

fn changes_of_report(report: &MigrateReport) -> Vec<ChangeOut> {
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

pub fn run(ctx: &Ctx, args: MigrateArgs) -> Result<MigrateOut, CliError> {
    let opts = MigrateOptions {
        rename_to_title: args.rename_to_title,
        import_columns: args.import_columns,
        force: args.force,
    };

    // The global --dry-run wins over --apply: it is the "write nothing" flag,
    // and the output says `dryRun: true` so nothing is hidden.
    let dry_run = ctx.dry_run || !args.apply;
    if dry_run {
        let report = migrate::report(&ctx.vault, &opts)?;
        return Ok(out_of(&report, true, args.force));
    }

    if args.materialize {
        // One dry pass names the placeholders; hydrating them first is what
        // turns the cloud-only skips into a complete plan.
        let dry = migrate::report(&ctx.vault, &opts)?;
        materialize_all(ctx, &dry.cloud_only_skipped)?;
    }
    let report = migrate::apply(&ctx.vault, &opts)?;
    Ok(out_of(&report, false, args.force))
}

impl Render for MigrateOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        for c in &self.collisions {
            writeln!(
                w,
                "collision, plan refused: {}\t{}",
                c.target,
                c.sources.join(" ")
            )?;
        }
        for r in &self.renames {
            writeln!(w, "{}\t{}", r.from, r.to)?;
        }
        for r in &self.links_rewritten {
            writeln!(w, "{}\t{}", r.path, r.count)?;
        }
        for c in &self.cards_updated {
            writeln!(w, "{}/{}\tcard", c.board, c.id)?;
        }
        for u in &self.unlinkable {
            writeln!(w, "title unusable as a file name, kept: {}", u.path)?;
        }
        for p in &self.frontmatter_failures {
            writeln!(w, "frontmatter not a mapping, left alone: {p}")?;
        }
        for p in &self.cloud_only_skipped {
            writeln!(w, "cloud-only, skipped: {p}")?;
        }
        Ok(())
    }

    fn exit_code(&self) -> i32 {
        // A collision refuses the whole plan, so it outranks a partial skip.
        if !self.collisions.is_empty() {
            EXIT_CONFLICT
        } else if !self.cloud_only_skipped.is_empty() && !self.forced {
            EXIT_NEEDS_FORCE
        } else {
            EXIT_OK
        }
    }
}
