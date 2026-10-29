import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import sprite from "../sebaro/icons/sprite.svg?raw";
import Icon, { externalLinkIcon, symbolOf, type IconName } from "./Icon";

const NAMES: IconName[] = [
  "plus",
  "folder",
  "board",
  "settings",
  "trash",
  "sidebar",
  "chevron-right",
  "external-link",
  "error",
  "warning",
  "home",
  "file-text",
  "info",
  "arrow-up",
  "arrow-down",
  "close",
  "search",
  "check",
  "chevron-up",
  "chevron-down",
  "warning--filled",
  "info--filled",
  "error--filled",
  "loader",
  "chevron-left",
  "zoom-out",
  "zoom-in",
  "zoom-fit",
  "changed",
  "eye",
  "arrow-left",
  "settings--filled",
];
// Where the 16-unit master is not named `<name>--16`.
const MASTERS: Partial<Record<IconName, string>> = { "error--filled": "error--filled-16" };
const SYMBOLS = new Set([...sprite.matchAll(/<symbol id="([^"]+)"/g)].map(([, id]) => id));

// ICO-04: icons are `<use>` of the inlined sprite, at 16 px from the 16-unit
// master where there is one; nothing is drawn by hand.
describe("Icon", () => {
  it("uses a symbol the exported sprite has, for every name and size", () => {
    for (const name of NAMES) {
      for (const size of [16, 20, 24] as const) expect(SYMBOLS.has(symbolOf(name, size)), `${name} ${size}`).toBe(true);
    }
  });

  it("takes the 16-unit master at 16 px where the sprite has one", () => {
    for (const name of NAMES) {
      const master = MASTERS[name] ?? `${name}--16`;
      expect(symbolOf(name, 16)).toBe(SYMBOLS.has(master) ? master : name);
    }
    expect(symbolOf("plus", 20)).toBe("plus");
  });

  it("renders sebaro's markup: size class, hidden from screen readers, no path of its own", () => {
    const { container } = render(<Icon name="plus" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("sb-icon sb-icon--16");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("use")?.getAttribute("href")).toBe("#plus--16");
    expect(svg.querySelector("path")).toBeNull();

    const tool = render(<Icon name="sidebar" size={20} />).container.querySelector("svg")!;
    expect(tool.getAttribute("class")).toBe("sb-icon sb-icon--20");
    expect(tool.querySelector("use")?.getAttribute("href")).toBe("#sidebar");

    const row = render(<Icon name="folder" size={20} className="sb-row__icon" />).container.querySelector("svg")!;
    expect(row.getAttribute("class")).toBe("sb-icon sb-icon--20 sb-row__icon");
  });

  it("builds the external-link icon as a DOM node for the preview", () => {
    const svg = externalLinkIcon(document);
    expect(svg.getAttribute("class")).toBe("sb-icon sb-icon--16");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("use")?.getAttribute("href")).toBe("#external-link--16");
  });
});
