import { act, render } from "@testing-library/react";
import { createElement, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { measureArea, useCalloutArea } from "./calloutArea";

/** An area of `view` px showing `content` px, scrolled to `top`; jsdom lays nothing out. */
function sized(area: HTMLElement, view: number, content: number, top = 0): HTMLElement {
  Object.defineProperty(area, "clientHeight", { configurable: true, value: view });
  Object.defineProperty(area, "scrollHeight", { configurable: true, value: content });
  area.scrollTop = top;
  return area;
}

/** A box `top`..`bottom` px down the page. */
function placed(element: Element, top: number, bottom: number): void {
  element.getBoundingClientRect = () => ({ top, bottom, height: bottom - top }) as DOMRect;
}

// spec/02 §3.11, D142: D134's sign on a callout area that holds more than it
// shows, measured as sb-controls.js measures it (ADR-0051 #90).
describe("measureArea", () => {
  it("marks an area that scrolls, where its shown part stands, and makes it a tab stop", () => {
    const area = sized(document.createElement("div"), 100, 300, 100);
    placed(area, 0, 100);
    measureArea(area);
    expect(area.hasAttribute("data-sb-more")).toBe(true);
    expect(area.tabIndex).toBe(0);
    expect(area.getAttribute("data-sb-scroll-stop")).toBe("");
    // 100 of 300 px shown: a mark of 100 · 100 / 300 px, halfway down its room.
    expect(area.style.getPropertyValue("--sb-more-length")).toBe(`${(100 * 100) / 300}px`);
    expect(area.style.getPropertyValue("--sb-more-top")).toBe(`${((100 - (100 * 100) / 300) * 100) / 200}px`);
    expect(area.style.getPropertyValue("--sb-more-fade-from")).toBe("64px");
    expect(area.style.getPropertyValue("--sb-more-fade-rest")).toBe("0");
  });

  it("keeps the mark at least 12 px and weakens the fade near the end", () => {
    const area = sized(document.createElement("div"), 50, 5000, 4932);
    placed(area, 0, 50);
    measureArea(area);
    expect(area.style.getPropertyValue("--sb-more-length")).toBe("12px");
    // 18 of the last 36 px are left.
    expect(area.style.getPropertyValue("--sb-more-fade-rest")).toBe("0.5");
  });

  it("starts the fade below a control that reaches into it, and leaves it out under a cut one", () => {
    const area = sized(document.createElement("div"), 100, 300);
    placed(area, 0, 100);
    const button = area.appendChild(document.createElement("button"));
    placed(button, 60, 80);
    measureArea(area);
    expect(area.style.getPropertyValue("--sb-more-fade-from")).toBe("80px");
    placed(button, 90, 110);
    measureArea(area);
    expect(area.style.getPropertyValue("--sb-more-fade-from")).toBe("100px");
    expect(area.style.getPropertyValue("--sb-more-fade-rest")).toBe("1");
  });

  it("takes the sign and its own tab stop away once everything fits", () => {
    const area = sized(document.createElement("div"), 100, 300);
    placed(area, 0, 100);
    measureArea(area);
    sized(area, 100, 101);
    measureArea(area);
    expect(area.hasAttribute("data-sb-more")).toBe(false);
    expect(area.hasAttribute("tabindex")).toBe(false);
    expect(area.hasAttribute("data-sb-scroll-stop")).toBe(false);
    expect(area.style.getPropertyValue("--sb-more-length")).toBe("");
  });

  it("leaves a tabindex the page set itself alone", () => {
    const area = sized(document.createElement("div"), 100, 300);
    placed(area, 0, 100);
    area.tabIndex = -1;
    measureArea(area);
    expect(area.tabIndex).toBe(-1);
    sized(area, 100, 100);
    measureArea(area);
    expect(area.getAttribute("tabindex")).toBe("-1");
  });
});

describe("useCalloutArea", () => {
  const original = globalThis.ResizeObserver;
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  function Area({ notices }: { notices: number }) {
    const ref = useRef<HTMLDivElement>(null);
    useCalloutArea(ref);
    return createElement(
      "div",
      { ref, "data-testid": "area" },
      Array.from({ length: notices }, (_, index) => createElement("p", { key: index }, `notice ${index}`)),
    );
  }

  it("measures on a scroll, on a size change of the area or a notice, and for a notice added later", async () => {
    const observed: Element[] = [];
    let resized: (() => void) | null = null;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    const { getByTestId, rerender, unmount } = render(createElement(Area, { notices: 1 }));
    const area = getByTestId("area");
    placed(area, 0, 100);
    expect(observed).toEqual([area, area.firstElementChild]);
    expect(area.hasAttribute("data-sb-more")).toBe(false);

    sized(area, 100, 300);
    act(() => resized!());
    expect(area.hasAttribute("data-sb-more")).toBe(true);

    sized(area, 100, 300, 200);
    area.dispatchEvent(new Event("scroll"));
    expect(area.style.getPropertyValue("--sb-more-top")).toBe(`${100 - 100 / 3}px`);

    rerender(createElement(Area, { notices: 2 }));
    await act(async () => {});
    expect(observed).toContain(area.lastElementChild);

    unmount();
  });
});
