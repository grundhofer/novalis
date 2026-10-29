//! The Rust half of PLAN.md §5.8: the native menu reads its labels from the
//! same `i18n/en.json` / `i18n/de.json` the UI uses.
//!
//! The catalogs are embedded at build time and parsed at startup. Embedding
//! rather than bundling them as resources keeps a shipped `.app` from having a
//! second, editable copy of the strings that could drift from the UI's.
//!
//! English is written in sentence case, like every other surface (sebaro
//! spec/07 §3 rule 10). Only the native macOS menus keep Apple's title case
//! (ADR-0051 #27 point 11) and Apple's „…“ right after the word („Move
//! To…“; sebaro D102 (21), spec/07 §3 rule 10), and this catalog serves
//! nothing but those menus, so it applies both here, once, instead of the
//! catalog carrying a second spelling of every shared label.

use std::collections::BTreeMap;

use novalis_core::settings::Language;

const EN: &str = include_str!("../../../../i18n/en.json");
const DE: &str = include_str!("../../../../i18n/de.json");

/// A flat `namespace.key` → text map.
#[derive(Debug, Clone)]
pub struct Catalog {
    map: BTreeMap<String, String>,
    fallback: BTreeMap<String, String>,
    /// English only: the product name, which title case leaves as written.
    title_case: Option<String>,
}

fn parse(source: &str) -> BTreeMap<String, String> {
    serde_json::from_str(source).unwrap_or_default()
}

impl Catalog {
    pub fn load(locale: &'static str) -> Self {
        let fallback = parse(EN);
        let (map, title_case) = match locale {
            "de" => (parse(DE), None),
            _ => {
                let product = fallback.get("app.name").cloned().unwrap_or_default();
                (fallback.clone(), Some(product))
            }
        };
        Catalog {
            map,
            fallback,
            title_case,
        }
    }

    /// The menu label for `key`, in title case and with Apple's unspaced „…“
    /// when the menu is English. A
    /// missing key falls back to English and then to the key itself — a
    /// visible `menu.file.title` in the menu bar is a louder bug report than
    /// a blank item.
    pub fn t(&self, key: &str) -> String {
        let text = self
            .map
            .get(key)
            .or_else(|| self.fallback.get(key))
            .cloned()
            .unwrap_or_else(|| key.to_string());
        match &self.title_case {
            Some(product) => title_case(&text, product)
                .replace("\u{a0}…", "…")
                .replace(" …", "…"),
            None => text,
        }
    }
}

/// Words that stay small inside a title: articles, short conjunctions and
/// prepositions of four letters or fewer (Apple's rule for menu items).
const SMALL_WORDS: &[&str] = &[
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on",
    "onto", "or", "the", "to", "via", "with",
];

/// „Move to Trash …“ → „Move to Trash …“, „Light or dark“ → „Light or
/// Dark“, „Move to …“ → „Move To …“: every word starts with a capital except
/// the small words inside the label. „…“ is no word, so the last word before
/// it is the last one. The product name stays lower case (spec/07 §3 rule 10).
fn title_case(text: &str, product: &str) -> String {
    let words: Vec<&str> = text.split(' ').collect();
    let last = words
        .iter()
        .rposition(|word| word.chars().any(char::is_alphanumeric));
    words
        .iter()
        .enumerate()
        .map(|(index, word)| {
            let inner = index != 0 && Some(index) != last;
            if *word == product || (inner && SMALL_WORDS.contains(word)) {
                return (*word).to_string();
            }
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
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

    /// The English catalog is in sentence case; the menu bar shows Apple's
    /// title case, and the German menu is left as written (ADR-0051).
    #[test]
    fn the_english_menu_is_in_title_case() {
        let en = Catalog::load("en");
        assert_eq!(en.t("menu.edit.moveTo"), "Move To…");
        assert_eq!(en.t("menu.edit.moveToTrash"), "Move to Trash…");
        assert_eq!(en.t("menu.edit.find"), "Find…");
        assert_eq!(en.t("menu.file.newNoteItem"), "New Note…");
        assert_eq!(en.t("menu.window.moveTabEarlier"), "Move Tab Left");
        assert_eq!(en.t("menu.view.fullScreen"), "Toggle Full Screen");
        assert_eq!(en.t("menu.file.revealInFinder"), "Show in Finder");
        assert_eq!(en.t("menu.file.todayNote"), "Today’s Note");
        assert_eq!(en.t("menu.view.appearance"), "Light or Dark");
        assert_eq!(en.t("settings.appearance.system"), "Like the System");
        assert_eq!(en.t("board.createNote"), "Create Note from Card");
        assert_eq!(en.t("board.linkNote"), "Link Note…");
        assert_eq!(en.t("menu.app.quit"), "Quit novalis");
        // The catalog keeps „…“ to its word with U+00A0 (spec/07 §3 rule 6).
        assert_eq!(map(EN)["menu.edit.moveTo"], "Move to\u{a0}…");
        let de = Catalog::load("de");
        assert_eq!(
            de.t("menu.file.reopenClosedTab"),
            "Geschlossenen Reiter wieder öffnen"
        );
        assert_eq!(de.t("menu.view.appearance"), "Hell oder Dunkel");
    }

    /// A board goes to the Trash, and its „Mehr“ says so; a column and a card
    /// are deleted (ADR-0051 #45, AKT-08).
    #[test]
    fn deleting_a_board_says_trash() {
        let (en, de) = (map(EN), map(DE));
        assert_eq!(en["board.deleteBoard"], "Move board to Trash\u{a0}…");
        assert_eq!(
            de["board.deleteBoard"],
            "Board in den Papierkorb legen\u{a0}…"
        );
        assert_eq!(de["board.deleteColumn"], "Spalte löschen\u{a0}…");
        assert_eq!(de["board.deleteCard"], "Karte löschen\u{a0}…");
    }

    #[test]
    fn every_menu_key_the_shell_asks_for_exists() {
        let en = Catalog::load("en");
        let de = Catalog::load("de");
        for key in crate::menu::MENU_KEYS
            .iter()
            .chain(&crate::menu::layout_keys())
        {
            assert_ne!(en.t(key), *key, "{key} missing from en.json");
            assert_ne!(de.t(key), *key, "{key} missing from de.json");
        }
    }
}
