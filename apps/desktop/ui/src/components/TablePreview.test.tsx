import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorSave } from "../stores/editorSave";
import TablePreview from "./TablePreview";

// jsdom has no layout, so the real virtualizer would draw no rows; every row
// is materialized instead, as in the tree's test (ADR-0011), at the height
// the table asks for.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: (index: number) => number }) => ({
    getTotalSize: () => count * estimateSize(0),
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: estimateSize(index),
        start: index * estimateSize(index),
      })),
    measure: () => {},
  }),
}));

function doc(path: string, text: string) {
  useEditorSave.setState({ docs: { [path]: { path, text } as never } });
}

const texts = (role: string) => screen.queryAllByRole(role).map((cell) => cell.textContent);

/** The export's tokens the row height is read from, at a root font size. */
function rootFont(fontSize: string) {
  const root = document.documentElement;
  root.style.fontSize = fontSize;
  root.style.setProperty("--sb-type-body-size", "1rem");
  root.style.setProperty("--sb-type-body-line-height", "1.5");
  root.style.setProperty("--sb-space-1", "0.25rem");
  root.style.setProperty("--sb-border-width-hairline", "1px");
}

describe("TablePreview", () => {
  beforeEach(() => {
    useEditorSave.setState({ docs: {} });
  });
  afterEach(() => {
    document.documentElement.removeAttribute("style");
    vi.unstubAllGlobals();
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
    // The last column takes the rest, so the row lines reach the pane's end.
    expect(head?.style.gridTemplateColumns).toBe("8ch minmax(13ch, 1fr)");
    expect(row?.style.gridTemplateColumns).toBe("8ch minmax(13ch, 1fr)");
  });

  // DAT-05, spec/02 §3.9: sebaro's table on the ARIA grid, in a region the
  // keyboard scrolls.
  it("is sebaro's table in a named, focusable region", () => {
    doc("data/a.csv", "x\n1\n");
    render(<TablePreview path="data/a.csv" kind="csv" />);
    const region = screen.getByRole("region", { name: "a.csv" });
    expect(region.tabIndex).toBe(0);
    expect(within(region).getByRole("table").className).toBe("table-inner sb-table");
    // A virtualised table cuts its cells on purpose (spec/02 §3.9, D102 (35)).
    expect(within(region).getByRole("table").getAttribute("data-sb-truncate")).toBe("");
  });

  // ADR-0051 #24, R2: one line per row, its height following the root font.
  it("sizes its rows at the root font, and again when it changes", () => {
    let resized: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    rootFont("16px");
    doc("a.csv", "x\n1\n");
    render(<TablePreview path="a.csv" kind="csv" />);
    const row = () => screen.getAllByRole("row")[1] as HTMLElement;
    expect(row().style.height).toBe("33px");

    rootFont("32px");
    act(() => resized?.());
    expect(row().style.height).toBe("65px");
  });
});
