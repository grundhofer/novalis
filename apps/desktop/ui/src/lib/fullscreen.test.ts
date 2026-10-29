import { afterEach, describe, expect, it, vi } from "vitest";

import { watchFullscreen } from "./fullscreen";

describe("watchFullscreen", () => {
  afterEach(() => {
    delete document.documentElement.dataset.sbFullscreen;
  });

  it("marks full screen on <html> and follows every resize", async () => {
    let full = true;
    let onResize: () => void = () => undefined;
    const stop = vi.fn();
    const unwatch = watchFullscreen({
      isFullscreen: () => Promise.resolve(full),
      onResized: (handler) => {
        onResize = handler;
        return Promise.resolve(stop);
      },
    });
    await vi.waitFor(() => expect(document.documentElement.hasAttribute("data-sb-fullscreen")).toBe(true));
    full = false;
    onResize();
    await vi.waitFor(() => expect(document.documentElement.hasAttribute("data-sb-fullscreen")).toBe(false));
    unwatch();
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("keeps the room when the window cannot answer", async () => {
    const isFullscreen = vi.fn(() => Promise.reject(new Error("no window")));
    watchFullscreen({ isFullscreen, onResized: () => Promise.resolve(() => undefined) });
    await vi.waitFor(() => expect(isFullscreen).toHaveBeenCalled());
    expect(document.documentElement.hasAttribute("data-sb-fullscreen")).toBe(false);
  });
});
