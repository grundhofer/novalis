import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBoard } from "../stores/board";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { dispatchCommand } from "./commands";
import { handleOpenRequests } from "./opening";

vi.mock("../ipc/client", () => ({ commands: {}, unwrap: vi.fn() }));
vi.mock("./commands", () => ({ dispatchCommand: vi.fn() }));

// ADR-0045: what macOS hands over opens when it is the vault's; ADR-0047:
// any other file the app opens too, in place; nothing switches vaults.
describe("handleOpenRequests", () => {
  let open: ReturnType<typeof vi.fn>;
  let load: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    open = vi.fn().mockResolvedValue(undefined);
    load = vi.fn().mockResolvedValue(undefined);
    useTabs.setState({ open } as never);
    useBoard.setState({ boards: [{ slug: "plan", name: "Plan", order: null }] as never, load } as never);
    useVault.setState({ vault: { root: "/Users/me/Vault" } as never });
    useFiles.setState({ files: ["notes/a.md", "b.txt"] });
    useUi.setState({ message: null, activeBoard: null });
  });

  it("opens a listed file of the vault as a tab", () => {
    handleOpenRequests([{ kind: "file", path: "/Users/me/Vault/notes/a.md" }]);
    expect(open).toHaveBeenCalledWith("notes/a.md");
  });

  // ADR-0047: any other file the app opens gets a tab of its own, keyed by
  // the absolute path the shell granted — unnormalized, as it came.
  it("opens a file outside the vault, or one the tree does not list, by its absolute path", () => {
    handleOpenRequests([{ kind: "file", path: "/Users/me/Elsewhere/x.md" }]);
    expect(open).toHaveBeenCalledWith("/Users/me/Elsewhere/x.md");
    handleOpenRequests([{ kind: "file", path: "/Users/me/Vault/.hidden.md" }]);
    expect(open).toHaveBeenCalledWith("/Users/me/Vault/.hidden.md");
    const decomposed = "/Users/me/Elsewhere/Gru\u0308n.pdf";
    handleOpenRequests([{ kind: "file", path: decomposed }]);
    expect(open).toHaveBeenCalledWith(decomposed);
    expect(useUi.getState().message).toBeNull();
  });

  it("says so for a file of a type it does not open", () => {
    handleOpenRequests([{ kind: "file", path: "/Users/me/Elsewhere/x.exe" }]);
    expect(useUi.getState().message).toEqual({
      key: "app.openUnsupported",
      values: { path: "/Users/me/Elsewhere/x.exe" },
    });
    expect(open).not.toHaveBeenCalled();
  });

  it("follows novalis://today and novalis://open, and refuses the rest", () => {
    handleOpenRequests([{ kind: "link", url: "novalis://today" }]);
    expect(dispatchCommand).toHaveBeenCalledWith("file.todayNote");
    handleOpenRequests([{ kind: "link", url: "novalis://open?path=notes%2Fa.md" }]);
    expect(open).toHaveBeenCalledWith("notes/a.md");
    handleOpenRequests([{ kind: "link", url: "novalis://open?path=boards/plan" }]);
    expect(useUi.getState().activeBoard).toBe("plan");
    expect(load).toHaveBeenCalledWith("plan");
    handleOpenRequests([{ kind: "link", url: "novalis://new?text=x" }]);
    expect(useUi.getState().message?.key).toBe("app.openLinkRefused");
  });
});
