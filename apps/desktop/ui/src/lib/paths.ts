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
