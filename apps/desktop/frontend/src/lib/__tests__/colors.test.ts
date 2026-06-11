import { describe, expect, it } from "vitest";

import { COLOR_HEX, colorForNotePath } from "../colors";

describe("colorForNotePath", () => {
  const colors = { A: "indigo", "A/B": "emerald" };

  it("uses the deepest colored ancestor, not the first", () => {
    // /A is indigo, /A/B is emerald: a note deep under /A/B/C inherits /A/B.
    expect(colorForNotePath("A/B/C/deep.md", colors)).toBe(COLOR_HEX.emerald);
  });

  it("walks up past uncolored intermediate folders", () => {
    expect(colorForNotePath("A/uncolored/note.md", colors)).toBe(COLOR_HEX.indigo);
  });

  it("returns null when no ancestor is colored", () => {
    expect(colorForNotePath("elsewhere/note.md", colors)).toBeNull();
    expect(colorForNotePath("root-note.md", colors)).toBeNull();
  });

  it("ignores an unknown color token defensively", () => {
    expect(colorForNotePath("X/note.md", { X: "not-a-token" })).toBeNull();
  });

  it("does not confuse a folder with a folder-prefixed sibling", () => {
    // "A2/note.md" must not match the "A" color via prefix.
    expect(colorForNotePath("A2/note.md", colors)).toBeNull();
  });
});
