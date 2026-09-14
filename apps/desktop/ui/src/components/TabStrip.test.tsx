import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import TabStrip from "./TabStrip";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TabStrip", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: ["a.md", "b.md"], active: "a.md" });
    useEditorSave.setState({ docs: {} });
    useUi.setState({ toast: null });
  });

  // The defect: a click on a tab fired `void useTabs.getState().close(path)`
  // with no handler, so a close whose flush failed (a read-only vault, a
  // vanished file) rejected into `unhandledrejection` and painted the fatal
  // overlay over a working window. It is a toast now, like every other
  // fire-and-forget in the UI (`report`, stores/ui.ts).
  it("reports a failed close as a toast", async () => {
    const boom = new Error("EROFS");
    useTabs.setState({ close: vi.fn().mockRejectedValue(boom) });
    render(<TabStrip />);

    fireEvent.click(screen.getAllByLabelText("menu.file.closeTab")[1]!);
    await flush();

    expect(useUi.getState().toast).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });

  it("reports a failed activation as a toast", async () => {
    const boom = new Error("EROFS");
    useTabs.setState({ activate: vi.fn().mockRejectedValue(boom) });
    render(<TabStrip />);

    fireEvent.click(screen.getByText("b"));
    await flush();

    expect(useUi.getState().toast).toEqual({
      key: "errors.internal",
      values: { detail: String(boom) },
    });
  });
});
