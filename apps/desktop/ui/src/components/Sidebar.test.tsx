import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import Sidebar from "./Sidebar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// jsdom has no layout, so the real virtualizer measures a 0 px scroller and
// renders no rows at all (ADR-0011: layout is not covered here). Every row is
// materialized instead; the tree's own logic is what is under test.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, size: 28, start: index * 28 })),
  }),
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const entry = (path: string, dir: boolean) => ({
  path,
  name: path,
  dir,
  size: "0",
  mtimeNs: "0",
  cloudOnly: false,
  boardSlug: null,
  conflictCopyOf: null,
});

describe("Sidebar", () => {
  beforeEach(() => {
    useVault.getState().setVault({ root: "/v", name: "v", kind: "local", boards: [] }, [
      entry("Notes", true),
      entry("a.md", false),
    ]);
    useTabs.setState({ tabs: [], active: null });
    useUi.setState({ toast: null });
  });

  // The defect: a click on a tree row fired `void useTabs.getState().open()`
  // / `void useVault.getState().toggleFolder()` with no handler, so a note
  // that could not be read or a folder that could not be listed rejected into
  // `unhandledrejection` and painted the fatal overlay over a working window.
  // Both are toasts now (`report`, stores/ui.ts).
  it("reports a note that cannot be opened as a toast", async () => {
    const boom = new Error("EACCES");
    useTabs.setState({ open: vi.fn().mockRejectedValue(boom) });
    render(<Sidebar />);

    fireEvent.click(screen.getByText("a.md"));
    await flush();

    expect(useUi.getState().toast).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });

  it("reports a folder that cannot be listed as a toast", async () => {
    const boom = new Error("EACCES");
    useVault.setState({ toggleFolder: vi.fn().mockRejectedValue(boom) });
    render(<Sidebar />);

    fireEvent.click(screen.getByText("Notes"));
    await flush();

    expect(useUi.getState().toast).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });
});
