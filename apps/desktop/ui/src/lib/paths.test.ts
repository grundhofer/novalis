import { describe, expect, it } from "vitest";

import { providerOf } from "./paths";

describe("providerOf", () => {
  it("names the provider from the CloudStorage domain folder", () => {
    expect(providerOf("/Users/x/Library/CloudStorage/OneDrive-Persönlich/novalis-test")).toBe("OneDrive");
    expect(providerOf("/Users/x/Library/CloudStorage/GoogleDrive-a-b@example.com/Meine Ablage/v")).toBe(
      "Google Drive",
    );
    expect(providerOf("/Users/x/Library/CloudStorage/Dropbox/v")).toBe("Dropbox");
  });

  it("has no provider for a vault outside CloudStorage", () => {
    expect(providerOf("/Users/x/Notes")).toBeNull();
    expect(providerOf("/Users/x/Google Drive/My Drive/v")).toBeNull();
  });
});

// ADR-0040: a relative Markdown destination, encoded per segment.
describe("relativeLink", () => {
  it("walks up and down from the note's folder and escapes each segment", async () => {
    const { relativeLink } = await import("./paths");
    expect(relativeLink("notes", "notes/att/a b.pdf")).toBe("att/a%20b.pdf");
    expect(relativeLink("notes/deep", "docs/x (1).png")).toBe("../../docs/x%20%281%29.png");
    expect(relativeLink("", "docs/y.pdf")).toBe("docs/y.pdf");
  });
});
