/**
 * Vault-relative path helpers, mirroring `novalis_core::vault::path`.
 *
 * Every path that crosses IPC is already NFC-normalized and `/`-separated by
 * the core, so these are pure string operations — the UI never builds a path
 * from user input without sending it through a command that validates it.
 */

export function fileNameOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? rel : rel.slice(i + 1);
}

export function folderOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}

export function stemOf(rel: string): string {
  const name = fileNameOf(rel);
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
}

export function extensionOf(rel: string): string {
  const name = fileNameOf(rel);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function joinRel(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

export function isNote(rel: string): boolean {
  return extensionOf(rel) === "md";
}

/**
 * A note or a `.markdown` file: what the ⌘E preview renders and image paste
 * writes next to (ADR-0022 point 6). The Markdown dialects are not in it.
 */
export function isMarkdownFile(rel: string): boolean {
  const extension = extensionOf(rel);
  return extension === "md" || extension === "markdown";
}

/** Every ancestor folder of `rel`, root first. */
export function ancestorsOf(rel: string): string[] {
  const parts = rel.split("/");
  parts.pop();
  const out: string[] = [];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.push(acc);
  }
  return out;
}

/**
 * Nanoseconds (a decimal string, see `EntryDto` in the shell) to milliseconds.
 * The value is far past 2^53, so the conversion is lossy by design: it is only
 * ever used for display. Equality is compared on the string.
 */
export function nsToMs(mtimeNs: string): number {
  const ns = Number(mtimeNs);
  return Number.isFinite(ns) ? Math.round(ns / 1e6) : 0;
}

/**
 * Order two `mtimeNs` strings exactly. They are non-negative decimal integers
 * without leading zeros, so the longer one is the larger and equal lengths
 * compare as text; `Number()` would round them (see `nsToMs`).
 */
export function compareNs(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The sync provider a File Provider vault lives in, for the status bar's
 * „Vault in {{provider}}": the domain folder under `~/Library/CloudStorage`,
 * which macOS names `<Provider>-<account or label>` — `OneDrive-Persönlich`,
 * `GoogleDrive-name@example.com`. The part before the first `-`, spaced where
 * the vendor glues its brand together. `null` for any other path.
 */
export function providerOf(absolutePath: string): string | null {
  const match = /\/Library\/CloudStorage\/([^/]+)/.exec(absolutePath);
  if (!match) return null;
  const domain = match[1]!.split("-")[0]!;
  return domain === "GoogleDrive" ? "Google Drive" : domain;
}
