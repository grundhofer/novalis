import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EntryDto } from "../ipc/client";
import { treeRows, useVault } from "./vault";

// The store reaches the shell through `../ipc/client`; a store test has no
// Tauri to talk to, so the boundary is mocked and only the store's own logic
// runs (ADR-0011).
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: () => ({}),
}));

function entry(path: string, overrides: Partial<EntryDto> = {}): EntryDto {
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    dir: false,
    size: "0",
    mtimeNs: "0",
    cloudOnly: false,
    boardSlug: null,
    conflictCopyOf: null,
    ...overrides,
  };
}

const paths = (rows: ReturnType<typeof treeRows>) => rows.map((row) => row.entry.path);

describe("treeRows", () => {
  // The root as the shell lists it: folders first, then names ascending.
  const children = {
    "": [
      entry("Notes", { dir: true }),
      entry("a.md", { mtimeNs: "1000000000" }),
      entry("b.md", { mtimeNs: "3000000000" }),
      entry("c.md", { mtimeNs: "2000000000" }),
    ],
    Notes: [entry("Notes/x.md", { mtimeNs: "5000000000" }), entry("Notes/y.md", { mtimeNs: "9000000000" })],
  };

  it("keeps the stored order under the name sort", () => {
    expect(paths(treeRows(children, { Notes: true }, "name", []))).toEqual([
      "Notes",
      "Notes/x.md",
      "Notes/y.md",
      "a.md",
      "b.md",
      "c.md",
    ]);
  });

  it("orders the files of every folder newest first under the modified sort", () => {
    expect(paths(treeRows(children, { Notes: true }, "modified", []))).toEqual([
      "Notes",
      "Notes/y.md",
      "Notes/x.md",
      "b.md",
      "c.md",
      "a.md",
    ]);
  });

  // `mtimeNs` is a decimal string past 2^53 (see `compareNs`); the tie falls
  // back to the name so two notes saved in the same instant have a fixed order.
  it("breaks an equal mtime on the name", () => {
    const same = { "": [entry("b.md", { mtimeNs: "7" }), entry("a.md", { mtimeNs: "7" })] };
    expect(paths(treeRows(same, {}, "modified", []))).toEqual(["a.md", "b.md"]);
  });

  // The sort is a file order (ADR-0012): a folder stays where the shell put
  // it, above the files, whichever sort is on and whatever order it arrived in.
  it("draws the folders first under both sorts, regardless of the stored order", () => {
    const mixed = {
      "": [entry("z.md", { mtimeNs: "9" }), entry("Notes", { dir: true }), entry("a.md", { mtimeNs: "1" })],
    };
    expect(paths(treeRows(mixed, {}, "name", []))).toEqual(["Notes", "z.md", "a.md"]);
    expect(paths(treeRows(mixed, {}, "modified", []))).toEqual(["Notes", "z.md", "a.md"]);
  });

  // In the list's own order: the shell puts dragged (keyed) boards first
  // and the rest by name (ADR-0019), so the tree does not sort again.
  it("appends the boards as root rows, in the list's order", () => {
    const rows = treeRows(children, {}, "name", [
      { slug: "zeta", name: "Zeta", order: "a0" },
      { slug: "atlas", name: "Atlas", order: null },
    ]);
    expect(paths(rows)).toEqual(["Notes", "a.md", "b.md", "c.md", "boards/zeta", "boards/atlas"]);
    expect(rows.at(-1)).toEqual({
      depth: 0,
      expanded: false,
      entry: {
        path: "boards/atlas",
        name: "Atlas",
        dir: true,
        size: "0",
        mtimeNs: "0",
        cloudOnly: false,
        boardSlug: "atlas",
        conflictCopyOf: null,
      },
    });
  });

  // The board's directory is also an entry of `boards/`; with that folder
  // expanded it used to be drawn there as well, under its directory name.
  // A `.wav` next to the notes is not the app's business (ADR-0015): it used
  // to be listed, and opening it read the whole file into a read-only tab.
  it("draws only the file types the app opens", () => {
    const mixed = {
      "": [entry("song.wav"), entry("a.md"), entry("scan.pdf"), entry("photo.jpg"), entry("clip.mp4")],
    };
    expect(paths(treeRows(mixed, {}, "name", []))).toEqual(["a.md", "scan.pdf", "photo.jpg"]);
  });

  it("skips a board directory met while walking, so a board is drawn once", () => {
    const withBoards = {
      "": [entry("boards", { dir: true }), entry("a.md")],
      boards: [entry("boards/atlas", { dir: true, boardSlug: "atlas" }), entry("boards/readme.md")],
    };
    const rows = treeRows(withBoards, { boards: true }, "name", [{ slug: "atlas", name: "Atlas", order: null }]);
    expect(paths(rows)).toEqual(["boards", "boards/readme.md", "a.md", "boards/atlas"]);
    expect(rows.filter((row) => row.entry.boardSlug === "atlas")).toHaveLength(1);
    expect(rows.at(-1)?.entry.name).toBe("Atlas");
  });

  // A sync client writes the folder in one watcher window and `board.json` in
  // the next: the listed entry has no `boardSlug` yet while the board list
  // already knows the board. Two rows with the same path would be two React
  // keys.
  it("skips a board directory the tree listed before its board.json arrived", () => {
    const withBoards = {
      "": [entry("boards", { dir: true })],
      boards: [entry("boards/foo", { dir: true })],
    };
    const rows = treeRows(withBoards, { boards: true }, "name", [{ slug: "foo", name: "Foo", order: null }]);
    expect(paths(rows)).toEqual(["boards", "boards/foo"]);
    expect(rows.at(-1)?.entry.boardSlug).toBe("foo");
  });
});

describe("useVault.touch", () => {
  beforeEach(() => {
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
      entry("a.md", { mtimeNs: "1", size: "10" }),
    ]);
  });

  // The watcher drops our own writes (§5.3 step 4), so the save path patches
  // the row itself; the other fields of the entry are kept as they were.
  it("merges the new mtime and size into a loaded folder's entry", () => {
    useVault.getState().touch("a.md", { mtimeNs: "2", size: "20" });
    expect(useVault.getState().children[""]).toEqual([entry("a.md", { mtimeNs: "2", size: "20" })]);
  });

  it("ignores a path whose folder is not loaded", () => {
    const before = useVault.getState().children;
    useVault.getState().touch("Notes/b.md", { mtimeNs: "2", size: "20" });
    expect(useVault.getState().children).toBe(before);
  });
});
