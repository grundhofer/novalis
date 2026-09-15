import { commands, NovalisError, unwrap } from "../ipc/client";
import { useVault } from "../stores/vault";
import { folderOf, joinRel, stemOf } from "./paths";

/**
 * Images pasted or dropped into a note (ADR-0017): the bytes go to a file
 * next to the note, the note gets a Markdown image link. Everything here is
 * pure string and byte work; the editor extension (`editor/attachments.ts`)
 * owns the DOM events and the buffer.
 */

/** Hard-coded like the PLAN.md §4.2 defaults (ADR-0012): one folder, per note folder. */
export const ATTACHMENTS_FOLDER = "attachments";

/** How many names are tried before an `already_exists` is reported as such. */
const MAX_ATTEMPTS = 5;

/** `String.fromCharCode` takes its bytes as arguments; this many fit on any stack. */
const BASE64_CHUNK = 8192;

/**
 * The §7.3 image types the shell's `write_blob` accepts, by the MIME type the
 * clipboard or a dropped file carries. Anything else is not an attachment.
 */
const EXTENSION_FOR_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function extensionForMime(mime: string): string | null {
  return EXTENSION_FOR_MIME[mime] ?? null;
}

/**
 * `<stem>-YYYYMMDD-HHMMSS.<ext>`, the stamp in local time — never
 * `toISOString()`, which is UTC and would date a screenshot taken at 00:30 to
 * the day before. Attempt 1, 2, … append `-2`, `-3` before the extension:
 * `write_blob` never overwrites, so a second paste within the same second is
 * refused and the caller asks for the next name.
 */
export function attachmentName(notePath: string, now: Date, ext: string, attempt = 0): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = attempt > 0 ? `-${attempt + 1}` : "";
  return `${stemOf(notePath)}-${day}-${time}${suffix}.${ext}`;
}

/**
 * The link written into the note: relative to the note (PLAN.md §7.2), the
 * name percent-encoded as one path segment. A space would end the destination
 * for the parser and an unbalanced parenthesis would close it, so both are
 * escaped; `followLink` decodes them again.
 */
export function attachmentLink(name: string): string {
  const segment = encodeURIComponent(name).replace(/[()]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `![](${ATTACHMENTS_FOLDER}/${segment})`;
}

/**
 * `btoa` wants a binary string. Building it with one `String.fromCharCode`
 * call per byte is slow and spreading the whole buffer into one call blows
 * the stack on a 20 MB screenshot, so the bytes go through in slices.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/** Write under the stamped name, then `-2` … `-5`; returns the name that took. */
async function writeUnderFreeName(
  folder: string,
  notePath: string,
  ext: string,
  now: Date,
  base64: string,
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const name = attachmentName(notePath, now, ext, attempt);
    try {
      await unwrap(commands.writeBlob(folder, name, base64));
      return name;
    } catch (error) {
      // `create_atomic` is RENAME_EXCL, so `already_exists` is exact: the name
      // is taken, the next one is free to try.
      const taken = error instanceof NovalisError && error.code === "already_exists";
      if (!taken || attempt + 1 >= MAX_ATTEMPTS) throw error;
    }
  }
}

/**
 * Write the image under `<note folder>/attachments/` and return the link to
 * put into the note. The folder is created by the shell along with the file;
 * when the note's folder is listed in the tree and did not show `attachments`
 * yet, it is listed again so the new folder appears. The note list is not
 * refreshed: an image is not a note.
 */
export async function saveAttachment(
  notePath: string,
  bytes: Uint8Array,
  mime: string,
  now = new Date(),
): Promise<string> {
  const ext = extensionForMime(mime);
  // The callers filter on `extensionForMime` first; this is the shell's own
  // refusal, spelled the way `write_blob` would spell it.
  if (!ext) {
    throw new NovalisError({ code: "bad_request", path: null, detail: mime, name: null, candidates: [] });
  }
  const noteFolder = folderOf(notePath);
  const folder = joinRel(noteFolder, ATTACHMENTS_FOLDER);
  const name = await writeUnderFreeName(folder, notePath, ext, now, toBase64(bytes));

  const vault = useVault.getState();
  const listed = vault.children[noteFolder];
  if (listed && !listed.some((e) => e.path === folder)) await vault.reload(noteFolder);
  return attachmentLink(name);
}
