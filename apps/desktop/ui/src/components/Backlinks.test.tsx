import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, unwrap } from "../ipc/client";
import { deferLine, goToEditorLine, takeDeferredLine } from "../lib/editorBridge";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import Backlinks from "./Backlinks";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Render the key plus any count, so plural selection is visible in a test
    // without pulling the real catalog in.
    t: (key: string, vars?: { count?: number }) =>
      vars?.count === undefined ? key : `${key}=${vars.count}`,
  }),
}));

vi.mock("../lib/editorBridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/editorBridge")>()),
  goToEditorLine: vi.fn(),
}));

vi.mock("../ipc/client", () => ({
  commands: { backlinks: vi.fn() },
  unwrap: vi.fn(),
  events: { cacheUpdated: { listen: vi.fn().mockResolvedValue(() => undefined) } },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const answer = (value: unknown) => {
  vi.mocked(unwrap).mockResolvedValue(value as never);
};

describe("Backlinks", () => {
  beforeEach(() => {
    useTabs.setState({ active: "Atlas Overview.md", tabs: ["Atlas Overview.md"] });
    useEditorSave.setState({ docs: {} });
    deferLine(null);
    vi.mocked(goToEditorLine).mockClear();
  });

  it("shows nothing at all when no note is open", () => {
    useTabs.setState({ active: null });
    const { container } = render(<Backlinks />);
    expect(container.innerHTML).toBe("");
  });

  it("lists the notes that link here", async () => {
    answer({
      notes: [{ path: "projects/Spec.md", title: "Spec", line: 12, snippet: "" }],
      cards: [],
      indexed: true,
    });
    render(<Backlinks />);
    await flush();

    expect(screen.getByText("Spec")).toBeTruthy();
    expect(screen.getByText("projects/Spec.md")).toBeTruthy();
  });

  // §4.4 approved "backlinks list (incl. cards linking here)". The first cut
  // returned notes only; a card is not a note and must appear too.
  it("lists the cards that link here, with their board", async () => {
    answer({
      notes: [],
      cards: [{ board: "plan", boardName: "Plan", id: "c1", title: "Ship the bundle" }],
      indexed: true,
    });
    render(<Backlinks />);
    await flush();

    expect(screen.getByText("Ship the bundle")).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
  });

  // feature-gaps A20: the pane draws `useBoard.board`, which a click that
  // only showed the pane left at whatever board was loaded last.
  it("shows the card's board and loads it", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    useBoard.setState({ load });
    answer({
      notes: [],
      cards: [{ board: "plan", boardName: "Plan", id: "c1", title: "Ship the bundle" }],
      indexed: true,
    });
    render(<Backlinks />);
    await flush();

    fireEvent.click(screen.getByText("Ship the bundle"));
    expect(useUi.getState().activeBoard).toBe("plan");
    expect(load).toHaveBeenCalledWith("plan");
  });

  it("counts notes and cards separately", async () => {
    answer({
      notes: [
        { path: "a.md", title: "A", line: 1, snippet: "" },
        { path: "b.md", title: "B", line: 2, snippet: "" },
      ],
      cards: [{ board: "plan", boardName: "Plan", id: "c1", title: "C" }],
      indexed: true,
    });
    render(<Backlinks />);
    await flush();

    expect(screen.getByText(/editor\.backlinks\.notes=2/)).toBeTruthy();
    expect(screen.getByText(/editor\.backlinks\.cards=1/)).toBeTruthy();
  });

  it("says so when nothing links here", async () => {
    answer({ notes: [], cards: [], indexed: true });
    render(<Backlinks />);
    await flush();

    expect(screen.getByText("editor.backlinks.empty")).toBeTruthy();
  });

  // sebaro's list end (spec/02 §3.3, DAT-07): one sentence after the head,
  // no list and no row.
  it("ends with sebaro's list end when nothing links here", async () => {
    answer({ notes: [], cards: [], indexed: true });
    const { container } = render(<Backlinks />);
    await flush();

    expect(screen.getByText("editor.backlinks.empty").className).toBe("sb-list-end");
    expect(container.querySelector(".sb-list")).toBeNull();
    expect(container.querySelector(".sb-row")).toBeNull();
  });

  // TXT-05, SCH-03: the head is sebaro's list head, the counts its count
  // part in tabular figures, not a mono label.
  it("heads the pane with sebaro's list head and its count", async () => {
    answer({ notes: [{ path: "a.md", title: "A", line: 1, snippet: "" }], cards: [], indexed: true });
    const { container } = render(<Backlinks />);
    await flush();

    const section = screen.getByRole("region", { name: "editor.backlinks.title" });
    const head = section.querySelector(".sb-list-header")!;
    expect(head.firstChild?.textContent).toBe("editor.backlinks.title");
    const count = head.querySelector(".sb-list-header__count")!;
    expect(count.classList.contains("sb-num")).toBe(true);
    expect(count.textContent).toBe("editor.backlinks.notes=1 · editor.backlinks.cards=0");
    expect(container.querySelector(".backlinks-head, .backlinks-title, .backlinks-counts")).toBeNull();
  });

  // spec/02 §4.13, ICO-03: each entry is a two-line window row with the
  // sprite's icon for its kind, the name over the line or the board.
  it("draws a note and a card as two-line rows with their icons", async () => {
    answer({
      notes: [{ path: "projects/Spec.md", title: "Spec", line: 12, snippet: "see [[A]]" }],
      cards: [{ board: "plan", boardName: "Plan", id: "c1", title: "Ship the bundle" }],
      indexed: true,
    });
    const { container } = render(<Backlinks />);
    await flush();

    const rows = [...container.querySelectorAll("ul.sb-list > li > button.sb-row")];
    expect(rows).toHaveLength(2);
    const [note, card] = rows as [HTMLButtonElement, HTMLButtonElement];
    expect(note.querySelector(".sb-row__icon use")?.getAttribute("href")).toBe("#file-text");
    expect(note.querySelector(".sb-row__main > .sb-row__name")?.textContent).toBe("Spec");
    expect(note.querySelector(".sb-row__main > .sb-row__sub")?.textContent).toBe("see [[A]]");
    expect(card.querySelector(".sb-row__icon use")?.getAttribute("href")).toBe("#board");
    expect(card.querySelector(".sb-row__main > .sb-row__name")?.textContent).toBe("Ship the bundle");
    expect(card.querySelector(".sb-row__main > .sb-row__sub")?.textContent).toBe("Plan");
    expect(container.querySelector(".backlink-glyph")).toBeNull();
    // An icon names nothing on its own: the row's name is its text.
    expect(note.querySelector(".sb-row__icon")?.getAttribute("aria-hidden")).toBe("true");
  });

  // D100 (6): a note's name and the path that stands in for an unread line
  // break only after - . _ /, as file names do everywhere.
  it("lets a note's name and its path break as file names", async () => {
    answer({
      notes: [{ path: "projects/long-name_v2.md", title: "long-name_v2", line: 3, snippet: "" }],
      cards: [],
      indexed: true,
    });
    const { container } = render(<Backlinks />);
    await flush();

    const name = container.querySelector(".sb-row__name > .sb-file-name")!;
    expect(name.textContent).toBe("long-name_v2");
    expect(name.querySelectorAll("wbr")).toHaveLength(2);
    const path = container.querySelector(".sb-row__sub > .sb-file-name")!;
    expect(path.textContent).toBe("projects/long-name_v2.md");
    expect(path.querySelectorAll("wbr")).toHaveLength(4);
  });

  it("asks for the note that is open", async () => {
    answer({ notes: [], cards: [], indexed: true });
    render(<Backlinks />);
    await flush();

    expect(commands.backlinks).toHaveBeenCalledWith("Atlas Overview.md");
  });

  // The pane is keyed by path: a result that arrives for the previous note
  // must not be shown against the new one.
  it("does not show one note's backlinks against another", async () => {
    answer({
      notes: [{ path: "old.md", title: "Old result", line: 1, snippet: "" }],
      cards: [],
      indexed: true,
    });
    const view = render(<Backlinks />);
    await flush();
    expect(screen.getByText("Old result")).toBeTruthy();

    // The answer for the next note has not arrived yet.
    vi.mocked(unwrap).mockReturnValue(new Promise(() => undefined) as never);
    useTabs.setState({ active: "Another.md" });
    view.rerender(<Backlinks />);
    await flush();

    expect(screen.queryByText("Old result")).toBeNull();
    expect(screen.getByText("editor.backlinks.empty")).toBeTruthy();
  });

  // Two links from one note are two entries; the line's text tells them
  // apart. The path is the fallback for a note whose text could not be read.
  it("tells two links from the same note apart by their line", async () => {
    answer({
      notes: [
        { path: "b.md", title: "B", line: 4, snippet: "see [[A]] for the plan" },
        { path: "b.md", title: "B", line: 31, snippet: "budget for [[A]]" },
        { path: "c.md", title: "C", line: 2, snippet: "" },
      ],
      cards: [],
      indexed: true,
    });
    render(<Backlinks />);
    await flush();

    expect(screen.getAllByText("B")).toHaveLength(2);
    expect(screen.getByText("see [[A]] for the plan")).toBeTruthy();
    expect(screen.getByText("budget for [[A]]")).toBeTruthy();
    expect(screen.getByText("c.md")).toBeTruthy();
  });

  // The core cuts a line at 200 characters and says so in `snippetCutEnd`;
  // the row now wraps instead of ending in a CSS „…“, so the cut needs its
  // own mark, as in the vault search. The jump still gets the core's text.
  it("ends a line the core cut with „…“, and only that one", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open });
    const cut = `…${"x".repeat(60)} [[A]] ${"y".repeat(132)}`;
    const whole = `see [[A]] ${"z".repeat(190)}`;
    answer({
      notes: [
        { path: "b.md", title: "B", line: 4, snippet: cut, snippetCutEnd: true },
        { path: "c.md", title: "C", line: 2, snippet: whole, snippetCutEnd: false },
      ],
      cards: [],
      indexed: true,
    });
    const { container } = render(<Backlinks />);
    await flush();

    const subs = [...container.querySelectorAll(".sb-row__sub")].map((el) => el.textContent);
    expect(subs).toEqual([`${cut}…`, whole]);

    fireEvent.click(screen.getByText(`${cut}…`));
    await flush();
    expect(takeDeferredLine()).toEqual({ line: 4, snippet: cut });
  });

  // The clicked entry's note gets its view after the tab switch, so the line
  // waits in the bridge; the editor takes it once the view exists.
  it("opens the note and leaves the line for the editor to jump to", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open });
    answer({
      notes: [{ path: "b.md", title: "B", line: 31, snippet: "budget for [[A]]" }],
      cards: [],
      indexed: true,
    });
    render(<Backlinks />);
    await flush();

    fireEvent.click(screen.getByText("budget for [[A]]"));
    await flush();

    expect(open).toHaveBeenCalledWith("b.md");
    expect(takeDeferredLine()).toEqual({ line: 31, snippet: "budget for [[A]]" });
    expect(goToEditorLine).not.toHaveBeenCalled();
  });

  // The cache indexes the file after the autosave pause; the buffer may have
  // moved the link meanwhile. The jump follows the line's text, not its number.
  it("settles the line against the buffer when the link has moved", async () => {
    useEditorSave.setState({
      docs: {
        "Atlas Overview.md": { path: "Atlas Overview.md", text: "new first line\n\n[[Atlas Overview]] itself\n" } as never,
      },
    });
    answer({
      notes: [{ path: "Atlas Overview.md", title: "Atlas Overview", line: 1, snippet: "[[Atlas Overview]] itself" }],
      cards: [],
      indexed: true,
    });
    render(<Backlinks />);
    await flush();

    fireEvent.click(screen.getByText("[[Atlas Overview]] itself"));

    expect(goToEditorLine).toHaveBeenCalledWith(3);
  });

  it("jumps at once when the link sits in the note that is already open", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open });
    answer({
      notes: [{ path: "Atlas Overview.md", title: "Atlas Overview", line: 7, snippet: "[[Atlas Overview]] itself" }],
      cards: [],
      indexed: true,
    });
    render(<Backlinks />);
    await flush();

    fireEvent.click(screen.getByText("[[Atlas Overview]] itself"));

    expect(goToEditorLine).toHaveBeenCalledWith(7);
    expect(open).not.toHaveBeenCalled();
    expect(takeDeferredLine()).toBeNull();
  });
});
