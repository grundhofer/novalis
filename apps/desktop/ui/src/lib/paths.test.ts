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
