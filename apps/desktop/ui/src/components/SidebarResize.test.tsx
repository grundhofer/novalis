import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../stores/ui";
import SidebarResize from "./SidebarResize";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
  }),
}));
vi.mock("../ipc/client", () => ({ commands: {}, unwrap: vi.fn() }));

// sebaro's divider (spec/02 §4.23, DSK-07, ADR-0051): 240 px to start,
// 200–360 px, the keyboard's steps, collapsing under the minimum, a double
// click back to the start width. The width is `state.json` state (a defect
// by the 2026-09-20 record was that nothing could change it).
describe("SidebarResize", () => {
  beforeEach(() => {
    useUi.setState({ sidebarWidth: 240, sidebarVisible: true, sidebarRoom: null });
  });

  const divider = () => screen.getByRole("separator");
  const state = () => ({ width: useUi.getState().sidebarWidth, visible: useUi.getState().sidebarVisible });

  it("names the sidebar it controls, its range and its width", () => {
    render(<SidebarResize />);
    const edge = divider();
    expect(edge.getAttribute("aria-controls")).toBe("sidebar");
    expect(edge.getAttribute("aria-label")).toBe("sidebar.resize");
    expect(edge.getAttribute("aria-valuemin")).toBe("200");
    expect(edge.getAttribute("aria-valuemax")).toBe("360");
    expect(edge.getAttribute("aria-valuenow")).toBe("240");
    expect(edge.getAttribute("aria-valuetext")).toBe('sidebar.widthValue {"width":240}');
    expect(edge.tabIndex).toBe(0);
  });

  // The 2 px ink line, its 24 px target and focus ring are sebaro.css's.
  it("is sebaro's divider", () => {
    render(<SidebarResize />);
    expect(divider().className).toBe("sb-window__divider");
    expect(divider().getAttribute("aria-orientation")).toBe("vertical");
  });

  // spec/02 §4.23: while dragged, the root keeps the resize pointer over the
  // content and stops text selection (sebaro.css).
  it("marks the drag on the root until it ends", () => {
    render(<SidebarResize />);
    const root = document.documentElement;
    fireEvent.pointerDown(divider(), { clientX: 240, pointerId: 1, button: 0 });
    expect(root.dataset.sbDragging).toBe("resize");
    fireEvent.pointerUp(divider(), { pointerId: 1 });
    expect(root.hasAttribute("data-sb-dragging")).toBe(false);
    fireEvent.pointerDown(divider(), { clientX: 240, pointerId: 2, button: 0 });
    fireEvent.pointerCancel(divider(), { pointerId: 2 });
    expect(root.hasAttribute("data-sb-dragging")).toBe(false);
  });

  it("says collapsed, at the smallest width, while the sidebar is hidden", () => {
    useUi.setState({ sidebarVisible: false, sidebarWidth: 300 });
    render(<SidebarResize />);
    expect(divider().getAttribute("aria-valuenow")).toBe("200");
    expect(divider().getAttribute("aria-valuetext")).toBe("sidebar.collapsed");
    expect(divider().getAttribute("aria-controls")).toBe("sidebar");
  });

  it("follows a drag, clamped to 200–360 px", () => {
    render(<SidebarResize />);
    const edge = divider();
    fireEvent.pointerDown(edge, { clientX: 240, pointerId: 1, button: 0 });
    fireEvent.pointerMove(edge, { clientX: 300, pointerId: 1 });
    expect(state()).toEqual({ width: 300, visible: true });
    fireEvent.pointerMove(edge, { clientX: 900, pointerId: 1 });
    expect(state().width).toBe(360);
    fireEvent.pointerMove(edge, { clientX: 180, pointerId: 1 });
    expect(state()).toEqual({ width: 200, visible: true });
    fireEvent.pointerUp(edge, { pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 300, pointerId: 1 });
    expect(state().width).toBe(200);
  });

  it("collapses 48 px under the smallest width and opens when dragged out again", () => {
    render(<SidebarResize />);
    const edge = divider();
    fireEvent.pointerDown(edge, { clientX: 240, pointerId: 1, button: 0 });
    fireEvent.pointerMove(edge, { clientX: 153, pointerId: 1 });
    expect(state()).toEqual({ width: 200, visible: true });
    fireEvent.pointerMove(edge, { clientX: 151, pointerId: 1 });
    expect(state()).toEqual({ width: 200, visible: false });
    fireEvent.pointerMove(edge, { clientX: 260, pointerId: 1 });
    expect(state()).toEqual({ width: 260, visible: true });
    fireEvent.pointerUp(edge, { pointerId: 1 });
  });

  it("opens a collapsed sidebar from the window's edge when dragged out", () => {
    useUi.setState({ sidebarVisible: false });
    render(<SidebarResize />);
    const edge = divider();
    fireEvent.pointerDown(edge, { clientX: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(edge, { clientX: 100, pointerId: 1 });
    expect(state().visible).toBe(false);
    fireEvent.pointerMove(edge, { clientX: 280, pointerId: 1 });
    expect(state()).toEqual({ width: 280, visible: true });
  });

  it("moves by 8 px with the arrows and 32 px with ⇧, Home and End to the ends", () => {
    render(<SidebarResize />);
    const edge = divider();
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(state().width).toBe(232);
    fireEvent.keyDown(edge, { key: "ArrowRight", shiftKey: true });
    expect(state().width).toBe(264);
    fireEvent.keyDown(edge, { key: "End" });
    expect(state().width).toBe(360);
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(state().width).toBe(360);
    fireEvent.keyDown(edge, { key: "Home" });
    expect(state().width).toBe(200);
    // The keyboard stops at the smallest width; only a drag collapses.
    fireEvent.keyDown(edge, { key: "ArrowLeft", shiftKey: true });
    expect(state()).toEqual({ width: 200, visible: true });
  });

  it("collapses and restores with Enter, keeping the width", () => {
    useUi.setState({ sidebarWidth: 300 });
    render(<SidebarResize />);
    const edge = divider();
    fireEvent.keyDown(edge, { key: "Enter" });
    expect(state()).toEqual({ width: 300, visible: false });
    fireEvent.keyDown(edge, { key: "Enter" });
    expect(state()).toEqual({ width: 300, visible: true });
  });

  // `Enter` is also the tree's rename in the window's keymap (App.tsx): the
  // divider's keys must not reach it, or Enter here renamed the open note.
  it("keeps its keys from the window's keymap", () => {
    const window_ = vi.fn();
    window.addEventListener("keydown", window_);
    try {
      render(<SidebarResize />);
      fireEvent.keyDown(divider(), { key: "Enter" });
      fireEvent.keyDown(divider(), { key: "ArrowLeft" });
      expect(window_).not.toHaveBeenCalled();
      fireEvent.keyDown(divider(), { key: "a" });
      expect(window_).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", window_);
    }
  });

  it("opens a collapsed sidebar with an arrow, from its smallest width", () => {
    useUi.setState({ sidebarVisible: false, sidebarWidth: 300 });
    render(<SidebarResize />);
    fireEvent.keyDown(divider(), { key: "ArrowRight" });
    expect(state()).toEqual({ width: 208, visible: true });
  });

  it("gives back the start width on a double click", () => {
    useUi.setState({ sidebarWidth: 344 });
    render(<SidebarResize />);
    fireEvent.doubleClick(divider());
    expect(state()).toEqual({ width: 240, visible: true });
  });

  // spec/02 §4.23, ADOPTION §2.3 (fit): in a window too narrow for its
  // width beside the content's 480 px the sidebar gives way. The divider
  // names and moves what shows; the sidebar's own width is kept.
  it("names and moves the width that shows while the sidebar gives way", () => {
    useUi.setState({ sidebarWidth: 320, sidebarRoom: 260 });
    render(<SidebarResize />);
    expect(divider().getAttribute("aria-valuenow")).toBe("260");
    expect(divider().getAttribute("aria-valuetext")).toBe('sidebar.widthValue {"width":260}');
    expect(state().width).toBe(320);
    // Wider than the room: no further than it fits.
    fireEvent.keyDown(divider(), { key: "ArrowRight" });
    expect(state().width).toBe(260);
    fireEvent.keyDown(divider(), { key: "End" });
    expect(state().width).toBe(260);
    fireEvent.keyDown(divider(), { key: "ArrowLeft", shiftKey: true });
    expect(state().width).toBe(228);
  });

  it("stays as it is with no room for even its smallest width", () => {
    useUi.setState({ sidebarWidth: 240, sidebarRoom: 180 });
    render(<SidebarResize />);
    expect(divider().getAttribute("aria-valuenow")).toBe("200");
    fireEvent.keyDown(divider(), { key: "ArrowRight" });
    expect(state()).toEqual({ width: 240, visible: true });
  });

  it("leaves chords with a modifier alone", () => {
    render(<SidebarResize />);
    fireEvent.keyDown(divider(), { key: "ArrowLeft", metaKey: true });
    expect(state().width).toBe(240);
  });
});
