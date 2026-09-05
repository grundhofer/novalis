//! The Rust half of PLAN.md §5.8: the native menu reads its labels from the
//! same `i18n/en.json` / `i18n/de.json` the UI uses.
//!
//! The catalogs are embedded at build time and parsed at startup. Embedding
//! rather than bundling them as resources keeps a shipped `.app` from having a
//! second, editable copy of the strings that could drift from the UI's.

use std::collections::BTreeMap;

use novalis_core::settings::Language;

const EN: &str = include_str!("../../../../i18n/en.json");
const DE: &str = include_str!("../../../../i18n/de.json");

/// A flat `namespace.key` → text map.
#[derive(Debug, Clone)]
pub struct Catalog {
    map: BTreeMap<String, String>,
    fallback: BTreeMap<String, String>,
}

fn parse(source: &str) -> BTreeMap<String, String> {
    serde_json::from_str(source).unwrap_or_default()
}

impl Catalog {
    pub fn load(locale: &'static str) -> Self {
        let fallback = parse(EN);
        let map = match locale {
            "de" => parse(DE),
            _ => fallback.clone(),
        };
        Catalog { map, fallback }
    }

    /// The string for `key`. A missing key falls back to English and then to
    /// the key itself — a visible `menu.file.title` in the menu bar is a
    /// louder bug report than a blank item.
    pub fn t(&self, key: &str) -> String {
        self.map
            .get(key)
            .or_else(|| self.fallback.get(key))
            .cloned()
            .unwrap_or_else(|| key.to_string())
    }
}

/// Resolve `settings.language` to the locale the menu and the UI both use.
/// `system` follows the macOS per-app language (System Settings ▸ Language &
/// Region); the View ▸ Language menu is the fallback either way (ADR-0004).
pub fn resolve_locale(language: Language) -> &'static str {
    match language {
        Language::De => "de",
        Language::En => "en",
        Language::System => match sys_locale::get_locale() {
            Some(tag) if tag.to_ascii_lowercase().starts_with("de") => "de",
            _ => "en",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{Catalog, DE, EN};
    use std::collections::BTreeMap;

    fn map(source: &str) -> BTreeMap<String, String> {
        serde_json::from_str(source).expect("catalog is a flat string map")
    }

    /// The menu asks for keys by name; a typo there is silent until someone
    /// looks at the menu bar. This is the shell's half of the §5.8 parity
    /// check: both catalogs parse, carry the same keys, and have no empty
    /// values.
    #[test]
    fn catalogs_are_flat_and_in_parity() {
        let en = map(EN);
        let de = map(DE);
        assert!(!en.is_empty());
        let missing: Vec<&String> = en.keys().filter(|k| !de.contains_key(*k)).collect();
        assert!(missing.is_empty(), "missing in de.json: {missing:?}");
        let extra: Vec<&String> = de.keys().filter(|k| !en.contains_key(*k)).collect();
        assert!(extra.is_empty(), "not in en.json: {extra:?}");
        for (key, value) in en.iter().chain(de.iter()) {
            assert!(!value.trim().is_empty(), "{key} is empty");
        }
    }

    #[test]
    fn every_menu_key_the_shell_asks_for_exists() {
        let en = Catalog::load("en");
        let de = Catalog::load("de");
        for key in crate::menu::MENU_KEYS {
            assert_ne!(en.t(key), *key, "{key} missing from en.json");
            assert_ne!(de.t(key), *key, "{key} missing from de.json");
        }
    }
}
