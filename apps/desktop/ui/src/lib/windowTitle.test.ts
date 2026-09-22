import { describe, expect, it } from "vitest";

import { windowTitle } from "./windowTitle";

describe("windowTitle", () => {
  it("names the open file and the vault, the vault alone, or the app", () => {
    expect(windowTitle("notes/Atlas Overview.md", "Vault")).toBe("Atlas Overview — Vault");
    expect(windowTitle(null, "Vault")).toBe("Vault");
    expect(windowTitle(null, null)).toBe("novalis");
  });
});
