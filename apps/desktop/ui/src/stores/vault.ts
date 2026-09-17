import { create } from "zustand";

import {
  commands,
  unwrap,
  type BoardRefDto,
  type EntryDto,
  type FsBatch,
  type TreeSortDto,
  type VaultDto,
} from "../ipc/client";
import { isSupported } from "../lib/fileTypes";
import { ancestorsOf, compareNs, folderOf } from "../lib/paths";

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
  /**
   * Patch one entry's size and mtime after an own write. The watcher drops
   * events for our own writes (§5.3 step 4), so without this the "Modified"
   * column showed the time a note was opened, not the time it was last saved.
   */
  touch: (path: string, stat: { mtimeNs: string; size: string }) => void;
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

  touch: (path, stat) =>
    set((state) => {
      const folder = folderOf(path);
      const list = state.children[folder];
      const entry = list?.find((e) => e.path === path);
      // A folder nobody has opened has nothing to patch (see `applyBatch`).
      if (!list || !entry) return state;
      const next = list.map((e) => (e === entry ? { ...e, mtimeNs: stat.mtimeNs, size: stat.size } : e));
      return { children: { ...state.children, [folder]: next } };
    }),
}));

/** One flattened, visible row of the tree. */
export interface TreeRow {
  entry: EntryDto;
  depth: number;
  expanded: boolean;
}

/**
 * One folder's entries in the order the tree draws them: folders first in
 * their stored (name) order, then the files by `sort`. Only the files follow
 * the sort (ADR-0012); a folder has no modification time worth ordering by.
 * A file of a type the app does not open is not drawn at all (ADR-0015).
 */
function orderEntries(entries: EntryDto[], sort: TreeSortDto): EntryDto[] {
  const folders = entries.filter((e) => e.dir);
  const files = entries.filter((e) => !e.dir && isSupported(e.path));
  if (sort === "modified") {
    files.sort((a, b) => compareNs(b.mtimeNs, a.mtimeNs) || a.name.localeCompare(b.name));
  }
  return [...folders, ...files];
}

/**
 * The row a board is drawn as: a synthetic entry at the root, named after the
 * board rather than its directory, so the tree does not need `boards/` to be
 * expanded — or listed at all — to show it.
 */
function boardEntry(board: BoardRefDto): EntryDto {
  return {
    path: `boards/${board.slug}`,
    name: board.name,
    dir: true,
    size: "0",
    mtimeNs: "0",
    cloudOnly: false,
    boardSlug: board.slug,
    conflictCopyOf: null,
  };
}

/**
 * Flatten the loaded, expanded folders into the list the virtualizer draws,
 * then the boards as the last root rows (ADR-0012). A board directory met
 * inside an expanded `boards` folder is skipped: it is drawn once, at the
 * root, from the vault's board list.
 */
export function treeRows(
  children: Record<string, EntryDto[]>,
  expandedFolders: Record<string, boolean>,
  sort: TreeSortDto,
  boards: BoardRefDto[],
): TreeRow[] {
  const rows: TreeRow[] = [];
  // By flag, and by name for a directory listed before its `board.json`
  // arrived (a sync client writes them in two batches): drawn once either way.
  const isBoard = (entry: EntryDto) =>
    !!entry.boardSlug ||
    (folderOf(entry.path) === "boards" && entry.dir && boards.some((b) => b.slug === entry.name));
  const walk = (folder: string, depth: number) => {
    for (const entry of orderEntries(children[folder] ?? [], sort)) {
      if (isBoard(entry)) continue;
      const expanded = entry.dir && !!expandedFolders[entry.path];
      rows.push({ entry, depth, expanded });
      if (expanded) walk(entry.path, depth + 1);
    }
  };
  walk("", 0);
  // In the list's own order: the shell keys dragged boards first (ADR-0019).
  for (const board of boards) {
    rows.push({ entry: boardEntry(board), depth: 0, expanded: false });
  }
  return rows;
}

/**
 * Counts for the sidebar foot and the status bar's cloud hints. Over the
 * files the tree draws, and no others: a `.gdoc` stub Drive leaves beside a
 * note is dataless too, and a count that included it said "3 nur online"
 * over a tree with nothing cloud-only in it (checklist B8, 2026-09-17).
 */
export function cloudCounts(children: Record<string, EntryDto[]>): {
  cloudOnly: number;
  conflicts: number;
} {
  let cloudOnly = 0;
  let conflicts = 0;
  for (const list of Object.values(children)) {
    for (const entry of list) {
      if (entry.dir || !isSupported(entry.path)) continue;
      if (entry.cloudOnly) cloudOnly += 1;
      // `conflictCopyOf` is decided by novalis_core, which owns the four
      // naming patterns. This used to be a regex here that never matched the
      // numbered form, so this count and `novalis doctor`'s disagreed.
      if (entry.conflictCopyOf) conflicts += 1;
    }
  }
  return { cloudOnly, conflicts };
}
