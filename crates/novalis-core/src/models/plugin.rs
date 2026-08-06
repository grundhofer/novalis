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
    /// Which host-API generation the plugin was written against
    /// (`crate::plugins::PLUGIN_API_VERSION`). `None` means the manifest
    /// predates the field; the frontend then assumes API 1, which is what
    /// every manifest written before the field existed targeted. New plugins
    /// must set it — see PLUGINS.md, "API version".
    #[serde(default)]
    pub api_version: Option<u32>,
    /// Capabilities the plugin **asks for**. The full set the host understands
    /// is [`crate::plugins::PLUGIN_CAPABILITIES`]; anything else is ignored.
    ///
    /// Asking is not getting: the effective set is this list intersected with
    /// what the user granted ([`PluginInfo::granted_capabilities`]), so a
    /// plugin that widens this list after being enabled gains nothing until
    /// the user consents again.
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
    /// What the *user* granted this plugin, from `plugins-enabled.json` — the
    /// half of the capability check the plugin cannot write. Empty for a
    /// disabled plugin.
    pub granted_capabilities: Vec<String>,
}
