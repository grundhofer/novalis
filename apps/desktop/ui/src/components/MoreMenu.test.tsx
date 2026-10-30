import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MoreMenu from "./MoreMenu";

// The menu is a closed popover: jsdom hides it like a browser does, so its
// rows are found among hidden elements. Opening, arrows and focus return are
// sb-menu.js's (spec/02 §4.10), which the tests do not load.
const item = (name: string) => screen.getByRole("menuitem", { name, hidden: true });

describe("MoreMenu", () => {
  it("is sebaro's menu button: a named tool tied to its named popover menu", () => {
    render(<MoreMenu label="Mehr zu Plan" entries={[{ label: "Umbenennen …", onSelect: () => {} }]} />);
    const button = screen.getByRole("button", { name: "Mehr zu Plan" });
    expect(button.className).toBe("sb-icon-button sb-icon-button--compact");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.querySelector("use")?.getAttribute("href")).toBe("#more-horizontal");
    const menu = document.getElementById(button.getAttribute("popovertarget")!)!;
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("popover")).toBe("auto");
    expect(menu.getAttribute("aria-label")).toBe("Mehr zu Plan");
    // Its tooltip names it (NAV-10); the name inside is the button's already.
    const tip = document.getElementById(button.getAttribute("aria-describedby")!)!;
    expect(tip.getAttribute("popover")).toBe("manual");
    expect(tip.textContent).toBe("Mehr zu Plan");
  });

  it("puts the danger rows last, after a separator, whatever the order given", () => {
    render(
      <MoreMenu
        label="Mehr"
        entries={[
          { label: "Löschen …", danger: true, onSelect: () => {} },
          { label: "Umbenennen …", onSelect: () => {} },
        ]}
      />,
    );
    const rows = [...document.querySelector("ul.sb-menu")!.children];
    expect(rows.map((row) => row.getAttribute("role"))).toEqual(["none", "separator", "none"]);
    expect(rows[2]!.textContent).toBe("Löschen …");
    expect(item("Löschen …").className).toBe("sb-menu__item sb-menu__item--danger");
  });

  it("draws no separator in a menu of one kind", () => {
    render(<MoreMenu label="Mehr" entries={[{ label: "Umbenennen …", onSelect: () => {} }]} />);
    expect(document.querySelector(".sb-menu__sep")).toBeNull();
  });

  it("runs a row, but not a disabled one, and keeps the click from its host", () => {
    const run = vi.fn();
    const skipped = vi.fn();
    const host = vi.fn();
    render(
      <div onClick={host}>
        <MoreMenu
          label="Mehr"
          entries={[
            { label: "Nach links", disabled: true, onSelect: skipped },
            { label: "Nach rechts", onSelect: run },
          ]}
        />
      </div>,
    );

    fireEvent.click(item("Nach links"));
    fireEvent.click(item("Nach rechts"));
    fireEvent.click(screen.getByRole("button", { name: "Mehr" }));

    expect(item("Nach links").getAttribute("aria-disabled")).toBe("true");
    expect(skipped).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    expect(host).not.toHaveBeenCalled();
  });

  it("opens a submenu of check rows, the current choice checked and inert", () => {
    const pick = vi.fn();
    const same = vi.fn();
    render(
      <MoreMenu
        label="Mehr"
        entries={[
          {
            label: "In Spalte verschieben",
            choices: [
              { label: "Offen", checked: true, onSelect: same },
              { label: "Erledigt", checked: false, onSelect: pick },
            ],
          },
        ]}
      />,
    );
    const opener = item("In Spalte verschieben");
    expect(opener.getAttribute("aria-haspopup")).toBe("menu");
    const sub = document.getElementById(opener.getAttribute("popovertarget")!)!;
    expect(sub.getAttribute("aria-label")).toBe("In Spalte verschieben");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Offen", hidden: true }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Erledigt", hidden: true }));

    expect(same).not.toHaveBeenCalled();
    expect(pick).toHaveBeenCalledTimes(1);
  });
});
