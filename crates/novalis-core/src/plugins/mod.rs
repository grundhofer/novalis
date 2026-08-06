//! Plugin registry. Plugins are folders under `<vault>/.novalis/plugins/<id>/`
//! containing a `plugin.json` manifest and an entry script (default `main.js`).
//! The frontend loads enabled plugins into sandboxed Web Workers; this module
//! discovers them, stores what the user granted each one, and reads their
//! source.
//!
//! The grant store is the half of the capability model a plugin cannot write:
//! `plugin.json` says what a plugin *asks for*, `plugins-enabled.json` says
//! what the user *allowed*, and the frontend enforces the intersection before
//! every host call. Without the second half a manifest would be both the
//! request and the answer.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::error::{CoreError, CoreResult};
use crate::models::{PluginInfo, PluginManifest};

/// Generation of the `novalis` host API this build provides. Bump it only for
/// a change that breaks a plugin written against the previous one (a removed
/// method, a changed argument); purely additive changes keep the number.
/// Exported to TypeScript as a specta constant so `pluginStore.reload()` can
/// refuse an incompatible plugin *before* its source becomes a live Worker.
pub const PLUGIN_API_VERSION: u32 = 1;

/// Every capability the host understands, and the single source of truth for
/// that set. Exported to TypeScript as a specta constant: `pluginStore.ts`
/// types its method→capability table against it, and its test asserts the two
/// sides are equal — so a capability that is enforced but undocumented (or
/// documented but unenforced) fails a gate instead of misleading a plugin
/// author into writing a plugin that dies at runtime.
pub const PLUGIN_CAPABILITIES: [&str; 5] = [
    "notes:read",
    "notes:write",
    "tasks:read",
    "tasks:write",
    "search",
];

fn plugins_dir(vault: &Path) -> PathBuf {
    vault.join(crate::vault::config::CONFIG_DIR).join("plugins")
}

fn enabled_path(vault: &Path) -> PathBuf {
    vault
        .join(crate::vault::config::CONFIG_DIR)
        .join("plugins-enabled.json")
}

/// On-disk shape of `.novalis/plugins-enabled.json`.
#[derive(Deserialize)]
#[serde(untagged)]
enum EnabledFile {
    /// Current format: enabled plugin id -> capabilities the user granted it.
    Grants(BTreeMap<String, Vec<String>>),
    /// Pre-consent format: a bare list of enabled ids, no grants. Migrated by
    /// [`list`] the first time it sees one.
    Legacy(Vec<String>),
}

/// Returns the grant map plus whether it came from the legacy list format
/// (which the caller must migrate — the grants are empty until it does).
fn read_grants(vault: &Path) -> (BTreeMap<String, Vec<String>>, bool) {
    match std::fs::read_to_string(enabled_path(vault))
        .ok()
        .and_then(|s| serde_json::from_str::<EnabledFile>(&s).ok())
    {
        Some(EnabledFile::Grants(map)) => (map, false),
        Some(EnabledFile::Legacy(ids)) => {
            (ids.into_iter().map(|id| (id, Vec::new())).collect(), true)
        }
        None => (BTreeMap::new(), false),
    }
}

