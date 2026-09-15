import { describe, expect, it } from "vitest";

import { resolveDestination } from "./links";

describe("resolveDestination", () => {
  it("resolves relative to the note's folder", () => {
    expect(resolveDestination("notes/x.md", "attachments/a.png")).toBe("notes/attachments/a.png");
    expect(resolveDestination("notes/x.md", "./other.md")).toBe("notes/other.md");
    expect(resolveDestination("x.md", "attachments/a.png")).toBe("attachments/a.png");
    expect(resolveDestination(null, "a.md")).toBe("a.md");
  });

  it("walks up with .., never above the vault root", () => {
    expect(resolveDestination("notes/x.md", "../b.pdf")).toBe("b.pdf");
    expect(resolveDestination("notes/x.md", "../../../b.pdf")).toBe("b.pdf");
    expect(resolveDestination("notes/x.md", "..")).toBeNull();
  });

  it("percent-decodes and strips the fragment", () => {
    expect(resolveDestination("notes/x.md", "attachments/My%20Image.png")).toBe("notes/attachments/My Image.png");
    expect(resolveDestination("notes/x.md", "other.md#heading")).toBe("notes/other.md");
    // The fragment goes first, so an encoded `#` stays part of the name.
    expect(resolveDestination("notes/x.md", "a%23b.md#h")).toBe("notes/a#b.md");
    expect(resolveDestination("notes/x.md", "<a b.md>")).toBe("notes/a b.md");
    expect(resolveDestination("notes/x.md", "100%.md")).toBe("notes/100%.md");
  });

  it("is not for wikilinks, bare stems or URLs", () => {
    expect(resolveDestination("notes/x.md", "[[Name]]")).toBeNull();
    expect(resolveDestination("notes/x.md", "[[folder/Name]]")).toBeNull();
    expect(resolveDestination("notes/x.md", "Name")).toBeNull();
    expect(resolveDestination("notes/x.md", "https://example.com/a.md")).toBeNull();
    expect(resolveDestination("notes/x.md", "mailto:a@b.de")).toBeNull();
  });
});
