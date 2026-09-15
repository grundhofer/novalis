import { extensionOf, fileNameOf } from "./paths";

/**
 * The file types the app handles, PLAN.md §7.3: tiers A–C open in the editor
 * as text, tier D (ADR-0015) opens read-only in the viewer. The tree shows
 * nothing else (ADR-0015): a `.wav` next to the notes is not the app's
 * business, and opening it as text was a banner and a wasted read.
 *
 * `CREATABLE_EXTENSIONS` mirrors the shell's list of the same name in
 * `src-tauri/src/commands.rs` (ADR-0014): what the New Note dialog keeps.
 * The two are kept in step by hand; the shell decides, this one only tells.
 */

export const CREATABLE_EXTENSIONS: readonly string[] = [
  "md", "markdown", "txt", "text", "json", "map", "yaml", "yml", "toml", "xml", "svg", "html",
  "htm", "css", "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx", "py", "rs", "sh", "bash",
  "zsh", "ini", "conf", "cfg", "properties", "env", "swift", "csv", "tsv", "log",
];

/** Tier C names without an extension (`.gitignore` is hidden and never listed). */
const TEXT_NAMES: ReadonlySet<string> = new Set(["Dockerfile", "LICENSE", "Makefile"]);

export type ViewKind = "pdf" | "image";

const VIEW_EXTENSIONS: Readonly<Record<string, ViewKind>> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
};

/** The MIME type the viewer hands the WebView for a tier-D file. */
const MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** How a path opens: in the viewer (tier D), or not at all (`null` = text). */
export function viewKind(rel: string): ViewKind | null {
  return VIEW_EXTENSIONS[extensionOf(rel)] ?? null;
}

export function mimeOf(rel: string): string {
  return MIME[extensionOf(rel)] ?? "application/octet-stream";
}

/** Whether the tree lists this file at all. Folders are always listed. */
export function isSupported(rel: string): boolean {
  const extension = extensionOf(rel);
  if (extension) return CREATABLE_EXTENSIONS.includes(extension) || extension in VIEW_EXTENSIONS;
  return TEXT_NAMES.has(fileNameOf(rel));
}
