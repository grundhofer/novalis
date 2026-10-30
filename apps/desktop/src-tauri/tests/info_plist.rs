//! The bundle's own `Info.plist`, which Tauri merges into the app's
//! (ADR-0051 #55, sebaro D108 (3), spec/09 §13.1): it names the two
//! languages of `i18n/`, so the items macOS adds to the menus (writing
//! tools, dictation, window arrangement) stand in the system's language
//! instead of English in a German menu. Its development region is the
//! fallback language, English (sebaro D111 (1)): for a system language
//! novalis does not have, macOS's items stand in English beside the app's
//! English texts. Read as text, as the bundler does.

use std::path::Path;

#[test]
fn info_plist_names_the_app_languages() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Info.plist");
    let text = std::fs::read_to_string(&path).expect("read Info.plist");
    let key = text
        .find("<key>CFBundleLocalizations</key>")
        .expect("CFBundleLocalizations in Info.plist");
    let rest = &text[key..];
    let array = &rest[..rest.find("</array>").expect("its array")];
    let languages: Vec<&str> = array
        .split("<string>")
        .skip(1)
        .map(|part| part.split("</string>").next().unwrap_or_default())
        .collect();
    assert_eq!(languages, ["de", "en"]);
    // The same languages as the catalogs the app ships.
    let i18n = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../i18n");
    for language in languages {
        assert!(
            i18n.join(format!("{language}.json")).is_file(),
            "i18n/{language}.json"
        );
    }
}

#[test]
fn info_plist_names_the_fallback_language_as_development_region() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Info.plist");
    let text = std::fs::read_to_string(&path).expect("read Info.plist");
    let key = text
        .find("<key>CFBundleDevelopmentRegion</key>")
        .expect("CFBundleDevelopmentRegion in Info.plist");
    let rest = &text[key..];
    let value = rest
        .split("<string>")
        .nth(1)
        .and_then(|part| part.split("</string>").next())
        .expect("its string");
    assert_eq!(value, "en");
    // The UI's fallback language says the same.
    let ui = Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/i18n.ts");
    let source = std::fs::read_to_string(&ui).expect("read i18n.ts");
    assert!(
        source.contains("fallbackLng: \"en\""),
        "fallbackLng in i18n.ts"
    );
}
