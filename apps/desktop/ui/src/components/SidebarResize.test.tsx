import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../stores/ui";
import SidebarResize from "./SidebarResize";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../ipc/client", () => ({ commands: {}, unwrap: vi.fn() }));

// `sidebarWidth` was kept in state.json with nothing to change it (a defect
// by the 2026-09-20 record); the edge drags it, within the tokens' bounds.
describe("SidebarResize", () => {
  beforeEach(() => {
    document.documentElement.style.setProperty("--ds-size-sidebar-min", "180px");
    document.documentElement.style.setProperty("--ds-size-sidebar-max", "480px");
    useUi.setState({ sidebarWidth: 256 });
  });

  it("follows a drag, clamped to the sidebar's bounds", () => {
    render(<SidebarResize />);
    const edge = screen.getByRole("separator");
    fireEvent.pointerDown(edge, { clientX: 256, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 300, pointerId: 1 });
    expect(useUi.getState().sidebarWidth).toBe(300);
    fireEvent.pointerMove(edge, { clientX: 900, pointerId: 1 });
    expect(useUi.getState().sidebarWidth).toBe(480);
    fireEvent.pointerUp(edge, { pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 100, pointerId: 1 });
    expect(useUi.getState().sidebarWidth).toBe(480);
  });

  it("moves by 16 px with the arrow keys", () => {
    render(<SidebarResize />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(useUi.getState().sidebarWidth).toBe(240);
  });
});
