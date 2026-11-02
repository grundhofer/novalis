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
    t: (key: string, vars?: { count?: number; matches?: string; notes?: string }) =>
      vars?.matches !== undefined
        ? `${key}[${vars.matches}|${vars.notes}]`
        : vars?.count === undefined
          ? key
          : `${key}=${vars.count}`,
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

/** The notes' names, whatever the breaks split them into. */
const labels = () => [...document.querySelectorAll("[role=option] .sb-row__name")].map((label) => label.textContent);
const foot = () => document.querySelector(".sb-command-palette__foot")!;
const sentence = () => document.querySelector(".sb-command-palette__empty")!;
// The filters with their suggestions are comboboxes too (SuggestField).
const field = () => screen.getByRole("combobox", { name: "editor.search.placeholder" });

/** A search answered with `hits`, as the shell streams them. */
function answer(hits: { path: string; line: number; snippet: string; snippetCutEnd?: boolean }[], report = REPORT) {
  vi.mocked(commands.search).mockImplementation(async (_query, channel) => {
    const box = channel as unknown as { onmessage: (event: SearchEventDto) => void };
    box.onmessage({ kind: "hits", hits: hits.map((hit) => ({ snippetCutEnd: false, ...hit })) });
    box.onmessage({ kind: "done", report });
    return { status: "ok", data: report };
  });
}

type Box = { onmessage: (event: SearchEventDto) => void };

