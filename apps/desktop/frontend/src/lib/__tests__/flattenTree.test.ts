import { describe, expect, it } from "vitest";

import type { FolderNode, NoteSummary } from "../../ipc/api";
import { flattenTree, type FlattenOpts } from "../flattenTree";

function note(path: string, title: string): NoteSummary {
  return {
    path,
    title,
    folder: "",
    tags: [],
    created: "",
    modified: "",
    pinned: false,
    wordCount: 0,
    taskTotal: 0,
    taskCompleted: 0,
    cloudOnly: false,
  };
}

function folder(
  path: string,
  name: string,
  children: FolderNode[],
  notes: NoteSummary[],
): FolderNode {
  return { path, name, children, notes };
}

// root
//   A/            (folder)
//     A/B/        (folder)
//       A/B/b1.md
//     A/a1.md
//   C/            (folder, empty)
//   m.md
//   z.md
function makeTree(): FolderNode {
  const ab = folder("A/B", "B", [], [note("A/B/b1.md", "b1")]);
  const a = folder("A", "A", [ab], [note("A/a1.md", "a1")]);
  const c = folder("C", "C", [], []);
  return folder("", "", [a, c], [note("m.md", "m"), note("z.md", "z")]);
}

const base: FlattenOpts = {
  sortBy: "name",
  sortDir: "asc",
  itemOrder: {},
  collapsed: new Set(),
  filter: "",
  newFolderParent: undefined,
};

const keys = (opts: Partial<FlattenOpts>) =>
  flattenTree(makeTree(), { ...base, ...opts }).map((r) => r.key);

describe("flattenTree", () => {
  it("depth-first flattens folders-before-notes, each sorted by name", () => {
    const rows = flattenTree(makeTree(), base);
    expect(rows.map((r) => r.key)).toEqual([
      "A",
      "A/B",
      "A/B/b1.md",
      "A/a1.md",
      "C",
      "m.md",
      "z.md",
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1, 0, 0, 0]);
  });

  it("carries the next *sibling* key for drag-reorder (not the next visual row)", () => {
    const rows = flattenTree(makeTree(), base);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    // A's next sibling is C even though A/B renders between them.
    expect(byKey.get("A")).toMatchObject({ nextKey: "C", parentPath: "" });
    // Last child of a folder / of the root has no next sibling.
    expect(byKey.get("A/a1.md")).toMatchObject({ nextKey: null, parentPath: "A" });
    expect(byKey.get("z.md")).toMatchObject({ nextKey: null });
  });

  it("hides the children of a collapsed folder", () => {
    expect(keys({ collapsed: new Set(["A"]) })).toEqual(["A", "C", "m.md", "z.md"]);
  });

  it("force-opens folders while filtering and keeps only matching branches", () => {
    expect(keys({ filter: "b1", collapsed: new Set(["A", "A/B"]) })).toEqual([
      "A",
      "A/B",
      "A/B/b1.md",
    ]);
  });

  it("appends the inline new-subfolder row at the end of its parent's children", () => {
    const rows = flattenTree(makeTree(), { ...base, newFolderParent: "A" });
    const idxA1 = rows.findIndex((r) => r.key === "A/a1.md");
    const newRow = rows[idxA1 + 1];
    expect(newRow.kind).toBe("new-folder");
    expect(newRow).toMatchObject({ depth: 1 });
    // Root's new-folder (parent null) is rendered above the tree, not here.
    expect(flattenTree(makeTree(), { ...base, newFolderParent: null })).toEqual(
      flattenTree(makeTree(), base),
    );
  });
});
