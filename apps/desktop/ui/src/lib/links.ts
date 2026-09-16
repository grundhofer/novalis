import { folderOf } from "./paths";

/**
 * Where a Markdown link destination points (PLAN.md §7.2): relative to the
 * note that holds it, percent-decoded, never above the vault root. Only for
 * `[text](path)` and `![](path)` targets — a `[[wikilink]]` resolves by stem
 * elsewhere, and so does a bare word, which has no slash or dot to mark it
 * as a path. A URL with a scheme is not a vault path either.
 */
export function resolveDestination(active: string | null, raw: string): string | null {
  // The parser keeps the `<…>` of a bracketed destination in the node.
  const target = raw.trim().replace(/^<(.*)>$/, "$1");
  if (target.startsWith("[[") || !/[/.]/.test(target)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  // The fragment goes before decoding, so an encoded `#` in a name survives.
  const withoutFragment = target.split("#")[0]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // A stray `%` is not an escape; the text is the path as written.
    decoded = withoutFragment;
  }
  const base = folderOf(active ?? "");
  const segments = base ? base.split("/") : [];
  for (const part of decoded.split("/")) {
    if (part === "" || part === ".") continue;
    // `..` above the root is dropped, not an error: nothing is outside the vault.
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.length > 0 ? segments.join("/") : null;
}
