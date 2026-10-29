import { SIDEBAR_WIDTH, useUi } from "../stores/ui";
import type { CommandOrigin } from "./commands";

/**
 * The sidebar in a window too narrow for it (spec/02 §4.17, DSK-04, DSK-07,
 * ADR-0051 #21): React's counterpart of `sb-window.js`'s `relayout` and its
 * overlay keys, under the contract of sebaro's ADOPTION §2.3.
 *
 * The content keeps 480 px (`.sb-window__body`'s grid). Down to 722 px the
 * sidebar gives way to its smallest width (sebaro.css caps it at
 * `100cqi − 482px`; `sidebarRoom` tells the divider, so it names and moves
 * the width that shows and its own is kept); below, sebaro.css's container
 * query lays it over the content's edge (`position: absolute`,
 * `--sb-layer-overlay`). Which of the two it is, is measured: the width of
 * the container `.sb-window` against sebaro's breakpoint token (`overlayBelow`).
 * Becoming an overlay closes it, and it never starts open; the user's
 * choice beside the content (`sidebarVisible`, `state.json`) is kept and
 * comes back when the window is wide enough again.
 *
 * The overlay opens with its tool, ⌃⌘S, View ▸ Sidebar and the palette;
 * focus moves into it from the tool and the palette only: a menu command
 * moves no focus (DSK-04, D95 (b)), and ⌃⌘S, the menu item's accelerator,
 * counts as the menu (ADR-0051 #48, sebaro NV-Z3); it closes with Escape inside it or on its tool (focus
 * back to the tool), with a press outside it (focus stays on what was
 * pressed when that takes it, else the tool), and with the same commands.
 * Like sebaro's, the overlay has no scrim: the content beside it stays as it
 * is (spec/02 §4.17).
 */

const SIDEBAR = "sidebar";

function pane(): HTMLElement | null {
  return document.getElementById(SIDEBAR);
}

