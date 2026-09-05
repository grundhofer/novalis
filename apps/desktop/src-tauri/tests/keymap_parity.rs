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

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn repo(rel: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(rel)
}

fn read(rel: &str) -> String {
    let p = repo(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} must be readable: {e}", p.display()))
}

/// The doc table: `chord -> (command, scope)` plus the chords marked
/// `unbound` / `system`.
fn doc_table() -> (BTreeMap<String, (String, String)>, Vec<String>) {
    let text = read("docs/KEYMAP.md");
    let start = text
        .find("<!-- keymap-table:start -->")
        .expect("keymap-table:start marker");
    let end = text
        .find("<!-- keymap-table:end -->")
        .expect("keymap-table:end marker");
    let mut bound = BTreeMap::new();
    let mut unbound = Vec::new();
    for line in text[start..end].lines() {
        let cells: Vec<&str> = line.split('|').map(str::trim).collect();
        // | Chord | Glyphs | Command | Scope | Origin |  -> 7 cells with the
        // empty ones the leading and trailing pipe produce.
        if cells.len() < 6 || !cells[1].starts_with('`') {
            continue;
        }
        let chord = cells[1].trim_matches('`').to_string();
        let command = cells[3].trim_matches('`').to_string();
        let scope = cells[4].to_string();
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
        if let Some(other) = seen.insert(command.as_str(), chord.as_str()) {
            panic!("command `{command}` is bound twice: `{other}` and `{chord}`");
        }
    }
    for chord in &markers {
        assert!(
            !doc.contains_key(chord),
            "`{chord}` is both bound and marked unbound/system"
        );
    }
}
