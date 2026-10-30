import { useUi } from "../stores/ui";

/**
 * The settings view's way in and out (DSK-02, spec/02 §4.24, ADR-0051 #1):
 * ⌘,, the app menu's „Einstellungen …“, the palette and the sidebar's place
 * „Einstellungen“ open it in the content area; Escape, ⌘W and „Zurück zu
 * <Ort>“ in the title bar leave it for the place before, and the focus goes
 * back to where it was when the view opened (ZUG-06). Showing something
 * else — a tab made current, the board — leaves it too, without that return:
 * the new content takes the focus (stores/tabs.ts, stores/ui.ts).
 */

/** What had the focus when the view opened. */
let opener: HTMLElement | null = null;

export function openSettingsView(): void {
  const ui = useUi.getState();
  if (!ui.settingsView) {
    const active = document.activeElement;
    opener = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  ui.setSettingsView(true);
}

/**
 * Back to the place before, the focus with it. It lands once React has shown
 * that place again (a hidden element takes no focus): on the element that had
 * it, else on the content area.
 */
export function leaveSettingsView(): void {
  if (!useUi.getState().settingsView) return;
  const back = opener;
  opener = null;
  useUi.getState().setSettingsView(false);
  requestAnimationFrame(() => {
    if (back?.isConnected && !back.closest("[hidden]")) back.focus({ preventScroll: true });
    if (back && document.activeElement === back) return;
    const content = document.querySelector<HTMLElement>("main.main:not([hidden])");
    if (!content) return;
    // The area takes the focus itself, as F6 gives it (lib/areas.ts).
    if (!content.hasAttribute("tabindex")) content.setAttribute("tabindex", "-1");
    content.focus({ preventScroll: true });
  });
}
