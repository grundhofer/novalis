//! `novalis edit <note>` — one structured, atomic rewrite of a note's body.
//! The frontmatter block is never touched (D22); every write carries the
//! read-time precondition, or the caller's `--if-match` hash (PLAN.md §5.3).

use std::io::Write;

use novalis_core::notes::frontmatter;
use novalis_core::util::sha256_hex;
use novalis_core::vault::fs::{write_atomic, Precondition};
use novalis_core::CoreError;
use regex::{Regex, RegexBuilder};
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::EditArgs;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::note::{load_for_write, DEFAULT_TIMEOUT};
use crate::output::Render;
use crate::text::{block_at, find_sections, line_ending, unified_diff, Section};
use crate::util::text_arg;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditOut {
    pub path: String,
    pub sha256_before: String,
    pub sha256_after: String,
    pub changed: bool,
    /// The single hunk this edit produces; present on `--dry-run`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
}

pub fn run(ctx: &Ctx, args: EditArgs) -> Result<EditOut, CliError> {
    reject_stray_flags(&args)?;
    let path = ctx.resolve_note(&args.note)?;
    let content = load_for_write(ctx, &path, args.materialize, DEFAULT_TIMEOUT)?;
    let text = &content.text;

    // `--if-match` is checked before the edit is computed so a mismatch is
    // exit 4 on a dry run too ("exits with the code the real run would").
    if let Some(want) = args.if_match.as_deref() {
        if !want.eq_ignore_ascii_case(&content.hash) {
            return Err(CliError::from_core(CoreError::Conflict {
                path: path.clone(),
                expected: Some(Precondition::hash_only(want)),
                actual: Some(content.precondition()),
            }));
        }
    }

    let body_start = text.len() - frontmatter::body(text).len();
    let body = &text[body_start..];
    let new_body = apply(&args, body, &path)?;
    let new_text = format!("{}{}", &text[..body_start], new_body);
    let changed = new_text != *text;

    let sha_before = content.hash.clone();
    let diff = ctx
        .dry_run
        .then(|| unified_diff(text, &new_text))
        .filter(|d| !d.is_empty());

    if ctx.dry_run {
        return Ok(EditOut {
            path,
            sha256_before: sha_before,
            sha256_after: sha256_hex(new_text.as_bytes()),
            changed,
            diff,
            dry_run: true,
        });
    }

    let expected = match args.if_match.as_deref() {
        Some(hash) => Precondition::hash_only(hash),
        None => content.precondition(),
    };
    let after = if changed {
        write_atomic(&ctx.abs(&path), new_text.as_bytes(), Some(&expected))?
    } else {
        content.precondition()
    };
    Ok(EditOut {
        path,
        sha256_before: sha_before,
        sha256_after: after.hash,
        changed,
        diff: None,
        dry_run: false,
    })
}

/// Flags that only mean something together with the mode that owns them.
fn reject_stray_flags(args: &EditArgs) -> Result<(), CliError> {
    let find_mode = args.find.is_some();
    if find_mode && args.replace.is_none() {
        return Err(CliError::usage("--find needs --replace"));
    }
    if !find_mode {
        for (flag, given) in [
            ("--replace", args.replace.is_some()),
            ("--regex", args.regex),
            ("--expect", args.expect.is_some()),
        ] {
            if given {
                return Err(CliError::usage(format!("{flag} needs --find")));
            }
        }
    }
    let section_mode = args.replace_section.is_some() || args.insert_after_section.is_some();
    if section_mode && args.content.is_none() {
        return Err(CliError::usage(
            "--replace-section and --insert-after-section need --content",
        ));
    }
    if !section_mode {
        if args.content.is_some() {
            return Err(CliError::usage(
                "--content belongs to --replace-section / --insert-after-section",
            ));
        }
        if args.nth.is_some() {
            return Err(CliError::usage(
                "--nth belongs to --replace-section / --insert-after-section",
            ));
        }
    }
    Ok(())
}

