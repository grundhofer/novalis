//! Small conversions the ops share.

use std::io::Read;
use std::time::{Duration, UNIX_EPOCH};

use novalis_core::util::rfc3339_ms;

use crate::error::CliError;

/// A file mtime as the `modified` field of a result row.
pub fn ns_to_rfc3339(mtime_ns: i64) -> String {
    let ns = u64::try_from(mtime_ns).unwrap_or(0);
    rfc3339_ms(UNIX_EPOCH + Duration::from_nanos(ns))
}

/// A `--content` / `--append` value: `-` reads stdin to the end.
pub fn text_arg(value: &str) -> Result<String, CliError> {
    if value != "-" {
        return Ok(value.to_string());
    }
    let mut buf = String::new();
    std::io::stdin()
        .read_to_string(&mut buf)
        .map_err(|e| CliError::usage(format!("cannot read stdin: {e}")))?;
    Ok(buf)
}

/// `#[serde(skip_serializing_if = "…")]` for the `dryRun` marker, which is
/// present only on a dry run (PLAN.md §9.1).
pub fn is_false(value: &bool) -> bool {
    !*value
}

/// Keep only the named keys of every object under `items`. Backs `ls --fields`
/// and the `cat --body` / `--frontmatter` selectors.
pub fn retain_item_fields(value: &mut serde_json::Value, fields: &[String]) {
    let Some(items) = value.get_mut("items").and_then(|v| v.as_array_mut()) else {
        return;
    };
    for item in items {
        if let Some(map) = item.as_object_mut() {
            map.retain(|k, _| fields.iter().any(|f| f == k));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mtimes_render_as_rfc3339_with_milliseconds() {
        let s = ns_to_rfc3339(1_700_000_000_000_000_000);
        assert!(s.starts_with("2023-11-14T"), "{s}");
        assert!(s.ends_with('Z'), "{s}");
        // A negative (pre-epoch) mtime must not panic.
        assert!(!ns_to_rfc3339(-5).is_empty());
    }

    #[test]
    fn field_selection_keeps_only_what_was_asked_for() {
        let mut v = serde_json::json!({"items":[{"a":1,"b":2}],"truncated":false});
        retain_item_fields(&mut v, &["a".to_string()]);
        assert_eq!(v["items"][0].as_object().unwrap().len(), 1);
        assert_eq!(v["items"][0]["a"], 1);
        assert_eq!(v["truncated"], false);
    }
}
