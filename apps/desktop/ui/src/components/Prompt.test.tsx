import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { report } from "../lib/commands";
import { useUi } from "../stores/ui";
import Prompt from "./Prompt";

// `report` is the one thing this component is supposed to reach on failure.
vi.mock("../lib/commands", () => ({ report: vi.fn() }));

// The catalog is not under test; render the key so assertions read plainly.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Prompt", () => {
  beforeEach(() => {
    useUi.setState({ prompt: null });
  });

  it("renders nothing when nothing was asked", () => {
    const { container } = render(<Prompt />);
    expect(container.innerHTML).toBe("");
  });

  // The defect: `ask()` only stores the request, so the promise
  // `dispatchCommand` catches has already resolved by the time OK is pressed.
  // `submit` then threw into nothing — the dialog closed and the action
  // silently did not happen, across all seven dialog-driven commands.
  it("reports a failing submit instead of closing silently", async () => {
    const boom = new Error("already exists");
    useUi.setState({
      prompt: {
        titleKey: "menu.file.newNote",
        placeholderKey: "tree.renamePlaceholder",
        initial: "",
        submit: () => Promise.reject(boom),
      },
    });
    render(<Prompt />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "taken" } });
    fireEvent.click(screen.getByText("app.ok"));
    await flush();

    expect(report).toHaveBeenCalledWith(boom);
  });

  it("passes the trimmed value through and closes on success", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    useUi.setState({
      prompt: { titleKey: "t", placeholderKey: "p", initial: "", submit },
    });
    render(<Prompt />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  name  " } });
    fireEvent.click(screen.getByText("app.ok"));
    await flush();

    expect(submit).toHaveBeenCalledWith("name");
    expect(useUi.getState().prompt).toBeNull();
  });

  it("does not submit an empty value", async () => {
    const submit = vi.fn();
    useUi.setState({
      prompt: { titleKey: "t", placeholderKey: "p", initial: "", submit },
    });
    render(<Prompt />);

    fireEvent.click(screen.getByText("app.ok"));
    await flush();

    expect(submit).not.toHaveBeenCalled();
  });

  describe("as a confirmation", () => {
    const confirmRequest = (submit: () => void | Promise<void>) => ({
      titleKey: "app.confirmTrash.title",
      confirm: {
        bodyKey: "app.confirmTrash.body",
        values: { name: "Note.md" },
        confirmKey: "menu.file.moveToTrash",
      },
      submit,
    });

    it("shows the body and the action's own label, and no input", () => {
      useUi.setState({ prompt: confirmRequest(vi.fn()) });
      render(<Prompt />);

      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.getByText("app.confirmTrash.body")).toBeTruthy();
      expect(screen.getByText("menu.file.moveToTrash")).toBeTruthy();
    });

    it("runs the action on confirm", async () => {
      const submit = vi.fn().mockResolvedValue(undefined);
      useUi.setState({ prompt: confirmRequest(submit) });
      render(<Prompt />);

      fireEvent.click(screen.getByText("menu.file.moveToTrash"));
      await flush();

      expect(submit).toHaveBeenCalledWith("");
    });

    it("does nothing on cancel", async () => {
      const submit = vi.fn();
      useUi.setState({ prompt: confirmRequest(submit) });
      render(<Prompt />);

      fireEvent.click(screen.getByText("app.cancel"));
      await flush();

      expect(submit).not.toHaveBeenCalled();
      expect(useUi.getState().prompt).toBeNull();
    });

    it("reports a failing confirmation too", async () => {
      const boom = new Error("read only");
      useUi.setState({ prompt: confirmRequest(() => Promise.reject(boom)) });
      render(<Prompt />);

      fireEvent.click(screen.getByText("menu.file.moveToTrash"));
      await flush();

      expect(report).toHaveBeenCalledWith(boom);
    });
  });
});
