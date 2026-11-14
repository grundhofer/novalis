import { act, render } from "@testing-library/react";
import { createElement, useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { BLOCK_SIZE, useBlockSize } from "./blockSize";

// docs/sebaro-luecken.md Z12: a pane's room under its last line follows the
// pane's own height, which this hook writes on it.
describe("useBlockSize", () => {
  const original = globalThis.ResizeObserver;
  let observed: (() => void) | null = null;

  afterEach(() => {
    globalThis.ResizeObserver = original;
    observed = null;
  });

  function Pane({ ready }: { ready: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useBlockSize(ref, ready);
    return createElement("div", { ref, "data-testid": "pane" });
  }

  it("writes the pane's height while it shows, and takes it away after", () => {
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {
        observed = null;
      }
    } as unknown as typeof ResizeObserver;
    const { getByTestId, rerender } = render(createElement(Pane, { ready: true }));
    const pane = getByTestId("pane");
    pane.getBoundingClientRect = () => ({ height: 133 }) as DOMRect;
    act(() => observed?.());
    expect(pane.style.getPropertyValue(BLOCK_SIZE)).toBe("133px");
    // Hidden (the settings view), the pane measures 0: the last height stays.
    pane.getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    act(() => observed?.());
    expect(pane.style.getPropertyValue(BLOCK_SIZE)).toBe("133px");
    rerender(createElement(Pane, { ready: false }));
    expect(pane.style.getPropertyValue(BLOCK_SIZE)).toBe("");
    expect(observed).toBeNull();
  });

  it("does nothing without a ResizeObserver", () => {
    globalThis.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    const { getByTestId } = render(createElement(Pane, { ready: true }));
    expect(getByTestId("pane").style.getPropertyValue(BLOCK_SIZE)).toBe("");
  });
});