fn write_grants(vault: &Path, grants: &BTreeMap<String, Vec<String>>) -> CoreResult<()> {
    let path = enabled_path(vault);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(grants).map_err(|e| CoreError::Serde(e.to_string()))?;
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

/// Discover all plugins (each with its enabled flag and granted capabilities),
/// sorted by name.
///
/// Migrates a legacy `plugins-enabled.json` in passing — a read that writes,
/// deliberately: this is the only place that sees both the old file and the
/// manifests it has to be reconciled against, and it runs on vault open. An
/// enabled id whose folder is currently missing keeps its (empty) entry, so it
/// stays enabled but ungranted and the user is asked once the folder is back.
pub fn list(vault: &Path) -> Vec<PluginInfo> {
    let (mut grants, legacy) = read_grants(vault);
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
            let is_enabled = grants.contains_key(&manifest.id);
            // Under the legacy format the manifest *was* the grant, so carry
            // exactly that forward once. Anything the plugin adds to its
            // manifest afterwards needs a fresh consent.
            if legacy && is_enabled {
                let carried: Vec<String> = manifest
                    .capabilities
                    .iter()
                    .filter(|c| PLUGIN_CAPABILITIES.contains(&c.as_str()))
                    .cloned()
                    .collect();
                grants.insert(manifest.id.clone(), carried);
            }
            let granted = if is_enabled {
                grants.get(&manifest.id).cloned().unwrap_or_default()
            } else {
                Vec::new()
            };
            out.push(PluginInfo {
                manifest,
                enabled: is_enabled,
                granted_capabilities: granted,
            });
        }
    }

    if legacy {
        if let Err(e) = write_grants(vault, &grants) {
            log::warn!("could not migrate plugins-enabled.json: {e}");
        }
    }

    out.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    out
}

/// Enable a plugin with an explicit user-granted capability set, or disable it
/// (which drops the grants — re-enabling asks again).
///
/// `granted` is rejected rather than trimmed when it exceeds what the manifest
/// asks for or names something the host does not implement: both mean the
/// caller and this module disagree about the model, and silently narrowing the
/// set would hide that behind a plugin that mysteriously loses access.
pub fn set_enabled(vault: &Path, id: &str, enabled: bool, granted: &[String]) -> CoreResult<()> {
    let id = safe_id(id)?;
    let (mut grants, _) = read_grants(vault);
    if enabled {
        let manifest = read_manifest(vault, id)?;
        if let Some(unknown) = granted
            .iter()
            .find(|c| !PLUGIN_CAPABILITIES.contains(&c.as_str()))
        {
            return Err(CoreError::BadRequest(format!(
                "Unknown plugin capability: {unknown}"
            )));
        }
        if let Some(extra) = granted
            .iter()
            .find(|c| !manifest.capabilities.iter().any(|d| d == *c))
        {
            return Err(CoreError::BadRequest(format!(
                "Plugin {id} never requested capability: {extra}"
            )));
        }
        let mut deduped: Vec<String> = Vec::with_capacity(granted.len());
        for cap in granted {
            if !deduped.contains(cap) {
                deduped.push(cap.clone());
            }
        }
        grants.insert(id.to_string(), deduped);
    } else {
        grants.remove(id);
    }
    write_grants(vault, &grants)
}

