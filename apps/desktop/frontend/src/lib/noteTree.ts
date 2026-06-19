import type { FolderNode, NoteSummary } from "../ipc/api";

/** Append every note in `node` and its descendants to `out` (depth-first). */
export function flattenNotes(node: FolderNode, out: NoteSummary[]): void {
  for (const n of node.notes) out.push(n);
  for (const c of node.children) flattenNotes(c, out);
}

/** Collect every note in the vault tree into a flat list. */
export function collectNotes(tree: FolderNode | null): NoteSummary[] {
  if (!tree) return [];
  const out: NoteSummary[] = [];
  flattenNotes(tree, out);
  return out;
}

/** A folder in the vault tree, identified by its vault-relative path. */
export interface FolderRef {
  path: string;
  name: string;
}

/** Collect every folder in the tree (depth-first), excluding the unnamed root
 *  (path === ""). */
export function collectFolders(tree: FolderNode | null): FolderRef[] {
  if (!tree) return [];
  const out: FolderRef[] = [];
  const walk = (node: FolderNode): void => {
    if (node.path) out.push({ path: node.path, name: node.name });
    for (const c of node.children) walk(c);
  };
  walk(tree);
  return out;
}
