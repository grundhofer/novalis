import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCommand } from "../lib/commands";
import tileSvg from "../sebaro/brand/inline/tile-novalis-small.svg?raw";
import { useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import TitleBar from "./TitleBar";

// The key, with a `{{place}}` appended so „Zurück zu <Ort>“ shows its place.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, values?: { place?: string }) => (values?.place ? `${key}:${values.place}` : key) }),
}));
vi.mock("../ipc/client", () => ({ commands: {}, unwrap: vi.fn() }));
vi.mock("../lib/commands", () => ({ dispatchCommand: vi.fn() }));

function vault(name: string) {
  useVault.setState({ vault: { name } as never });
}

// sebaro's title bar (spec/02 §4.17, DSK-04, DSK-06; ADR-0051 #5).
describe("TitleBar", () => {
  beforeEach(() => {
    useVault.setState({ vault: null });
    useTabs.setState({ tabs: [], active: null });
    useUi.setState({ boardVisible: false, activeBoard: null, sidebarVisible: true, settingsView: false });
    useBoard.setState({ boards: [] });
  });

  it("is the window's title bar and drags the window from anywhere but a control", () => {
    const { container } = render(<TitleBar />);
    const bar = container.querySelector("header.sb-window__titlebar")!;
    expect(bar.getAttribute("data-tauri-drag-region")).toBe("deep");
    expect(screen.getByText("app.name").className).toBe("sb-window__name");
  });

  it("shows the export's tile unchanged, hidden beside the name, as the start's target", () => {
    const { container } = render(<TitleBar />);
    const tile = container.querySelector(".sb-sign-tile.sb-sign-tile--32")!;
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(tile.hasAttribute("data-sb-start-target")).toBe(true);
    // The file as exported (ZEI-07), as the parser writes it back.
    const exported = document.createElement("span");
    exported.innerHTML = tileSvg;
    expect(tile.innerHTML).toBe(exported.innerHTML);
    expect(tile.querySelector("svg.sb-app-sign")).toBeTruthy();
  });

  it("writes the path as text: the places with chevrons between, the current one last", () => {
    vault("Vault");
    useTabs.setState({ tabs: ["notes/2026/Plan.md"], active: "notes/2026/Plan.md" });
    const { container } = render(<TitleBar />);
    const path = container.querySelector("p.sb-window__path")!;
    expect(path.closest("nav, ol")).toBeNull();
    expect(path.querySelector("a")).toBeNull();
    const spans = [...path.querySelectorAll(":scope > span")].map((span) => span.textContent);
    expect(spans).toEqual(["window.place", "Vault", "notes", "2026", "Plan"]);
    expect(path.querySelector(":scope > span")?.className).toBe("sb-visually-hidden");
    const chevrons = [...path.querySelectorAll(":scope > svg use")].map((use) => use.getAttribute("href"));
    expect(chevrons).toEqual(["#chevron-right--16", "#chevron-right--16", "#chevron-right--16"]);
    expect(path.textContent).not.toMatch(/[/▸›>]/);
  });

  it("names the board as the current place while it shows", () => {
    vault("Vault");
    useTabs.setState({ tabs: ["a.md"], active: "a.md" });
    useBoard.setState({ boards: [{ slug: "plan", name: "Wochenplan" } as never] });
    useUi.setState({ boardVisible: true, activeBoard: "plan" });
    const { container } = render(<TitleBar />);
    const spans = [...container.querySelectorAll(".sb-window__path > span")].map((span) => span.textContent);
    expect(spans).toEqual(["window.place", "Vault", "Wochenplan"]);
  });

  it("has no path without a place", () => {
    const { container } = render(<TitleBar />);
    expect(container.querySelector(".sb-window__path")).toBeNull();
  });

  it("has the sidebar's tool, with its state, its shortcut and sebaro's tooltip", () => {
    render(<TitleBar />);
    const group = screen.getByRole("group", { name: "window.tools" });
    expect(group.className).toBe("sb-window__tools");
    const tool = screen.getByRole("button", { name: "sidebar.label" });
    expect(group.contains(tool)).toBe(true);
    expect(tool.className).toBe("sb-icon-button sb-icon-button--compact");
    expect(tool.getAttribute("aria-expanded")).toBe("true");
    expect(tool.getAttribute("aria-controls")).toBe("sidebar");
    expect(tool.getAttribute("aria-keyshortcuts")).toBe("Control+Meta+S");
    expect(tool.hasAttribute("data-sb-window-toggle")).toBe(true);
    expect(tool.querySelector("svg.sb-icon use")?.getAttribute("href")).toBe("#sidebar");

    const tip = document.getElementById(tool.getAttribute("aria-describedby")!)!;
    expect(tip.className).toBe("sb-tooltip");
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.getAttribute("popover")).toBe("manual");
    // Not part of the bar's drag surface: a press on the open tooltip neither
    // drags nor zooms the window.
    expect(tip.getAttribute("data-tauri-drag-region")).toBe("false");
    // The name is the button's; the tooltip adds only the spoken shortcut.
    expect(tip.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    const keys = tip.querySelector(".sb-keys")!;
    expect(keys.getAttribute("data-sb-keys")).toBe("Ctrl+Mod+S");
    expect(keys.querySelector('[aria-hidden="true"]')?.textContent).toBe("⌃⌘S");
    expect(keys.querySelector(".sb-visually-hidden")?.textContent).toBe("keys.ctrl keys.cmd S");
  });

  it("toggles the sidebar through its command and says when it is hidden", () => {
    render(<TitleBar />);
    const tool = screen.getByRole("button", { name: "sidebar.label" });
    fireEvent.click(tool);
    expect(dispatchCommand).toHaveBeenCalledWith("sidebar.toggle", "tool");

    act(() => useUi.setState({ sidebarVisible: false }));
    expect(tool.getAttribute("aria-expanded")).toBe("false");
    // The hidden sidebar stays in the page with `hidden` (spec/02 §4.17).
    expect(tool.getAttribute("aria-controls")).toBe("sidebar");
  });

  // spec/02 §4.17: over the content of a narrow window the tool says whether
  // the overlay is open, whatever the choice beside the content is.
  it("says whether the overlay is open in a narrow window", () => {
    render(<TitleBar />);
    const tool = screen.getByRole("button", { name: "sidebar.label" });
    act(() => useUi.setState({ sidebarVisible: true, sidebarOverlay: true, sidebarOverlayOpen: false }));
    expect(tool.getAttribute("aria-expanded")).toBe("false");
    act(() => useUi.setState({ sidebarOverlayOpen: true }));
    expect(tool.getAttribute("aria-expanded")).toBe("true");
    act(() => useUi.setState({ sidebarOverlay: false, sidebarOverlayOpen: false }));
  });

  // spec/02 §4.24, D102 (7), ADR-0051 #1: the slim settings view's path is
  // „Einstellungen“, and „Zurück zu <Ort>“ follows the sidebar tool, naming
  // the place the path named before.
  it("names the settings view and leads back to the place before", () => {
    vault("Vault");
    useTabs.setState({ tabs: ["notes/Plan.md"], active: "notes/Plan.md" });
    useUi.setState({ settingsView: true });
    const { container } = render(<TitleBar />);
    const spans = [...container.querySelectorAll("p.sb-window__path > span")].map((span) => span.textContent);
    expect(spans).toEqual(["window.place", "sidebar.settings"]);

    const tools = container.querySelector(".sb-window__tools")!;
    const back = screen.getByRole("button", { name: "settingsView.backTo:Plan" });
    expect(back.className).toBe("sb-text-action sb-text-action--compact");
    expect(back.hasAttribute("data-sb-escape")).toBe(true);
    expect(back.querySelector("svg.sb-icon--20 use")?.getAttribute("href")).toBe("#arrow-left");
    expect(back.querySelector(".sb-window__word")?.textContent).toBe("settingsView.backTo:PlansettingsView.back");
    // Below 722 px app.css shows only the short word; the name keeps the place.
    expect(back.querySelector(".nv-word-long")?.textContent).toBe("settingsView.backTo:Plan");
    expect(back.querySelector(".nv-word-short")?.textContent).toBe("settingsView.back");
    // After the sidebar tool, in the tools' group.
    expect(tools.lastElementChild).toBe(back);
    expect(tools.querySelector("[data-sb-window-toggle]")).toBeTruthy();

    fireEvent.click(back);
    expect(useUi.getState().settingsView).toBe(false);
    expect(container.querySelector("[data-sb-escape]")).toBeNull();
  });

  it("says only „Zurück“ when there was no place before", () => {
    useUi.setState({ settingsView: true });
    render(<TitleBar />);
    expect(screen.getByRole("button", { name: "settingsView.back" })).toBeTruthy();
  });
});
