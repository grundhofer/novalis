//! `novalis meta <note>` — line-level frontmatter edits (D22). The block is
//! parsed strictly first, so a hand-broken block is refused instead of
//! rewritten, and unknown keys are preserved verbatim.

use std::io::Write;

use novalis_core::notes::frontmatter;
use novalis_core::util::sha256_hex;
use novalis_core::vault::fs::{write_atomic, Precondition};
use novalis_core::CoreError;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::MetaArgs;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::note::{load_for_write, DEFAULT_TIMEOUT};
use crate::ops::cat::FrontmatterOut;
use crate::output::Render;
use crate::text::unified_diff;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MetaOut {
    pub path: String,
    pub frontmatter: FrontmatterOut,
    pub sha256_after: String,
    pub changed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
}

pub fn run(ctx: &Ctx, args: MetaArgs) -> Result<MetaOut, CliError> {
    if args.set.is_empty()
        && args.unset.is_empty()
        && args.add_tag.is_empty()
        && args.rm_tag.is_empty()
    {
        return Err(CliError::usage(
            "meta needs at least one of --set, --unset, --add-tag, --rm-tag",
        ));
    }
    let path = ctx.resolve_note(&args.note)?;
    let content = load_for_write(ctx, &path, args.materialize, DEFAULT_TIMEOUT)?;
    let text = &content.text;

    if let Some(want) = args.if_match.as_deref() {
        if !want.eq_ignore_ascii_case(&content.hash) {
            return Err(CliError::from_core(CoreError::Conflict {
                path: path.clone(),
                expected: Some(Precondition::hash_only(want)),
                actual: Some(content.precondition()),
            }));
        }
    }

    // A fixed order so two invocations with the same flags agree: set,
    // unset, add-tag, remove-tag.
    let mut out = text.clone();
    for pair in &args.set {
        let (key, value) = pair
            .split_once('=')
            .ok_or_else(|| CliError::usage(format!("--set expects KEY=VALUE, got `{pair}`")))?;
        let key = key.trim();
        if key.is_empty() {
            return Err(CliError::usage(format!("--set has an empty key: `{pair}`")));
        }
        out = frontmatter::edit_key(&out, key, Some(value))?;
    }
    for key in &args.unset {
        out = frontmatter::edit_key(&out, key.trim(), None)?;
    }
    for tag in &args.add_tag {
        out = frontmatter::add_tag(&out, tag.trim())?;
    }
    for tag in &args.rm_tag {
        out = frontmatter::remove_tag(&out, tag.trim())?;
    }

    let changed = out != *text;
    let frontmatter_out: FrontmatterOut = frontmatter::read(&out).into();

    if ctx.dry_run {
        return Ok(MetaOut {
            path,
            frontmatter: frontmatter_out,
            sha256_after: sha256_hex(out.as_bytes()),
            changed,
            diff: Some(unified_diff(text, &out)).filter(|d| !d.is_empty()),
            dry_run: true,
        });
    }

    let expected = match args.if_match.as_deref() {
        Some(hash) => Precondition::hash_only(hash),
        None => content.precondition(),
    };
    let after = if changed {
        write_atomic(&ctx.abs(&path), out.as_bytes(), Some(&expected))?
    } else {
        content.precondition()
    };
    Ok(MetaOut {
        path,
        frontmatter: frontmatter_out,
        sha256_after: after.hash,
        changed,
        diff: None,
        dry_run: false,
    })
}

impl Render for MetaOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        writeln!(
            w,
            "{} {} {}",
            if self.changed { "changed" } else { "unchanged" },
            self.path,
            self.sha256_after
        )?;
        for key in &self.frontmatter.keys {
            writeln!(w, "  {key}")?;
        }
        if let Some(diff) = &self.diff {
            w.write_all(diff.as_bytes())?;
        }
        Ok(())
    }
}
