import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabs } from "../stores/tabs";
import { uiStateNow } from "./uiState";

vi.mock("../ipc/client", () => ({ commands: {}, unwrap: vi.fn() }));

// ADR-0047: a file from outside the vault is open for this run only. Its
// grant ends with the app, so `state.json` never names it.
describe("uiStateNow", () => {
  beforeEach(() => {
    useTabs.setState({
      tabs: ["notes/a.md", "/Users/me/Downloads/x.md"],
      active: "/Users/me/Downloads/x.md",
      recent: ["/Users/me/Downloads/x.md", "notes/a.md"],
    });
  });

  it("keeps the vault's tabs and leaves out the ones from outside it", () => {
    const state = uiStateNow();

    expect(state.openTabs).toEqual(["notes/a.md"]);
    expect(state.activeTab).toBeNull();
    expect(state.recentFiles).toEqual(["notes/a.md"]);
  });
});