/** Searches that stay open: each call's channel, for the test to stream into. */
function hold(): Box[] {
  const boxes: Box[] = [];
  vi.mocked(commands.search).mockImplementation((_query, channel) => {
    boxes.push(channel as unknown as Box);
    return new Promise(() => undefined);
  });
  return boxes;
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
    // A note by its name, any other file with its extension, as Quick Open.
    expect(labels()).toEqual(["a", "main.go"]);
    expect(document.querySelector(".sb-command-palette__group")?.textContent).toBe("editor.search.files=2");
    expect(foot().textContent).toBe(
      "editor.search.summary[editor.search.results=2|editor.search.files=2] editor.search.notUtf8Skipped=2",
    );
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

  // ADR-0051 #84, D104 (1): a row per note, in the order the notes arrive.
  it("groups the hits per note in the order they arrive", async () => {
    answer([
      { path: "a.md", line: 3, snippet: "needle three" },
      { path: "b.md", line: 1, snippet: "needle one" },
      { path: "a.md", line: 9, snippet: "needle nine" },
    ]);
    render(<SearchPanel />);
    fireEvent.change(field(), { target: { value: "needle" } });
    await settle();

    expect(labels()).toEqual(["a", "b"]);
    expect(document.querySelector("[role=option] .sb-row__text")?.textContent).toBe("needle three");
    const head = document.querySelector(".sb-command-palette__group")!;
    expect(head.textContent).toBe("editor.search.notes=2");
    expect(head.parentElement?.className).toBe("sb-command-palette__section");
    const group = screen.getByRole("group", { name: "editor.search.notes=2" });
    expect(group.getAttribute("aria-labelledby")).toBe(head.id);
    expect(group.querySelectorAll("[role=option]")).toHaveLength(2);
  });

  // docs/research/2026-09-20-feature-gaps.md A3/A12/A29/A13; ADR-0051 #84.
  it("opens a note at its first match", async () => {
    answer([
      { path: "notes/a.md", line: 9, snippet: "the needle again" },
      { path: "notes/a.md", line: 3, snippet: "the needle" },
    ]);
    render(<SearchPanel />);
    fireEvent.change(screen.getByPlaceholderText("editor.search.placeholder"), { target: { value: "needle" } });
    await settle();

    fireEvent.click(screen.getByRole("option"));
    expect(useTabs.getState().open).toHaveBeenCalledWith("notes/a.md");
    // Parked for the editor that mounts for the tab (the backlinks' way).
    expect(takeDeferredLine()).toEqual({ line: 3, snippet: "the needle" });
    expect(useUi.getState().overlay.kind).toBe("none");
    deferLine(null);
  });

  it("walks the notes with the arrows and opens one with Enter", async () => {
    answer([
      { path: "a.md", line: 1, snippet: "needle one" },
      { path: "a.md", line: 5, snippet: "needle five" },
      { path: "b.md", line: 2, snippet: "needle two" },
    ]);
    render(<SearchPanel />);
    const field = screen.getByPlaceholderText("editor.search.placeholder");
    fireEvent.change(field, { target: { value: "needle" } });
    await settle();

    const selected = () => document.querySelector('[role=option][aria-selected="true"]');
    const active = () => selected()?.querySelector(".sb-row__name")?.textContent;
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(active()).toBe("a");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(active()).toBe("b");
    expect(field.getAttribute("aria-activedescendant")).toBe(selected()?.id);
    // Round, as sebaro's palette (spec/02 §4.16).
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(active()).toBe("a");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(active()).toBe("b");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useTabs.getState().open).toHaveBeenCalledWith("b.md");
    expect(takeDeferredLine()).toEqual({ line: 2, snippet: "needle two" });
    deferLine(null);
  });

  // A search that a newer one superseded still sends its last batch and its
  // report; neither belongs to the newer search.
  it("ignores a superseded search's late batch and report", async () => {
    const boxes = hold();
    render(<SearchPanel />);
    fireEvent.change(field(), { target: { value: "needle" } });
    await settle();
    fireEvent.change(field(), { target: { value: "needles" } });
    await settle();
    expect(boxes).toHaveLength(2);

    act(() => {
      boxes[1]!.onmessage({ kind: "hits", hits: [{ path: "b.md", line: 1, snippet: "needles", snippetCutEnd: false }] });
      boxes[0]!.onmessage({ kind: "hits", hits: [{ path: "a.md", line: 1, snippet: "needle", snippetCutEnd: false }] });
      boxes[0]!.onmessage({ kind: "done", report: { ...REPORT, cancelled: true } });
    });
    expect(labels()).toEqual(["b"]);
    expect(foot().textContent).toBe("");

    act(() => boxes[1]!.onmessage({ kind: "done", report: { ...REPORT, matches: 1, notUtf8Skipped: 0 } }));
    expect(foot().textContent).toBe("editor.search.summary[editor.search.results=1|editor.search.notes=1]");
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

    it("lists a note as sebaro's three-line row: name, folder, the match", async () => {
      answer([
        { path: "notes/q3-plan.md", line: 1, snippet: "the needle" },
        { path: "top.md", line: 4, snippet: "a needle" },
      ]);
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await settle();
      const [row, top] = screen.getAllByRole("option");
      expect(row!.className).toBe("sb-row");
      expect(row!.getAttribute("aria-selected")).toBe("true");
      expect(field().getAttribute("aria-activedescendant")).toBe(row!.id);
      // spec/02 §4.25.1: `__icon` file-text, then `__main` with `__name`,
      // `__sub` (the folder) and `__text` (the match, marked).
      expect(row!.firstElementChild?.getAttribute("class")).toContain("sb-row__icon");
      expect(row!.firstElementChild?.querySelector("use")?.getAttribute("href")).toBe("#file-text");
      expect(row!.querySelector(".sb-row__check")).toBeNull();
      const main = row!.querySelector(":scope > .sb-row__main")!;
      const name = main.querySelector(":scope > .sb-row__name > .sb-file-name")!;
      expect(name.textContent).toBe("q3-plan");
      expect(name.querySelectorAll("wbr")).toHaveLength(1);
      expect(main.querySelector(":scope > .sb-row__sub > .sb-file-name")?.textContent).toBe("notes");
      const text = main.querySelector(":scope > .sb-row__text")!;
      expect(text.textContent).toBe("the needle");
      expect(text.querySelector(":scope > mark.sb-mark")?.textContent).toBe("needle");
      expect(row!.querySelector(".sb-row__meta")).toBeNull();
      // A note at the vault's top names no folder, as in Quick Open.
      expect(top!.querySelector(".sb-row__name")?.textContent).toBe("top");
      expect(top!.querySelector(".sb-row__sub")).toBeNull();
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
      const texts = [...document.querySelectorAll("[role=option] .sb-row__text")].map((el) => el.textContent);
      expect(texts).toEqual([`${cut}…`, whole]);
      expect(document.querySelector("[role=option] mark")?.textContent).toBe("needle");
    });

    // DAT-07 / NAV-09: nothing found says what was looked for.
    it("says that no note, or with all files no file, contains the query", async () => {
      answer([]);
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await settle();
      expect(sentence().getAttribute("role")).toBe("status");
      expect(sentence().textContent).toBe("editor.search.noNote");
      fireEvent.click(screen.getByRole("button", { name: "editor.search.allFiles" }));
      await settle();
      expect(sentence().textContent).toBe("editor.search.noFile");
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
      expect(sentence().textContent).toBe("");
      // D104 (4): the list is busy while the search runs.
      expect(screen.getByRole("listbox").getAttribute("aria-busy")).toBe("true");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900);
      });
      expect(sentence().textContent).toBe("");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(sentence().textContent).toBe("editor.search.searching");
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

    // spec/02 §4.25.1, ADR-0051 #84: the foot is a sentence and a status,
    // without the palette's key hints.
    it("says the counts as sentences in the foot's status region", async () => {
      answer([{ path: "a.md", line: 1, snippet: "needle" }], { ...REPORT, truncated: true });
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await settle();
      expect(foot().getAttribute("role")).toBe("status");
      expect(foot().querySelector(".sb-keys")).toBeNull();
      expect(foot().textContent).toBe(
        "editor.search.summary[editor.search.results=2|editor.search.notes=1] editor.search.notUtf8Skipped=2 editor.search.truncated=400",
      );
    });

    // D104 (1): nothing counts up in the foot while the scan runs; the group
    // head follows the notes as they arrive.
    it("says its sentence only once the search has ended", async () => {
      const boxes = hold();
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await settle();
      act(() => boxes[0]!.onmessage({ kind: "hits", hits: [{ path: "a.md", line: 1, snippet: "needle", snippetCutEnd: false }] }));
      expect(labels()).toEqual(["a"]);
      expect(document.querySelector(".sb-command-palette__group")?.textContent).toBe("editor.search.notes=1");
      expect(foot().textContent).toBe("");

      act(() => boxes[0]!.onmessage({ kind: "done", report: { ...REPORT, matches: 1, notUtf8Skipped: 0 } }));
      expect(foot().textContent).toBe("editor.search.summary[editor.search.results=1|editor.search.notes=1]");
    });

    it("says nothing about 0 matches in the foot, only what it skipped", async () => {
      answer([], { ...REPORT, matches: 0 });
      render(<SearchPanel />);
      fireEvent.change(field(), { target: { value: "needle" } });
      await settle();
      expect(sentence().textContent).toBe("editor.search.noNote");
      expect(document.querySelector(".sb-command-palette__group")).toBeNull();
      expect(foot().textContent).toBe("editor.search.notUtf8Skipped=2");
    });
  });
});