fn apply(args: &EditArgs, body: &str, path: &str) -> Result<String, CliError> {
    let eol = line_ending(body);
    if let Some(raw) = &args.append {
        let insert = text_arg(raw)?;
        let mut out = body.to_string();
        out.push_str(&block_at(body, body.len(), &insert, eol));
        return Ok(out);
    }
    if let Some(raw) = &args.prepend {
        let insert = text_arg(raw)?;
        let mut out = block_at(body, 0, &insert, eol);
        out.push_str(body);
        return Ok(out);
    }
    if let Some(raw) = &args.set_body {
        let text = text_arg(raw)?;
        return Ok(if text.is_empty() || text.ends_with('\n') {
            text
        } else {
            format!("{text}{eol}")
        });
    }
    if let Some(heading) = &args.replace_section {
        let section = pick_section(body, heading, args.nth, path)?;
        let insert = text_arg(args.content.as_deref().unwrap_or(""))?;
        let mut out = body[..section.body_start].to_string();
        out.push_str(&block_at(body, section.body_start, &insert, eol));
        out.push_str(&body[section.body_end..]);
        return Ok(out);
    }
    if let Some(heading) = &args.insert_after_section {
        let section = pick_section(body, heading, args.nth, path)?;
        let insert = text_arg(args.content.as_deref().unwrap_or(""))?;
        let mut out = body[..section.body_end].to_string();
        out.push_str(&block_at(body, section.body_end, &insert, eol));
        out.push_str(&body[section.body_end..]);
        return Ok(out);
    }
    if let Some(find) = &args.find {
        let replace = args.replace.clone().unwrap_or_default();
        let expect = args.expect.unwrap_or(1);
        let re = build_regex(find, args.regex)?;
        let count = re.find_iter(body).count();
        if count != expect {
            return Err(CliError::conflict(format!(
                "--find matched {count} time(s) in {path}, --expect asked for {expect}"
            ))
            .with_path(path)
            .with_hint("pass --expect with the real count, or narrow --find"));
        }
        // Literal replacement in both modes: `$1` in --replace is text, not a
        // capture reference, so an agent never has to escape its own data.
        let mut out = String::with_capacity(body.len());
        let mut last = 0;
        for m in re.find_iter(body) {
            out.push_str(&body[last..m.start()]);
            out.push_str(&replace);
            last = m.end();
        }
        out.push_str(&body[last..]);
        return Ok(out);
    }
    Err(CliError::usage("no edit mode given"))
}

fn build_regex(pattern: &str, is_regex: bool) -> Result<Regex, CliError> {
    let source = if is_regex {
        pattern.to_string()
    } else {
        regex::escape(pattern)
    };
    RegexBuilder::new(&source)
        .size_limit(1 << 22)
        .build()
        .map_err(|e| CliError::usage(format!("cannot read `{pattern}` as a regex: {e}")))
}

/// Resolve `--replace-section "## H"` to one section. Duplicate headings are
/// exit 4 with the candidate line numbers unless `--nth` picks one.
fn pick_section(
    body: &str,
    heading: &str,
    nth: Option<usize>,
    path: &str,
) -> Result<Section, CliError> {
    let sections = find_sections(body, heading);
    if sections.is_empty() {
        return Err(
            CliError::not_found(format!("no heading `{}` in {path}", heading.trim()))
                .with_path(path),
        );
    }
    match nth {
        None if sections.len() > 1 => Err(CliError::from_core(CoreError::Ambiguous {
            name: heading.trim().to_string(),
            candidates: sections.iter().map(|s| s.line.to_string()).collect(),
        })
        .with_path(path)
        .with_hint(format!(
            "{} headings match; pass --nth 1..{} (the candidates are body line numbers)",
            sections.len(),
            sections.len()
        ))),
        None => Ok(sections[0]),
        Some(n) if n >= 1 && n <= sections.len() => Ok(sections[n - 1]),
        Some(n) => Err(CliError::usage(format!(
            "--nth {n} is outside 1..{}",
            sections.len()
        ))),
    }
}

impl Render for EditOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        writeln!(
            w,
            "{} {} {}",
            if self.changed { "changed" } else { "unchanged" },
            self.path,
            self.sha256_after
        )?;
        if let Some(diff) = &self.diff {
            w.write_all(diff.as_bytes())?;
        }
        Ok(())
    }
}
