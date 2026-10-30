// sb-start.js: the same start on every platform (D49, D52; spec/03 §14). The app sign tile stands in the middle of
// the ground while the page really loads, then moves to its place in the header ([data-sb-start-target]) while the
// content enters from below (D46 rule E). Only on the first call of a tab session, only on pages that opt in with
// <html data-sb-start>. Reduced motion (system, html[data-sb-motion="reduce"], or data-sb-motion="reduce" on a container
// around a replay frame, D80) = the tile fades out over x-sebaro-enter-fade-duration (200 ms under both settings,
// D102 (52)), nothing moves. "First call of a tab session" = the first page of this site that a browser tab opens
// (sessionStorage "sb-started"); later pages and reloads in that tab show no start (D85).
// <html data-sb-start="nostore"> (D102 (51), spec/03 §14.1): the product's choice to store nothing; the start then shows on
// every page load (an app with one shell: once per load of the app), and the script reads and writes no storage.
// Load it in <head> as a classic script right after theme-init.js, so the start screen is there at first paint.
// Markup: <div class="sb-start" aria-hidden="true"><span class="sb-start__tile">(inline tile svg)</span></div> as the
// first child of <body>; the header tile carries data-sb-start-target; elements to enter carry data-sb-start-enter.
// An app that loads its own data calls sbStart.hold() before and sbStart.release() after; the start waits for both
// the load event and every release. sbStart.play(scope) replays the start inside one element (component sheet).
// When loading fails (spec/03 §14.1): sbStart.fail() ends the start at once, whatever holds are left and before load; the tile
// fades out where it stands, so the app's failure sentence in its window is not covered. An uncaught error (an
// "error" event that carries an error object) or an unhandled promise rejection while the tile stands does the same
// (provisional, agent).
// The end (spec/03 §14.1): when the start is over (also at once when this page shows none) sbStart.done is true and
// "sb-start-done" is fired on document with detail { started, reduced, failed }; a framework that renders the entering
// content itself listens for it (or reads sbStart.done first) instead of keeping the class in its own state.
// .sb-enter (spec/03 §14.1): the class this script puts on [data-sb-start-enter] is removed again after its animation ends
// (animationend or animationcancel of that element, or at once when no animation runs), so a long-lived app body keeps
// no finished animation (stacking context, containing block of fixed descendants). React and other frameworks that
// rewrite className keep data-sb-start-enter on an element whose className they never change (shared/ADOPTION.md §2.3).
// An upper bound (spec/03 §14.1): the end of a run comes when its animation finishes, or at the latest 500 ms after the
// animation's duration (an animation that is cancelled, paused or never painted must not leave the tile standing;
// provisional, agent: the 500 ms).
// CSP-safe: no inline handlers, styles only through the CSSOM and the Web Animations API.
(function () {
  var root = document.documentElement;
  var holds = 0, loaded = false, done = false, failed = false, ended = false;

  function reduced(scope) {
    var el = scope && scope !== document && scope.closest ? scope : root;
    return !!el.closest('[data-sb-motion="reduce"]') || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function token(name, fallback) {
    var v = getComputedStyle(root).getPropertyValue(name).trim();
    return v || fallback;
  }
  function ms(v) { var n = parseFloat(v); return /ms$/.test(v) ? n : n * 1000; }

  // spec/03 §14.1: take .sb-enter off again once its animation is over
  function enter(el) {
    el.classList.remove("sb-enter"); void el.offsetWidth; el.classList.add("sb-enter");
    function off(event) {
      if (event && (event.target !== el || !/^sb-(enter|fade-in)$/.test(event.animationName))) return;
      el.removeEventListener("animationend", off); el.removeEventListener("animationcancel", off);
      el.classList.remove("sb-enter");
    }
    el.addEventListener("animationend", off); el.addEventListener("animationcancel", off);
    var running = typeof el.getAnimations === "function" ? el.getAnimations().length : 1;
    if (!running) off();
  }

  // one run of the start inside scope (the document or one frame); finish() runs once at the end: when the animation
  // finishes, or at the latest 500 ms after its duration (spec/03 §14.1)
  function run(scope, overlay, finish, fadeOnly) {
    var finished = false, cap = null;
    function once() { if (finished) return; finished = true; clearTimeout(cap); finish(); }
    var tile = overlay.querySelector(".sb-start__tile");
    var target = scope.querySelector("[data-sb-start-target]");
    var duration = ms(token("--sb-motion-duration-long", "200ms"));
    var easing = token("--sb-motion-easing-emphasized", "ease-out");
    Array.prototype.forEach.call(scope.querySelectorAll("[data-sb-start-enter]"), enter);
    if (fadeOnly || !tile || !target || reduced(scope) || typeof tile.animate !== "function") {
      // the fade keeps its 200 ms under both settings (D102 (52)): tokens.css collapses motion.duration.long there
      var fadeMs = ms(token("--sb-x-sebaro-enter-fade-duration", "200ms"));
      var fade = typeof overlay.animate === "function" ? overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeMs, fill: "forwards" }) : null;
      if (fade) { fade.onfinish = once; cap = setTimeout(once, fadeMs + 500); } else once();
      return;
    }
    var from = tile.getBoundingClientRect(), to = target.getBoundingClientRect();
    var dx = to.left + to.width / 2 - (from.left + from.width / 2);
    var dy = to.top + to.height / 2 - (from.top + from.height / 2);
    var scale = to.width / from.width;
    target.style.visibility = "hidden";
    overlay.classList.add("is-moving");                       // ground turns transparent: the content shows under the tile
    var move = tile.animate([{ transform: "none" }, { transform: "translate(" + dx + "px, " + dy + "px) scale(" + scale + ")" }],
      { duration: duration, easing: easing, fill: "forwards" });
    var land = function () { target.style.visibility = ""; once(); };
    move.onfinish = land;
    cap = setTimeout(land, duration + 500);
  }

  // spec/03 §14.1: the start is over (or this page shows none)
  function end(started) {
    if (ended) return;
    ended = true;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onError);
    document.dispatchEvent(new CustomEvent("sb-start-done", { detail: { started: started, reduced: reduced(document), failed: failed } }));
  }

  function start() {
    if (done || !(failed || (loaded && holds === 0))) return;
    done = true;
    var overlay = document.querySelector("body > .sb-start");
    if (!overlay) { root.classList.remove("sb-starting"); end(false); return; }
    run(document, overlay, function () { root.classList.remove("sb-starting"); overlay.classList.remove("is-moving"); end(true); }, failed);
  }
  // an ErrorEvent without an error object is no failure of the app (WA-R2): Chromium's "ResizeObserver loop completed
  // with undelivered notifications" and a cross-origin "Script error." leave the start alone
  function onError(event) {
    if (done || (event && event.type === "error" && event.error == null)) return;
    window.sbStart.fail();
  }

  window.sbStart = {
    get done() { return ended; },
    hold: function () { holds++; },
    release: function () { holds = Math.max(0, holds - 1); start(); },
    // spec/03 §14.1: loading failed; end the start now, the tile fades where it stands
    fail: function () { if (done || !root.classList.contains("sb-starting")) return; failed = true; start(); },
    // replay inside one element that holds its own .sb-start (demo frames); loadMs stands in for the real loading
    // time (default 700 ms) during which the tile stays in the middle
    play: function (scope, loadMs) {
      var overlay = scope && scope.querySelector(".sb-start");
      if (!overlay || scope.classList.contains("sb-starting")) return;
      scope.classList.add("sb-starting");
      setTimeout(function () {
        run(scope, overlay, function () {
          scope.classList.remove("sb-starting"); overlay.classList.remove("is-moving");
          overlay.getAnimations().concat(overlay.querySelector(".sb-start__tile").getAnimations()).forEach(function (a) { a.cancel(); });
        });
      }, loadMs === undefined ? 700 : loadMs);
    }
  };

  // [data-sb-start-replay="<id>"] replays the start inside that element (component sheet)
  document.addEventListener("click", function (event) {
    var button = event.target instanceof Element ? event.target.closest("[data-sb-start-replay]") : null;
    if (button) window.sbStart.play(document.getElementById(button.getAttribute("data-sb-start-replay")));
  });

  // no start on this page: sb-start-done once the document is parsed, so a listener added by the page's own scripts hears it
  function none() {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { end(false); });
    else end(false);
  }
  if (!root.hasAttribute("data-sb-start")) { none(); return; }
  if (root.getAttribute("data-sb-start") !== "nostore") {
    try {
      if (sessionStorage.getItem("sb-started")) { none(); return; }
      sessionStorage.setItem("sb-started", "1");
    } catch (e) { none(); return; }                           // no storage: no start rather than a start on every page
  }
  root.classList.add("sb-starting");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onError);
  window.addEventListener("load", function () { loaded = true; start(); });
})();
