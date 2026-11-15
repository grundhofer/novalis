import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBoard } from "../stores/board";
import { useUi } from "../stores/ui";
import CardDialog, { labelsOf } from "./CardDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  errorKey: (error: Error) => `errors.${error.message}`,
  errorValues: () => ({}),
}));

const card = {
  id: "c1",
  title: "Write the spec",
  column: "todo",
  order: "a0",
  notes: [],
  created: "2026-11-01T10:00:00.000Z",
  updated: "2026-11-10T10:00:00.000Z",
  description: "Why first.",
  descriptionHtml: null,
  labels: ["Kunde"],
  due: "2026-11-20",
  priority: "medium",
  assignee: "Anna",
};
const board = {
  slug: "plan",
  name: "Plan",
  columns: [{ id: "todo", name: "To do" }],
  cards: [card, { ...card, id: "c2", assignee: "Ben", labels: [] }],
  orphanCards: [],
  cloudOnly: [],
  unreadable: [],
  resolvedConflicts: 0,
  resolvedColumns: false,
  resolveError: null,
  view: { collapsed: false, hiddenColumns: [], changedWithin: null, sort: null, sortReversed: false, labelTones: { Kunde: 2 } },
};

const field = (label: string) => screen.getByLabelText(new RegExp(`^${label.replace(".", "\\.")}`)) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "app.save" }));

// ADR-0054: the title, the description and the fields in one dialog.
describe("CardDialog", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    useBoard.setState({
      docs: { plan: board as never },
      apply: vi.fn().mockResolvedValue(undefined),
      setView: vi.fn().mockResolvedValue(undefined),
    });
    useUi.setState({ cardEdit: { slug: "plan", id: "c1" } });
  });

  it("is sebaro's dialog with the card's values, the title focused", () => {
    render(<CardDialog />);
    const dialog = document.querySelector("dialog")!;
    expect(dialog.className).toBe("sb-dialog card-dialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("board.editCardTitle");
    expect(document.activeElement).toBe(field("board.cardTitleLabel"));
    expect(field("board.cardTitleLabel").value).toBe("Write the spec");
    expect(field("board.cardDescriptionLabel").value).toBe("Why first.");
    expect(field("board.labelsLabel").value).toBe("Kunde");
    expect(field("board.dueLabel").value).toBe("2026-11-20");
    expect(field("board.dueLabel").type).toBe("date");
    expect((screen.getByLabelText("board.priorityLabel") as HTMLSelectElement).value).toBe("medium");
    expect(field("board.assigneeLabel").value).toBe("Anna");
    // The names on this board are offered.
    const list = document.getElementById(field("board.assigneeLabel").getAttribute("list")!)!;
    expect([...list.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual(["Anna", "Ben"]);
    // Each label with its tone on this board, a category dot.
    expect(document.querySelector(".card-dialog__tones .sb-category")?.className).toBe("sb-category sb-category--2");
    const actions = [...document.querySelectorAll(".sb-dialog__actions > button")].map((b) => b.textContent);
    expect(actions).toEqual(["app.cancel", "app.save"]);
  });

  it("writes only the fields that changed, each its own change", async () => {
    render(<CardDialog />);
    fireEvent.change(field("board.cardTitleLabel"), { target: { value: "  Write the spec v2 " } });
    fireEvent.change(field("board.labelsLabel"), { target: { value: "Kunde, blockiert, kunde" } });
    fireEvent.change(screen.getByLabelText("board.priorityLabel"), { target: { value: "" } });
    fireEvent.change(field("board.dueLabel"), { target: { value: "" } });
    await act(async () => save());

    const apply = vi.mocked(useBoard.getState().apply);
    expect(apply.mock.calls).toEqual([
      [{ kind: "retitle", id: "c1", title: "Write the spec v2" }, "plan"],
      [{ kind: "setLabels", id: "c1", labels: ["Kunde", "blockiert"] }, "plan"],
      [{ kind: "setDue", id: "c1", due: "" }, "plan"],
      [{ kind: "setPriority", id: "c1", priority: null }, "plan"],
    ]);
    expect(useBoard.getState().setView).not.toHaveBeenCalled();
    expect(useUi.getState().cardEdit).toBeNull();
  });

  it("gives a label its tone on this board, and takes it away", async () => {
    render(<CardDialog />);
    fireEvent.change(field("board.labelsLabel"), { target: { value: "Kunde, blockiert" } });
    // Two selects carry the same stub label: „Kunde“, then „blockiert“.
    const selects = screen.getAllByLabelText("board.labelTone");
    fireEvent.change(selects[0]!, { target: { value: "0" } });
    fireEvent.change(selects[1]!, { target: { value: "5" } });
    await act(async () => save());
    expect(useBoard.getState().setView).toHaveBeenCalledWith("plan", { labelTones: { blockiert: 5 } });
  });

  it("closes without a write when nothing changed, and on Escape", async () => {
    const { rerender } = render(<CardDialog />);
    await act(async () => save());
    expect(useBoard.getState().apply).not.toHaveBeenCalled();
    expect(useUi.getState().cardEdit).toBeNull();

    act(() => useUi.setState({ cardEdit: { slug: "plan", id: "c1" } }));
    rerender(<CardDialog />);
    fireEvent.keyDown(document.querySelector("dialog")!, { key: "Escape" });
    expect(useUi.getState().cardEdit).toBeNull();
  });

  it("keeps a failure in the dialog and offers to try again", async () => {
    useBoard.setState({ apply: vi.fn().mockRejectedValue(new Error("io")) });
    render(<CardDialog />);
    fireEvent.change(field("board.assigneeLabel"), { target: { value: "Ben" } });
    await act(async () => save());
    expect(useUi.getState().cardEdit).toEqual({ slug: "plan", id: "c1" });
    expect(screen.getByRole("alert").textContent).toContain("errors.io");
    expect(screen.getByRole("button", { name: "app.retry" })).toBeTruthy();
  });

  it("splits the labels at commas, each once regardless of case", () => {
    expect(labelsOf(" a , b,,A, c ")).toEqual(["a", "b", "c"]);
    expect(labelsOf("")).toEqual([]);
  });
});
