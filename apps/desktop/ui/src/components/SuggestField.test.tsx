import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import SuggestField from "./SuggestField";

/** The field as a parent holds it, with a spy on what it is told. */
function Harness({ onChange, onKey }: { onChange?: (value: string) => void; onKey?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div onKeyDown={onKey}>
      <SuggestField
        label="Schlagwort"
        listLabel="Schlagwörter"
        value={value}
        suggestions={["Garten", "Garage", "Haus"]}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </div>
  );
}

const field = () => screen.getByRole("combobox", { name: "Schlagwort" }) as HTMLInputElement;
const list = () => screen.queryByRole("listbox", { name: "Schlagwörter" });
const names = () => [...(list()?.querySelectorAll("[role=option]") ?? [])].map((o) => o.textContent);

// spec/02 §4.26 (NV-M12): a field with suggestions is a combobox with
// sebaro's completion list under it, never a datalist.
describe("SuggestField", () => {
  it("is a labelled compact field whose input is a combobox", () => {
    render(<Harness />);
    const input = field();
    expect(input.closest(".sb-field")?.className).toBe("sb-field sb-field--compact nv-suggest");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("list")).toBe(false);
    expect(list()).toBeNull();
  });

  it("opens with the values that contain the typed text, the typed letters marked", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "gar" } });
    expect(field().getAttribute("aria-expanded")).toBe("true");
    expect(list()?.className).toBe("sb-completion");
    expect(names()).toEqual(["Garten", "Garage"]);
    const hits = [...list()!.querySelectorAll("b.sb-completion__hit")].map((b) => b.textContent);
    expect(hits).toEqual(["Gar", "Gar"]);
    for (const option of list()!.querySelectorAll("[role=option]")) expect(option.className).toBe("sb-row");
    // No active option until an arrow: Eingabe keeps what was typed.
    expect(field().hasAttribute("aria-activedescendant")).toBe(false);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(field().value).toBe("gar");
    expect(list()).toBeNull();
  });

  it("moves with the arrows and takes the active option with Eingabe", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "ga" } });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    const active = document.getElementById(field().getAttribute("aria-activedescendant")!)!;
    expect(active.textContent).toBe("Garage");
    expect(active.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("Garage");
    expect(field().value).toBe("Garage");
    expect(list()).toBeNull();
  });

  // jsdom has no layout, so `scrollIntoView` is what the test can see.
  it("keeps the active option in view while the arrows move", () => {
    const original = Element.prototype.scrollIntoView;
    const scrolled: [string | null, unknown][] = [];
    Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      scrolled.push([this.textContent, arg]);
    };
    try {
      render(<Harness />);
      fireEvent.keyDown(field(), { key: "ArrowDown" });
      fireEvent.keyDown(field(), { key: "ArrowUp" });
      expect(scrolled).toEqual([
        ["Garten", { block: "nearest" }],
        ["Haus", { block: "nearest" }],
      ]);
      expect(document.getElementById(field().getAttribute("aria-activedescendant")!)?.textContent).toBe("Haus");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("takes an option on a press, keeping the focus in the field", () => {
    render(<Harness />);
    field().focus();
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(names()).toEqual(["Garten", "Garage", "Haus"]);
    const haus = screen.getByRole("option", { name: "Haus" });
    expect(fireEvent.mouseDown(haus)).toBe(false);
    fireEvent.click(haus);
    expect(field().value).toBe("Haus");
  });

  it("closes the list with the first Escape and lets the second through", () => {
    const onKey = vi.fn();
    render(<Harness onKey={onKey} />);
    fireEvent.change(field(), { target: { value: "h" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(list()).toBeNull();
    expect(field().value).toBe("h");
    expect(onKey).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it("shows no list when nothing contains the text, and closes when the field loses focus", () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: "xyz" } });
    expect(list()).toBeNull();
    fireEvent.change(field(), { target: { value: "a" } });
    expect(list()).not.toBeNull();
    fireEvent.blur(field());
    expect(list()).toBeNull();
  });
});
