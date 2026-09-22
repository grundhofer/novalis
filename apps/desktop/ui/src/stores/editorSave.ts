import { create } from "zustand";

import {
  commands,
  isConflict,
  NovalisError,
  unwrap,
  type FileDto,
  type PreconditionDto,
  type VaultKindDto,
} from "../ipc/client";
import { report } from "./ui";
import { useVault } from "./vault";

/**
 * The external-change state machine of PLAN.md §5.3, steps 1–4.
 *
 * 1. On open we capture `(mtime, size, hash)`; every write we make records the
 *    hash it produced.
 * 2. A watcher batch marking an open path:
 *      - buffer clean, and either we never wrote it or the disk hash equals the
 *        one we recorded → reload silently;
 *      - buffer clean, the last write was ours, disk hash differs → the sync
 *        client replaced our text: `replacedBySync` banner;
 *      - buffer dirty → `changedOnDisk` banner, unless the disk diff is exactly
 *        a link rewrite from a rename, which is re-applied to the buffer
 *        instead (see `mergeLinkRewrite`).
 * 3. On save, a precondition mismatch writes the buffer to a conflict copy at
 *    once and keeps autosaving *there* until the banner is resolved.
 * 4. Watcher events matching our own write are already dropped by the shell.
 *
 * `Cmd+W` and `Cmd+Q` never block and never lose text (D19): closing flushes,
 * and a refused save always has a destination.
 *
 * The live document is CodeMirror's; `Doc.text` mirrors it *lazily*.
 * Materialising the buffer on every keystroke cost 3–5 ms in a 1 MB note and
 * 18–30 ms at 5 MB against the 8/16 ms budget (measured 2026-09-20, ADR-0022
 * F7), so the editor only says *that* the buffer changed (`touch`) and hands
 * over a reader (`attach`). Whoever needs the text — a save, the merge, the
 * counts, a completion — calls `flush` first, which reads the buffer once.
 * `pending` holds the paths whose buffer is ahead of the mirror; every place
 * that replaces the mirror from disk clears it, so a view about to be rebuilt
 * cannot write its stale buffer over the fresh text on its way out.
 */

/** PLAN.md §4.2. */
export const AUTOSAVE_MS = 1000;
/** Above this the link-rewrite merge is not attempted; the banner is shown. */
const MERGE_MAX_BYTES = 1_000_000;

export type Banner =
  | { kind: "changedOnDisk" }
  /** The file went away under unsaved text (feature-gaps A17). */
  | { kind: "deletedOnDisk" }
  | { kind: "replacedBySync" }
  | { kind: "binary" }
  | { kind: "notUtf8" }
  | { kind: "plainMode" }
  | { kind: "hugeFile" };

export interface Doc {
  path: string;
  /** The buffer as of the last `flush`; CodeMirror owns the live document. */
  text: string;
  /** The text of our last successful write — the base for the merge. */
  savedText: string;
  /** Where autosave writes: `path`, or the conflict copy from §5.3 step 3. */
  writePath: string;
  /** Read-time precondition of `path`. Null once we write to a copy. */
  precondition: PreconditionDto | null;
  /** Hash of our last write to `path`; null while we never wrote it. */
  lastWriteHash: string | null;
  dirty: boolean;
  saving: boolean;
  readOnly: boolean;
  plainMode: boolean;
  banner: Banner | null;
  /** Bumped whenever the text is replaced from disk, to reset CodeMirror. */
  revision: number;
}

