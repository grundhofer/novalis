//! `novalis journal` — the day note, `journal/YYYY-MM-DD.md` in local time
//! (ADR-0012, ADR-0027): created empty when missing, like the app's Today
//! row, and optionally appended to in the same call. The date is computed
//! here, so an agent never derives it from UTC after 22:00.

use std::io::Write;

use novalis_core::util::{is_iso_day, local_iso_day, sha256_hex};
use novalis_core::vault::fs::{create_atomic, write_atomic};
use novalis_core::CoreError;
use schemars::JsonSchema;
use serde::Serialize;

use crate::cli::JournalArgs;
use crate::ctx::Ctx;
use crate::error::CliError;
use crate::note::{load_for_write, DEFAULT_TIMEOUT};
use crate::output::Render;
use crate::text::{block_at, line_ending};
use crate::util::text_arg;

/// Hard-coded like the app's (ADR-0012); the UI mirrors it by hand.
const JOURNAL_FOLDER: &str = "journal";

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct JournalOut {
    pub path: String,
    pub stem: String,
    pub link_target: String,
    /// True when the day note was already there.
    pub existing: bool,
    /// The note's sha256 after this call, `--append` included.
    pub sha256: String,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub appended: bool,
    #[serde(skip_serializing_if = "crate::util::is_false")]
    pub dry_run: bool,
}

pub fn run(ctx: &Ctx, args: JournalArgs) -> Result<JournalOut, CliError> {
    let day = day_of(args.date.as_deref())?;
    let path = ctx.note_target(&format!("{JOURNAL_FOLDER}/{day}"))?;
    let abs = ctx.abs(&path);
    let stem = day.clone();

    let mut stems = ctx.stem_index()?.clone();
    stems.insert(&path);
    let link_target = stems.link_target_for(&path);
    let insert = args.append.as_deref().map(text_arg).transpose()?;
    let appended = insert.is_some();

    let out = |existing: bool, sha256: String| JournalOut {
        path: path.clone(),
        stem: stem.clone(),
        link_target: link_target.clone(),
        existing,
        sha256,
        appended,
        dry_run: ctx.dry_run,
    };

    if !abs.exists() {
        let text = match &insert {
            Some(insert) => block_at("", 0, insert, "\n"),
            None => String::new(),
        };
        if ctx.dry_run {
            return Ok(out(false, sha256_hex(text.as_bytes())));
        }
        match create_atomic(&abs, text.as_bytes()) {
            Ok(written) => return Ok(out(false, written.hash)),
            // The app or another agent made it since the check: it exists,
            // so fall through and treat it as the existing note.
            Err(CoreError::AlreadyExists { .. }) => {}
            Err(e) => return Err(CliError::from_core(e)),
        }
    }

    let content = load_for_write(ctx, &path, args.materialize, DEFAULT_TIMEOUT)?;
    let Some(insert) = insert else {
        return Ok(out(true, content.hash));
    };
    let text = &content.text;
    let new_text = format!(
        "{text}{}",
        block_at(text, text.len(), &insert, line_ending(text))
    );
    if ctx.dry_run {
        return Ok(out(true, sha256_hex(new_text.as_bytes())));
    }
    let written = write_atomic(&abs, new_text.as_bytes(), Some(&content.precondition()))?;
    Ok(out(true, written.hash))
}

/// `--date`: `YYYY-MM-DD`, `today` or `yesterday`, in local time.
fn day_of(arg: Option<&str>) -> Result<String, CliError> {
    match arg {
        None | Some("today") => Ok(local_iso_day(0)),
        Some("yesterday") => Ok(local_iso_day(-1)),
        Some(raw) if is_iso_day(raw) => Ok(raw.to_string()),
        Some(raw) => Err(CliError::usage(format!(
            "--date {raw:?} is not YYYY-MM-DD, today or yesterday"
        ))),
    }
}

impl Render for JournalOut {
    fn render(&self, w: &mut dyn Write) -> std::io::Result<()> {
        let state = match (self.existing, self.appended) {
            (_, true) => "appended",
            (true, false) => "existing",
            (false, false) => "created",
        };
        writeln!(w, "{state} {} [[{}]]", self.path, self.link_target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_date_is_exactly_yyyy_mm_dd_today_or_yesterday() {
        assert_eq!(day_of(Some("2026-09-14")).unwrap(), "2026-09-14");
        assert_eq!(day_of(Some("today")).unwrap(), day_of(None).unwrap());
        assert_eq!(day_of(Some("yesterday")).unwrap(), local_iso_day(-1));
        for bad in ["2026-9-14", "2026-02-30", "tomorrow", ""] {
            assert!(day_of(Some(bad)).is_err(), "{bad:?}");
        }
    }
}
