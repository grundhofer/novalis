import { describe, expect, it } from "vitest";

import { currentRow, outlineOf, type OutlineNode, type OutlineSource } from "./pdfOutline";

const node = (title: string, dest: OutlineNode["dest"], items: OutlineNode[] = []): OutlineNode => ({
  title,
  dest,
  items,
});

/** Page references are `{ num, gen }`; here page N's is `num: 100 + N - 1`. */
const ref = (page: number) => ({ num: 100 + page - 1, gen: 0 });

function source(outline: OutlineNode[] | null, named: Record<string, unknown[]> = {}): OutlineSource {
  return {
    getOutline: () => Promise.resolve(outline),
    getDestination: (id) => Promise.resolve(named[id] ?? null),
    getPageIndex: ({ num }) =>
      num === 999 ? Promise.reject(new Error("Invalid page reference")) : Promise.resolve(num - 100),
  };
}

describe("outlineOf", () => {
  it("flattens the outline depth-first with the page each entry leads to", async () => {
    const doc = source(
      [
        node("Introduction", [ref(1), { name: "XYZ" }]),
        node("Part One", "part-one", [
          node("Chapter 1", [ref(3), { name: "Fit" }]),
          node("Chapter 2", [ref(7), { name: "Fit" }]),
        ]),
        node("  ", [ref(9)]),
      ],
      { "part-one": [ref(2), { name: "XYZ" }] },
    );

    expect(await outlineOf(doc, 10)).toEqual([
      { label: "Introduction", page: 1, depth: 0 },
      { label: "Part One", page: 2, depth: 0 },
      { label: "Chapter 1", page: 3, depth: 1 },
      { label: "Chapter 2", page: 7, depth: 1 },
      // An entry without a title is named by its page.
      { label: "9", page: 9, depth: 0 },
    ]);
  });

  it("takes a page index where a writer put one instead of a reference", async () => {
    expect(await outlineOf(source([node("Two", [1, { name: "Fit" }])]), 3)).toEqual([
      { label: "Two", page: 2, depth: 0 },
    ]);
  });

  it("leaves out what leads to no page and keeps its children one level up", async () => {
    const doc = source([
      // A web link has no destination; a grouping entry may have none either.
      node("Website", null, [node("Inside", [ref(2)])]),
      node("Missing name", "nowhere"),
      node("Broken reference", [{ num: 999, gen: 0 }]),
      node("Past the end", [ref(40)]),
      node("Last", [ref(4)]),
    ]);

    expect(await outlineOf(doc, 5)).toEqual([
      { label: "Inside", page: 2, depth: 0 },
      { label: "Last", page: 4, depth: 0 },
    ]);
  });

  it("is empty for a document without an outline", async () => {
    expect(await outlineOf(source(null), 3)).toEqual([]);
  });
});

describe("currentRow", () => {
  const rows = [
    { label: "A", page: 2, depth: 0 },
    { label: "B", page: 5, depth: 0 },
    { label: "B.1", page: 5, depth: 1 },
    { label: "C", page: 9, depth: 0 },
  ];

  it("is the last row that starts on or before the page", () => {
    expect(currentRow(rows, 1)).toBe(-1);
    expect(currentRow(rows, 2)).toBe(0);
    expect(currentRow(rows, 4)).toBe(0);
    expect(currentRow(rows, 5)).toBe(2);
    expect(currentRow(rows, 12)).toBe(3);
  });
});
