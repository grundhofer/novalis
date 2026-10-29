import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import sebaroCss from "../sebaro/css/sebaro.css?raw";
import tokensCss from "../sebaro/tokens.css?raw";
import { sidebarShown, useUi } from "../stores/ui";
import { overlayBelow, toggleSidebar, watchSidebarFit } from "./windowFit";

vi.mock("../ipc/client", () => ({ commands: {}, unwrap: vi.fn() }));

// The sidebar over the content of a narrow window (spec/02 §4.17, DSK-04,
// DSK-07; ADOPTION §2.3 for a counterpart without sb-window.js). jsdom has
// neither layout nor ResizeObserver: the test stands in for both, giving
// the window its width and calling the observer's callback.
describe("the sidebar in a narrow window", () => {
  let resized: () => void;
  let unwatch: () => void;
  let width: number;

  /** The window's width from now on, without telling anyone. */
  const widen = (to: number) => {
    width = to;
  };

  /** Renders the store's state as React does: `hidden` on what does not show. */
  const render = () => {
    const state = useUi.getState();
    const nav = document.getElementById("sidebar")!;
    nav.hidden = !sidebarShown(state);
    document.getElementById("tool")!.setAttribute("aria-expanded", String(sidebarShown(state)));
  };

  /** The window gets narrower than 722 px (`narrow`) or wide enough again. */
  const resize = (narrow: boolean) => {
    widen(narrow ? 640 : 1200);
    resized();
    render();
  };

  /** What `requestAnimationFrame` defers: the focus once React has shown the pane. */
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  beforeEach(() => {
    // jsdom loads no stylesheet: the page gets the exported token as is.
    const below = /--sb-x-sebaro-pane-sidebar-overlay-below: ([^;]+);/.exec(tokensCss)?.[1] ?? "";
    document.documentElement.style.setProperty("--sb-x-sebaro-pane-sidebar-overlay-below", below);
    document.body.innerHTML = `
      <div class="sb-window">
        <header class="sb-window__titlebar">
          <button id="tool" data-sb-window-toggle="" aria-controls="sidebar" aria-expanded="true">Sidebar</button>
        </header>
        <div class="sb-window__body">
          <nav class="sb-side-nav sb-window__sidebar" id="sidebar">
            <button id="today">Today</button>
            <div role="tree"><div id="row" role="treeitem" tabindex="0">a</div></div>
          </nav>
          <main class="main sb-window__content"><button id="content">Text</button></main>
        </div>
      </div>
      <dialog id="dialog"><button id="in-dialog">OK</button></dialog>`;
    width = 1200;
    const frame = document.querySelector<HTMLElement>(".sb-window")!;
    frame.getBoundingClientRect = () => ({ width }) as DOMRect;
    useUi.setState({ sidebarVisible: true, sidebarOverlay: false, sidebarOverlayOpen: false, sidebarWidth: 240 });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    unwatch = watchSidebarFit();
    render();
  });

  afterEach(() => {
    unwatch();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--sb-x-sebaro-pane-sidebar-overlay-below");
    useUi.setState({ sidebarOverlay: false, sidebarOverlayOpen: false, sidebarRoom: null });
  });

  const focused = () => document.activeElement;
  const byId = (id: string) => document.getElementById(id)!;

  it("closes as the window narrows and comes back as the user left it", () => {
    resize(true);
    expect(useUi.getState()).toMatchObject({ sidebarOverlay: true, sidebarOverlayOpen: false, sidebarVisible: true });
    expect(byId("sidebar").hidden).toBe(true);
    expect(byId("tool").getAttribute("aria-expanded")).toBe("false");
    resize(false);
    expect(useUi.getState().sidebarOverlay).toBe(false);
    expect(byId("sidebar").hidden).toBe(false);

    // Hidden beside the content, it stays hidden after a narrow spell, even
    // when its overlay was open meanwhile.
    useUi.setState({ sidebarVisible: false });
    resize(true);
    toggleSidebar("tool");
    render();
    expect(byId("sidebar").hidden).toBe(false);
    resize(false);
    expect(byId("sidebar").hidden).toBe(true);
    expect(useUi.getState().sidebarVisible).toBe(false);
  });

  // The docked sidebar gives way down to its smallest width (spec/02 §4.23):
  // the room is the body less the content's 480 px and the divider.
  it("tells the divider the room beside the content's 480 px", () => {
    const body = document.querySelector<HTMLElement>(".sb-window__body")!;
    body.insertAdjacentHTML("beforeend", `<div class="sb-window__divider"></div>`);
    const divider = body.querySelector<HTMLElement>(".sb-window__divider")!;
    Object.defineProperty(divider, "offsetWidth", { configurable: true, value: 2 });
    Object.defineProperty(body, "clientWidth", { configurable: true, value: 760 });
    resize(false);
    expect(useUi.getState().sidebarRoom).toBe(278);
    // Room for its largest width: the largest width, so wider windows change nothing.
    Object.defineProperty(body, "clientWidth", { configurable: true, value: 1400 });
    resize(false);
    expect(useUi.getState().sidebarRoom).toBe(360);
  });

  // The number is sebaro's token (D108, NV-Z2): its container query lays the
  // sidebar over the content below it, and the measured width must agree.
  it("takes its breakpoint from sebaro's token", () => {
    expect(overlayBelow()).toBe(722);
    expect(tokensCss).toContain("--sb-x-sebaro-pane-sidebar-overlay-below: 722px;");
    expect(sebaroCss).toContain(
      "@container sb-window (max-width: 721.98px) {\n  .sb-window__body > .sb-window__sidebar {\n    position: absolute;",
    );
  });

  it("starts closed in a window that is narrow from the start", () => {
    unwatch();
    widen(640);
    unwatch = watchSidebarFit();
    render();
    expect(useUi.getState()).toMatchObject({ sidebarOverlay: true, sidebarOverlayOpen: false });
    expect(byId("sidebar").hidden).toBe(true);
  });

  // Seen in WKWebView at 640 pt (rounds 1 and 2 of the pictures): the
  // computed `position` answered with the container query of the width
  // before, so the store held the overlay for docked and ⌃⌘S toggled the
  // choice beside the content. The width is measured, not read from it.
  it("is an overlay by the window's width, whatever the computed style still says", async () => {
    const real = window.getComputedStyle.bind(window);
    // Every pane reads as docked; the root keeps its tokens.
    const spy = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element) =>
        element === document.documentElement ? real(element) : ({ position: "static" } as CSSStyleDeclaration),
      );
    try {
      resize(true);
      expect(useUi.getState()).toMatchObject({ sidebarOverlay: true, sidebarOverlayOpen: false });
      expect(byId("sidebar").hidden).toBe(true);
      resized();
      render();
      expect(byId("sidebar").hidden).toBe(true);
      toggleSidebar("tool");
      render();
      await frame();
      expect(useUi.getState()).toMatchObject({ sidebarOverlayOpen: true, sidebarVisible: true });
      expect(focused()).toBe(byId("row"));
    } finally {
      spy.mockRestore();
    }
  });

  it("follows the window's own resize too", () => {
    widen(640);
    window.dispatchEvent(new Event("resize"));
    render();
    expect(useUi.getState()).toMatchObject({ sidebarOverlay: true, sidebarOverlayOpen: false });
  });

  // Narrowed while not in front, with no observer or resize heard yet: the
  // command measures before it acts, so it opens the overlay and leaves
  // `sidebarVisible` (state.json) as it is.
  it("measures again before the command acts", async () => {
    widen(640);
    byId("content").focus();
    toggleSidebar("tool");
    render();
    await frame();
    expect(useUi.getState()).toMatchObject({ sidebarOverlay: true, sidebarOverlayOpen: true, sidebarVisible: true });
    expect(focused()).toBe(byId("row"));
  });

  it("opens with its tool and moves focus to the tree's tab stop", async () => {
    resize(true);
    byId("tool").focus();
    toggleSidebar("tool");
    render();
    await frame();
    expect(byId("sidebar").hidden).toBe(false);
    expect(byId("tool").getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe(byId("row"));
    expect(byId("sidebar").classList.contains("sb-enter")).toBe(true);
    // The choice beside the content is not touched by the overlay.
    expect(useUi.getState().sidebarVisible).toBe(true);
  });

  // DSK-04, D95 (b): a menu command opens the part without moving focus in.
  it("opens from the native menu without moving focus into it", async () => {
    resize(true);
    byId("content").focus();
    toggleSidebar("menu");
    render();
    await frame();
    expect(byId("sidebar").hidden).toBe(false);
    expect(byId("sidebar").classList.contains("sb-enter")).toBe(true);
    expect(focused()).toBe(byId("content"));
  });

  // ADR-0051 #48 (sebaro NV-Z3): ⌃⌘S is View ▸ Sidebar's accelerator and
  // counts as the menu, also where the webview sees the key; only the tool
  // and the palette move focus in.
  it("opens from ⌃⌘S as from the menu, from the palette with focus inside", async () => {
    resize(true);
    byId("content").focus();
    toggleSidebar();
    render();
    await frame();
    expect(byId("sidebar").hidden).toBe(false);
    expect(focused()).toBe(byId("content"));

    toggleSidebar();
    render();
    expect(byId("sidebar").hidden).toBe(true);
    toggleSidebar("palette");
    render();
    await frame();
    expect(focused()).toBe(byId("row"));
  });

  it("closes with Escape inside it or on its tool, focus back on the tool", async () => {
    resize(true);
    toggleSidebar("tool");
    render();
    await frame();
    byId("row").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    render();
    expect(useUi.getState().sidebarOverlayOpen).toBe(false);
    expect(focused()).toBe(byId("tool"));

    toggleSidebar("tool");
    render();
    byId("tool").focus();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    byId("tool").dispatchEvent(escape);
    expect(useUi.getState().sidebarOverlayOpen).toBe(false);
    // Taken: the settings view's Escape does not also leave the view.
    expect(escape.defaultPrevented).toBe(true);
  });

  it("leaves an Escape elsewhere to others", () => {
    resize(true);
    toggleSidebar("tool");
    render();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    byId("content").dispatchEvent(escape);
    expect(useUi.getState().sidebarOverlayOpen).toBe(true);
    expect(escape.defaultPrevented).toBe(false);
  });

  it("closes with a press outside; focus stays on what was pressed, else the tool", async () => {
    resize(true);
    toggleSidebar("tool");
    render();
    await frame();
    // A press on a control that takes focus keeps it there.
    byId("content").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    byId("content").focus();
    render();
    expect(useUi.getState().sidebarOverlayOpen).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(focused()).toBe(byId("content"));

    // A press on something that takes no focus: the tool, not the page.
    toggleSidebar("tool");
    render();
    await frame();
    expect(focused()).toBe(byId("row"));
    document.querySelector("main")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    render();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(focused()).toBe(byId("tool"));
  });

  it("stays open for a press inside it, on its tool or in a dialog over the window", () => {
    resize(true);
    toggleSidebar("tool");
    render();
    byId("today").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(useUi.getState().sidebarOverlayOpen).toBe(true);
    byId("tool").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(useUi.getState().sidebarOverlayOpen).toBe(true);
    byId("dialog").setAttribute("open", "");
    byId("in-dialog").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(useUi.getState().sidebarOverlayOpen).toBe(true);
  });

  it("closes again with the same command, focus back on the tool from inside", async () => {
    resize(true);
    toggleSidebar("tool");
    render();
    await frame();
    expect(focused()).toBe(byId("row"));
    toggleSidebar("tool");
    render();
    expect(useUi.getState().sidebarOverlayOpen).toBe(false);
    expect(focused()).toBe(byId("tool"));
  });

  it("toggles the choice beside the content in a wide window, without moving focus", async () => {
    byId("content").focus();
    toggleSidebar("tool");
    render();
    await frame();
    expect(useUi.getState()).toMatchObject({ sidebarVisible: false, sidebarOverlayOpen: false });
    expect(focused()).toBe(byId("content"));
  });
});
