import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commands, unwrap, type EntryDto } from "../ipc/client";
import { useVault } from "../stores/vault";
import Waiting, { WAITING_LONG_MS, WAITING_SILENT_MS } from "./Waiting";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => (values?.name ? `${key}:${values.name}` : key),
  }),
}));
vi.mock("../ipc/client", () => ({ commands: { listDir: vi.fn() }, unwrap: vi.fn() }));

const entry = (path: string, cloudOnly: boolean) =>
  ({ path, name: path.split("/").pop(), dir: false, cloudOnly }) as unknown as EntryDto;

const later = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("Waiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(unwrap).mockReturnValue(new Promise(() => {}));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(unwrap).mockReset();
    vi.mocked(commands.listDir).mockReset();
    useVault.setState({ children: {}, loading: {} });
  });

  // STA-06, ADR-0051 #27.8: a cloud file is silent under a second, named after it.
  it("names a cloud file's wait after a second", () => {
    useVault.setState({ children: { books: [entry("books/b.epub", true)] } });
    const { container } = render(<Waiting path="books/b.epub" />);
    const pane = container.querySelector(".sb-view__content")!;
    expect(pane.getAttribute("aria-busy")).toBe("true");
    expect(pane.textContent).toBe("");

    later(WAITING_SILENT_MS - 1);
    expect(pane.textContent).toBe("");
    later(1);
    expect(pane.textContent).toBe("editor.loading");
    expect(WAITING_SILENT_MS).toBe(1000);
  });

  // spec/02 §3.12, spec/07 §4.5: sebaro's `sb-loading`, a live region that is
  // there from the start, the turning `loader` before the words.
  it("shows sebaro's loading line with the spinner in a live region", () => {
    useVault.setState({ children: { books: [entry("books/b.epub", true)] } });
    const { container } = render(<Waiting path="books/b.epub" />);
    const region = container.querySelector(".sb-view__content > p.sb-loading")!;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.childNodes).toHaveLength(0);

    later(WAITING_SILENT_MS);
    expect(container.querySelector(".sb-view__content > p.sb-loading")).toBe(region);
    const spinner = region.firstElementChild!;
    expect(spinner.getAttribute("class")).toBe("sb-icon sb-icon--20 sb-spinner");
    expect(spinner.getAttribute("aria-hidden")).toBe("true");
    expect(spinner.querySelector("use")?.getAttribute("href")).toBe("#loader");
    expect(region.textContent).toBe("editor.loading");
  });

  // STA-06: over 10 s the line says what is happening, the spinner stays.
  it("says after 10 s which file is downloaded", () => {
    useVault.setState({ children: { books: [entry("books/Ein-Buch.epub", true)] } });
    const { container } = render(<Waiting path="books/Ein-Buch.epub" />);
    const region = container.querySelector("p.sb-loading")!;
    later(WAITING_LONG_MS - 1);
    expect(region.textContent).toBe("editor.loading");
    later(1);
    expect(region.querySelector(".sb-spinner")).toBeTruthy();
    expect(region.textContent).toBe("editor.downloading:Ein-Buch.epub");
    // The name breaks as a file name (D100 (6)).
    expect(region.querySelector(":scope > span > .sb-file-name")?.textContent).toBe("Ein-Buch.epub");
    expect(WAITING_LONG_MS).toBe(10_000);
  });

  it("stays silent for a local file past 10 s too", () => {
    useVault.setState({ children: { "": [entry("a.md", false)] } });
    const { container } = render(<Waiting path="a.md" />);
    later(WAITING_LONG_MS * 2);
    expect(container.querySelector("p.sb-loading")?.childNodes).toHaveLength(0);
    expect(container.querySelector(".sb-spinner")).toBeNull();
  });

  it("keeps a local read silent however long it takes", () => {
    useVault.setState({ children: { "": [entry("a.pdf", false)] } });
    const { container } = render(<Waiting path="a.pdf" />);
    const pane = container.querySelector(".sb-view__content")!;
    later(WAITING_SILENT_MS * 10);
    expect(pane.getAttribute("aria-busy")).toBe("true");
    expect(pane.textContent).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  // A file outside the vault (ADR-0047), a listed folder without the file's
  // row, and a pane without a path: silent, and nothing is listed.
  it("keeps a file it cannot know as cloud silent", () => {
    useVault.setState({ children: { other: [] } });
    for (const path of ["/Volumes/Stick/b.epub", "other/c.pdf", undefined]) {
      const { container, unmount } = render(<Waiting path={path} />);
      later(WAITING_SILENT_MS * 5);
      expect(container.textContent).toBe("");
      expect(vi.getTimerCount()).toBe(0);
      unmount();
    }
    expect(commands.listDir).not.toHaveBeenCalled();
  });

  it("drops its timer when the wait ends first", () => {
    useVault.setState({ children: { books: [entry("books/b.epub", true)] } });
    const { unmount } = render(<Waiting path="books/b.epub" />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  // Quick open, a link, search and the restored session can show a file
  // before its folder is listed; the row that arrives later still counts.
  it("names the wait when the row arrives after the pane", () => {
    const { container } = render(<Waiting path="scans/cloud.pdf" />);
    expect(commands.listDir).toHaveBeenCalledWith("scans");
    later(500);
    act(() => {
      useVault.setState({ children: { scans: [entry("scans/cloud.pdf", true)] } });
    });
    expect(container.textContent).toBe("");
    later(WAITING_SILENT_MS - 500);
    expect(container.textContent).toBe("editor.loading");
  });

  it("stays silent when the row that arrives says local", () => {
    const { container } = render(<Waiting path="scans/local.pdf" />);
    act(() => {
      useVault.setState({ children: { scans: [entry("scans/local.pdf", false)] } });
    });
    expect(vi.getTimerCount()).toBe(0);
    later(WAITING_SILENT_MS * 5);
    expect(container.textContent).toBe("");
  });

  // The finished download's watcher batch can clear `cloudOnly` before the
  // read returns: a wait once named stays named.
  it("keeps a named wait named when the row turns local", () => {
    useVault.setState({ children: { books: [entry("books/b.epub", true)] } });
    const { container } = render(<Waiting path="books/b.epub" />);
    later(WAITING_SILENT_MS);
    act(() => {
      useVault.setState({ children: { books: [entry("books/b.epub", false)] } });
    });
    expect(container.textContent).toBe("editor.loading");
  });

  it("lists an unlisted folder once, without opening it in the tree", () => {
    render(<Waiting path="a/b/c.pdf" />);
    render(<Waiting path="a/b/d.pdf" />);
    expect(commands.listDir).toHaveBeenCalledTimes(1);
    expect(commands.listDir).toHaveBeenCalledWith("a/b");
    expect(useVault.getState().expanded["a/b"]).toBeFalsy();
  });
});
