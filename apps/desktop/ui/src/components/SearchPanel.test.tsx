import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type SearchEventDto } from "../ipc/client";
import { deferLine, takeDeferredLine } from "../lib/editorBridge";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import SearchPanel from "./SearchPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: { count?: number }) =>
      vars?.count === undefined ? key : `${key}=${vars.count}`,
  }),
}));

// No Tauri in jsdom: the channel is a box with an `onmessage` the mocked
// `search` fills, the way the shell streams hits.
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (event: SearchEventDto) => void = () => undefined;
  },
}));

vi.mock("../ipc/client", () => ({
  commands: { search: vi.fn(), tags: vi.fn().mockResolvedValue({ status: "ok", data: { tags: [] } }) },
  unwrap: async (call: Promise<{ status: string; data?: unknown; error?: unknown }>) => {
    const result = await call;
    if (result.status === "error") throw new Error(String(result.error));
    return result.data;
  },
  events: { cacheUpdated: { listen: vi.fn().mockResolvedValue(() => undefined) } },
}));

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 250)));

/** The results' text, whatever the marks split it into. */
const labels = () => [...document.querySelectorAll(".result-label")].map((label) => label.textContent);

/** A search answered with `hits`, as the shell streams them. */
function answer(hits: { path: string; line: number; snippet: string }[]) {
  vi.mocked(commands.search).mockImplementation(async (_query, channel) => {
    const box = channel as unknown as { onmessage: (event: SearchEventDto) => void };
    box.onmessage({ kind: "hits", hits });
    box.onmessage({ kind: "done", report: REPORT });
    return { status: "ok", data: REPORT };
  });
}

const REPORT = { scanned: 3, cloudOnlySkipped: 0, notUtf8Skipped: 2, matches: 2, truncated: false, cancelled: false };

describe("SearchPanel", () => {
  beforeEach(() => {
    useUi.setState({ overlay: { kind: "search" }, searchAllFiles: false, toast: null });
    useTabs.setState({ open: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(commands.search).mockReset();
  });

  // "All files" (ADR-0022 point 5): the shell scans every listed file and
  // sends only those hits, the footer names what the scan could not read;
  // the toggle outlives the panel for the session.
  it("sends allFiles, lists the hits and names what was skipped", async () => {
    vi.mocked(commands.search).mockImplementation(async (_query, channel) => {
      const box = channel as unknown as { onmessage: (event: SearchEventDto) => void };
      box.onmessage({
        kind: "hits",
        hits: [
          { path: "notes/a.md", line: 1, snippet: "needle in a note" },
          { path: "src/main.go", line: 7, snippet: "needle in Go" },
        ],
      });
      box.onmessage({ kind: "done", report: REPORT });
      return { status: "ok", data: REPORT };
    });
    useUi.getState().toggleSearchAllFiles();
    render(<SearchPanel />);

    fireEvent.change(screen.getByPlaceholderText("editor.search.placeholder"), { target: { value: "needle" } });
    await settle();

    expect(vi.mocked(commands.search).mock.calls.at(-1)?.[0]).toMatchObject({ query: "needle", allFiles: true });
    expect(labels()).toEqual(["needle in a note", "needle in Go"]);
    expect(screen.getByText("editor.search.results=2")).toBeTruthy();
    expect(screen.getByText("editor.search.notUtf8Skipped=2")).toBeTruthy();
    expect(useUi.getState().searchAllFiles).toBe(true);
  });

  it("searches notes only until the toggle is pressed", async () => {
    vi.mocked(commands.search).mockResolvedValue({ status: "ok", data: REPORT });
    render(<SearchPanel />);

    fireEvent.change(screen.getByPlaceholderText("editor.search.placeholder"), { target: { value: "x" } });
    await settle();
    expect(vi.mocked(commands.search).mock.calls.at(-1)?.[0]).toMatchObject({ allFiles: false });

    fireEvent.click(screen.getByTitle("editor.search.allFiles"));
    await settle();
    expect(vi.mocked(commands.search).mock.calls.at(-1)?.[0]).toMatchObject({ allFiles: true });
  });

  // docs/research/2026-09-20-feature-gaps.md A3/A12/A29/A13.
  it("opens a hit at its line", async () => {
    answer([{ path: "notes/a.md", line: 12, snippet: "the needle" }]);
    render(<SearchPanel />);
    fireEvent.change(screen.getByPlaceholderText("editor.search.placeholder"), { target: { value: "needle" } });
    await settle();

    fireEvent.click(screen.getByText("needle"));
    expect(useTabs.getState().open).toHaveBeenCalledWith("notes/a.md");
    // Parked for the editor that mounts for the tab (the backlinks' way).
    expect(takeDeferredLine()).toEqual({ line: 12, snippet: "the needle" });
    expect(useUi.getState().overlay.kind).toBe("none");
    deferLine(null);
  });

  it("walks the results with the arrows and opens one with Enter", async () => {
    answer([
      { path: "a.md", line: 1, snippet: "needle one" },
      { path: "b.md", line: 2, snippet: "needle two" },
    ]);
    render(<SearchPanel />);
    const field = screen.getByPlaceholderText("editor.search.placeholder");
    fireEvent.change(field, { target: { value: "needle" } });
    await settle();

    const active = () => document.querySelector(".result.active .result-label")?.textContent;
    expect(active()).toBe("needle one");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(active()).toBe("needle two");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useTabs.getState().open).toHaveBeenCalledWith("b.md");
    deferLine(null);
  });

  it("marks what matched: every occurrence, the case flag and a regex", async () => {
    answer([{ path: "a.md", line: 1, snippet: "Needle and needle" }]);
    render(<SearchPanel />);
    const field = screen.getByPlaceholderText("editor.search.placeholder");
    fireEvent.change(field, { target: { value: "needle" } });
    await settle();
    const marks = () => [...document.querySelectorAll("mark.match")].map((mark) => mark.textContent);
    expect(marks()).toEqual(["Needle", "needle"]);

    fireEvent.click(screen.getByText("editor.find.caseSensitive"));
    await settle();
    expect(marks()).toEqual(["needle"]);

    fireEvent.click(screen.getByText("editor.find.regex"));
    fireEvent.change(field, { target: { value: "N.edle" } });
    await settle();
    expect(marks()).toEqual(["Needle"]);
    // A pattern JavaScript cannot compile leaves the line unmarked.
    fireEvent.change(field, { target: { value: "(?i)x[" } });
    await settle();
    expect(marks()).toEqual([]);
  });

  it("narrows to a folder, offering the vault's folders", async () => {
    answer([]);
    useFiles.setState({ files: ["notes/a.md", "notes/deep/b.md", "top.md"] });
    render(<SearchPanel />);
    const options = [...document.querySelectorAll("#search-folders option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["notes", "notes/deep"]);

    fireEvent.change(screen.getByPlaceholderText("editor.search.placeholder"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("editor.search.filterFolder"), { target: { value: "notes/deep" } });
    await settle();
    expect(vi.mocked(commands.search).mock.calls.at(-1)?.[0]).toMatchObject({ folder: "notes/deep" });

    fireEvent.click(screen.getByText("editor.search.clearFilters"));
    await settle();
    expect(vi.mocked(commands.search).mock.calls.at(-1)?.[0]).toMatchObject({ folder: null, tag: null });
  });
});
