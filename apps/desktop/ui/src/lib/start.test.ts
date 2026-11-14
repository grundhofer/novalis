import { afterEach, describe, expect, it, vi } from "vitest";

import { commands } from "../ipc/client";
import { failStart, holdStart, releaseStart, START_FALLBACK_MS, watchStartEnd } from "./start";

vi.mock("../ipc/client", () => ({
  commands: { startEnded: vi.fn() },
  unwrap: vi.fn().mockResolvedValue(null),
}));

describe("the start's hold", () => {
  afterEach(() => {
    releaseStart();
    delete window.sbStart;
    vi.mocked(commands.startEnded).mockClear();
  });

  it("holds sb-start.js once and releases it once", () => {
    const sbStart = { hold: vi.fn(), release: vi.fn(), fail: vi.fn() };
    window.sbStart = sbStart;
    holdStart();
    holdStart();
    expect(sbStart.hold).toHaveBeenCalledTimes(1);
    releaseStart();
    releaseStart();
    expect(sbStart.release).toHaveBeenCalledTimes(1);
  });

  // spec/03 §14.1, NV-E5: a load that failed ends the start at once,
  // whatever else holds it, so the tile never covers the reason.
  it("ends the start with sbStart.fail() when loading failed, once", () => {
    const sbStart = { hold: vi.fn(), release: vi.fn(), fail: vi.fn() };
    window.sbStart = sbStart;
    holdStart();
    failStart();
    failStart();
    releaseStart();
    expect(sbStart.fail).toHaveBeenCalledTimes(1);
    expect(sbStart.release).not.toHaveBeenCalled();
  });

  // STR-01: a start whose animation never finishes (a hidden webview) does
  // not leave its ground over the app.
  it("ends a start that is still on a second after the release", () => {
    vi.useFakeTimers();
    try {
      window.sbStart = { hold: vi.fn(), release: vi.fn(), fail: vi.fn() };
      const root = document.documentElement;
      root.classList.add("sb-starting");
      const overlay = document.createElement("div");
      overlay.className = "sb-start is-moving";
      document.body.prepend(overlay);
      const target = document.createElement("span");
      target.setAttribute("data-sb-start-target", "");
      target.style.visibility = "hidden";
      document.body.append(target);

      holdStart();
      releaseStart();
      vi.advanceTimersByTime(START_FALLBACK_MS - 1);
      expect(root.classList.contains("sb-starting")).toBe(true);
      vi.advanceTimersByTime(1);
      expect(root.classList.contains("sb-starting")).toBe(false);
      expect(overlay.classList.contains("is-moving")).toBe(false);
      expect(target.style.visibility).toBe("");
      // ADR-0052: the window leaves the start's ground with it.
      expect(commands.startEnded).toHaveBeenCalledTimes(1);
      overlay.remove();
      target.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  // The script runs only after `load`: before it, the start has not begun
  // and is not ended.
  it("counts the second from the page's load when it comes after the release", () => {
    vi.useFakeTimers();
    const readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    try {
      window.sbStart = { hold: vi.fn(), release: vi.fn(), fail: vi.fn() };
      const root = document.documentElement;
      root.classList.add("sb-starting");
      holdStart();
      releaseStart();
      vi.advanceTimersByTime(START_FALLBACK_MS * 3);
      expect(root.classList.contains("sb-starting")).toBe(true);
      readyState.mockReturnValue("complete");
      window.dispatchEvent(new Event("load"));
      vi.advanceTimersByTime(START_FALLBACK_MS - 1);
      expect(root.classList.contains("sb-starting")).toBe(true);
      vi.advanceTimersByTime(1);
      expect(root.classList.contains("sb-starting")).toBe(false);
    } finally {
      readyState.mockRestore();
      vi.useRealTimers();
    }
  });

  it("leaves a start alone that ended by itself", () => {
    vi.useFakeTimers();
    try {
      window.sbStart = { hold: vi.fn(), release: vi.fn(), fail: vi.fn() };
      const target = document.createElement("span");
      target.setAttribute("data-sb-start-target", "");
      target.style.visibility = "hidden";
      document.body.append(target);
      holdStart();
      releaseStart();
      vi.advanceTimersByTime(START_FALLBACK_MS);
      // No `sb-starting`: the script finished, nothing is touched.
      expect(target.style.visibility).toBe("hidden");
      expect(commands.startEnded).not.toHaveBeenCalled();
      target.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing without the script", () => {
    expect(() => {
      holdStart();
      releaseStart();
    }).not.toThrow();
  });
});

// ADR-0052: the window opens in novalis's tile colour, the start's ground,
// and takes the stored one when the start is over.
describe("the window's ground after the start", () => {
  afterEach(() => {
    delete window.sbStart;
    vi.mocked(commands.startEnded).mockClear();
  });

  it("stays the start's until sb-start-done, then is the stored one, once", () => {
    window.sbStart = { done: false, hold: vi.fn(), release: vi.fn(), fail: vi.fn() };
    watchStartEnd();
    expect(commands.startEnded).not.toHaveBeenCalled();
    document.dispatchEvent(new CustomEvent("sb-start-done"));
    expect(commands.startEnded).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new CustomEvent("sb-start-done"));
    expect(commands.startEnded).toHaveBeenCalledTimes(1);
  });

  it("is the stored one at once when the start is over or the script is missing", () => {
    window.sbStart = { done: true, hold: vi.fn(), release: vi.fn(), fail: vi.fn() };
    watchStartEnd();
    expect(commands.startEnded).toHaveBeenCalledTimes(1);
    delete window.sbStart;
    watchStartEnd();
    expect(commands.startEnded).toHaveBeenCalledTimes(2);
  });
});
