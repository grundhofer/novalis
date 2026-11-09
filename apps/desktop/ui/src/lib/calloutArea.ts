import { type RefObject, useEffect } from "react";

/** The fade over the last px, and the mark's least length (sb-controls.js). */
const MORE_FADE = 36;
const MORE_LEAST = 12;
const MORE_PROPS = ["--sb-more-top", "--sb-more-length", "--sb-more-fade-from", "--sb-more-fade-rest"];

/** What the fade starts below, sb-controls.js's FOCUSABLE. */
const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), " +
  "textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

/**
 * D134's sign on a callout area that holds more than it shows (spec/02
 * §3.11, D142), as `sb-controls.js` measures it: `data-sb-more` and the
 * `--sb-more-*` the area's mark and fade read, and a tab stop while it
 * scrolls, so its words can be read by keys. A tabindex the page set itself
 * is left alone.
 */
export function measureArea(area: HTMLElement): void {
  const view = area.clientHeight;
  const max = area.scrollHeight - view;
  const mine = area.getAttribute("data-sb-scroll-stop") === "";
  if (max <= 1 || !view) {
    area.removeAttribute("data-sb-more");
    for (const prop of MORE_PROPS) area.style.removeProperty(prop);
    if (mine) {
      area.removeAttribute("tabindex");
      area.removeAttribute("data-sb-scroll-stop");
    }
    return;
  }
  if (!area.hasAttribute("tabindex")) {
    area.tabIndex = 0;
    area.setAttribute("data-sb-scroll-stop", "");
  }
  const top = Math.min(max, Math.max(0, area.scrollTop));
  const length = Math.min(view, Math.max((view * view) / (view + max), MORE_LEAST));
  let from = view - MORE_FADE;
  const edge = area.getBoundingClientRect().top + area.clientTop;
  for (const control of area.querySelectorAll(FOCUSABLE)) {
    const box = control.getBoundingClientRect();
    if (box.height && box.top - edge < view && box.bottom - edge > from) from = box.bottom - edge;
  }
  area.style.setProperty("--sb-more-top", `${((view - length) * top) / max}px`);
  area.style.setProperty("--sb-more-length", `${length}px`);
  area.style.setProperty("--sb-more-fade-from", `${Math.min(from, view)}px`);
  area.style.setProperty("--sb-more-fade-rest", from >= view ? "1" : String(1 - Math.min(1, (max - top) / MORE_FADE)));
  area.setAttribute("data-sb-more", "");
}

/**
 * The React counterpart of `sb-controls.js` for one `div.sb-callout-area`
 * (ADR-0051 #21: novalis loads only the delegated tooltip and menu scripts).
 * The area is measured again on every scroll and on every size change of it
 * or of a notice in it („Ausblenden“), and for notices added later.
 */
export function useCalloutArea(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const area = ref.current;
    if (!area) return undefined;
    const measure = () => measureArea(area);
    area.addEventListener("scroll", measure, { passive: true });
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    sizes?.observe(area);
    for (const child of area.children) sizes?.observe(child);
    const notices =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) sizes?.observe(node);
            measure();
          });
    notices?.observe(area, { childList: true });
    measure();
    return () => {
      area.removeEventListener("scroll", measure);
      sizes?.disconnect();
      notices?.disconnect();
    };
  }, [ref]);
}
