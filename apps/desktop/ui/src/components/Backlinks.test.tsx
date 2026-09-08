import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, unwrap } from "../ipc/client";
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
  });

  it("shows nothing at all when no note is open", () => {
    useTabs.setState({ active: null });
    const { container } = render(<Backlinks />);
    expect(container.innerHTML).toBe("");
  });

  it("lists the notes that link here", async () => {
    answer({
      notes: [{ path: "projects/Spec.md", title: "Spec", line: 12 }],
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
        { path: "a.md", title: "A", line: 1 },
        { path: "b.md", title: "B", line: 2 },
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
      notes: [{ path: "old.md", title: "Old result", line: 1 }],
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
});