fn read_manifest(vault: &Path, id: &str) -> CoreResult<PluginManifest> {
    let path = plugins_dir(vault).join(id).join("plugin.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|_| CoreError::NotFound(format!("Plugin not found: {id}")))?;
    Ok(serde_json::from_str(&text)?)
}

/// Read a plugin's entry-script source (path-safe).
pub fn read_source(vault: &Path, id: &str) -> CoreResult<String> {
    let id = safe_id(id)?;
    let dir = plugins_dir(vault).join(id);
    let manifest = read_manifest(vault, id)?;
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
        write_plugin_caps(vault, id, name, r#"["notes:read"]"#);
    }

    fn write_plugin_caps(vault: &Path, id: &str, name: &str, caps: &str) {
        let dir = plugins_dir(vault).join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("plugin.json"),
            format!(r#"{{"id":"{id}","name":"{name}","entry":"main.js","capabilities":{caps}}}"#),
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
        assert!(plugins[0].granted_capabilities.is_empty());

        set_enabled(&v, "word-count", true, &["notes:read".to_string()]).unwrap();
        let plugins = list(&v);
        assert!(plugins[0].enabled);
        assert_eq!(plugins[0].granted_capabilities, vec!["notes:read"]);

        let src = read_source(&v, "word-count").unwrap();
        assert!(src.contains("export default"));

        set_enabled(&v, "word-count", false, &[]).unwrap();
        assert!(!list(&v)[0].enabled);

        std::fs::remove_dir_all(&v).ok();
    }

    #[test]
    fn rejects_unsafe_id() {
        let v = vault();
        assert!(read_source(&v, "../secrets").is_err());
        assert!(set_enabled(&v, "a/b", true, &[]).is_err());
    }

    /// The point of the grant store: enabling grants a subset, and the rest
    /// stays ungranted no matter what the manifest asks for.
    #[test]
    fn grants_only_what_the_user_picked() {
        let v = vault();
        write_plugin_caps(&v, "partial", "Partial", r#"["notes:read","notes:write"]"#);

        set_enabled(&v, "partial", true, &["notes:read".to_string()]).unwrap();
        assert_eq!(list(&v)[0].granted_capabilities, vec!["notes:read"]);

        std::fs::remove_dir_all(&v).ok();
    }

    /// A grant may never exceed the manifest, and may never name a capability
    /// the host does not implement — both are caller bugs, so they fail loudly.
    #[test]
    fn rejects_grants_beyond_the_manifest() {
        let v = vault();
        write_plugin_caps(&v, "greedy", "Greedy", r#"["notes:read"]"#);

        assert!(set_enabled(&v, "greedy", true, &["notes:write".to_string()]).is_err());
        assert!(set_enabled(&v, "greedy", true, &["notify".to_string()]).is_err());
        // Nothing was written, so the plugin is still disabled.
        assert!(!list(&v)[0].enabled);

        std::fs::remove_dir_all(&v).ok();
    }

    /// Enabling a plugin that isn't installed can't be consented to.
    #[test]
    fn rejects_enabling_an_unknown_plugin() {
        let v = vault();
        assert!(set_enabled(&v, "ghost", true, &[]).is_err());
        std::fs::remove_dir_all(&v).ok();
    }

    /// Vaults written before the consent model hold a bare id list. The
    /// manifest was the grant then, so migration carries exactly that forward
    /// (dropping capabilities the host never implemented) rather than
    /// silently re-granting whatever the manifest says today.
    #[test]
    fn migrates_the_legacy_enabled_list() {
        let v = vault();
        write_plugin_caps(&v, "old", "Old", r#"["notes:read","tasks:write","notify"]"#);
        std::fs::create_dir_all(v.join(crate::vault::config::CONFIG_DIR)).unwrap();
        std::fs::write(enabled_path(&v), r#"["old"]"#).unwrap();

        let plugins = list(&v);
        assert!(plugins[0].enabled);
        assert_eq!(
            plugins[0].granted_capabilities,
            vec!["notes:read", "tasks:write"]
        );

        // The migration is persisted, so the next read is already in the new
        // format: a manifest that now asks for more no longer widens the grant.
        write_plugin_caps(&v, "old", "Old", r#"["notes:read","notes:write"]"#);
        assert_eq!(
            list(&v)[0].granted_capabilities,
            vec!["notes:read", "tasks:write"]
        );

        std::fs::remove_dir_all(&v).ok();
    }

    /// `api_version` is optional so manifests written before it existed keep
    /// parsing; absent means "unversioned" here and the frontend decides what
    /// that is compatible with.
    #[test]
    fn api_version_is_optional() {
        let v = vault();
        write_plugin(&v, "unversioned", "Unversioned");
        assert_eq!(list(&v)[0].manifest.api_version, None);

        let dir = plugins_dir(&v).join("versioned");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("plugin.json"),
            r#"{"id":"versioned","name":"Versioned","apiVersion":1}"#,
        )
        .unwrap();
        let plugins = list(&v);
        let versioned = plugins
            .iter()
            .find(|p| p.manifest.id == "versioned")
            .unwrap();
        assert_eq!(versioned.manifest.api_version, Some(PLUGIN_API_VERSION));

        std::fs::remove_dir_all(&v).ok();
    }
}
