import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorSave } from "../stores/editorSave";
import TablePreview from "./TablePreview";

// jsdom has no layout, so the real virtualizer would draw no rows; every row
// is materialized instead, as in the tree's test (ADR-0011).
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, size: 28, start: index * 28 })),
  }),
}));

function doc(path: string, text: string) {
  useEditorSave.setState({ docs: { [path]: { path, text } as never } });
}

const texts = (role: string) => screen.queryAllByRole(role).map((cell) => cell.textContent);

describe("TablePreview", () => {
  beforeEach(() => {
    useEditorSave.setState({ docs: {} });
  });

  it("shows the first row as the header and the rest as rows, short rows padded", () => {
    doc("a.csv", 'city,people\n"Köln, Altstadt",120\nBonn\n');
    render(<TablePreview path="a.csv" kind="csv" />);

    expect(texts("columnheader")).toEqual(["city", "people"]);
    expect(texts("row")).toHaveLength(3);
    expect(texts("cell")).toEqual(["Köln, Altstadt", "120", "Bonn", ""]);
    // A cell cut by its column shows in full as its tooltip.
    expect(screen.getByText("Köln, Altstadt").getAttribute("title")).toBe("Köln, Altstadt");
  });

  it("splits a TSV on tabs", () => {
    doc("a.tsv", "a\tb\n1\t2, 3\n");
    render(<TablePreview path="a.tsv" kind="tsv" />);
    expect(texts("cell")).toEqual(["1", "2, 3"]);
  });

  it("follows the buffer, so an edit shows", () => {
    doc("a.csv", "x\n1\n");
    render(<TablePreview path="a.csv" kind="csv" />);
    act(() => doc("a.csv", "x\n1\n2\n"));
    expect(texts("cell")).toEqual(["1", "2"]);
  });

  it("gives every row the same columns, sized by the widest cell of any row", () => {
    doc("a.csv", "id,name\n1,Alexandria\n" + "2,x\n".repeat(600) + "12345,y\n");
    render(<TablePreview path="a.csv" kind="csv" />);
    const [head, row] = screen.getAllByRole("row");
    expect(head?.style.gridTemplateColumns).toBe("8ch 13ch");
    expect(row?.style.gridTemplateColumns).toBe("8ch 13ch");
  });
});
