import { useUi } from "../stores/ui";

/**
 * F6 / ⇧F6 through the window's areas (sebaro spec/02 §4.20, DSK-09,
 * ADR-0051): the title bar, the sidebar (its overlay while it is open over a
 * narrow window), the content (the editor, a preview, a viewer, the board or
 * the settings view), the backlinks and the action zone, in this order and
 * round. novalis has no inspector; the backlinks under the editor stand
 * where it would (ADR-0051 #8), a named region inside the content that is an
 * area of its own. A hidden area — the sidebar while it is closed, the
 * content the settings view covers — stays in the page with `hidden` and is
 * skipped.
 *
 * Each area gives back the element that had focus in it last; else its first
 * control (the editor's text counts as one), in the title bar its sidebar
 * tool; an area with nothing to press takes focus itself.
 *
 * The 2 px ring inside the edge of an area that takes focus itself is
 * sebaro.css's for the title bar (`sb-window__titlebar`), the sidebar
 * (`sb-window__sidebar`), the content (`sb-window__content`) and the action
 * zone (`.sb-window > .sb-bottom-block`); the backlinks have it from
 * styles/backlinks.css.
 */
const AREAS = [
  "header.sb-window__titlebar",
  "nav.sb-window__sidebar",
  "main.main",
  "section.backlinks",
  ".sb-window > .sb-bottom-block",
];

// A roving widget's other members (`tabindex="-1"`, the document tabs that
// are not current) are no tab stop: entering the content lands on the
// current tab, the list's one stop (spec/02 §4.21).
const TABBABLE = [
  "a[href]:not([tabindex='-1'])",
  "button:not([disabled]):not([tabindex='-1'])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** The last focused element of each area; gone with the element. */
const lastFocus = new WeakMap<Element, HTMLElement>();
/** The area focus was in last, for a move that starts outside every area. */
let lastArea: Element | null = null;

/** Areas are skipped while they or an ancestor carry `hidden`. */
const shown = (element: Element) => element.isConnected && !element.closest("[hidden]");

function areas(): Element[] {
  return AREAS.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(shown);
}

/**
 * The area an element lies in, the innermost: the backlinks, not the content
 * around them. The palette and a dialog lie in none, the toast in the action
 * zone (spec/02 §4.17).
 */
export function areaOf(element: Element | null): Element | null {
  return element?.closest(AREAS.join(", ")) ?? null;
}

/**
 * The area focus is in, else the one it was in last: from the palette or a
 * native menu, the area the command was given from.
 */
export function currentArea(): Element | null {
  return areaOf(document.activeElement) ?? (lastArea && shown(lastArea) ? lastArea : null);
}

/**
 * Remember where focus is, per area. Installed once by the app; returns the
 * function that removes it.
 */
export function trackAreaFocus(): () => void {
  const onFocusIn = (event: FocusEvent) => {
    const element = event.target;
    if (!(element instanceof HTMLElement)) return;
    const area = areaOf(element);
    if (!area) return;
    lastArea = area;
    if (element !== area) lastFocus.set(area, element);
  };
  document.addEventListener("focusin", onFocusIn);
  return () => document.removeEventListener("focusin", onFocusIn);
}

/**
 * Focus the next area (or the previous one with `back`). Not while the
 * palette, an overlay or a dialog has the keyboard: their own keys lead back
 * out. From the palette's command list the palette is already closed when
 * this runs, so the move starts at the area focus was in before it opened.
 */
export function moveArea(back: boolean): void {
  const ui = useUi.getState();
  if (ui.overlay.kind !== "none" || ui.prompt) return;
  const list = areas();
  if (list.length === 0) return;
  const current = currentArea();
  const at = current ? list.indexOf(current) : -1;
  const next =
    list[at < 0 ? (back ? list.length - 1 : 0) : (at + (back ? -1 : 1) + list.length) % list.length]!;
  // An area's own elements: not those of an area inside it (the backlinks).
  const own = (element: HTMLElement) => areaOf(element) === next && shown(element);
  const remembered = lastFocus.get(next);
  let target: HTMLElement | null =
    remembered && own(remembered) && remembered.matches(`${TABBABLE}, [tabindex='-1']`)
      ? remembered
      : ([...next.querySelectorAll<HTMLElement>(TABBABLE)].find(own) ?? null);
  if (!target && next instanceof HTMLElement) {
    // Nothing to press: the area itself takes focus, as sebaro's script does.
    if (!next.hasAttribute("tabindex")) next.setAttribute("tabindex", "-1");
    target = next;
  }
  target?.focus();
}

/**
 * Whether focus is in a tab list: content that takes focus when it opens (the
 * editor, the PDF pane) leaves it there when a tab was chosen with the keys,
 * so the next arrow chooses the next tab (spec/02 §4.21).
 */
export function focusInTabList(): boolean {
  return !!document.activeElement?.closest('[role="tablist"]');
}

/**
 * Run `take`, a request for focus, now; while the dialog is open, once it has
 * closed (spec/02 §4.6, ZUG-06). A modal dialog makes the rest of the page
 * inert, and WebKit drops focus asked for there meanwhile: the editor of a
 * note „Anlegen“ has just opened, the tree row of a renamed file. The
 * dialog's `close` event comes after it has given focus back to its opener,
 * so what the action opened wins, as it did before the dialog was modal.
 * Another question asked meanwhile defers it again.
 */
export function afterDialog(take: () => void): void {
  const dialog = document.querySelector<HTMLDialogElement>("dialog.sb-dialog[open]");
  if (dialog) dialog.addEventListener("close", () => afterDialog(take), { once: true });
  else take();
}
