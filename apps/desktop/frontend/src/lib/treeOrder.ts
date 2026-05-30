// Sorting/ordering for the sidebar tree. Shared by the store (to compute the
// current sibling order when manually reordering) and by the Sidebar (to render
// in the same order). The backend returns alphabetical order; this layers the
// user's chosen sort mode (name / modified / created / manual) on top, purely
// on the frontend so `novalis-core` stays sort-agnostic.

import type { FolderNode, NoteSummary } from "../ipc/api";

export type TreeItem =
  | { kind: "folder"; key: string; folder: FolderNode }
  | { kind: "note"; key: string; note: NoteSummary };

export type SortBy = "name" | "modified" | "created" | "manual";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function label(item: TreeItem): string {
  return item.kind === "folder" ? item.folder.name : item.note.title;
}

function timestamp(item: TreeItem, key: "modified" | "created"): string {
  // Folders carry no timestamp; treat as empty so they fall back to name order.
  return item.kind === "note" ? (item.note[key] ?? "") : "";
}

/** Build the ordered list of a folder's direct children (subfolders + notes). */
export function orderedItems(
  node: FolderNode,
  sortBy: SortBy,
  sortDir: "asc" | "desc",
  itemOrder: Record<string, string[]>,
): TreeItem[] {
  const folders: TreeItem[] = node.children.map((f) => ({ kind: "folder", key: f.path, folder: f }));
  const notes: TreeItem[] = node.notes.map((n) => ({ kind: "note", key: n.path, note: n }));
  const dir = sortDir === "desc" ? -1 : 1;

  if (sortBy === "manual") {
    const order = itemOrder[node.path] ?? [];
    const pos = new Map(order.map((k, i) => [k, i] as const));
    // Listed items keep their explicit order; unlisted ones fall to the end,
    // folders-before-notes then alphabetical, so freshly created/external items
    // stay predictable.
    return [...folders, ...notes].sort((a, b) => {
      const pa = pos.has(a.key) ? (pos.get(a.key) as number) : Infinity;
      const pb = pos.has(b.key) ? (pos.get(b.key) as number) : Infinity;
      if (pa !== pb) return pa - pb;
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return collator.compare(label(a), label(b));
    });
  }

  const cmp = (a: TreeItem, b: TreeItem): number => {
    if (sortBy === "modified" || sortBy === "created") {
      const ta = timestamp(a, sortBy);
      const tb = timestamp(b, sortBy);
      if (ta && tb && ta !== tb) return dir * (ta < tb ? -1 : 1);
    }
    return dir * collator.compare(label(a), label(b));
  };
  // Folders first, then notes (the existing convention), each sorted within group.
  return [...folders.sort(cmp), ...notes.sort(cmp)];
}

/** Find a folder node by its vault-relative path ("" = root). */
export function findFolder(root: FolderNode, path: string): FolderNode | null {
  if (path === "" || path === root.path) return root;
  for (const child of root.children) {
    if (child.path === path) return child;
    if (path.startsWith(child.path + "/")) {
      const found = findFolder(child, path);
      if (found) return found;
    }
  }
  return null;
}
