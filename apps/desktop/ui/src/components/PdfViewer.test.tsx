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
    useUi.setState({ message: null });
    // jsdom lays nothing out: the scroller is 0 wide, so fit-to-width
    // bottoms out at the minimum zoom. The tests reason about page numbers
    // and relative zoom, not pixels.
  });

  it("shows page 1 of 2 with its text layer, and moves with the buttons", async () => {
    render(<PdfViewer bytes={new Uint8Array([1, 2, 3])} name="Reiseplan" />);
    await flush();

    expect(rendered.at(-1)?.page).toBe(1);
    expect(textLayers).toHaveLength(1);
    expect(screen.getByText("viewer.pageOf:2")).toBeTruthy();
    expect(screen.getByLabelText("viewer.previousPage").getAttribute("aria-disabled")).toBe("true");

    const next = screen.getByLabelText("viewer.nextPage");
    next.focus();
    fireEvent.click(next);
    await flush();
    expect(rendered.at(-1)?.page).toBe(2);
    // The tool that disabled itself by its press keeps the focus (and so
    // the pane's keys), and a further press does nothing.
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect((next as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(next);
    fireEvent.click(next);
    await flush();
    expect(rendered.at(-1)?.page).toBe(2);
    expect((screen.getByLabelText("viewer.page") as HTMLInputElement).value).toBe("2");
  });

  it("clamps a typed page number to the document", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} name="Reiseplan" />);
    await flush();

    fireEvent.change(screen.getByLabelText("viewer.page"), { target: { value: "9" } });
    await flush();
    expect(rendered.at(-1)?.page).toBe(2);
  });

  it("zooms in steps from the current scale and back to fit width", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} name="Reiseplan" />);
    await flush();
    const start = rendered.at(-1)!.scale;

    fireEvent.click(screen.getByLabelText("viewer.zoomIn"));
    await flush();
    expect(rendered.at(-1)!.scale).toBeCloseTo(start * 1.25);
    expect(screen.getByRole("button", { name: "viewer.fitWidth" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "viewer.fitWidth" }));
    await flush();
    expect(rendered.at(-1)!.scale).toBeCloseTo(start);
  });

  it("turns the page with the viewer keys while the pane has focus", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} name="Reiseplan" />);
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

  // spec/02 §4.21: ← → in the tab list choose and focus a tab; the PDF it
  // shows must not take the focus from the tab list.
  it("but leaves the focus in the tab list that chose the PDF", async () => {
    const strip = document.createElement("div");
    strip.setAttribute("role", "tablist");
    const tab = document.createElement("button");
    tab.setAttribute("role", "tab");
    strip.append(tab);
    document.body.append(strip);
    tab.focus();

    render(<PdfViewer bytes={new Uint8Array([1])} name="Reiseplan" />);
    await flush();
    expect(document.activeElement).toBe(tab);
    fireEvent.keyDown(tab, { code: "ArrowRight", key: "ArrowRight" });
    await flush();
    expect(rendered.at(-1)?.page).toBe(1);
    strip.remove();
  });

  it("leaves the page field its own keys", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} name="Reiseplan" />);
    await flush();
    const field = screen.getByLabelText("viewer.page");

    expect(fireEvent.keyDown(field, { code: "End", key: "End" })).toBe(true);
    expect(fireEvent.keyDown(field, { code: "ArrowRight", key: "ArrowRight" })).toBe(true);
    await flush();
    expect(rendered.at(-1)?.page).toBe(1);
  });

  it("has no contents button for a document without an outline", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} name="Reiseplan" />);
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
    render(<PdfViewer bytes={new Uint8Array([1])} name="Reiseplan" />);
    await flush();

    const toggle = screen.getByRole("button", { name: "viewer.outline" });
    expect(toggle.className).toBe("sb-secondary-action sb-secondary-action--compact");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.hasAttribute("aria-controls")).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // sebaro's overlay look with window rows; the toggle names what it opened.
    const popover = screen.getByRole("navigation", { name: "viewer.outline" });
    expect(toggle.getAttribute("aria-controls")).toBe(popover.id);
    expect(popover.getAttribute("data-sb-density")).toBe("window");
    // sebaro's contents over a reader (spec/02 §4.5, D102 (34)).
    expect(popover.className).toBe("sb-toc sb-toc--overlay viewer-contents");
    expect(popover.querySelector(":scope > ol > li > a")).toBeTruthy();
    const rows = screen.getAllByRole("link", { name: /Cover|Part|Chapter|Website/ });
    expect(rows.map((row) => row.textContent)).toEqual(["Cover", "Part", "Chapter"]);
    // The place the reader is in (NAV-01): aria-current, no class of its own.
    expect(rows.map((row) => row.getAttribute("aria-current"))).toEqual([null, "location", null]);
    expect(rows[2]?.style.getPropertyValue("--depth")).toBe("1");

    // A row was a button: Space jumps as Enter does.
    fireEvent.keyDown(screen.getByText("Chapter"), { key: " " });
    await flush();
    expect(rendered.at(-1)?.page).toBe(2);
    expect(screen.queryByText("Cover")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole("link", { name: "Chapter" }).getAttribute("aria-current")).toBe("location");
    expect(screen.getByRole("link", { name: "Part" }).hasAttribute("aria-current")).toBe(false);
    // Escape from a row hands the focus back to the toggle (spec/02 §4.10).
    screen.getByRole("link", { name: "Part" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Chapter")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  // spec/02 §4.18, NAV-10, ICO-06, EIN-01, SCH-03: sebaro's bar.
  it("builds its bar from sebaro's tools, words, field and counters", async () => {
    render(<PdfViewer bytes={new Uint8Array([1])} name="Reiseplan" />);
    await flush();

    // The pane is a region named after the file and says which keys it takes.
    const pane = screen.getByRole("region", { name: "Reiseplan" });
    expect(pane.getAttribute("aria-keyshortcuts")).toBe("ArrowLeft ArrowRight PageUp PageDown Home End");

    // sebaro's reader (spec/02 §4.25.3, D104 (5)–(7)): its row over the
    // document, the page on the view's sunken ground.
    expect(pane.classList.contains("sb-reader")).toBe(true);
    expect(pane.querySelector(".pdf-scroll")?.classList.contains("sb-reader__view")).toBe(true);
    const bar = pane.querySelector(".viewer-head > .sb-doc-bar")!;
    // The bar is a named group of tools (NAV-10).
    expect(screen.getByRole("group", { name: "viewer.tools" })).toBe(bar);
    // Tools: an icon of the sprite, a name, a tooltip; no glyph as an icon.
    expect(bar.textContent).not.toMatch(/[‹›×−+]/);
    const icons = (label: string) => {
      const tool = screen.getByRole("button", { name: label });
      expect(tool.className).toBe("sb-icon-button sb-icon-button--compact");
      const tip = document.getElementById(tool.getAttribute("aria-describedby") ?? "");
      expect(tip?.getAttribute("role")).toBe("tooltip");
      return [tool.querySelector("use")?.getAttribute("href"), tool.getAttribute("aria-keyshortcuts")];
    };
    expect(icons("viewer.previousPage")).toEqual(["#chevron-left", "ArrowLeft"]);
    expect(icons("viewer.nextPage")).toEqual(["#chevron-right", "ArrowRight"]);
    expect(icons("viewer.zoomOut")).toEqual(["#zoom-out", null]);
    expect(icons("viewer.zoomIn")).toEqual(["#zoom-in", null]);
    expect(icons("viewer.fitWidth")).toEqual(["#zoom-fit", null]);
    // On the first page „Vorherige Seite“ cannot run: disabled, and greyed
    // by sebaro.css, not by opacity (STA-03).
    expect(screen.getByRole("button", { name: "viewer.previousPage" }).getAttribute("aria-disabled")).toBe("true");

    // The page field „Seite [n] von m“ with its visible label (EIN-01,
    // spec/02 §4.25.3).
    const field = screen.getByLabelText("viewer.page");
    expect(field.closest(".sb-field")?.className).toBe("sb-field sb-field--compact sb-field--number");
    expect(field.closest(".sb-field")?.querySelector("label.sb-field__label")?.textContent).toBe("viewer.page");
    expect(field.nextElementSibling?.className).toBe("sb-field__suffix");
    expect(field.nextElementSibling?.textContent).toBe("viewer.pageOf:2");
    // The zoom value, a status with its hidden name.
    const value = screen.getByText(/^viewer\.zoom:/).parentElement!;
    expect(value.className).toBe("sb-doc-bar__value");
    expect(value.getAttribute("role")).toBe("status");
    expect(value.querySelector(".sb-visually-hidden")?.textContent).toBe("viewer.zoomName ");
    expect(bar.querySelector(".sb-doc-bar__sep")?.getAttribute("aria-hidden")).toBe("true");

    // „Seitenbreite“ is the fit tool with `zoom-fit`, pressed while fitted.
    const width = screen.getByRole("button", { name: "viewer.fitWidth" });
    expect(width.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "viewer.zoomIn" }));
    await flush();
    expect(width.getAttribute("aria-pressed")).toBe("false");
    // The zoom tools, their value and the fit tool wrap as one group.
    const group = width.closest(".viewer-bar__group")!;
    expect(group.parentElement).toBe(bar);
    expect([...group.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
      "viewer.zoomOut",
      "viewer.zoomIn",
      "viewer.fitWidth",
    ]);
  });

  // ZUG-09: at „Seitenbreite“ the page fits the scroller's content box —
  // its padding (rem, so larger at a large root font) and the sheet's frame
  // taken off — and no horizontal scrollbar appears.
  it("fits the page into the scroller less its padding and the sheet's frame", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      if (element.classList.contains("pdf-scroll")) {
        return { paddingLeft: "32px", paddingRight: "32px" } as CSSStyleDeclaration;
      }
      if (element.classList.contains("pdf-sheet")) {
        return { borderLeftWidth: "1px", borderRightWidth: "1px" } as CSSStyleDeclaration;
      }
      return real(element, pseudo);
    });
    try {
      render(<PdfViewer bytes={new Uint8Array([1])} name="Reiseplan" />);
      await flush();
      // The page is 100 points wide: (400 − 2 × 32 − 2 × 1) / 100.
      expect(rendered.at(-1)!.scale).toBeCloseTo(3.34);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
