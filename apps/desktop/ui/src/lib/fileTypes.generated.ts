// This file has been generated from the desktop crate's `file_types.rs`. Do not edit it manually;
// regenerate with `cargo run -p novalis-desktop --example gen_bindings` (PLAN.md §7.3, ADR-0022).

export type FileKind = "note" | "text" | "view";

/** Lower-case extension → what the app does with the file. */
export const EXTENSION_KINDS: Readonly<Record<string, FileKind>> = {
  "md": "note",
  "markdown": "text",
  "txt": "text",
  "text": "text",
  "json": "text",
  "map": "text",
  "yaml": "text",
  "yml": "text",
  "toml": "text",
  "xml": "text",
  "svg": "text",
  "html": "text",
  "htm": "text",
  "css": "text",
  "js": "text",
  "mjs": "text",
  "cjs": "text",
  "jsx": "text",
  "ts": "text",
  "mts": "text",
  "cts": "text",
  "tsx": "text",
  "py": "text",
  "rs": "text",
  "sh": "text",
  "bash": "text",
  "zsh": "text",
  "ini": "text",
  "conf": "text",
  "cfg": "text",
  "properties": "text",
  "env": "text",
  "swift": "text",
  "csv": "text",
  "tsv": "text",
  "log": "text",
  "pdf": "view",
  "png": "view",
  "jpg": "view",
  "jpeg": "view",
  "gif": "view",
  "webp": "view",
};

/** Whole file name → kind, for files that have no extension worth the name. */
export const NAME_KINDS: Readonly<Record<string, FileKind>> = {
  "Dockerfile": "text",
  "LICENSE": "text",
  "Makefile": "text",
};
