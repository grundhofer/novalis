// D144 (3), spec/03 §14: full product-colour screen with the bare white symbol, then fade to the app.
// Markup: .sb-start[data-sb-product] > .sb-start__tile with the product's bare sign inline (sign/sign.svg of the
// product kit's folder; brand/inline/sign-<id>.svg of a --target export). Target markers are legacy no-ops.
// First visit per tab (sessionStorage sb-started); nostore opts out of storage. hold/release waits for app data,
// fail() reveals errors immediately. The animation-end cap is duration + 500 ms. No minimum loading dwell.
// Replay API, sb-start-done and sb-enter cleanup remain compatible. CSP-safe Web Animations API.
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
  function run(scope, overlay, finish) {
    var finished = false, cap = null;
    function once() { if (finished) return; finished = true; clearTimeout(cap); finish(); }
    // D144 (3): the whole product-colour screen fades; no travelling tile or hidden target.
    Array.prototype.forEach.call(scope.querySelectorAll("[data-sb-start-enter]"), enter);
    var fadeMs = ms(token("--sb-x-sebaro-enter-fade-duration", "200ms"));
    var fade = typeof overlay.animate === "function" ? overlay.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: fadeMs, fill: "forwards" }) : null;
    if (fade) { fade.onfinish = once; fade.oncancel = once; cap = setTimeout(once, fadeMs + 500); } else once();
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
    run(document, overlay, function () { root.classList.remove("sb-starting"); end(true); });
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
          scope.classList.remove("sb-starting");
          overlay.getAnimations().forEach(function (a) { a.cancel(); });
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
