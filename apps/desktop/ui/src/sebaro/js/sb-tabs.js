// sb-tabs.js: keyboard for the tabs of spec/02 §4.4 (ARIA tabs pattern, D80 „Skripte für Bedienung“, „Pfeiltasten“).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval.
// Markup carries the state (aria-selected, tabindex 0 on the selected tab and -1 on the others, hidden on the
// other panels); a press on a tab selects it in sb-controls.js (or in the product's framework). This file adds only
// what was missing:
//   - roving tabindex: Tab enters the row on the selected tab, the next Tab leaves the row (to the panel);
//   - ArrowRight / ArrowLeft (ArrowDown / ArrowUp with aria-orientation="vertical") move to the next / previous tab
//     and wrap; Home / End jump to the first / last; right-to-left rows swap the two arrows;
//   - automatic activation: the tab that gets focus is selected at once, by a click on it, so whoever selects on a
//     press (sb-controls.js, a React onClick) does the selecting. Chosen because every sebaro panel is in the page
//     already (no loading behind a tab); a panel that must load first shows its loading state (spec/02 §3.12), it
//     does not switch the row to manual activation.
// Disabled tabs (disabled or aria-disabled="true") are skipped. No motion. The script writes no words (D87).
(function () {
  var TAB = "[role='tab']";
  function tabs(list) {
    return Array.prototype.filter.call(list.querySelectorAll(TAB), function (t) {
      return t.closest("[role='tablist']") === list && !t.disabled && t.getAttribute("aria-disabled") !== "true";
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey || !(event.target instanceof Element)) return;
    var tab = event.target.closest(".sb-tabs " + TAB);
    if (!tab) return;
    var list = tab.closest("[role='tablist']");
    var all = tabs(list), at = all.indexOf(tab);
    if (at < 0) return;
    var vertical = list.getAttribute("aria-orientation") === "vertical";
    var rtl = !vertical && getComputedStyle(list).direction === "rtl";
    var nextKey = vertical ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
    var prevKey = vertical ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
    var to = -1;
    if (event.key === nextKey) to = (at + 1) % all.length;
    else if (event.key === prevKey) to = (at - 1 + all.length) % all.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = all.length - 1;
    if (to < 0) return;
    event.preventDefault();
    var target = all[to];
    all.forEach(function (t) { t.tabIndex = t === target ? 0 : -1; });
    target.focus();
    if (target.getAttribute("aria-selected") !== "true") target.click();   // automatic activation
  });

  // Roving tabindex from the markup's own aria-selected (a row written without tabindex still gets one Tab stop).
  function init() {
    document.querySelectorAll(".sb-tabs[role='tablist']").forEach(function (list) {
      var all = list.querySelectorAll(TAB);
      var chosen = list.querySelector(TAB + "[aria-selected='true']") || all[0];
      Array.prototype.forEach.call(all, function (t) { t.tabIndex = t === chosen ? 0 : -1; });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
