import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { report, useUi } from "../stores/ui";
import { withFileNames } from "./FileName";

/** The one lifetime of every toast (spec/02 §4.8, D78). */
export const TOAST_MS = 6000;

/** The toast's clock: what is left of its 6 s, and what holds it. */
interface Clock {
  timer: number;
  left: number;
  since: number;
  pointer: boolean;
  focus: boolean;
}

function run(clock: Clock): void {
  window.clearTimeout(clock.timer);
  if (clock.pointer || clock.focus) return;
  clock.since = Date.now();
  clock.timer = window.setTimeout(() => useUi.getState().clearToast(), clock.left);
}

function hold(clock: Clock, kind: "pointer" | "focus", on: boolean): void {
  if (!useUi.getState().toast) return;
  if (on && !clock.pointer && !clock.focus) {
    window.clearTimeout(clock.timer);
    clock.left = Math.max(0, clock.left - (Date.now() - clock.since));
  }
  clock[kind] = on;
  if (!on) run(clock);
}

/**
 * Where focus goes when its origin is gone or hidden: the main content of
 * the area the toast stands in, never the page's body (spec/02 §4.8,
 * `sbToast.hide()`, sebaro D108 NV-X1).
 */
const FOCUS_FALLBACK = [".sb-doc-tabs__panel:not([hidden])", ".sb-window__content", ".sb-view__content", "main"];

/**
 * Hide the toast; focus inside `box` goes back to `from`, where it came
 * from, and where that no longer takes it, to the area's main content.
 */
function close(box: HTMLElement | null, from: Element | null): void {
  if (box?.contains(document.activeElement)) {
    if (from instanceof HTMLElement && from !== document.body && from.isConnected && !from.closest("[hidden], [inert]")) {
      from.focus({ preventScroll: true });
    }
    // A style that hides the origin (display: none) lets `focus()` do nothing.
    if (box.contains(document.activeElement)) {
      const area = box.closest(".sb-window, .sb-view") ?? document;
      const main = FOCUS_FALLBACK.map((selector) => area.querySelector<HTMLElement>(selector)).find(Boolean);
      if (main) {
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus({ preventScroll: true });
      }
    }
  }
  useUi.getState().clearToast();
}

/**
 * An Escape that belongs to an open modal dialog (a sheet, the palette, a
 * confirmation) or an open popover (a menu, the contents, a tooltip) leaves
 * the toast standing (spec/02 §4.8, ADR-0051 #56, as sb-controls.js does).
 */
function escapeTaken(): boolean {
  try {
    return !!document.querySelector("dialog:modal, :popover-open");
  } catch {
    // An engine without the selectors.
    return !!document.querySelector("dialog[open]");
  }
}

/**
 * sebaro's toast (`sb-toast`, spec/02 §4.8, EBE-05, D78; ADR-0051 #14), at
 * the top of the action zone (`App` puts it first in `.sb-bottom-block`,
 * spec/02 §4.17): one sentence for a reversible result only — „Karte
 * hinzugefügt“, a move the hidden tree cannot show — and „In die
 * Zwischenablage kopiert: …“ (spec/07 §4.3 case 4, D102 (18)). A failed command says why in the zone's
 * `__message` instead (`StatusBar`). Only the move carries an action,
 * „Rückgängig“ (`sb-toast__action`, D102 (16), ADR-0051 #39); pressing it
 * closes the toast and runs it, a failure going to the zone. „Schließen“ is
 * no toast action.
 *
 * It stays in the DOM, `hidden` until shown, as its own live region; the
 * sentence is written into it a frame after it is unhidden, since a region
 * that enters the accessibility tree already filled may go unread. A path
 * in it breaks after `- . _ /` (D100 (6)). 6 s, the timer stopped while the
 * pointer is over it or focus is inside it and run on with the time left —
 * a toast that replaces a shown one keeps that hold; Escape closes it,
 * unless a dialog, the palette or a menu that is open takes it (ADR-0051
 * #56). Focus that was inside when it closes goes back to where it was when
 * the toast was shown, else to the area's main content, as `sbToast.hide()`
 * does. It
 * enters from below (`.sb-enter`, spec/02 §0.4), set the way sebaro's
 * `sbToast.show()` sets it, so a new toast enters again.
 */
export default function Toast() {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const box = useRef<HTMLDivElement>(null);
  const clock = useRef<Clock>({ timer: 0, left: TOAST_MS, since: 0, pointer: false, focus: false });
  /** Where focus was when the toast was shown: it goes back there (`close`). */
  const from = useRef<Element | null>(null);
  // What the live region says: the toast once its box is shown.
  const [said, setSaid] = useState<ReturnType<typeof useUi.getState>["toast"]>(null);

  useLayoutEffect(() => {
    const element = box.current;
    if (!toast || !element) return;
    // A toast that replaces a shown one, with focus on its action, keeps
    // the place focus came from.
    if (!element.contains(document.activeElement)) from.current = document.activeElement;
    element.classList.remove("sb-enter");
    void element.offsetWidth;
    element.classList.add("sb-enter");
  }, [toast]);

  useLayoutEffect(() => {
    if (!toast) return undefined;
    // Shown empty for a frame, then the sentence (`said` still holds the
    // last toast, so the new one starts empty): a change inside a region
    // already in the tree is what a screen reader announces.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setSaid(toast));
    });
    return () => cancelAnimationFrame(id);
  }, [toast]);

  useEffect(() => {
    const state = clock.current;
    if (!toast) {
      // A hidden toast gets no `pointerleave`: its hold ends here. A toast
      // that replaces a shown one gets no `pointerenter` either, so it
      // keeps the hold the pointer or focus has on the box.
      state.pointer = false;
      state.focus = false;
      return undefined;
    }
    state.left = TOAST_MS;
    run(state);
    // Escape closes it from anywhere, from inside it too (its action).
    // Heard in the capture phase, before an overlay that stops the key's
    // propagation; the key is not taken, so the editor still gets its own
    // Escape. One that an open dialog, the palette or a menu owns is theirs:
    // the toast and its „Rückgängig“ stay.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      const inside = event.target instanceof Node && !!box.current?.contains(event.target);
      if (!inside && escapeTaken()) return;
      close(box.current, from.current);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(state.timer);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [toast]);

  const action = toast?.action;
  return (
    <div
      ref={box}
      className="sb-toast"
      role="status"
      hidden={!toast}
      onPointerEnter={() => hold(clock.current, "pointer", true)}
      onPointerLeave={() => hold(clock.current, "pointer", false)}
      onFocus={() => hold(clock.current, "focus", true)}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
          hold(clock.current, "focus", false);
        }
      }}
    >
      {toast && <p>{said === toast && withFileNames((key, values) => t(key, values), said.key, said.values)}</p>}
      {action && (
        <button
          type="button"
          className="sb-toast__action"
          onClick={() => {
            close(box.current, from.current);
            action.run().catch(report);
          }}
        >
          {t(action.labelKey)}
        </button>
      )}
    </div>
  );
}
