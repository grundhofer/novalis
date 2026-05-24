//! Plugin registry. Plugins are folders under `<vault>/.novalis/plugins/<id>/`
//! containing a `plugin.json` manifest and an entry script (default `main.js`).
//! The frontend loads enabled plugins into sandboxed Web Workers; this module
//! just discovers them, tracks which are enabled, and reads their source.

use std::path::{Path, PathBuf};

use crate::error::{CoreError, CoreResult};
use crate::models::{PluginInfo, PluginManifest};

fn plugins_dir(vault: &Path) -> PathBuf {
    vault.join(crate::vault::config::CONFIG_DIR).join("plugins")
}

fn enabled_path(vault: &Path) -> PathBuf {
    vault
        .join(crate::vault::config::CONFIG_DIR)
        .join("plugins-enabled.json")
}

fn read_enabled(vault: &Path) -> Vec<String> {
    std::fs::read_to_string(enabled_path(vault))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn write_enabled(vault: &Path, ids: &[String]) -> CoreResult<()> {
    let path = enabled_path(vault);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(ids).map_err(|e| CoreError::Serde(e.to_string()))?;
    std::fs::write(path, json)?;
    Ok(())
}

/// Reject ids that could escape the plugins directory.
fn safe_id(id: &str) -> CoreResult<&str> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(CoreError::BadRequest(format!("Invalid plugin id: {id}")));
    }
    Ok(id)
}

/// Discover all plugins (each with its enabled flag), sorted by name.
pub fn list(vault: &Path) -> Vec<PluginInfo> {
    let enabled = read_enabled(vault);
    let mut out = Vec::new();

    if let Ok(entries) = std::fs::read_dir(plugins_dir(vault)) {
        for entry in entries.filter_map(|e| e.ok()) {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let manifest_path = entry.path().join("plugin.json");
            let Ok(text) = std::fs::read_to_string(&manifest_path) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_str::<PluginManifest>(&text) else {
                log::warn!("invalid plugin manifest at {manifest_path:?}");
                continue;
            };
            let is_enabled = enabled.iter().any(|id| id == &manifest.id);
            out.push(PluginInfo {
                manifest,
                enabled: is_enabled,
            });
        }
    }

    out.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    out
}

/// Enable or disable a plugin by id.
pub fn set_enabled(vault: &Path, id: &str, enabled: bool) -> CoreResult<()> {
    let id = safe_id(id)?;
    let mut set = read_enabled(vault);
    set.retain(|x| x != id);
    if enabled {
        set.push(id.to_string());
    }
    write_enabled(vault, &set)
}

/// Read a plugin's entry-script source (path-safe).
pub fn read_source(vault: &Path, id: &str) -> CoreResult<String> {
    let id = safe_id(id)?;
    let dir = plugins_dir(vault).join(id);
    let manifest: PluginManifest = serde_json::from_str(
        &std::fs::read_to_string(dir.join("plugin.json"))
            .map_err(|_| CoreError::NotFound(format!("Plugin not found: {id}")))?,
    )?;
    if manifest.entry.contains("..") || manifest.entry.starts_with('/') {
        return Err(CoreError::BadRequest(
            "Invalid plugin entry path".to_string(),
        ));
    }
    Ok(std::fs::read_to_string(dir.join(&manifest.entry))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> PathBuf {
        std::env::temp_dir().join(format!("novalis-plugins-{}", uuid::Uuid::new_v4()))
    }

    fn write_plugin(vault: &Path, id: &str, name: &str) {
        let dir = plugins_dir(vault).join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("plugin.json"),
            format!(
                r#"{{"id":"{id}","name":"{name}","entry":"main.js","capabilities":["notes:read"]}}"#
            ),
        )
        .unwrap();
        std::fs::write(dir.join("main.js"), "export default () => {};").unwrap();
    }

    #[test]
    fn list_enable_read_cycle() {
        let v = vault();
        write_plugin(&v, "word-count", "Word Count");

        let plugins = list(&v);
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].manifest.id, "word-count");
        assert!(!plugins[0].enabled);

        set_enabled(&v, "word-count", true).unwrap();
        assert!(list(&v)[0].enabled);

        let src = read_source(&v, "word-count").unwrap();
        assert!(src.contains("export default"));

        set_enabled(&v, "word-count", false).unwrap();
        assert!(!list(&v)[0].enabled);

        std::fs::remove_dir_all(&v).ok();
    }

    #[test]
    fn rejects_unsafe_id() {
        let v = vault();
        assert!(read_source(&v, "../secrets").is_err());
        assert!(set_enabled(&v, "a/b", true).is_err());
    }
}
