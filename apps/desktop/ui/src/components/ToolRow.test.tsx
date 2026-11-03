import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ToolRow from "./ToolRow";

/** What Tab stops at in the row: a natively disabled control never takes focus. */
const stops = () =>
  [...screen.getByRole("toolbar").querySelectorAll<HTMLElement>("button:enabled, input:enabled")].filter((tool) => tool.tabIndex === 0);

// ADR-0051 #80: what every row has. The rows themselves are tested beside
// DocTools and the viewers.
describe("ToolRow", () => {
  it("is sebaro's row as a named toolbar", () => {
    render(
      <ToolRow label="tools">
        <button type="button">A</button>
      </ToolRow>,
    );
    const row = screen.getByRole("toolbar", { name: "tools" });
    expect(row.className).toBe("sb-doc-bar");
  });

  // APG: a disabled control is skipped only when it is natively disabled;
  // an `aria-disabled` one keeps its place (Tool.tsx).
  it("skips a natively disabled control and keeps an aria-disabled one", () => {
    render(
      <ToolRow label="tools">
        <button type="button">A</button>
        <button type="button" disabled>
          B
        </button>
        <button type="button" aria-disabled="true">
          C
        </button>
      </ToolRow>,
    );
    const a = screen.getByText("A");
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByText("C"));
    expect(stops()).toEqual([screen.getByText("C")]);
  });

  it("goes back to its first tool when the tool used last goes", () => {
    const { rerender } = render(
      <ToolRow label="tools">
        <button type="button">A</button>
        <button type="button">B</button>
      </ToolRow>,
    );
    fireEvent.click(screen.getByText("B"));
    expect(stops()).toEqual([screen.getByText("B")]);

    rerender(
      <ToolRow label="tools">
        <button type="button">A</button>
      </ToolRow>,
    );
    expect(stops()).toEqual([screen.getByText("A")]);
  });

  it("leaves a text field its keys", () => {
    render(
      <ToolRow label="tools">
        <button type="button">A</button>
        <input aria-label="page" />
      </ToolRow>,
    );
    const field = screen.getByLabelText("page");
    fireEvent.keyDown(screen.getByText("A"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(field);
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(fireEvent.keyDown(field, { key }), key).toBe(true);
      expect(document.activeElement, key).toBe(field);
    }
  });

  // Found in review: a field as the stop kept the arrows to itself, and the
  // other tools could no longer be reached by keyboard.
  it("never makes a text field its stop", () => {
    render(
      <ToolRow label="tools">
        <input aria-label="page" />
        <button type="button">A</button>
        <button type="button">B</button>
      </ToolRow>,
    );
    const field = screen.getByLabelText("page");
    expect(stops()).toEqual([screen.getByText("A")]);
    screen.getByText("B").focus();
    fireEvent.keyDown(screen.getByText("B"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(field);
    expect(stops()).toEqual([screen.getByText("B")]);
    fireEvent.click(field);
    expect(stops()).toEqual([screen.getByText("B")]);
  });
});
