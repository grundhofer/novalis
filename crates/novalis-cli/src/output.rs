//! Writing results out: bare JSON on stdout, the error envelope on stderr
//! (PLAN.md §9.1).
//!
//! JSON is emitted through `serde_json::Value`, whose maps are `BTreeMap`s, so
//! every object comes out with sorted keys and two invocations of the same
//! command produce byte-identical output. `--plain` renders the same value as
//! text through [`Render`].

use std::io::{self, Write};

use serde::Serialize;

use crate::error::{CliError, ErrorBody, ErrorEnvelope};

/// The text rendering of one command's result. Every op output implements it;
/// `--plain` (and a TTY without `--json`) uses it instead of JSON.
pub trait Render {
    fn render(&self, w: &mut dyn Write) -> io::Result<()>;

    /// The exit code of a *successful* run. Commands whose result can still
    /// need `--force` (`mv`, `rm`, `relink`, PLAN.md §9.2) return 5 from the
    /// report itself, so the caller gets the full shape and the code.
    fn exit_code(&self) -> i32 {
        crate::error::EXIT_OK
    }
}

/// Serialize to a key-sorted, pretty JSON document with a trailing newline.
pub fn to_json_string<T: Serialize>(value: &T) -> Result<String, CliError> {
    let value = serde_json::to_value(value)?;
    Ok(serde_json::to_string_pretty(&value)?)
}

pub fn emit_json<T: Serialize>(w: &mut dyn Write, value: &T) -> Result<(), CliError> {
    writeln!(w, "{}", to_json_string(value)?)?;
    Ok(())
}

pub fn emit_plain<T: Render>(w: &mut dyn Write, value: &T) -> Result<(), CliError> {
    value.render(w)?;
    Ok(())
}

/// The stderr error envelope. Written even in `--plain` mode: agents parse
/// stderr, humans read the message inside it.
pub fn emit_error(w: &mut dyn Write, body: &ErrorBody) {
    let envelope = ErrorEnvelope { error: body };
    match serde_json::to_value(&envelope).and_then(|v| serde_json::to_string_pretty(&v)) {
        Ok(text) => {
            let _ = writeln!(w, "{text}");
        }
        Err(e) => {
            let _ = writeln!(
                w,
                "{{\"error\":{{\"code\":\"internal\",\"message\":\"{e}\"}}}}"
            );
        }
    }
}

/// A one-line stderr warning, e.g. `{"warning":{"code":"stale_index"}}`
/// when the cache was busy during a read (PLAN.md §9.2).
pub fn emit_warning(w: &mut dyn Write, code: &str, message: &str) {
    let value = serde_json::json!({ "warning": { "code": code, "message": message } });
    let _ = writeln!(w, "{value}");
}

/// `-` for an empty optional, so plain output never has a dangling key.
pub fn or_dash(value: Option<&str>) -> &str {
    value.unwrap_or("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Serialize)]
    struct Sample {
        zulu: u32,
        alpha: u32,
        mike: u32,
    }

    #[test]
    fn json_keys_are_sorted_regardless_of_field_order() {
        let text = to_json_string(&Sample {
            zulu: 1,
            alpha: 2,
            mike: 3,
        })
        .unwrap();
        let alpha = text.find("alpha").unwrap();
        let mike = text.find("mike").unwrap();
        let zulu = text.find("zulu").unwrap();
        assert!(alpha < mike && mike < zulu, "{text}");
    }

    #[test]
    fn the_error_envelope_has_all_five_members() {
        let mut out = Vec::new();
        emit_error(
            &mut out,
            &ErrorBody {
                code: "not_found".into(),
                message: "not found: a.md".into(),
                path: Some("a.md".into()),
                hint: None,
                candidates: vec![],
            },
        );
        let text = String::from_utf8(out).unwrap();
        for key in ["code", "message", "path", "hint", "candidates"] {
            assert!(text.contains(key), "{key} missing from {text}");
        }
    }
}