interface EditorSaveState {
  docs: Record<string, Doc>;
  open: (path: string) => Promise<Doc>;
  close: (path: string) => Promise<void>;
  rename: (from: string, to: string) => void;
  /** Register the live buffer's reader once the editor is mounted. */
  attach: (path: string, read: () => string) => void;
  /** Forget the reader — after a `flush`, since the buffer is about to go. */
  detach: (path: string, read: () => string) => void;
  /** The buffer changed: dirty, autosave clock restarted, no text read. */
  touch: (path: string) => void;
  /** Bring the mirror up to date with the buffer; the text, or undefined for a path not open. */
  flush: (path: string) => string | undefined;
  /** Replace the mirror outright — the preview's edits, while no editor is mounted for the path. */
  setText: (path: string, text: string) => void;
  save: (path: string) => Promise<void>;
  flushAll: () => Promise<void>;
  externalChange: (path: string) => Promise<void>;
  /**
   * The watcher saw `path` go. `"gone"` when it is still gone and the buffer
   * held nothing unsaved — the caller closes the tab; `"kept"` when the
   * banner now holds the unsaved text, or the file was back by the time it
   * was looked at.
   */
  deletedOnDisk: (path: string) => Promise<"gone" | "kept">;
  /** "Keep mine" on the deleted-on-disk banner: write the buffer as the file again. */
  restoreDeleted: (path: string) => Promise<void>;
  dismissBanner: (path: string) => void;
  reloadFromDisk: (path: string) => Promise<void>;
  keepMine: (path: string, vaultKind: VaultKindDto) => Promise<void>;
  keepBoth: (path: string) => Promise<string>;
  conflictCopyPath: (path: string) => string | null;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const readers = new Map<string, () => string>();
const pending = new Set<string>();

/** Whether `path` is not on disk (any other read failure is thrown). */
async function isGone(path: string): Promise<boolean> {
  try {
    await unwrap(commands.readFile(path));
    return false;
  } catch (error) {
    if (error instanceof NovalisError && error.code === "not_found") return true;
    throw error;
  }
}

function cancelTimer(path: string): void {
  const timer = timers.get(path);
  if (timer) {
    clearTimeout(timer);
    timers.delete(path);
  }
}

/** Autosave `AUTOSAVE_MS` after the last change (PLAN.md §4.2). */
function armAutosave(path: string, save: (path: string) => Promise<void>): void {
  cancelTimer(path);
  timers.set(
    path,
    setTimeout(() => {
      timers.delete(path);
      void save(path).catch(report);
    }, AUTOSAVE_MS),
  );
}

function docFromFile(file: FileDto): Doc {
  return {
    path: file.path,
    text: file.text,
    savedText: file.text,
    writePath: file.path,
    precondition: file.precondition,
    lastWriteHash: null,
    dirty: false,
    saving: false,
    readOnly: file.binary || !file.utf8,
    plainMode: file.plainMode,
    banner: file.binary
      ? { kind: "binary" }
      : !file.utf8
        ? { kind: "notUtf8" }
        : file.huge
          ? { kind: "hugeFile" }
          : file.plainMode
            ? { kind: "plainMode" }
            : null,
    revision: 0,
  };
}

/**
 * Re-apply a rename's link rewrite to a dirty buffer (§5.3 step 2).
 *
 * Deliberately narrow: a link rewrite never changes the number of lines, so a
 * disk version with a different line count is a real edit and gets the banner.
 * Only lines the user has not touched (buffer line still equals the base line)
 * are replaced, so nothing typed is ever overwritten. Returns null when the
 * merge is not provably safe.
 */
export function mergeLinkRewrite(base: string, disk: string, buffer: string): string | null {
  if (base === disk) return null;
  const baseLines = base.split("\n");
  const diskLines = disk.split("\n");
  const bufferLines = buffer.split("\n");
  if (baseLines.length !== diskLines.length || baseLines.length !== bufferLines.length) return null;

  const merged = [...bufferLines];
  for (let i = 0; i < baseLines.length; i += 1) {
    if (baseLines[i] === diskLines[i]) continue;
    if (bufferLines[i] !== baseLines[i]) return null;
    merged[i] = diskLines[i] as string;
  }
  return merged.join("\n");
}

export const useEditorSave = create<EditorSaveState>((set, get) => ({
  docs: {},

  open: async (path) => {
    const existing = get().docs[path];
    if (existing) return existing;
    const file = await unwrap(commands.readFile(path));
    const doc = docFromFile(file);
    set((s) => ({ docs: { ...s.docs, [path]: doc } }));
    return doc;
  },

  close: async (path) => {
    await get().save(path);
    cancelTimer(path);
    // The save flushed; this only keeps a mark from outliving its doc.
    pending.delete(path);
    set((s) => {
      const docs = { ...s.docs };
      delete docs[path];
      return { docs };
    });
  },

  rename: (from, to) => {
    if (from === to || !get().docs[from]) return;
    // The map is keyed by path, so a rename has to re-key it or the pane reads
    // `docs[to]`, finds nothing and falls through to the empty state. The
    // command path saves before renaming; the watcher path (a rename by the
    // CLI, the Finder or the sync client under an open note) does not, and
    // the view for `from` is still alive here — so the buffer is read now,
    // and the re-keyed doc carries it. Dropping the pending autosave, keyed
    // by the old path and aimed at a file that no longer exists, loses
    // nothing. The editor is rebuilt under the new path and attaches again;
    // the old key's reader and pending mark go with the old key.
    get().flush(from);
    cancelTimer(from);
    pending.delete(from);
    readers.delete(from);
    set((s) => {
      const doc = s.docs[from];
      if (!doc) return s;
      const docs = { ...s.docs };
      delete docs[from];
      docs[to] = {
        ...doc,
        path: to,
        // Only follow the rename while we are writing to the note itself: a
        // conflict copy from §5.3 step 3 keeps the path it was given.
        writePath: doc.writePath === from ? to : doc.writePath,
      };
      return { docs };
    });
  },

  attach: (path, read) => {
    readers.set(path, read);
  },

  detach: (path, read) => {
    if (readers.get(path) === read) readers.delete(path);
  },

  touch: (path) => {
    const doc = get().docs[path];
    if (!doc || doc.readOnly) return;
    pending.add(path);
    // The first keystroke flips the dirty dot; the rest change nothing here.
    if (!doc.dirty) set((s) => ({ docs: { ...s.docs, [path]: { ...doc, dirty: true } } }));
    armAutosave(path, get().save);
  },

  flush: (path) => {
    const doc = get().docs[path];
    if (!doc) return undefined;
    const read = readers.get(path);
    if (!read || !pending.has(path)) return doc.text;
    pending.delete(path);
    const text = read();
    if (text === doc.text) return text;
    set((s) => {
      const current = s.docs[path];
      return current ? { docs: { ...s.docs, [path]: { ...current, text } } } : s;
    });
    return text;
  },

  setText: (path, text) => {
    const doc = get().docs[path];
    if (!doc || doc.readOnly || doc.text === text) return;
    set((s) => ({ docs: { ...s.docs, [path]: { ...doc, text, dirty: true } } }));
    armAutosave(path, get().save);
  },

  save: async (path) => {
    cancelTimer(path);
    get().flush(path);
    const doc = get().docs[path];
    if (!doc || !doc.dirty || doc.readOnly || doc.saving) return;
    // The file was deleted under this buffer: nothing is written until the
    // banner is answered — an autosave would recreate it behind the user's
    // back, or end as a conflict copy nobody asked for.
    if (doc.banner?.kind === "deletedOnDisk") return;
    const text = doc.text;
    // A conflict copy is ours alone: no precondition, and no way for it to
    // conflict in turn.
    const expected = doc.writePath === doc.path ? doc.precondition : null;
    set((s) => ({ docs: { ...s.docs, [path]: { ...doc, saving: true } } }));

    try {
      const precondition = await unwrap(commands.writeFile(doc.writePath, text, expected));
      // Step 4 cuts both ways: the tree never hears of this write either, so
      // its "Modified" column kept the time the note was opened. The conflict
      // copy is a row of its own while the autosaves go there.
      useVault.getState().touch(doc.writePath, precondition);
      // Typing during the write leaves the buffer ahead of what was written:
      // the doc stays dirty and the clock is re-armed, because the tick that
      // fired meanwhile found `saving` and left. (Before the lazy mirror this
      // window silently waited for the next keystroke.)
      const latest = get().flush(path) ?? text;
      set((s) => {
        const current = s.docs[path];
        if (!current) return s;
        return {
          docs: {
            ...s.docs,
            [path]: {
              ...current,
              saving: false,
              savedText: text,
              dirty: latest !== text,
              precondition: current.writePath === current.path ? precondition : current.precondition,
              lastWriteHash:
                current.writePath === current.path ? precondition.hash : current.lastWriteHash,
            },
          },
        };
      });
      if (latest !== text && get().docs[path]) armAutosave(path, get().save);
    } catch (error) {
      if (!isConflict(error) || doc.writePath !== doc.path) {
        set((s) => {
          const current = s.docs[path];
          return current ? { docs: { ...s.docs, [path]: { ...current, saving: false } } } : s;
        });
        throw error;
      }
      // A conflict because the file is gone is a deletion, not a change (the
      // autosave can reach it before the watcher reports it): the text waits
      // under the deleted-on-disk banner instead of in a conflict copy.
      if (await isGone(path)) {
        set((s) => {
          const current = s.docs[path];
          return current
            ? { docs: { ...s.docs, [path]: { ...current, saving: false, banner: { kind: "deletedOnDisk" } } } }
            : s;
        });
        return;
      }
      // §5.3 step 3: the buffer goes to a conflict copy immediately and keeps
      // autosaving there. Nothing is lost and nothing is clobbered.
      const copy = await unwrap(commands.writeConflictCopy(path, text));
      const latest = get().flush(path) ?? text;
      set((s) => {
        const current = s.docs[path];
        if (!current) return s;
        return {
          docs: {
            ...s.docs,
            [path]: {
              ...current,
              saving: false,
              dirty: latest !== text,
              savedText: text,
              writePath: copy,
              banner: { kind: "changedOnDisk" },
            },
          },
        };
      });
      if (latest !== text && get().docs[path]) armAutosave(path, get().save);
    }
  },

  flushAll: async () => {
    await Promise.all(Object.keys(get().docs).map((path) => get().save(path)));
  },

  deletedOnDisk: async (path) => {
    // A save by delete-and-recreate (some editors, some sync clients) is not
    // a deletion: if the file is back, it is an ordinary change.
    if (!(await isGone(path))) {
      await get().externalChange(path);
      return "kept";
    }
    cancelTimer(path);
    const text = get().flush(path);
    const doc = get().docs[path];
    if (!doc) return "gone";
    if (!doc.dirty && text === doc.savedText) return "gone";
    set((s) => {
      const current = s.docs[path];
      return current ? { docs: { ...s.docs, [path]: { ...current, banner: { kind: "deletedOnDisk" } } } } : s;
    });
    return "kept";
  },

  restoreDeleted: async (path) => {
    const text = get().flush(path);
    const doc = get().docs[path];
    if (!doc || text === undefined) return;
    const precondition = await unwrap(commands.writeFile(path, text, null));
    useVault.getState().touch(path, precondition);
    const latest = get().flush(path) ?? text;
    set((s) => {
      const current = s.docs[path];
      if (!current) return s;
      return {
        docs: {
          ...s.docs,
          [path]: {
            ...current,
            writePath: path,
            precondition,
            lastWriteHash: precondition.hash,
            savedText: text,
            dirty: latest !== text,
            banner: null,
          },
        },
      };
    });
    if (latest !== text && get().docs[path]) armAutosave(path, get().save);
  },

  externalChange: async (path) => {
    get().flush(path);
    const doc = get().docs[path];
    // While a conflict copy is active the target is frozen until the banner is
    // resolved; more disk changes do not change that.
    if (!doc || doc.writePath !== doc.path || doc.banner?.kind === "replacedBySync") return;

    if (!doc.dirty) {
      const file = await unwrap(commands.readFile(path));
      if (doc.lastWriteHash && file.precondition.hash !== doc.lastWriteHash) {
        set((s) => {
          const current = s.docs[path];
          return current
            ? { docs: { ...s.docs, [path]: { ...current, banner: { kind: "replacedBySync" } } } }
            : s;
        });
        return;
      }
      set((s) => {
        const current = s.docs[path];
        // A keystroke during the read made it dirty: the banner path, not
        // a silent replace (and `pending` is only ever set with `dirty`).
        if (!current || current.dirty) return s;
        // The doc follows the disk whole — a file that turned binary or
        // lost its UTF-8 reloads read-only under its banner, not as an empty
        // writable buffer — and keeps knowing whether the disk holds our
        // last write.
        return {
          docs: {
            ...s.docs,
            [path]: {
              ...docFromFile(file),
              lastWriteHash: current.lastWriteHash,
              revision: current.revision + 1,
            },
          },
        };
      });
      return;
    }

    if (doc.text.length > MERGE_MAX_BYTES) {
      set((s) => {
        const current = s.docs[path];
        return current
          ? { docs: { ...s.docs, [path]: { ...current, banner: { kind: "changedOnDisk" } } } }
          : s;
      });
      return;
    }

    const file = await unwrap(commands.readFile(path));
    // The read took time; merge against what the buffer holds now. The
    // flush leaves nothing pending, and nothing can type between here and
    // the replace below, so the view rebuilt for it cannot undo it.
    const buffer = get().flush(path) ?? doc.text;
    const merged = mergeLinkRewrite(doc.savedText, file.text, buffer);
    set((s) => {
      const current = s.docs[path];
      if (!current) return s;
      if (merged === null) {
        return { docs: { ...s.docs, [path]: { ...current, banner: { kind: "changedOnDisk" } } } };
      }
      return {
        docs: {
          ...s.docs,
          [path]: {
            ...current,
            text: merged,
            savedText: file.text,
            precondition: file.precondition,
            revision: current.revision + 1,
          },
        },
      };
    });
  },

  dismissBanner: (path) =>
    set((s) => {
      const doc = s.docs[path];
      return doc ? { docs: { ...s.docs, [path]: { ...doc, banner: null } } } : s;
    }),

  reloadFromDisk: async (path) => {
    const doc = get().docs[path];
    if (!doc) return;
    // Reload discards the conflict copy: the user chose the disk version.
    if (doc.writePath !== doc.path) await unwrap(commands.trash(doc.writePath));
    const file = await unwrap(commands.readFile(path));
    // The user chose the disk version; whatever the buffer holds goes with
    // the view that is about to be rebuilt.
    pending.delete(path);
    set((s) => {
      const current = s.docs[path];
      if (!current) return s;
      return {
        docs: {
          ...s.docs,
          [path]: {
            ...docFromFile(file),
            revision: current.revision + 1,
          },
        },
      };
    });
  },

  keepMine: async (path, vaultKind) => {
    get().flush(path);
    const doc = get().docs[path];
    if (!doc) return;
    // In a vault that is not in a cloud folder there is no vendor version
    // history, so the version we are about to replace is preserved first
    // (§5.3 step 3).
    if (vaultKind === "local") {
      const onDisk = await unwrap(commands.readFile(path));
      if (onDisk.precondition.hash !== doc.precondition?.hash) {
        await unwrap(commands.writeConflictCopy(path, onDisk.text));
      }
    }
    const precondition = await unwrap(commands.writeFile(path, doc.text, null));
    useVault.getState().touch(path, precondition);
    if (doc.writePath !== doc.path) await unwrap(commands.trash(doc.writePath));
    const latest = get().flush(path) ?? doc.text;
    set((s) => {
      const current = s.docs[path];
      if (!current) return s;
      return {
        docs: {
          ...s.docs,
          [path]: {
            ...current,
            writePath: path,
            precondition,
            lastWriteHash: precondition.hash,
            savedText: doc.text,
            dirty: latest !== doc.text,
            banner: null,
          },
        },
      };
    });
    if (latest !== doc.text && get().docs[path]) armAutosave(path, get().save);
  },

  keepBoth: async (path) => {
    get().flush(path);
    const doc = get().docs[path];
    if (!doc) return path;
    const copy =
      doc.writePath === doc.path
        ? await unwrap(commands.writeConflictCopy(path, doc.text))
        : doc.writePath;
    // The tab follows the copy: that is the text the user is editing.
    const file = await unwrap(commands.readFile(copy));
    pending.delete(path);
    set((s) => {
      const docs = { ...s.docs };
      delete docs[path];
      docs[copy] = docFromFile(file);
      return { docs };
    });
    return copy;
  },

  conflictCopyPath: (path) => {
    const doc = get().docs[path];
    return doc && doc.writePath !== doc.path ? doc.writePath : null;
  },
}));
