//! Keymap parity (CLAUDE.md, `docs/KEYMAP.md`): the table between the
//! `keymap-table` markers in `docs/KEYMAP.md` is the contract, and the app's
//! table in `apps/desktop/ui/src/lib/keymap.ts` must mirror it exactly — same
//! chords, same command id per chord, same scope.
//!
//! Both files are parsed as text: the doc table is Markdown, the app table is
//! TypeScript, and this crate is the one that owns the native menu built from
//! the same command ids, so the comparison lives here rather than in
//! `novalis-core` (which knows nothing about the UI).
//!
//! `unbound` and `system` are markers, not ids: the chord must not appear in
//! the app's table at all (see the "Not listed" section of the doc).
//!
//! The `sebaro` column names the fixed row of sebaro's shortcut table
//! (spec/02 §4.19) a chord fulfils, or `system` for a chord macOS keeps; it
//! is compared with `SEBARO_FIXED` in `keymap.ts`, the app's copy of those
//! rows, which also decides what a control marks as its own shortcut.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// The chords that may bind a command a second time, each named: `⇧⌘P` stays
/// the palette's chord beside sebaro's `⌘K` (ADR-0051), and `⌃⌘←` / `⌃⌘→` are
/// Back / Forward where a text field keeps `⌘←` / `⌘→` (D102 (14), ADR-0051
/// #36).
const SECOND_CHORDS: &[(&str, &str)] = &[
    ("Shift+Cmd+P", "palette.open"),
    ("Ctrl+Cmd+Left", "nav.back"),
    ("Ctrl+Cmd+Right", "nav.forward"),
];

fn repo(rel: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(rel)
}

fn read(rel: &str) -> String {
    let p = repo(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} must be readable: {e}", p.display()))
}

/// The doc table's rows: chord, command, scope, the `sebaro` cell.
fn doc_rows() -> Vec<[String; 4]> {
    let text = read("docs/KEYMAP.md");
    let start = text
        .find("<!-- keymap-table:start -->")
        .expect("keymap-table:start marker");
    let end = text
        .find("<!-- keymap-table:end -->")
        .expect("keymap-table:end marker");
    let mut rows = Vec::new();
    for line in text[start..end].lines() {
        let cells: Vec<&str> = line.split('|').map(str::trim).collect();
        // | Chord | Glyphs | Command | Scope | sebaro | Origin |  -> 8 cells
        // with the empty ones the leading and trailing pipe produce.
        if cells.len() < 8 || !cells[1].starts_with('`') {
            continue;
        }
        rows.push([
            cells[1].trim_matches('`').to_string(),
            cells[3].trim_matches('`').to_string(),
            cells[4].to_string(),
            cells[5].trim_matches('`').to_string(),
        ]);
    }
    rows
}

/// The doc table: `chord -> (command, scope)` plus the chords marked
/// `unbound` / `system`.
fn doc_table() -> (BTreeMap<String, (String, String)>, Vec<String>) {
    let mut bound = BTreeMap::new();
    let mut unbound = Vec::new();
    for [chord, command, scope, _] in doc_rows() {
        if command == "unbound" || command == "system" {
            unbound.push(chord);
        } else {
            assert!(
                bound.insert(chord.clone(), (command, scope)).is_none(),
                "docs/KEYMAP.md lists `{chord}` twice"
            );
        }
    }
    assert!(
        bound.len() > 40,
        "docs/KEYMAP.md parsed to only {} rows — did the table format change?",
        bound.len()
    );
    (bound, unbound)
}

/// The app table in `keymap.ts`, parsed from the `KEYMAP` array literal.
fn app_table() -> BTreeMap<String, (String, String)> {
    let text = read("apps/desktop/ui/src/lib/keymap.ts");
    let start = text
        .find("export const KEYMAP")
        .expect("the KEYMAP array in keymap.ts");
    let end = text[start..]
        .find("];")
        .expect("the end of the KEYMAP array")
        + start;
    let mut out = BTreeMap::new();
    for entry in text[start..end].split("{ chord:").skip(1) {
        let chord = quoted(entry, "").expect("a chord string");
        let command = quoted(entry, "command:").expect("a command string");
        let scope = quoted(entry, "scope:").expect("a scope string");
        assert!(
            out.insert(chord.clone(), (command, scope)).is_none(),
            "keymap.ts binds `{chord}` twice"
        );
    }
    out
}

