// sb-tooltip.js: the tooltip of spec/02 §4.9 (D80 „Skripte für Bedienung“; WCAG 1.4.13 content on hover or focus).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval, position only through the CSSOM.
// Markup carries the state:
//   <button class="sb-icon-button" type="button" aria-label="Kalender" aria-describedby="t1">…</button>
//   <span class="sb-tooltip" role="tooltip" id="t1" popover="manual">Kalender öffnen</span>
// The tooltip is a description, never the name: the trigger keeps its own name (aria-label or its text), and the
// tooltip only adds to it (aria-describedby; screen readers read it without this script, also while it is hidden).
// A trigger whose only name would be the tooltip is a mistake; the script warns in the console and shows nothing.
// What the script adds:
//   - shows the tooltip 400 ms after the pointer (mouse or pen, not touch) rests on the trigger, or after keyboard
//     focus (:focus-visible) reaches it; a touch press never shows it (D36: never the only place of information);
//   - places it under the trigger, centred, 8 px away so the 2 + 2 px focus ring stays clear (above when there is no
//     room below), inside the window;
//   - keeps it while the pointer moves from the trigger onto the tooltip (hoverable);
//   - hides it when the pointer leaves both, on blur, on a press of the trigger and on Escape; Escape hides only the
//     tooltip (a dialog or sheet around it stays open) and focus stays where it is.
// Motion: none. A tooltip appears and disappears in place; it is not new content entering (spec/02 §0.4).
// The delay is the constant DELAY_MS (no token yet). The script writes no words (D87).
(function () {
  if (typeof HTMLElement.prototype.showPopover !== "function") return;   // aria-describedby still describes the trigger
  var DELAY_MS = 400, GRACE_MS = 100;
  var timer = 0, graceTimer = 0, shown = null, shownFor = null;

  function tipOf(trigger) {
    var ids = (trigger.getAttribute("aria-describedby") || "").split(/\s+/);
    for (var i = 0; i < ids.length; i++) {
      var el = ids[i] && document.getElementById(ids[i]);
      if (el && el.classList.contains("sb-tooltip") && el.hasAttribute("popover")) return el;
    }
    return null;
  }
  function triggerOf(target) {
    var el = target instanceof Element ? target.closest("[aria-describedby]") : null;
    return el && tipOf(el) ? el : null;
  }
  function named(trigger) {
    if ((trigger.getAttribute("aria-label") || "").trim() || trigger.hasAttribute("aria-labelledby")) return true;
    if (trigger.labels && trigger.labels.length) return true;
    return (trigger.textContent || "").trim() !== "";
  }

  function place(tip, trigger) {
    var b = trigger.getBoundingClientRect(), t = tip.getBoundingClientRect();
    var gap = 8, edge = 8, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var top = b.bottom + gap;
    if (top + t.height > vh - edge && b.top - gap - t.height >= edge) top = b.top - gap - t.height;
    var left = b.left + b.width / 2 - t.width / 2;
    left = Math.min(Math.max(edge, left), Math.max(edge, vw - t.width - edge));
    tip.style.top = Math.round(top) + "px";
    tip.style.left = Math.round(left) + "px";
  }
  function show(trigger) {
    var tip = tipOf(trigger);
    if (!tip) return;
    if (!named(trigger)) {
      if (window.console) console.warn("sb-tooltip: the trigger needs its own name; a tooltip only describes it", trigger);
      return;
    }
    if (shown && shown !== tip) hide();
    if (!tip.matches(":popover-open")) tip.showPopover();
    place(tip, trigger);
    shown = tip; shownFor = trigger;
  }
  function hide() {
    clearTimeout(timer); clearTimeout(graceTimer);
    if (shown && shown.matches(":popover-open")) shown.hidePopover();
    shown = null; shownFor = null;
  }
  function later(trigger) {
    clearTimeout(timer); clearTimeout(graceTimer);
    if (shownFor === trigger) return;
    timer = setTimeout(function () { show(trigger); }, DELAY_MS);
  }
  function leaveSoon() {
    clearTimeout(timer); clearTimeout(graceTimer);
    graceTimer = setTimeout(hide, GRACE_MS);
  }

  document.addEventListener("pointerover", function (event) {
    if (event.pointerType === "touch") return;
    var trigger = triggerOf(event.target);
    if (trigger) { later(trigger); return; }
    if (shown && event.target instanceof Node && shown.contains(event.target)) clearTimeout(graceTimer);   // onto the tooltip
  });
  document.addEventListener("pointerout", function (event) {
    if (event.pointerType === "touch") return;
    var from = event.target instanceof Element ? (triggerOf(event.target) || (shown && shown.contains(event.target) ? shown : null)) : null;
    if (!from) return;
    var to = event.relatedTarget;
    if (to instanceof Node && (from.contains(to) || (shown && shown.contains(to)) || (shownFor && shownFor.contains(to)))) return;
    if (document.activeElement === shownFor && shownFor && shownFor.matches(":focus-visible")) { clearTimeout(timer); return; }
    leaveSoon();
  });
  document.addEventListener("pointerdown", function (event) {
    if (triggerOf(event.target) || (shown && event.target instanceof Node && !shown.contains(event.target))) hide();
  }, true);
  document.addEventListener("focusin", function (event) {
    var trigger = triggerOf(event.target);
    if (trigger && trigger.matches(":focus-visible")) later(trigger);
  });
  document.addEventListener("focusout", function (event) {
    if (triggerOf(event.target)) hide();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !shown) return;
    event.preventDefault();                       // hide only the tooltip; a dialog around it stays open
    event.stopPropagation();
    hide();
  }, true);
  window.addEventListener("scroll", function () { if (shown && shownFor) place(shown, shownFor); }, { passive: true, capture: true });
  window.addEventListener("resize", function () { if (shown && shownFor) place(shown, shownFor); });
})();
