import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

// jsdom has `<dialog>` but neither `showModal()` nor `close()`: the open
// state is the attribute, as in a browser, and `close` queues its event.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute("open");
    setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  });
});

/** The results' text, whatever the marks split it into. */
const labels = () => [...document.querySelectorAll("[role=option] .sb-row__name")].map((label) => label.textContent);
// The filters with their suggestions are comboboxes too (SuggestField).
const field = () => screen.getByRole("combobox", { name: "editor.search.placeholder" });

/** A search answered with `hits`, as the shell streams them. */
function answer(hits: { path: string; line: number; snippet: string; snippetCutEnd?: boolean }[]) {
  vi.mocked(commands.search).mockImplementation(async (_query, channel) => {
    const box = channel as unknown as { onmessage: (event: SearchEventDto) => void };
    box.onmessage({ kind: "hits", hits: hits.map((hit) => ({ snippetCutEnd: false, ...hit })) });
    box.onmessage({ kind: "done", report: REPORT });
    return { status: "ok", data: REPORT };
  });
}

const REPORT = { scanned: 3, cloudOnlySkipped: 0, notUtf8Skipped: 2, matches: 2, truncated: false, cancelled: false };

describe("SearchPanel", () => {
  beforeEach(() => {
    useUi.setState({ overlay: { kind: "search" }, searchAllFiles: false, message: null });
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
          { path: "notes/a.md", line: 1, snippet: "needle in a note", snippetCutEnd: false },
          { path: "src/main.go", line: 7, snippet: "needle in Go", snippetCutEnd: false },
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

    fireEvent.click(screen.getByRole("button", { name: "editor.search.allFiles" }));
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

    const active = () => document.querySelector('[role=option][aria-selected="true"] .sb-row__name')?.textContent;
    expect(active()).toBe("needle one");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(active()).toBe("needle two");
    // Round, as sebaro's palette (spec/02 §4.16).
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(active()).toBe("needle one");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(active()).toBe("needle two");
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
    const marks = () => [...document.querySelectorAll("mark.sb-mark")].map((mark) => mark.textContent);
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
    // spec/02 §4.26 (NV-M12): a combobox with sebaro's completion list, no datalist.
    const folderField = screen.getByLabelText("editor.search.filterFolder");
    expect(folderField.getAttribute("role")).toBe("combobox");
    expect(folderField.hasAttribute("list")).toBe(false);
    fireEvent.keyDown(folderField, { key: "ArrowDown" });
    const list = document.getElementById(folderField.getAttribute("aria-controls")!)!;
    expect(list.className).toBe("sb-completion");
    const options = [...list.querySelectorAll("[role=option]")].map((o) => o.textContent);
    expect(options).toEqual(["notes", "notes/deep"]);
    fireEvent.keyDown(folderField, { key: "Escape" });
    expect(useUi.getState().overlay.kind).toBe("search");

    fireEvent.change(screen.getByPlaceholderText("editor.search.placeholder"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("editor.search.filterFolder"), { target: { value: "notes/deep" } });
    await settle();
    expect(vi.mocked(commands.search).mock.calls.at(-1)?.[0]).toMatchObject({ folder: "notes/deep" });

    fireEvent.click(screen.getByText("editor.search.clearFilters"));
    await settle();
    expect(vi.mocked(commands.search).mock.calls.at(-1)?.[0]).toMatchObject({ folder: null, tag: null });
  });

  // feature-gaps A14: a tag chosen in the palette arrives as the filter.
  it("starts with the tag the palette handed over", async () => {
    answer([]);
    useUi.setState({ overlay: { kind: "search", tag: "project" } });
    render(<SearchPanel />);
    expect((screen.getByLabelText("editor.search.filterTag") as HTMLInputElement).value).toBe("project");

    fireEvent.change(screen.getByPlaceholderText("editor.search.placeholder"), { target: { value: "x" } });
    await settle();
    expect(vi.mocked(commands.search).mock.calls.at(-1)?.[0]).toMatchObject({ tag: "project" });
  });

  // View step 8 (ADR-0051, spec/02 §4.16, §2.2, §2.9): the palette's frame
  // with sebaro's search field, chips, compact fields and rows.
  describe("in sebaro's parts", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("is the palette's modal dialog, named, with the search field's combobox", () => {
      vi.mocked(commands.search).mockResolvedValue({ status: "ok", data: REPORT });
      render(<SearchPanel />);
      const dialog = document.querySelector("dialog")!;
      expect(dialog.className).toBe("sb-command-palette");
      expect(dialog.dataset.sbDensity).toBe("window");
      // spec/02 §4.25.1 (D104 (1)): the palette's frame as full-text search.
      expect(dialog.hasAttribute("data-sb-fulltext")).toBe(true);
      expect(dialog.open).toBe(true);
      expect(dialog.getAttribute("aria-label")).toBe("editor.search.title");
      const input = field();
      expect(input.getAttribute("type")).toBe("search");
      expect(input.parentElement?.className).toBe("sb-command-palette__search sb-search");
      expect(input.getAttribute("aria-label")).toBe("editor.search.placeholder");
      expect(input.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
      expect(document.activeElement).toBe(input);
    });

    // EIN-05: „Suche leeren“ only while the field has text; the focus stays.
    it("offers „Suche leeren“ while the field has text, and keeps the focus there", () => {
      vi.mocked(commands.search).mockResolvedValue({ status: "ok", data: REPORT });
      render(<SearchPanel />);
      expect(screen.queryByRole("button", { name: "editor.search.clear" })).toBeNull();
      fireEvent.change(field(), { target: { value: "needle" } });
      const clear = screen.getByRole("button", { name: "editor.search.clear" });
      expect(clear.className).toBe("sb-icon-button sb-icon-button--compact");
      expect(clear.querySelector("use")?.getAttribute("href")).toBe("#close");
      fireEvent.click(clear);
      expect((field() as HTMLInputElement).value).toBe("");
      expect(document.activeElement).toBe(field());
      expect(screen.queryByRole("button", { name: "editor.search.clear" })).toBeNull();
    });

    // EIN-04 (R1): the options are filter chips with their state, not key caps.
    it("has the options as pressed chips in a named group", () => {
      vi.mocked(commands.search).mockResolvedValue({ status: "ok", data: REPORT });
      render(<SearchPanel />);
      const group = screen.getByRole("group", { name: "editor.find.options" });
      expect(group.className).toBe("sb-chips");
      // spec/02 §4.25.1: in the row of options under the search row.
      expect(group.parentElement?.className).toBe("sb-command-palette__options");
      const chips = [...group.querySelectorAll("button")];
      expect(chips.map((chip) => [chip.className, chip.textContent, chip.getAttribute("aria-pressed")])).toEqual([
        ["sb-chip", "editor.find.caseSensitive", "false"],
        ["sb-chip", "editor.find.regex", "false"],
        ["sb-chip", "editor.search.allFiles", "false"],
      ]);
      expect(chips[0]?.querySelector("use")?.getAttribute("href")).toBe("#check--16");
      expect(chips.map((chip) => chip.getAttribute("data-sb-search-option"))).toEqual(["case", "regex", null]);
      fireEvent.click(chips[1]!);
      expect(chips[1]?.getAttribute("aria-pressed")).toBe("true");
      expect(document.querySelector(".kbd")).toBeNull();
    });

    // EIN-01, AKT-06: the filters are compact fields with visible labels,
    // „Filter zurücksetzen“ a compact text action.
    it("labels its filters and resets them with a text action", () => {
      vi.mocked(commands.search).mockResolvedValue({ status: "ok", data: REPORT });
      render(<SearchPanel />);
      const tag = screen.getByLabelText("editor.search.filterTag");
      expect(tag.closest(".sb-field")?.className).toBe("sb-field sb-field--compact nv-suggest");
      expect(tag.closest(".sb-field")?.querySelector("label")?.className).toBe("sb-field__label");
      expect(screen.queryByText("editor.search.clearFilters")).toBeNull();
      fireEvent.change(tag, { target: { value: "project" } });
      const reset = screen.getByRole("button", { name: "editor.search.clearFilters" });
      expect(reset.className).toBe("sb-text-action sb-text-action--compact");
    });

    it("lists a hit as a two-line window row, the snippet over its path", async () => {
      answer([{ path: "notes/q3-plan.md", line: 1, snippet: "the needle" }]);
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await settle();
      const row = screen.getByRole("option");
      expect(row.className).toBe("sb-row");
      expect(row.getAttribute("aria-selected")).toBe("true");
      expect(field().getAttribute("aria-activedescendant")).toBe(row.id);
      // spec/02 §4.13: two lines are `__main` with `__name` and `__sub`.
      const main = row.querySelector(":scope > .sb-row__main")!;
      expect(main.querySelector(":scope > .sb-row__name")?.textContent).toBe("the needle");
      const path = main.querySelector(":scope > .sb-row__sub > .sb-file-name")!;
      expect(path.textContent).toBe("notes/q3-plan.md");
      expect(path.querySelectorAll("wbr")).toHaveLength(3);
      expect(row.querySelector(".sb-row__meta")).toBeNull();
      expect(screen.getByRole("listbox").className).toBe("sb-command-palette__list");
    });

    // The core marks a cut start with „…“ in the text and a cut end in
    // `snippetCutEnd`; the length alone says nothing.
    it("ends a snippet the core cut with „…“, and only that one", async () => {
      const cut = `…${"x".repeat(150)} needle ${"y".repeat(42)}`;
      const whole = `needle ${"z".repeat(193)}`;
      answer([
        { path: "a.md", line: 1, snippet: cut, snippetCutEnd: true },
        { path: "b.md", line: 1, snippet: whole },
      ]);
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await settle();
      const names = [...document.querySelectorAll("[role=option] .sb-row__name")].map((el) => el.textContent);
      expect(names).toEqual([`${cut}…`, whole]);
      expect(document.querySelector("[role=option] mark")?.textContent).toBe("needle");
    });

    // DAT-07 / NAV-09: nothing found says what was looked for.
    it("says that no note, or with all files no file, contains the query", async () => {
      answer([]);
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await settle();
      const status = screen.getByRole("status");
      expect(status.className).toBe("sb-command-palette__empty");
      expect(status.textContent).toBe("editor.search.noNote");
      fireEvent.click(screen.getByRole("button", { name: "editor.search.allFiles" }));
      await settle();
      expect(screen.getByRole("status").textContent).toBe("editor.search.noFile");
    });

    // STA-06: local work is quiet; „Suche läuft …“ only after a second.
    it("says „Suche läuft …“ only once the search has taken a second", async () => {
      vi.useFakeTimers();
      vi.mocked(commands.search).mockImplementation(() => new Promise(() => undefined));
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(commands.search).toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toBe("");
      // D104 (4): the list is busy while the search runs.
      expect(screen.getByRole("listbox").getAttribute("aria-busy")).toBe("true");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      expect(screen.getByRole("status").textContent).toBe("");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.getByRole("status").textContent).toBe("editor.search.searching");
    });

    // ZUG-06: Escape closes from any of its fields, the focus goes back.
    it("closes on Escape from a filter and gives the focus back", () => {
      vi.mocked(commands.search).mockResolvedValue({ status: "ok", data: REPORT });
      const opener = document.createElement("button");
      document.body.append(opener);
      opener.focus();
      try {
        render(<SearchPanel />);
        fireEvent.keyDown(screen.getByLabelText("editor.search.filterFolder"), { key: "Escape" });
        expect(useUi.getState().overlay).toEqual({ kind: "none" });
        expect(document.activeElement).toBe(opener);
      } finally {
        opener.remove();
      }
    });

    it("names the counts in the foot after the keys", async () => {
      answer([{ path: "a.md", line: 1, snippet: "needle" }]);
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await settle();
      const foot = document.querySelector(".sb-command-palette__foot")!;
      expect([...foot.querySelectorAll(".sb-keys")].map((k) => k.getAttribute("data-sb-keys"))).toEqual([
        "Up Down",
        "Enter",
        "Escape",
      ]);
      expect(foot.textContent).toContain("palette.foot.open");
      expect(foot.lastElementChild?.textContent).toBe("editor.search.notUtf8Skipped=2");
    });
  });
});