/// The first double-quoted string after `field` in `entry`, with the TS escapes
/// the keymap uses (`\\` for a literal backslash) resolved.
fn quoted(entry: &str, field: &str) -> Option<String> {
    let rest = if field.is_empty() {
        entry
    } else {
        &entry[entry.find(field)? + field.len()..]
    };
    let rest = &rest[rest.find('"')? + 1..];
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some(out),
            '\\' => out.push(chars.next()?),
            _ => out.push(c),
        }
    }
    None
}

#[test]
fn the_app_keymap_matches_the_documented_one() {
    let (doc, markers) = doc_table();
    let app = app_table();

    let mut problems: Vec<String> = Vec::new();
    for (chord, (command, scope)) in &doc {
        match app.get(chord) {
            None => problems.push(format!("`{chord}` ({command}) is documented but not bound")),
            Some((c, s)) if c != command || s != scope => problems.push(format!(
                "`{chord}`: docs say {command}/{scope}, keymap.ts says {c}/{s}"
            )),
            Some(_) => {}
        }
    }
    for chord in app.keys() {
        if !doc.contains_key(chord) {
            problems.push(format!(
                "`{chord}` is bound in keymap.ts but missing from docs/KEYMAP.md"
            ));
        }
    }
    for chord in &markers {
        if app.contains_key(chord) {
            problems.push(format!(
                "`{chord}` is marked unbound/system in docs/KEYMAP.md but bound in keymap.ts"
            ));
        }
    }
    assert!(
        problems.is_empty(),
        "keymap drift:\n  {}",
        problems.join("\n  ")
    );
}

#[test]
fn every_chord_and_command_is_unique() {
    let (doc, markers) = doc_table();
    let mut seen: BTreeMap<&str, &str> = BTreeMap::new();
    for (chord, (command, _)) in &doc {
        if SECOND_CHORDS.contains(&(chord.as_str(), command.as_str())) {
            continue;
        }
        if let Some(other) = seen.insert(command.as_str(), chord.as_str()) {
            panic!("command `{command}` is bound twice: `{other}` and `{chord}`");
        }
    }
    for (chord, command) in SECOND_CHORDS {
        assert!(
            seen.contains_key(command),
            "`{chord}` is the second chord of `{command}`, which has no first one"
        );
        assert_eq!(
            doc.get(*chord).map(|(c, _)| c.as_str()),
            Some(*command),
            "`{chord}` is listed as a second chord of `{command}` but not bound to it"
        );
    }
    for chord in &markers {
        assert!(
            !doc.contains_key(chord),
            "`{chord}` is both bound and marked unbound/system"
        );
    }
}

/// `SEBARO_FIXED` in `keymap.ts`: chord -> the name of sebaro's fixed row.
fn sebaro_fixed() -> BTreeMap<String, String> {
    let text = read("apps/desktop/ui/src/lib/keymap.ts");
    let start = text
        .find("export const SEBARO_FIXED")
        .expect("the SEBARO_FIXED table in keymap.ts");
    let body = &text[start..];
    let body = &body[body.find('{').expect("its start") + 1..body.find("};").expect("its end")];
    let mut out = BTreeMap::new();
    for line in body.lines() {
        let Some((chord, name)) = line.trim().trim_end_matches(',').split_once(": ") else {
            continue;
        };
        let chord = chord.trim_matches('"').to_string();
        let name = name.trim_matches('"').to_string();
        assert!(
            out.insert(chord.clone(), name).is_none(),
            "SEBARO_FIXED lists `{chord}` twice"
        );
    }
    out
}

// sebaro's fixed rows (spec/02 §4.19): a chord of one of them names its row in
// the `sebaro` column, whatever it is bound to (`unbound` rows too, so the doc
// says what the free chord is kept for), and a named row has that chord.
// `system` marks a chord macOS keeps (Quit, Full Screen), never a fixed one.
#[test]
fn the_sebaro_column_names_the_fixed_rows() {
    let fixed = sebaro_fixed();
    let names: std::collections::BTreeSet<&String> = fixed.values().collect();
    assert_eq!(names.len(), 15, "sebaro has 15 fixed rows: {names:?}");

    let mut problems: Vec<String> = Vec::new();
    for [chord, command, _, sebaro] in doc_rows() {
        match (fixed.get(&chord), sebaro.as_str()) {
            (Some(row), named) if named != row => problems.push(format!(
                "`{chord}` ({command}) is sebaro's „{row}“ but the sebaro column says „{named}“"
            )),
            (None, "system") | (None, "") | (Some(_), _) => {}
            (None, named) => problems.push(format!(
                "`{chord}` ({command}) names „{named}“, but it is none of sebaro's fixed chords"
            )),
        }
    }
    assert!(
        problems.is_empty(),
        "sebaro column drift:\n  {}",
        problems.join("\n  ")
    );
}
