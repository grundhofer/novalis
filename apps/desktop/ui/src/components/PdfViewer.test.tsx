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

// A two-page document, 100 points wide, that records what was rendered.
const rendered: { page: number; scale: number }[] = [];
const textLayers: number[] = [];
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
      promise: Promise.resolve({ numPages: 2, getPage: (n: number) => Promise.resolve(page(n)) }),
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
});
