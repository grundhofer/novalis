import { afterEach, describe, expect, it, vi } from "vitest";

import { watchWindowActive } from "./windowActive";

describe("watchWindowActive", () => {
  const root = document.documentElement;

  afterEach(() => {
    delete root.dataset.sbWindowActive;
  });

  it("marks <html> with the window's focus and follows its changes", async () => {
    let onFocus: (event: { payload: boolean }) => void = () => undefined;
    const stop = vi.fn();
    const unwatch = watchWindowActive({
      isFocused: () => Promise.resolve(false),
      onFocusChanged: (handler) => {
        onFocus = handler;
        return Promise.resolve(stop);
      },
    });
    await vi.waitFor(() => expect(root.getAttribute("data-sb-window-active")).toBe("false"));
    onFocus({ payload: true });
    expect(root.getAttribute("data-sb-window-active")).toBe("true");
    onFocus({ payload: false });
    expect(root.getAttribute("data-sb-window-active")).toBe("false");
    unwatch();
    await vi.waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("counts a window that cannot answer as in front", async () => {
    const isFocused = vi.fn(() => Promise.reject(new Error("no window")));
    watchWindowActive({ isFocused, onFocusChanged: () => Promise.resolve(() => undefined) });
    await vi.waitFor(() => expect(isFocused).toHaveBeenCalled());
    expect(root.getAttribute("data-sb-window-active")).toBe("true");
  });
});
