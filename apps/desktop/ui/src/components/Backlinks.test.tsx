import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, unwrap } from "../ipc/client";
import { deferLine, goToEditorLine, takeDeferredLine } from "../lib/editorBridge";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
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
