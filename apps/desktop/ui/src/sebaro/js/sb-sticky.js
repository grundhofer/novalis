// sb-sticky.js: the „stands“ state of the sticky group head of spec/02 §3.17 (D91 B3b), for browsers without the
// container query scroll-state(stuck: top).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval.
// sebaro.css draws the 2 px ink line under .sb-list-header--sticky only while it stands at the top of its scroll box:
// by @container scroll-state(stuck: top) where the browser has it, else by data-sb-state="stuck", which this script
// sets. Where the browser has the container query, the script does nothing. Without either, the head still stands,
// only without the line (progressive enhancement).
// How: an empty, hidden-from-screen-readers marker <div> is put right before each head and watched with one
// IntersectionObserver per head (root = the nearest scroll box, else the viewport; the root's top edge moved down by
// the head's own top offset). The head stands while its marker has left the root above.
// Writes no words (D87). No motion: the line appears and disappears in place.
(function () {
  if (window.CSS && CSS.supports && CSS.supports("container-type: scroll-state")) return;
  if (!("IntersectionObserver" in window)) return;

  function scrollBox(el) {
    for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      var o = getComputedStyle(p).overflowY;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "overlay") return p;
    }
    return null;
  }
  function watch(head) {
    if (head.previousElementSibling && head.previousElementSibling.hasAttribute("data-sb-sticky-marker")) return;
    var marker = document.createElement("div");
    marker.setAttribute("data-sb-sticky-marker", "");
    marker.setAttribute("aria-hidden", "true");
    head.parentNode.insertBefore(marker, head);
    var top = parseFloat(getComputedStyle(head).top) || 0;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var rootTop = entry.rootBounds ? entry.rootBounds.top : 0;
        var stuck = !entry.isIntersecting && entry.boundingClientRect.top < rootTop + 1;
        if (stuck) head.setAttribute("data-sb-state", "stuck");
        else if (head.getAttribute("data-sb-state") === "stuck") head.removeAttribute("data-sb-state");
      });
    }, { root: scrollBox(head), rootMargin: (-top) + "px 0px 0px 0px", threshold: [0] });
    observer.observe(marker);
  }
  function init() { document.querySelectorAll(".sb-list-header--sticky").forEach(watch); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.sbSticky = { watch: watch };
})();
