use serde::{Deserialize, Serialize};
use specta::Type;

/// A plugin's `plugin.json` manifest. Plugins live in
/// `<vault>/.novalis/plugins/<id>/` and run sandboxed in the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_entry")]
    pub entry: String,
    /// Capabilities the plugin may use, e.g. `["notes:read", "notes:write",
    /// "tasks:read", "search", "notify"]`. The host enforces these.
    #[serde(default)]
    pub capabilities: Vec<String>,
}

fn default_entry() -> String {
    "main.js".to_string()
}

/// A discovered plugin plus whether it is enabled.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub enabled: bool,
}
