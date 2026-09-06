import { create } from "zustand";

import {
  commands,
  isConflict,
  unwrap,
  type FileDto,
  type PreconditionDto,
  type VaultKindDto,
} from "../ipc/client";

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
 */

/** PLAN.md §4.2. */
export const AUTOSAVE_MS = 1000;
/** Above this the link-rewrite merge is not attempted; the banner is shown. */
const MERGE_MAX_BYTES = 1_000_000;

export type Banner =
  | { kind: "changedOnDisk" }
  | { kind: "replacedBySync" }
  | { kind: "notUtf8" }
  | { kind: "plainMode" }
  | { kind: "hugeFile" };

export interface Doc {
  path: string;
  /** The buffer. CodeMirror owns the live document; this mirrors it. */
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
  setText: (path: string, text: string) => void;
  save: (path: string) => Promise<void>;
  flushAll: () => Promise<void>;
  externalChange: (path: string) => Promise<void>;
  dismissBanner: (path: string) => void;
  reloadFromDisk: (path: string) => Promise<void>;
  keepMine: (path: string, vaultKind: VaultKindDto) => Promise<void>;
  keepBoth: (path: string) => Promise<string>;
  conflictCopyPath: (path: string) => string | null;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelTimer(path: string): void {
  const timer = timers.get(path);
  if (timer) {
    clearTimeout(timer);
    timers.delete(path);
  }
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
    readOnly: !file.utf8,
    plainMode: file.plainMode,
    banner: !file.utf8
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
    set((s) => {
      const docs = { ...s.docs };
      delete docs[path];
      return { docs };
    });
  },

  rename: (from, to) => {
    const doc = get().docs[from];
    if (!doc || from === to) return;
    // The map is keyed by path, so a rename has to re-key it or the pane reads
    // `docs[to]`, finds nothing and falls through to the empty state. Both
    // callers save before renaming, so dropping the pending autosave — which
    // is keyed by the old path and would write a file that no longer exists —
    // loses nothing.
    cancelTimer(from);
    set((s) => {
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

  setText: (path, text) => {
    const doc = get().docs[path];
    if (!doc || doc.readOnly || doc.text === text) return;
    set((s) => ({ docs: { ...s.docs, [path]: { ...doc, text, dirty: true } } }));
    cancelTimer(path);
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        void get().save(path);
      }, AUTOSAVE_MS),
    );
  },

  save: async (path) => {
    cancelTimer(path);
    const doc = get().docs[path];
    if (!doc || !doc.dirty || doc.readOnly || doc.saving) return;
    const text = doc.text;
    // A conflict copy is ours alone: no precondition, and no way for it to
    // conflict in turn.
    const expected = doc.writePath === doc.path ? doc.precondition : null;
    set((s) => ({ docs: { ...s.docs, [path]: { ...doc, saving: true } } }));

    try {
      const precondition = await unwrap(commands.writeFile(doc.writePath, text, expected));
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
              dirty: current.text !== text,
              precondition: current.writePath === current.path ? precondition : current.precondition,
              lastWriteHash:
                current.writePath === current.path ? precondition.hash : current.lastWriteHash,
            },
          },
        };
      });
    } catch (error) {
      if (!isConflict(error) || doc.writePath !== doc.path) {
        set((s) => {
          const current = s.docs[path];
          return current ? { docs: { ...s.docs, [path]: { ...current, saving: false } } } : s;
        });
        throw error;
      }
      // §5.3 step 3: the buffer goes to a conflict copy immediately and keeps
      // autosaving there. Nothing is lost and nothing is clobbered.
      const copy = await unwrap(commands.writeConflictCopy(path, text));
      set((s) => {
        const current = s.docs[path];
        if (!current) return s;
        return {
          docs: {
            ...s.docs,
            [path]: {
              ...current,
              saving: false,
              dirty: false,
              savedText: text,
              writePath: copy,
              banner: { kind: "changedOnDisk" },
            },
          },
        };
      });
    }
  },

  flushAll: async () => {
    await Promise.all(Object.keys(get().docs).map((path) => get().save(path)));
  },

  externalChange: async (path) => {
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
        if (!current || current.dirty) return s;
        return {
          docs: {
            ...s.docs,
            [path]: {
              ...current,
              text: file.text,
              savedText: file.text,
              precondition: file.precondition,
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
    const merged = mergeLinkRewrite(doc.savedText, file.text, doc.text);
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
    if (doc.writePath !== doc.path) await unwrap(commands.trash(doc.writePath));
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
            savedText: current.text,
            dirty: false,
            banner: null,
          },
        },
      };
    });
  },

  keepBoth: async (path) => {
    const doc = get().docs[path];
    if (!doc) return path;
    const copy =
      doc.writePath === doc.path
        ? await unwrap(commands.writeConflictCopy(path, doc.text))
        : doc.writePath;
    // The tab follows the copy: that is the text the user is editing.
    const file = await unwrap(commands.readFile(copy));
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
