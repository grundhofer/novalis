import { afterEach, describe, expect, it } from "vitest";

import { tableRowHeight, windowRowHeight } from "./windowRow";

// RAU-06 and ADR-0051 #24 (R3): the tree's row is 32 px, and grows with the
// root font once the label line is taller.
describe("windowRowHeight", () => {
  const root = document.documentElement;

  afterEach(() => {
    root.removeAttribute("style");
  });

  const tokens = (fontSize: string) => {
    root.style.fontSize = fontSize;
    root.style.setProperty("--sb-size-control-sm", "32px");
    root.style.setProperty("--sb-type-label-size", "0.875rem");
    root.style.setProperty("--sb-type-label-line-height", "1.4286");
  };

  it("is 32 px at the normal root font", () => {
    tokens("16px");
    expect(windowRowHeight()).toBe(32);
  });

  it("follows the label line at 200 % text", () => {
    tokens("32px");
    expect(windowRowHeight()).toBe(40);
  });

  it("falls back to 32 px without the export's tokens", () => {
    expect(windowRowHeight()).toBe(32);
  });
});

// ADR-0051 #24 (R2): the CSV table's row is one body line in sebaro's cell,
// and grows with the root font.
describe("tableRowHeight", () => {
  const root = document.documentElement;

  afterEach(() => {
    root.removeAttribute("style");
  });

  const tokens = (fontSize: string) => {
    root.style.fontSize = fontSize;
    root.style.setProperty("--sb-type-body-size", "1rem");
    root.style.setProperty("--sb-type-body-line-height", "1.5");
    root.style.setProperty("--sb-space-1", "0.25rem");
    root.style.setProperty("--sb-border-width-hairline", "1px");
  };

  it("is one body line, its padding and the hairline at the normal root font", () => {
    tokens("16px");
    expect(tableRowHeight()).toBe(33);
  });

  it("grows with the root font at 200 % text, the hairline staying 1 px", () => {
    tokens("32px");
    expect(tableRowHeight()).toBe(65);
  });

  it("falls back to the normal height without the export's tokens", () => {
    expect(tableRowHeight()).toBe(33);
  });
});
