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

/// How a file is recognised: by its lower-case extension, by its whole file
/// name when it has no extension worth the name (`Makefile`), or by a
/// prefix of the file name with something after it (`Dockerfile.dev`),
/// tried after the other two failed. The UI gets the prefix as an anchored
/// regex; [`kind_of`] is the same lookup in Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    Ext(&'static str),
    Name(&'static str),
    Prefix(&'static str),
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

const fn prefix(prefix: &'static str, kind: Kind) -> FileType {
    FileType {
        key: Key::Prefix(prefix),
        kind,
    }
}

/// PLAN.md §7.3 as shipped, in the order of the plan's table (ADR-0022
/// point 2, docs/research/2026-09-20-formats-plan.md §3.1): every row has a
/// grammar already in the bundle or is plain on purpose. What is not here
/// is not listed — the plan's §3.3 says why, row by row.
pub const FILE_TYPES: &[FileType] = &[
    // Notes and prose
    ext("md", Kind::Note),
    ext("markdown", Kind::Text),
    ext("txt", Kind::Text),
    ext("text", Kind::Text),
    ext("rst", Kind::Text),
    ext("adoc", Kind::Text),
    ext("org", Kind::Text),
    ext("textile", Kind::Text),
    ext("mkd", Kind::Text),
    ext("mdx", Kind::Text),
    ext("rmd", Kind::Text),
    ext("qmd", Kind::Text),
    ext("srt", Kind::Text),
    ext("vtt", Kind::Text),
    ext("tex", Kind::Text),
    ext("ltx", Kind::Text),
    // Data
    ext("json", Kind::Text),
    ext("json5", Kind::Text),
    ext("jsonc", Kind::Text),
    ext("yaml", Kind::Text),
    ext("yml", Kind::Text),
    ext("toml", Kind::Text),
    ext("xml", Kind::Text),
    ext("xsl", Kind::Text),
    ext("xsd", Kind::Text),
    ext("plist", Kind::Text),
    ext("svg", Kind::Text),
    ext("csv", Kind::Text),
    ext("tsv", Kind::Text),
    ext("log", Kind::Text),
    ext("diff", Kind::Text),
    ext("patch", Kind::Text),
    ext("bib", Kind::Text),
    // Configuration
    ext("ini", Kind::Text),
    ext("properties", Kind::Text),
    ext("cfg", Kind::Text),
    ext("env", Kind::Text),
    ext("conf", Kind::Text),
    // Web
    ext("html", Kind::Text),
    ext("htm", Kind::Text),
    ext("css", Kind::Text),
    ext("scss", Kind::Text),
    ext("sass", Kind::Text),
    ext("less", Kind::Text),
    ext("js", Kind::Text),
    ext("mjs", Kind::Text),
    ext("cjs", Kind::Text),
    ext("jsx", Kind::Text),
    ext("ts", Kind::Text),
    ext("mts", Kind::Text),
    ext("cts", Kind::Text),
    ext("tsx", Kind::Text),
    ext("vue", Kind::Text),
    // Scripts and shells
    ext("py", Kind::Text),
    ext("rb", Kind::Text),
    name("Gemfile", Kind::Text),
    name("Rakefile", Kind::Text),
    ext("pl", Kind::Text),
    ext("pm", Kind::Text),
    ext("php", Kind::Text),
    ext("lua", Kind::Text),
    ext("tcl", Kind::Text),
    ext("ps1", Kind::Text),
    ext("sh", Kind::Text),
    ext("bash", Kind::Text),
    ext("zsh", Kind::Text),
    // Systems
    ext("c", Kind::Text),
    ext("h", Kind::Text),
    ext("cpp", Kind::Text),
    ext("cc", Kind::Text),
    ext("cxx", Kind::Text),
    ext("hpp", Kind::Text),
    ext("hh", Kind::Text),
    ext("hxx", Kind::Text),
    ext("rs", Kind::Text),
    ext("go", Kind::Text),
    ext("swift", Kind::Text),
    // JVM and .NET
    ext("java", Kind::Text),
    ext("kt", Kind::Text),
    ext("kts", Kind::Text),
    ext("scala", Kind::Text),
    ext("cs", Kind::Text),
    ext("groovy", Kind::Text),
    ext("gradle", Kind::Text),
    name("Jenkinsfile", Kind::Text),
    // Mobile, functional, Lisp
    ext("dart", Kind::Text),
    ext("hs", Kind::Text),
    ext("ml", Kind::Text),
    ext("mli", Kind::Text),
    ext("elm", Kind::Text),
    ext("erl", Kind::Text),
    ext("clj", Kind::Text),
    ext("cljs", Kind::Text),
    ext("edn", Kind::Text),
    ext("lisp", Kind::Text),
    ext("el", Kind::Text),
    ext("scm", Kind::Text),
    // Science, databases, interfaces
    ext("r", Kind::Text),
    ext("jl", Kind::Text),
    ext("sql", Kind::Text),
    ext("proto", Kind::Text),
    // Build
    ext("dockerfile", Kind::Text),
    name("Dockerfile", Kind::Text),
    name("Containerfile", Kind::Text),
    prefix("Dockerfile.", Kind::Text),
    ext("cmake", Kind::Text),
    name("Makefile", Kind::Text),
    name("GNUmakefile", Kind::Text),
    name("makefile", Kind::Text),
    ext("mk", Kind::Text),
    name("Justfile", Kind::Text),
    name("justfile", Kind::Text),
    // Documentation names
    name("LICENSE", Kind::Text),
    name("README", Kind::Text),
    name("CHANGELOG", Kind::Text),
    name("CONTRIBUTING", Kind::Text),
    name("AUTHORS", Kind::Text),
    name("NOTICE", Kind::Text),
    name("COPYING", Kind::Text),
    name("VERSION", Kind::Text),
    name("TODO", Kind::Text),
    name("CODEOWNERS", Kind::Text),
    // View (ADR-0015/0016, ADR-0023)
    ext("pdf", Kind::View),
    ext("epub", Kind::View),
    ext("cbz", Kind::View),
    ext("png", Kind::View),
    ext("jpg", Kind::View),
    ext("jpeg", Kind::View),
    ext("gif", Kind::View),
    ext("webp", Kind::View),
];

/// What the app does with this vault-relative path, or `None` when the tree
/// does not list it — the UI's `kindOf` in Rust, for what must decide before
/// the UI sees the path (the search limit, ADR-0022 point 5): by the
/// lower-case extension, else by the whole name, else by a prefix.
pub fn kind_of(rel: &str) -> Option<Kind> {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let ext = name
        .rfind('.')
        .filter(|&i| i > 0)
        .map(|i| name[i + 1..].to_ascii_lowercase());
    let by_key = FILE_TYPES.iter().find(|t| match (&ext, t.key) {
        (Some(e), Key::Ext(x)) => x == e,
        (None, Key::Name(n)) => n == name,
        _ => false,
    });
    by_key
        .or_else(|| {
            FILE_TYPES.iter().find(
                |t| matches!(t.key, Key::Prefix(p) if name.len() > p.len() && name.starts_with(p)),
            )
        })
        .map(|t| t.kind)
}

/// The anchored regex source the UI runs for a prefix row: the prefix,
/// escaped, then at least one character.
fn prefix_regex(prefix: &str) -> String {
    let mut out = String::from("^");
    for c in prefix.chars() {
        if r"\.^$|?*+()[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out.push_str(".+$");
    out
}

/// Whether a typed name keeps this (lower-case) extension in `create_note`
/// (ADR-0014): the extensions the editor opens. A viewer type cannot be
/// created empty.
pub fn is_creatable_ext(ext: &str) -> bool {
    FILE_TYPES
        .iter()
        .any(|t| t.kind != Kind::View && matches!(t.key, Key::Ext(e) if e == ext))
}

/// The TypeScript module the UI reads: three maps, extension → kind, file
/// name → kind and pattern source → kind, in the table's order. Keys are
/// quoted so a row like `c++` or `.bashrc` needs no special case when it
/// comes; a prefix row becomes a regex source the UI hands to `RegExp`.
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
    out.push_str(
        "};\n\n\
         /** Regex source over the file name → kind, tried after the two maps. */\n\
         export const PATTERN_KINDS: Readonly<Record<string, FileKind>> = {\n",
    );
    for t in FILE_TYPES {
        if let Key::Prefix(p) = t.key {
            out.push_str(&format!(
                "  \"{}\": \"{}\",\n",
                prefix_regex(p).replace('\\', "\\\\"),
                kind(t.kind)
            ));
        }
    }
    out.push_str("};\n");
    out
}

#[cfg(test)]
mod tests {
    use super::{export_ts, is_creatable_ext, prefix_regex, Key, Kind, FILE_TYPES};

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
                Key::Prefix(p) => {
                    assert!(!p.is_empty() && !p.contains('/'), "{p:?}");
                    assert!(seen.insert(format!("prefix:{p}")), "duplicate prefix {p:?}");
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
        for e in [
            "md", "txt", "json", "swift", "log", "go", "tex", "org", "php",
        ] {
            assert!(is_creatable_ext(e), "{e}");
        }
        for e in ["pdf", "png", "wav", "MD", "", "docx", "map", "m", "1"] {
            assert!(!is_creatable_ext(e), "{e}");
        }
    }

    /// The same cases `fileTypes.test.ts` runs against the UI's `kindOf`:
    /// extension first, the whole name only without one, the prefix last.
    #[test]
    fn kind_of_is_the_ui_lookup() {
        use super::kind_of;
        for path in [
            "a.md",
            "notes/b.txt",
            "Notes.TXT",
            "Makefile",
            "sub/LICENSE",
            "README",
            "main.go",
            "build/Dockerfile.dev",
            "Containerfile",
            "justfile",
            "d.pdf",
        ] {
            assert!(kind_of(path).is_some(), "{path}");
        }
        for path in [
            "song.wav",
            "archive.zip",
            "app.js.map",
            "matrix.m",
            "syslog.1",
            "readme",
            "Dockerfile.",
            "Dockerfiles",
            ".md",
            "a/.txt",
        ] {
            assert!(kind_of(path).is_none(), "{path}");
        }
        assert_eq!(kind_of("Dockerfile.md"), Some(Kind::Note));
        assert_eq!(kind_of("Dockerfile.dev"), Some(Kind::Text));
        assert_eq!(kind_of("e.PNG"), Some(Kind::View));
    }

    /// The generated module is a valid object literal per map and names
    /// every row once.
    #[test]
    fn the_typescript_export_carries_every_row() {
        let ts = export_ts();
        assert!(ts.starts_with("// This file has been generated"));
        for t in FILE_TYPES {
            let kind = match t.kind {
                Kind::Note => "note",
                Kind::Text => "text",
                Kind::View => "view",
            };
            let key = match t.key {
                Key::Ext(k) | Key::Name(k) => k.to_string(),
                Key::Prefix(p) => prefix_regex(p).replace('\\', "\\\\"),
            };
            let line = format!("  \"{key}\": \"{kind}\",\n");
            assert_eq!(ts.matches(&line).count(), 1, "{line:?}");
        }
        assert!(ts.contains("\"^Dockerfile\\\\..+$\": \"text\""), "{ts}");
    }
}
