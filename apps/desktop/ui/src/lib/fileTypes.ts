import { EXTENSION_KINDS, NAME_KINDS, type FileKind } from "./fileTypes.generated";
import { extensionOf, fileNameOf } from "./paths";

/**
 * The file types the app handles, PLAN.md §7.3: notes and text open in the
 * editor, tier D (ADR-0015) opens read-only in the viewer. The tree shows
 * nothing else (ADR-0015): a `.wav` next to the notes is not the app's
 * business, and opening it as text was a banner and a wasted read.
 *
 * The list itself is the shell's (`src-tauri/src/file_types.rs`, ADR-0022),
 * written to `fileTypes.generated.ts` by the same run that writes the IPC
 * bindings; the shell decides what a typed name becomes, this module only
 * tells what is listed and how it opens. What stays here is presentation:
 * which viewer a tier-D type gets and the MIME type it is handed with.
 */

/** What the New Note dialog keeps as typed (ADR-0014): every text extension. */
export const CREATABLE_EXTENSIONS: readonly string[] = Object.entries(EXTENSION_KINDS)
  .filter(([, kind]) => kind !== "view")
  .map(([extension]) => extension);

export type ViewKind = "pdf" | "image";

/** Which viewer a tier-D type opens in; every `view` row of the table has one. */
export const VIEW_EXTENSIONS: Readonly<Record<string, ViewKind>> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
};

/** The MIME type the viewer hands the WebView for a tier-D file. */
export const MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * What the app does with this path, or `null` when it is not listed. Own
 * keys only: a file named `constructor` must not find `Object.prototype`.
 */
export function kindOf(rel: string): FileKind | null {
  const extension = extensionOf(rel);
  if (extension) return Object.hasOwn(EXTENSION_KINDS, extension) ? (EXTENSION_KINDS[extension] ?? null) : null;
  const name = fileNameOf(rel);
  return Object.hasOwn(NAME_KINDS, name) ? (NAME_KINDS[name] ?? null) : null;
}

/** How a path opens: in the viewer (tier D), or not at all (`null` = text). */
export function viewKind(rel: string): ViewKind | null {
  return kindOf(rel) === "view" ? (VIEW_EXTENSIONS[extensionOf(rel)] ?? null) : null;
}

export function mimeOf(rel: string): string {
  return MIME[extensionOf(rel)] ?? "application/octet-stream";
}

/** Whether the tree lists this file at all. Folders are always listed. */
export function isSupported(rel: string): boolean {
  return kindOf(rel) !== null;
}
