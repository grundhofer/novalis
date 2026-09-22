import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type SearchEventDto } from "../ipc/client";
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
    expect(screen.getByText("needle in a note")).toBeTruthy();
    expect(screen.getByText("needle in Go")).toBeTruthy();
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
});
