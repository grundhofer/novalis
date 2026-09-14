import { create } from "zustand";

import { commands, unwrap, type EntryDto, type FsBatch, type VaultDto } from "../ipc/client";
import { ancestorsOf, folderOf } from "../lib/paths";

/**
 * The tree.
 *
 * Folders are listed lazily: `bootstrap()` brings the root's children and one
 * `list_dir` follows per folder the user opens, so first paint never waits for
 * a walk (PLAN.md §2.3 rule 1). A watcher batch is applied as a patch to the
 * folders that are already loaded — the tree is never refetched (rule 5).
 */

export interface VaultState {
  vault: VaultDto | null;
  /** Children per folder path; `""` is the vault root. Only loaded folders. */
  children: Record<string, EntryDto[]>;
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;
  selected: string | null;

  setVault: (vault: VaultDto | null, tree: EntryDto[]) => void;
  select: (path: string | null) => void;
  toggleFolder: (path: string) => Promise<void>;
  reveal: (path: string) => Promise<void>;
  reload: (folder: string) => Promise<void>;
  applyBatch: (batch: FsBatch) => void;
}

/** Folders first, then name ascending — the same order the shell returns. */
function sortEntries(entries: EntryDto[]): EntryDto[] {
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function upsert(list: EntryDto[], entry: EntryDto): EntryDto[] {
  const i = list.findIndex((e) => e.path === entry.path);
  if (i < 0) return sortEntries([...list, entry]);
  const next = [...list];
  next[i] = entry;
  return next;
}

export const useVault = create<VaultState>((set, get) => ({
  vault: null,
  children: {},
  expanded: {},
  loading: {},
  selected: null,

  setVault: (vault, tree) =>
    set({ vault, children: { "": sortEntries(tree) }, expanded: {}, loading: {}, selected: null }),

  select: (path) => set({ selected: path }),

  toggleFolder: async (path) => {
    const open = !get().expanded[path];
    set((s) => ({ expanded: { ...s.expanded, [path]: open } }));
    if (open && !get().children[path]) await get().reload(path);
  },

  reveal: async (path) => {
    for (const folder of ancestorsOf(path)) {
      set((s) => ({ expanded: { ...s.expanded, [folder]: true } }));
      if (!get().children[folder]) await get().reload(folder);
    }
  },

  reload: async (folder) => {
    if (get().loading[folder]) return;
    set((s) => ({ loading: { ...s.loading, [folder]: true } }));
    try {
      const entries = await unwrap(commands.listDir(folder));
      set((s) => ({ children: { ...s.children, [folder]: sortEntries(entries) } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, [folder]: false } }));
    }
  },

  applyBatch: (batch) => {
    set((state) => {
      const children = { ...state.children };
      const touch = (entry: EntryDto) => {
        const folder = folderOf(entry.path);
        const list = children[folder];
        // A folder nobody has opened has nothing to patch; it will be listed
        // fresh when it opens.
        if (list) children[folder] = upsert(list, entry);
      };
      const drop = (path: string) => {
        const folder = folderOf(path);
        const list = children[folder];
        if (list) children[folder] = list.filter((e) => e.path !== path);
        delete children[path];
      };

      for (const path of batch.removed) drop(path);
      for (const rename of batch.renamed) drop(rename.from);
      for (const entry of batch.added) touch(entry);
      for (const entry of batch.modified) touch(entry);
      return { children };
    });
  },
}));

/** One flattened, visible row of the tree. */
export interface TreeRow {
  entry: EntryDto;
  depth: number;
  expanded: boolean;
}

/** Flatten the loaded, expanded folders into the list the virtualizer draws. */
export function treeRows(
  children: Record<string, EntryDto[]>,
  expandedFolders: Record<string, boolean>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (folder: string, depth: number) => {
    for (const entry of children[folder] ?? []) {
      const expanded = entry.dir && !entry.boardSlug && !!expandedFolders[entry.path];
      rows.push({ entry, depth, expanded });
      if (expanded) walk(entry.path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

/** Counts for the sidebar foot and the status bar's cloud hints. */
export function cloudCounts(children: Record<string, EntryDto[]>): {
  cloudOnly: number;
  conflicts: number;
} {
  let cloudOnly = 0;
  let conflicts = 0;
  for (const list of Object.values(children)) {
    for (const entry of list) {
      if (entry.cloudOnly) cloudOnly += 1;
      // `conflictCopyOf` is decided by novalis_core, which owns the four
      // naming patterns. This used to be a regex here that never matched the
      // numbered form, so this count and `novalis doctor`'s disagreed.
      if (entry.conflictCopyOf) conflicts += 1;
    }
  }
  return { cloudOnly, conflicts };
}
