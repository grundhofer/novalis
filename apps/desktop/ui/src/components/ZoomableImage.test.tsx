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
    expect(screen.getByText("viewer.fit").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(img);
    expect(percent()).toBe("viewer.zoom:100");
    expect(img.style.width).toBe("2000px");
    expect(img.className).toContain("zoomed");
    expect(screen.getByText("viewer.fit").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(img);
    expect(percent()).toBe("viewer.zoom:50");
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
    fireEvent.click(screen.getByText("viewer.fit"));
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
