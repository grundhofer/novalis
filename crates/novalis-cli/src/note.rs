//! The shared note read path: cloud-only refusal, optional materialization
//! and the UTF-8 verdict that keeps `edit`/`meta` off a binary file.

use std::path::Path;
use std::time::Duration;

use novalis_core::vault::cloud;
use novalis_core::vault::fs::{read_file, stat, FileContent};
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
    let content = read_file(&abs)?;
    Ok(content)
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
    let (tx, rx) = std::sync::mpsc::channel();
    let path = abs.to_path_buf();
    std::thread::spawn(move || {
        let _ = tx.send(cloud::materialize(&path));
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(CliError::from_core(e)),
        Err(_) => Err(CliError::from_core(CoreError::CloudOnly {
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
