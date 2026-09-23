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

// ADR-0045: what macOS hands over opens when it is the vault's, and is said
// otherwise; nothing switches vaults.
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
    useUi.setState({ toast: null, activeBoard: null });
  });

  it("opens a listed file of the vault as a tab", () => {
    handleOpenRequests([{ kind: "file", path: "/Users/me/Vault/notes/a.md" }]);
    expect(open).toHaveBeenCalledWith("notes/a.md");
  });

  it("says so for a file outside the vault, or one it does not list", () => {
    handleOpenRequests([{ kind: "file", path: "/Users/me/Elsewhere/x.md" }]);
    expect(useUi.getState().toast).toEqual({
      key: "app.openOutsideVault",
      values: { path: "/Users/me/Elsewhere/x.md" },
    });
    handleOpenRequests([{ kind: "file", path: "/Users/me/Vault/.hidden.md" }]);
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
    expect(useUi.getState().toast?.key).toBe("app.openLinkRefused");
  });
});
