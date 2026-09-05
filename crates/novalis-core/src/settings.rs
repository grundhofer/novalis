//! The settings file (PLAN.md §5.5, ADR-0004): four settings plus the
//! `version` stamp and `lastVault` state. `deny_unknown_fields` and a parity
//! test against `docs/SETTINGS.md` keep the allow-list honest (rule 11).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::vault::fs::write_atomic;

/// Current `version` stamp.
pub const SETTINGS_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    System,
    De,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct EditorSettings {
    pub font_size: u32,
}

impl Default for EditorSettings {
    fn default() -> Self {
        EditorSettings { font_size: 16 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct Settings {
    pub version: u32,
    pub language: Language,
    pub appearance: Appearance,
    pub editor: EditorSettings,
    pub spellcheck: bool,
    pub last_vault: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            version: SETTINGS_VERSION,
            language: Language::System,
            appearance: Appearance::System,
            editor: EditorSettings::default(),
            spellcheck: true,
            last_vault: None,
        }
    }
}

impl Settings {
    /// Load from `path`; a missing file is the default. Unknown keys and
    /// malformed JSON are `Parse` errors (never silently defaulted).
    pub fn load(path: &Path) -> CoreResult<Settings> {
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| CoreError::parse(Some(&path.to_string_lossy()), e.to_string())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(e) => Err(CoreError::from_io(path, e)),
        }
    }

    /// Atomic write (parent created).
    pub fn save(&self, path: &Path) -> CoreResult<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| CoreError::from_io(parent, e))?;
        }
        let mut json = serde_json::to_string_pretty(self)?;
        json.push('\n');
        write_atomic(path, json.as_bytes(), None).map(|_| ())
    }

    /// Dotted key paths of the on-disk shape with their JSON type and
    /// default value (as rendered in `docs/SETTINGS.md`).
    pub fn key_paths() -> Vec<(String, &'static str, String)> {
        let mut json = serde_json::to_value(Settings::default()).unwrap_or_default();
        // `lastVault: null` is a real key on disk.
        if let Some(obj) = json.as_object_mut() {
            obj.entry("lastVault").or_insert(serde_json::Value::Null);
        }
        let mut out = Vec::new();
        flatten("", &json, &mut out);
        out
    }
}

fn flatten(prefix: &str, v: &serde_json::Value, out: &mut Vec<(String, &'static str, String)>) {
    match v {
        serde_json::Value::Object(map) => {
            for (k, val) in map {
                let path = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                flatten(&path, val, out);
            }
        }
        serde_json::Value::Number(n) => out.push((prefix.to_string(), "integer", n.to_string())),
        serde_json::Value::Bool(b) => out.push((prefix.to_string(), "boolean", b.to_string())),
        serde_json::Value::String(s) => out.push((prefix.to_string(), "string", s.clone())),
        serde_json::Value::Null => {
            out.push((prefix.to_string(), "string or null", "null".to_string()))
        }
        serde_json::Value::Array(_) => out.push((prefix.to_string(), "array", v.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_plan_example_shape() {
        let s = Settings::default();
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "version": 1, "language": "system", "appearance": "system",
                "editor": {"fontSize": 16}, "spellcheck": true, "lastVault": null
            })
        );
    }

    #[test]
    fn unknown_keys_are_refused_and_partial_files_default() {
        let err = serde_json::from_str::<Settings>(r#"{"version":1,"theme":"dark"}"#).unwrap_err();
        assert!(err.to_string().contains("unknown field"));
        let err = serde_json::from_str::<Settings>(r#"{"editor":{"fontSize":14,"font":"x"}}"#)
            .unwrap_err();
        assert!(err.to_string().contains("unknown field"));
        let s: Settings = serde_json::from_str(r#"{"version":1,"appearance":"dark"}"#).unwrap();
        assert_eq!(s.appearance, Appearance::Dark);
        assert_eq!(s.editor.font_size, 16);
        assert!(serde_json::from_str::<Settings>(r#"{"language":"fr"}"#).is_err());
    }

    #[test]
    fn load_save_roundtrip_and_missing_file_is_default() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("app/settings.json");
        assert_eq!(Settings::load(&p).unwrap(), Settings::default());
        let s = Settings {
            last_vault: Some("/Users/x/Notizen".into()),
            editor: EditorSettings { font_size: 18 },
            ..Settings::default()
        };
        s.save(&p).unwrap();
        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("\"fontSize\": 18"));
        assert!(raw.ends_with("}\n"));
        assert_eq!(Settings::load(&p).unwrap(), s);
        std::fs::write(&p, "{bad").unwrap();
        assert!(matches!(Settings::load(&p), Err(CoreError::Parse { .. })));
    }

    /// Parity with `docs/SETTINGS.md`: the table between the
    /// `settings-table:start/end` markers must list exactly the struct's
    /// dotted keys with the same type and default.
    #[test]
    fn settings_doc_parity() {
        let doc = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/SETTINGS.md");
        let text = std::fs::read_to_string(&doc)
            .unwrap_or_else(|e| panic!("{} must be readable: {e}", doc.display()));
        let start = text
            .find("<!-- settings-table:start -->")
            .expect("start marker");
        let end = text
            .find("<!-- settings-table:end -->")
            .expect("end marker");
        let mut doc_rows: Vec<(String, String, String)> = Vec::new();
        for line in text[start..end].lines() {
            let cells: Vec<&str> = line.split('|').map(str::trim).collect();
            if cells.len() < 6 || !cells[1].starts_with('`') {
                continue;
            }
            let key = cells[1].trim_matches('`').to_string();
            let ty = cells[3].to_string();
            let default = cells[5].trim_matches('`').to_string();
            doc_rows.push((key, ty, default));
        }
        doc_rows.sort();
        let mut struct_rows: Vec<(String, String, String)> = Settings::key_paths()
            .into_iter()
            .map(|(k, t, d)| (k, t.to_string(), d))
            .collect();
        struct_rows.sort();
        assert_eq!(
            doc_rows, struct_rows,
            "docs/SETTINGS.md table and the Settings struct disagree (key, type, default)"
        );
    }
}
