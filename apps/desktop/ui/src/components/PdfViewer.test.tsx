import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../stores/ui";
import PdfViewer from "./PdfViewer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));
vi.mock("../ipc/client", () => ({
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf.worker.mjs" }));

// A two-page document, 100 points wide, that records what was rendered. Its
// outline is the test's; a page reference is `{ num: N, gen: 0 }` for page N.
const rendered: { page: number; scale: number }[] = [];
const textLayers: number[] = [];
let outline: { title: string; dest: unknown; items: unknown[] }[] | null = null;
vi.mock("pdfjs-dist", () => {
  const page = (number: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 150 * scale, scale }),
    render: ({ viewport }: { viewport: { scale: number } }) => {
      rendered.push({ page: number, scale: viewport.scale });
      return { promise: Promise.resolve(), cancel: vi.fn() };
    },
    // A stream stand-in: the layer is mocked too, so only the hand-over counts.
    streamTextContent: () => ({ getReader: () => ({ read: () => Promise.resolve({ done: true }) }) }),
  });
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: (n: number) => Promise.resolve(page(n)),
        getOutline: () => Promise.resolve(outline),
        getDestination: () => Promise.resolve(null),
        getPageIndex: ({ num }: { num: number }) => Promise.resolve(num - 1),
      }),
      destroy: () => Promise.resolve(),
    }),
    TextLayer: class {
      constructor({ viewport, textContentSource }: { viewport: { scale: number }; textContentSource: unknown }) {
        // The source must be the stream: `getTextContent()` iterates it with
        // `for await`, which WebKit's ReadableStream lacks.
        if (typeof (textContentSource as { getReader?: unknown }).getReader !== "function") {
          throw new Error("text layer needs a stream");
        }
        textLayers.push(viewport.scale);
      }
      render() {
        return Promise.resolve();
      }
    },
  };
});

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("PdfViewer", () => {
  beforeEach(() => {
    rendered.length = 0;
    textLayers.length = 0;
    outline = null;
    useUi.setState({ toast: null });
    // jsdom lays nothing out: the scroller is 0 wide, so fit-to-width
    // bottoms out at the minimum zoom. The tests reason about page numbers
    // and relative zoom, not pixels.
  });

  it("shows page 1 of 2 with its text layer, and moves with the buttons", async () => {
    render(<PdfViewer bytes={new Uint8Array([1, 2, 3])} />);
    await flush();

    expect(rendered.at(-1)?.page).toBe(1);
    expect(textLayers).toHaveLength(1);
    expect(screen.getByText("viewer.pageOf:2")).toBeTruthy();
    expect((screen.getByLabelText("viewer.previousPage") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("viewer.nextPage"));
    await flush();
    expect(rendered.at(-1)?.page).toBe(2);
    expect((screen.getByLabelText("viewer.nextPage") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("viewer.page") as HTMLInputElement).value).toBe("2");
  });

  it("clamps a typed page number to the document", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} />);
    await flush();

    fireEvent.change(screen.getByLabelText("viewer.page"), { target: { value: "9" } });
    await flush();
    expect(rendered.at(-1)?.page).toBe(2);
  });

  it("zooms in steps from the current scale and back to fit width", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} />);
    await flush();
    const start = rendered.at(-1)!.scale;

    fireEvent.click(screen.getByLabelText("viewer.zoomIn"));
    await flush();
    expect(rendered.at(-1)!.scale).toBeCloseTo(start * 1.25);
    expect((screen.getByText("viewer.fitWidth") as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByText("viewer.fitWidth"));
    await flush();
    expect(rendered.at(-1)!.scale).toBeCloseTo(start);
  });

  it("turns the page with the viewer keys while the pane has focus", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} />);
    await flush();
    const pane = document.querySelector("section.pdf") as HTMLElement;
    // It takes focus when it opens, as the editor does.
    expect(document.activeElement).toBe(pane);

    const press = async (code: string) => {
      const event = fireEvent.keyDown(document.activeElement ?? pane, { code, key: code });
      await flush();
      return event;
    };
    expect(await press("ArrowRight")).toBe(false); // default prevented
    expect(rendered.at(-1)?.page).toBe(2);
    await press("ArrowLeft");
    expect(rendered.at(-1)?.page).toBe(1);
    await press("PageDown");
    expect(rendered.at(-1)?.page).toBe(2);
    await press("PageUp");
    expect(rendered.at(-1)?.page).toBe(1);
    await press("End");
    expect(rendered.at(-1)?.page).toBe(2);
    await press("Home");
    expect(rendered.at(-1)?.page).toBe(1);
    // A key the viewer scope does not name is left alone.
    expect(await press("ArrowDown")).toBe(true);
    // So is a chord with a modifier: Cmd+Right is the system's.
    expect(fireEvent.keyDown(pane, { code: "ArrowRight", key: "ArrowRight", metaKey: true })).toBe(true);
    await flush();
    expect(rendered.at(-1)?.page).toBe(1);
  });

  it("leaves the page field its own keys", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} />);
    await flush();
    const field = screen.getByLabelText("viewer.page");

    expect(fireEvent.keyDown(field, { code: "End", key: "End" })).toBe(true);
    expect(fireEvent.keyDown(field, { code: "ArrowRight", key: "ArrowRight" })).toBe(true);
    await flush();
    expect(rendered.at(-1)?.page).toBe(1);
  });

  it("has no contents button for a document without an outline", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} />);
    await flush();
    expect(screen.queryByText("viewer.outline")).toBeNull();
  });

  it("opens the outline, marks where the reader is and goes to a picked entry", async () => {
    outline = [
      { title: "Cover", dest: [{ num: 1, gen: 0 }, { name: "Fit" }], items: [] },
      {
        title: "Part",
        dest: [{ num: 1, gen: 0 }, { name: "Fit" }],
        items: [{ title: "Chapter", dest: [{ num: 2, gen: 0 }, { name: "Fit" }], items: [] }],
      },
      { title: "Website", dest: null, items: [] },
    ];
    render(<PdfViewer bytes={new Uint8Array([1])} />);
    await flush();

    fireEvent.click(screen.getByText("viewer.outline"));
    const rows = screen.getAllByRole("button", { name: /Cover|Part|Chapter|Website/ });
    expect(rows.map((row) => row.textContent)).toEqual(["Cover", "Part", "Chapter"]);
    expect(rows[1]?.className).toContain("on");
    expect(rows[2]?.style.getPropertyValue("--depth")).toBe("1");

    fireEvent.click(screen.getByText("Chapter"));
    await flush();
    expect(rendered.at(-1)?.page).toBe(2);
    expect(screen.queryByText("Cover")).toBeNull();

    fireEvent.click(screen.getByText("viewer.outline"));
    expect(screen.getByText("Chapter").className).toContain("on");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Chapter")).toBeNull();
  });
});
