//! The one list of what novalis lists and opens (PLAN.md §7.3, ADR-0022).
//!
//! The shell decides what a typed name becomes (ADR-0014) and the UI decides
//! what the tree draws (ADR-0015); both used to keep their own copy of the
//! same list by hand, with nothing to tell them apart when they drifted. Now
//! this table is the list, and [`export_ts`] writes it to
//! `ui/src/lib/fileTypes.generated.ts` next to the IPC bindings, regenerated
//! by the same example and diffed by the same CI step. How a kind is drawn —
//! wrap, line numbers, grammar, viewer, MIME — stays in the UI, which is the
//! only side that needs to know.

/// What the app does with a file of this type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A note: the cache, links, backlinks and the CLI know it. `.md` only —
    /// the core recognises a note by exactly that extension (`is_note_name`).
    Note,
    /// Opens in the editor as text; created by the New Note dialog when typed.
    Text,
    /// Opens read-only in the viewer (ADR-0015/0016); never created empty.
    View,
}

/// How a file is recognised: by its lower-case extension, or by its whole
/// file name when it has no extension worth the name (`Makefile`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    Ext(&'static str),
    Name(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileType {
    pub key: Key,
    pub kind: Kind,
}

const fn ext(ext: &'static str, kind: Kind) -> FileType {
    FileType {
        key: Key::Ext(ext),
        kind,
    }
}

const fn name(name: &'static str, kind: Kind) -> FileType {
    FileType {
        key: Key::Name(name),
        kind,
    }
}

/// PLAN.md §7.3 tiers A–D as shipped; the order is the table's.
pub const FILE_TYPES: &[FileType] = &[
    // Tier A (Lezer grammars, lazy)
    ext("md", Kind::Note),
    ext("markdown", Kind::Text),
    ext("txt", Kind::Text),
    ext("text", Kind::Text),
    ext("json", Kind::Text),
    ext("map", Kind::Text),
    ext("yaml", Kind::Text),
    ext("yml", Kind::Text),
    ext("toml", Kind::Text),
    ext("xml", Kind::Text),
    ext("svg", Kind::Text),
    ext("html", Kind::Text),
    ext("htm", Kind::Text),
    ext("css", Kind::Text),
    ext("js", Kind::Text),
    ext("mjs", Kind::Text),
    ext("cjs", Kind::Text),
    ext("jsx", Kind::Text),
    ext("ts", Kind::Text),
    ext("mts", Kind::Text),
    ext("cts", Kind::Text),
    ext("tsx", Kind::Text),
    ext("py", Kind::Text),
    ext("rs", Kind::Text),
    // Tier B (legacy stream modes)
    ext("sh", Kind::Text),
    ext("bash", Kind::Text),
    ext("zsh", Kind::Text),
    ext("ini", Kind::Text),
    ext("conf", Kind::Text),
    ext("cfg", Kind::Text),
    ext("properties", Kind::Text),
    ext("env", Kind::Text),
    ext("swift", Kind::Text),
    name("Dockerfile", Kind::Text),
    // Tier C (plain)
    ext("csv", Kind::Text),
    ext("tsv", Kind::Text),
    ext("log", Kind::Text),
    name("LICENSE", Kind::Text),
    name("Makefile", Kind::Text),
    // Tier D (view, ADR-0015/0016)
    ext("pdf", Kind::View),
    ext("png", Kind::View),
    ext("jpg", Kind::View),
    ext("jpeg", Kind::View),
    ext("gif", Kind::View),
    ext("webp", Kind::View),
];

/// Whether a typed name keeps this (lower-case) extension in `create_note`
/// (ADR-0014): the extensions the editor opens. A viewer type cannot be
/// created empty.
pub fn is_creatable_ext(ext: &str) -> bool {
    FILE_TYPES
        .iter()
        .any(|t| t.kind != Kind::View && matches!(t.key, Key::Ext(e) if e == ext))
}

/// The TypeScript module the UI reads: two maps, extension → kind and
/// file name → kind, in the table's order. Keys are quoted so a row like
/// `c++` or `.bashrc` needs no special case when it comes.
pub fn export_ts() -> String {
    let kind = |k: Kind| match k {
        Kind::Note => "note",
        Kind::Text => "text",
        Kind::View => "view",
    };
    let mut out = String::from(
        "// This file has been generated from the desktop crate's `file_types.rs`. Do not edit it manually;\n\
         // regenerate with `cargo run -p novalis-desktop --example gen_bindings` (PLAN.md §7.3, ADR-0022).\n\n\
         export type FileKind = \"note\" | \"text\" | \"view\";\n\n\
         /** Lower-case extension → what the app does with the file. */\n\
         export const EXTENSION_KINDS: Readonly<Record<string, FileKind>> = {\n",
    );
    for t in FILE_TYPES {
        if let Key::Ext(e) = t.key {
            out.push_str(&format!("  \"{e}\": \"{}\",\n", kind(t.kind)));
        }
    }
    out.push_str(
        "};\n\n\
         /** Whole file name → kind, for files that have no extension worth the name. */\n\
         export const NAME_KINDS: Readonly<Record<string, FileKind>> = {\n",
    );
    for t in FILE_TYPES {
        if let Key::Name(n) = t.key {
            out.push_str(&format!("  \"{n}\": \"{}\",\n", kind(t.kind)));
        }
    }
    out.push_str("};\n");
    out
}

#[cfg(test)]
mod tests {
    use super::{export_ts, is_creatable_ext, Key, Kind, FILE_TYPES};

    /// The invariants the UI and `creatable_name` rely on: extensions are
    /// lower-case and dot-free, every key is unique, and `md` is the only
    /// note, because the core knows no other.
    #[test]
    fn the_table_is_well_formed() {
        let mut seen = std::collections::HashSet::new();
        for t in FILE_TYPES {
            match t.key {
                Key::Ext(e) => {
                    assert!(!e.is_empty() && !e.contains('.'), "{e:?}");
                    assert_eq!(e, e.to_ascii_lowercase(), "{e:?}");
                    assert!(seen.insert(format!("ext:{e}")), "duplicate extension {e:?}");
                }
                Key::Name(n) => {
                    assert!(!n.is_empty() && !n.contains('/'), "{n:?}");
                    assert!(seen.insert(format!("name:{n}")), "duplicate name {n:?}");
                }
            }
            assert!(
                t.kind != Kind::Note || t.key == Key::Ext("md"),
                "only .md is a note: {:?}",
                t.key
            );
        }
        assert!(FILE_TYPES.iter().any(|t| t.kind == Kind::Note));
    }

    #[test]
    fn creatable_is_every_text_extension_and_no_viewer_type() {
        for e in ["md", "txt", "json", "swift", "log"] {
            assert!(is_creatable_ext(e), "{e}");
        }
        for e in ["pdf", "png", "wav", "MD", "", "docx"] {
            assert!(!is_creatable_ext(e), "{e}");
        }
    }

    /// The generated module is a valid object literal per map and names
    /// every row once.
    #[test]
    fn the_typescript_export_carries_every_row() {
        let ts = export_ts();
        assert!(ts.starts_with("// This file has been generated"));
        for t in FILE_TYPES {
            let (key, kind) = match (t.key, t.kind) {
                (Key::Ext(e), Kind::Note) => (e, "note"),
                (Key::Ext(e), Kind::Text) | (Key::Name(e), Kind::Text) => (e, "text"),
                (Key::Ext(e), Kind::View) | (Key::Name(e), Kind::View) => (e, "view"),
                (Key::Name(n), Kind::Note) => (n, "note"),
            };
            let line = format!("  \"{key}\": \"{kind}\",\n");
            assert_eq!(ts.matches(&line).count(), 1, "{line:?}");
        }
    }
}
