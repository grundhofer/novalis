//! The shared note read path: cloud-only refusal, optional materialization
//! and the UTF-8 verdict that keeps `edit`/`meta` off a binary file.

use std::path::Path;
use std::time::Duration;

use novalis_core::vault::cloud;
use novalis_core::vault::fs::{read_file, read_text, stat, FileContent, TextRead};
use novalis_core::CoreError;

use crate::ctx::Ctx;
use crate::error::CliError;

/// Read a note, honouring the cloud-only rules of PLAN.md §9.2: a placeholder
/// is exit 8 unless `materialize` was asked for.
pub fn load(
    ctx: &Ctx,
    rel: &str,
    materialize: bool,
    timeout: Duration,
) -> Result<FileContent, CliError> {
    let abs = hydrated(ctx, rel, materialize, timeout)?;
    let content = read_file(&abs)?;
    Ok(content)
}

/// [`load`] for a file that is not a note (ADR-0036): the same cloud rules,
/// then the binary verdict of the head, so a binary file is refused without
/// being read (exit 2) rather than printed as a lossy mess.
pub fn load_text(
    ctx: &Ctx,
    rel: &str,
    materialize: bool,
    timeout: Duration,
) -> Result<FileContent, CliError> {
    let abs = hydrated(ctx, rel, materialize, timeout)?;
    match read_text(&abs)? {
        TextRead::Text(content) => Ok(content),
        TextRead::Binary { .. } => {
            Err(CliError::usage(format!("{rel} is a binary file; cat reads text")).with_path(rel))
        }
    }
}

/// The absolute path of `rel`, downloaded first when it is a placeholder and
/// `materialize` allows it; exit 8 when it does not.
fn hydrated(
    ctx: &Ctx,
    rel: &str,
    materialize: bool,
    timeout: Duration,
) -> Result<std::path::PathBuf, CliError> {
    let abs = ctx.abs(rel);
    let st = stat(&abs)?;
    if st.cloud_only {
        if !materialize {
            return Err(CliError::from_core(CoreError::CloudOnly {
                path: rel.to_string(),
            }));
        }
        materialize_within(&abs, timeout).map_err(|e| e.with_path(rel))?;
    }
    Ok(abs)
}

/// Read a note that is about to be rewritten: cloud-only and non-UTF-8 files
/// are refused before anything is written.
pub fn load_for_write(
    ctx: &Ctx,
    rel: &str,
    materialize: bool,
    timeout: Duration,
) -> Result<FileContent, CliError> {
    let content = load(ctx, rel, materialize, timeout)?;
    if !content.utf8 {
        return Err(CliError::usage(format!(
            "{rel} is not valid UTF-8; novalis opens it read-only"
        ))
        .with_path(rel));
    }
    Ok(content)
}

/// Hydrate a placeholder, giving up after `timeout`. Core's `materialize` is
/// a blocking read, so the wait happens on a worker thread the CLI abandons
/// on timeout instead of blocking the process forever.
pub fn materialize_within(abs: &Path, timeout: Duration) -> Result<(), CliError> {
    match cloud::materialize_within(abs, timeout) {
        Some(Ok(())) => Ok(()),
        Some(Err(e)) => Err(CliError::from_core(e)),
        None => Err(CliError::from_core(CoreError::CloudOnly {
            path: abs.to_string_lossy().into_owned(),
        })
        .with_hint(format!(
            "the download did not finish within {}s; raise --timeout",
            timeout.as_secs()
        ))),
    }
}

/// `30s`, `500ms`, `2m`, or a bare number of seconds.
pub fn parse_duration(raw: &str) -> Result<Duration, CliError> {
    let raw = raw.trim();
    let bad = || CliError::usage(format!("cannot read `{raw}` as a duration (try 30s)"));
    let (digits, unit) = match raw.find(|c: char| !c.is_ascii_digit()) {
        Some(i) => (&raw[..i], &raw[i..]),
        None => (raw, ""),
    };
    let value: u64 = digits.parse().map_err(|_| bad())?;
    match unit {
        "ms" => Ok(Duration::from_millis(value)),
        "" | "s" => Ok(Duration::from_secs(value)),
        "m" => Ok(Duration::from_secs(value * 60)),
        _ => Err(bad()),
    }
}

/// The default of `cat --materialize --timeout 30s` (PLAN.md §9.2).
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations_take_the_documented_units() {
        assert_eq!(parse_duration("30s").unwrap(), Duration::from_secs(30));
        assert_eq!(parse_duration("500ms").unwrap(), Duration::from_millis(500));
        assert_eq!(parse_duration("2m").unwrap(), Duration::from_secs(120));
        assert_eq!(parse_duration("7").unwrap(), Duration::from_secs(7));
        assert!(parse_duration("later").is_err());
        assert!(parse_duration("30h").is_err());
    }
}
