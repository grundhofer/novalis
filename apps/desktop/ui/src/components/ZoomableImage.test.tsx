import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ZoomableImage from "./ZoomableImage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));

/**
 * jsdom lays nothing out: the pane is given a size here, and the image its
 * natural size through a `load` event, which is all the component reads.
 */
function loadImage(width: number, height: number): HTMLImageElement {
  const img = screen.getByRole("img") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(img);
  return img;
}

const percent = () => screen.getByText(/^viewer\.zoom:/).textContent;
const pane = () => document.querySelector(".zoom-scroll") as HTMLElement;

describe("ZoomableImage", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fits the pane, and toggles to 1:1 and back with a click", () => {
    render(<ZoomableImage src="blob:1" alt="photo" />);
    const img = loadImage(2000, 1000);

    expect(percent()).toBe("viewer.zoom:50");
    expect(img.style.width).toBe("1000px");
    expect(screen.getByRole("button", { name: "viewer.fit" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(img);
    expect(percent()).toBe("viewer.zoom:100");
    expect(img.style.width).toBe("2000px");
    expect(img.className).toContain("zoomed");
    expect(screen.getByRole("button", { name: "viewer.fit" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(img);
    expect(percent()).toBe("viewer.zoom:50");
  });

  // „Einpassen“ fits the view's content box: `sb-reader__view` has its own
  // padding (space-4), which the room leaves out, or the page would stand
  // over the view's edge and scroll (seen with the comic).
  it("fits inside the view's padding", () => {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) =>
      (element as HTMLElement).classList.contains("zoom-scroll")
        ? ({ paddingLeft: "16px", paddingRight: "16px", paddingTop: "16px", paddingBottom: "16px" } as CSSStyleDeclaration)
        : real(element),
    );
    render(<ZoomableImage src="blob:1" alt="page" />);
    const img = loadImage(1000, 1000);
    // 500 high less 2 × 16 px: the page is 468 px square.
    expect(img.style.width).toBe("468px");
    expect(img.style.height).toBe("468px");
  });

  // spec/02 §4.18, NAV-10, ICO-06: tools with the sprite's icons and a word.
  it("zooms with sebaro's tools, „Einpassen“ among them", () => {
    const { container } = render(
      <ZoomableImage src="blob:1" alt="photo">
        <span>page tools</span>
      </ZoomableImage>,
    );
    loadImage(2000, 1000);

    // sebaro's reader row (spec/02 §4.25.3), the image on the view's ground.
    const bar = container.querySelector(".sb-doc-bar")!;
    expect(container.querySelector(".zoom-scroll")?.classList.contains("sb-reader__view")).toBe(true);
    // The view is a focus stop named after the image (spec/02 §4.25.3, D108 NV-Y7).
    expect(pane().tabIndex).toBe(0);
    expect(pane().getAttribute("role")).toBe("region");
    expect(pane().getAttribute("aria-label")).toBe(container.querySelector("img")?.getAttribute("alt"));
    expect(pane().getAttribute("aria-label")).toBeTruthy();
    // The bar is a named group of tools (NAV-10).
    expect(screen.getByRole("group", { name: "viewer.tools" })).toBe(bar);
    // What a reader adds comes first, at the bar's start.
    expect(bar.firstElementChild?.textContent).toBe("page tools");
    expect(bar.children[1]?.className).toBe("sb-doc-bar__sep");
    expect(bar.textContent).not.toMatch(/[−+]/);
    for (const [label, icon] of [
      ["viewer.zoomOut", "#zoom-out"],
      ["viewer.zoomIn", "#zoom-in"],
      ["viewer.fit", "#zoom-fit"],
    ]) {
      const tool = screen.getByRole("button", { name: label });
      expect(tool.className).toBe("sb-icon-button sb-icon-button--compact");
      expect(tool.querySelector("use")?.getAttribute("href")).toBe(icon);
      expect(document.getElementById(tool.getAttribute("aria-describedby") ?? "")?.getAttribute("role")).toBe(
        "tooltip",
      );
    }
    expect(screen.getByText(/^viewer\.zoom:/).parentElement?.className).toBe("sb-doc-bar__value");
    const fit = screen.getByRole("button", { name: "viewer.fit" });
    expect(fit.getAttribute("aria-pressed")).toBe("true");
    // The zoom tools, their value and the word wrap as one group at the end.
    const group = bar.lastElementChild!;
    expect(group.className).toBe("viewer-bar__group");
    expect(group.contains(fit)).toBe(true);
    expect(group.contains(screen.getByRole("button", { name: "viewer.zoomOut" }))).toBe(true);
  });

  it("never enlarges a small image to fit", () => {
    render(<ZoomableImage src="blob:1" alt="icon" />);
    const img = loadImage(200, 100);
    expect(percent()).toBe("viewer.zoom:100");
    expect(img.style.width).toBe("200px");
  });

  it("steps with the bar from the scale shown, and fits again", () => {
    render(<ZoomableImage src="blob:1" alt="photo" />);
    loadImage(2000, 1000);

    fireEvent.click(screen.getByLabelText("viewer.zoomIn"));
    expect(percent()).toBe("viewer.zoom:63");
    fireEvent.click(screen.getByLabelText("viewer.zoomOut"));
    fireEvent.click(screen.getByLabelText("viewer.zoomOut"));
    expect(percent()).toBe("viewer.zoom:40");
    fireEvent.click(screen.getByRole("button", { name: "viewer.fit" }));
    expect(percent()).toBe("viewer.zoom:50");
  });

  it("zooms on a Ctrl-wheel and a pinch, and leaves a plain wheel to scroll", () => {
    render(<ZoomableImage src="blob:1" alt="photo" />);
    loadImage(2000, 1000);

    // Not prevented: the pane scrolls as any other.
    expect(fireEvent.wheel(pane(), { deltaY: -25 })).toBe(true);
    expect(percent()).toBe("viewer.zoom:50");

    expect(fireEvent.wheel(pane(), { deltaY: -25, ctrlKey: true })).toBe(false);
    expect(percent()).toBe(`viewer.zoom:${Math.round(50 * Math.exp(0.25))}`);

    // WebKit's pinch: its own events, scaled from where the pinch began.
    fireEvent(pane(), new Event("gesturestart", { cancelable: true }));
    const change = Object.assign(new Event("gesturechange", { cancelable: true }), {
      scale: 2,
      clientX: 0,
      clientY: 0,
    });
    fireEvent(pane(), change);
    expect(change.defaultPrevented).toBe(true);
    expect(percent()).toBe(`viewer.zoom:${Math.round(100 * Math.exp(0.25))}`);
  });

  it("keeps the zoom when the image changes, as a comic's pages turn", () => {
    const { rerender } = render(<ZoomableImage src="blob:1" alt="page 1" />);
    const img = loadImage(2000, 1000);
    fireEvent.click(img);
    rerender(<ZoomableImage src="blob:2" alt="page 2" />);
    loadImage(2000, 1000);
    expect(percent()).toBe("viewer.zoom:100");
  });
});