/** The title bar's tool: what the menu item is not, it says `aria-expanded`. */
function tool(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-sb-window-toggle][aria-controls='${SIDEBAR}'][aria-expanded]`);
}

function isTool(target: Node): boolean {
  return !!tool()?.contains(target);
}

/**
 * Above the window and opened from it, so a press there is no press outside:
 * a dialog the tree's commands ask (Umbenennen …), the palette, a menu, a
 * tooltip. A popover that is not open cannot be pressed.
 */
const ABOVE = "dialog[open], [popover]";

function focusTool(): void {
  tool()?.focus({ preventScroll: true });
}

/** What the content keeps (spec/02 §4.17, D81). */
const CONTENT_MIN = 480;

/**
 * The widest the docked sidebar may be now: the body less the content's
 * 480 px and the divider, as sebaro.css's cap and `sb-window.js`'s `roomFor`
 * reckon it; up to the largest width, so it changes only in windows that
 * are too narrow for that. `null` before the body is measured.
 */
function room(): number | null {
  const body = document.querySelector<HTMLElement>(".sb-window__body");
  if (!body || body.clientWidth === 0) return null;
  const divider = body.querySelector<HTMLElement>(":scope > .sb-window__divider");
  return Math.min(SIDEBAR_WIDTH.max, body.clientWidth - CONTENT_MIN - (divider?.offsetWidth ?? 0));
}

/**
 * sebaro's breakpoint: below it, sebaro.css's container query lays the
 * sidebar over the content (`@container sb-window (max-width: 721.98px)`,
 * „722 = 240 + 2 + 480“). @container cannot read var(), so sebaro.css
 * writes the number; a counterpart reads the token
 * `x-sebaro.pane.sidebar-overlay-below` (ADOPTION §2.3, sebaro D108,
 * NV-Z2), and windowFit.test.ts holds the two to each other. `NaN` where
 * the tokens are not loaded.
 */
export function overlayBelow(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(OVERLAY_TOKEN));
}

const OVERLAY_TOKEN = "--sb-x-sebaro-pane-sidebar-overlay-below";

/**
 * Whether sebaro.css lays the sidebar over the content now: the container's
 * width below `overlayBelow()`; `null` before the window is laid out or
 * while the token cannot be read. Measured,
 * not read from the computed `position`: in WKWebView at 640 pt that read
 * answered with the container query of the width before (in round 1 for the
 * closed overlay, in round 2 for the sidebar shown), and the store held the
 * overlay for docked (docs/sebaro-luecken.md Z „Überlagerung, Zustand
 * lesen“). `getBoundingClientRect` lays out first, so the width is the one
 * the container query is about to see. `.sb-window` has no padding or
 * border, so its box is the container's content box.
 */
function isOverlay(): boolean | null {
  const frame = document.querySelector<HTMLElement>(".sb-window");
  const width = frame?.getBoundingClientRect().width ?? 0;
  const below = overlayBelow();
  return width === 0 || !Number.isFinite(below) ? null : width < below;
}

/** Where focus enters the open overlay, the first that is there (sb-window.js `focusInto`). */
const INTO = [
  "[role='treeitem'][tabindex='0']",
  "[aria-current]:not([aria-current='false'])",
  "button:not([disabled])",
  "[tabindex='0']",
];

/**
 * The overlay has just opened: it enters as an action does (`.sb-enter`,
 * spec/03 §0.4), and, with `focus`, focus moves into it, on the tree's row
 * with the tab stop, else on its first control. Once React has shown it: a
 * hidden element takes no focus.
 */
function enter(focus: boolean): void {
  requestAnimationFrame(() => {
    const element = pane();
    if (!element || element.hidden) return;
    // The class is the pane's own until its animation ends; React never
    // changes the sidebar's class name, so it is not lost meanwhile.
    element.classList.remove("sb-enter");
    void element.offsetWidth;
    element.classList.add("sb-enter");
    element.addEventListener("animationend", () => element.classList.remove("sb-enter"), { once: true });
    if (!focus) return;
    const first = INTO.map((selector) => element.querySelector<HTMLElement>(selector)).find(Boolean);
    first?.focus({ preventScroll: true });
  });
}

/**
 * `sidebar.toggle`: the tool, ⌃⌘S, View ▸ Sidebar and the palette. Beside
 * the content it shows or hides the sidebar, as the user's choice; over the
 * content it opens the overlay or closes it, focus back on the tool when it
 * was inside. Focus moves into the opened overlay only from the tool and
 * the palette (`from` "tool" / "palette"); from the native menu and from
 * ⌃⌘S, its accelerator, it stays where it was, as the menu has no
 * in-window „Menü“ to go back to (DSK-04, D95 (b), ADR-0051 #48).
 */
export function toggleSidebar(from?: CommandOrigin): void {
  const overlay = isOverlay();
  if (overlay !== null) useUi.getState().setSidebarOverlay(overlay);
  const before = useUi.getState();
  const had = before.sidebarOverlay && !!pane()?.contains(document.activeElement);
  before.toggleSidebar();
  const after = useUi.getState();
  if (!after.sidebarOverlay) return;
  if (after.sidebarOverlayOpen) enter(from === "tool" || from === "palette");
  else if (had) focusTool();
}

/**
 * Follow the window's width and close the overlay by key and press. Installed
 * once the window is drawn; returns the function that removes it.
 */
export function watchSidebarFit(): () => void {
  const check = () => {
    if (!pane()) return;
    const overlay = isOverlay();
    if (overlay !== null) useUi.getState().setSidebarOverlay(overlay);
    useUi.getState().setSidebarRoom(room());
  };
  const open = () => {
    const ui = useUi.getState();
    return ui.sidebarOverlay && ui.sidebarOverlayOpen ? pane() : null;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const element = open();
    const target = event.target;
    if (!element || !(target instanceof Node)) return;
    if (!element.contains(target) && !isTool(target)) return;
    // Before the settings view's Escape, which would leave the view.
    event.preventDefault();
    useUi.getState().setSidebarOverlayOpen(false);
    focusTool();
  };

  const onPointerDown = (event: PointerEvent) => {
    const element = open();
    const target = event.target;
    if (!element || !(target instanceof Node)) return;
    if (element.contains(target) || isTool(target)) return;
    if (target instanceof Element && target.closest(ABOVE)) return;
    const had = element.contains(document.activeElement);
    useUi.getState().setSidebarOverlayOpen(false);
    // Like a menu (spec/02 §4.17, OR-12): focus stays on what was pressed
    // when that takes it; else it goes back to the tool instead of falling
    // to the page. The press moves focus after this event.
    if (had) {
      setTimeout(() => {
        const now = document.activeElement;
        if (!now || now === document.body || element.contains(now)) focusTool();
      }, 0);
    }
  };

  // The observer follows the container; the window's own `resize` and the
  // media query of the same width (`.sb-window` is the whole window) check
  // too, should one of them be late or missed while the window is not in
  // front; `toggleSidebar` checks once more before it acts.
  const below = overlayBelow();
  const narrow =
    typeof window.matchMedia === "function" && Number.isFinite(below)
      ? window.matchMedia(`(width < ${below}px)`)
      : null;

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", check);
  narrow?.addEventListener("change", check);
  check();
  const frame = document.querySelector(".sb-window");
  const observer = frame && typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
  if (frame) observer?.observe(frame);
  return () => {
    observer?.disconnect();
    narrow?.removeEventListener("change", check);
    window.removeEventListener("resize", check);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", onPointerDown);
  };
}
