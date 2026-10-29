// sb-colour-count.js: the colour count per view (spec/03 §1.4), a port of sketch A's live check
// (concepts/runde-2/colour-is-function/skizze.js checkFrame). A review aid for demos and app stand-ins, and since
// 2026-10-22 the gate group `colour` of tools/check_demo.py (COL1-COL3), which calls sbColourCount on every view.
// Every view root carries data-sb-view="<name>" (and data-sb-primary-expected="0" where the view has no primary
// action). The line is written into the element [data-sb-colour-count="<name>"], e.g.
// „Farbprüfung: Hauptaktion 1 · Ort 4 · Status 3 · App-Zeichen 1 · Farben ohne Rolle 0 · Text auf Farbfläche 0 · bestanden“.
// Sign tiles (.sb-sign-tile) count as „App-Zeichen“, not as colours. Colours with a local job count only inside their
// part (LOCAL below; anywhere else they are colours without a role): the diff fills success-subtle / danger-subtle on a
// signed diff line (D85, spec/02 §3.19), the category tones in .sb-category (D91 C1b), the mark in mark / .sb-mark
// (C2a), the categorical, sequential and diverging chart colours in charts and scale cells (spec/01 §8, D91 G6a) and
// the code colours in code (D67). The line names only the core jobs.
// Known gaps (as in the sketch): pseudo-element paints (checkbox marks, chip frames, slider handles) and focus outlines
// are not read.
function sbColourCount(view) {
  var ROLES = {
    neutral: ["bg", "surface", "surface-raised", "surface-sunken", "text", "text-muted", "text-subtle", "border",
      "border-strong", "scrim", "on-accent", "on-primary-action", "hover-fill", "pressed-fill"],
    place: ["accent", "link", "link-visited", "focus", "selection"],
    primary: ["primary-action", "primary-action-hover", "primary-action-pressed", "primary-action-outline"],
    status: ["success", "warning", "danger", "info"],
    unused: ["accent-hover", "accent-pressed", "accent-subtle", "text-on-accent-subtle", "on-success", "on-warning",
      "on-danger", "on-info", "warning-subtle", "info-subtle",
      "text-on-success-subtle", "text-on-warning-subtle", "text-on-danger-subtle", "text-on-info-subtle"]
  };
  function series(prefix, n) { var a = []; for (var i = 1; i <= n; i++) a.push(prefix + i); return a; }
  var LOCAL = [                                              // [custom properties, the part they belong to]
    [["--sb-color-success-subtle", "--sb-color-danger-subtle"], ".sb-diff__line--add, .sb-diff__line--del"],
    [series("--sb-category-", 8), ".sb-category"],
    [["--sb-mark", "--sb-mark-edge"], "mark, .sb-mark"],
    [series("--sb-dataviz-categorical-", 8).concat(series("--sb-dataviz-sequential-", 11),
      series("--sb-dataviz-diverging-", 11)), ".sb-chart, .sb-scale-cell"],
    [["--sb-syntax-keyword", "--sb-syntax-string", "--sb-syntax-constant", "--sb-syntax-comment",
      "--sb-syntax-number", "--sb-syntax-function"], "pre, code, .sb-code, .sb-diff"]
  ];
  var map = {}, local = {}, probe = document.createElement("span");
  view.appendChild(probe);                                   // resolves every role in the view's own mode
  Object.keys(ROLES).forEach(function (group) {
    ROLES[group].forEach(function (role) {
      probe.style.color = "var(--sb-color-" + role + ")";
      var c = getComputedStyle(probe).color;
      if (!(c in map)) map[c] = group;                       // equal values: the first group wins (neutral first)
    });
  });
  var defined = getComputedStyle(view);
  LOCAL.forEach(function (job) {
    job[0].forEach(function (prop) {
      if (!defined.getPropertyValue(prop).trim()) return;    // a role this palette does not have
      probe.style.color = "var(" + prop + ")";
      var c = getComputedStyle(probe).color;
      if (!(c in map)) (local[c] = local[c] || []).push(job[1]);
    });
  });
  view.removeChild(probe);
  function clear(c) { return !c || c === "none" || c === "transparent" || /, 0\)$/.test(c); }
  function ownText(e) {
    return Array.prototype.some.call(e.childNodes, function (t) { return t.nodeType === 3 && /\S/.test(t.nodeValue); });
  }
  var SHAPES = /^(path|circle|rect|polygon|polyline|ellipse|line)$/i;
  var n = { primary: 0, place: 0, status: 0, signs: view.querySelectorAll(".sb-sign-tile").length, unknown: {}, textOnColour: 0 };
  view.querySelectorAll("*").forEach(function (e) {
    if (e.closest(".sb-sign-tile") || !e.getClientRects().length) return;
    var cs = getComputedStyle(e);
    if (cs.visibility === "hidden") return;
    var paints = [];
    if (!clear(cs.backgroundColor)) paints.push(["fill", cs.backgroundColor]);
    ["Top", "Right", "Bottom", "Left"].forEach(function (side) {
      if (parseFloat(cs["border" + side + "Width"]) > 0 && cs["border" + side + "Style"] !== "none") paints.push(["line", cs["border" + side + "Color"]]);
    });
    if (ownText(e)) paints.push(["text", cs.color]);
    if (SHAPES.test(e.tagName)) {
      if (!clear(cs.fill)) paints.push(["shape", cs.fill]);
      if (!clear(cs.stroke) && parseFloat(cs.strokeWidth) > 0) paints.push(["shape", cs.stroke]);
    }
    if (/^use$/i.test(e.tagName)) paints.push(["shape", cs.color]);   // sprite icons paint in currentColor inside <use>
    paints.forEach(function (p) {
      if (clear(p[1])) return;
      var group = map[p[1]];
      if (!group && local[p[1]] && local[p[1]].some(function (sel) { return e.closest(sel); })) return;
      if (!group || group === "unused") { n.unknown[p[1]] = 1; return; }
      if (group === "primary" && p[0] === "fill") n.primary++;
      else if (group === "place") n.place++;
      else if (group === "status") n.status++;
    });
    if (ownText(e)) {                                         // the nearest painted ground behind this text
      var a = e;
      while (a && a !== view.parentElement && clear(getComputedStyle(a).backgroundColor)) a = a.parentElement;
      var bgc = a && a !== view.parentElement ? getComputedStyle(a).backgroundColor : null;
      var g = bgc ? map[bgc] : "neutral";
      var own = !g && local[bgc] && local[bgc].some(function (sel) { return a.closest(sel); });   // a signed diff line, a mark
      if (g !== "neutral" && g !== "primary" && !own) n.textOnColour++;
    }
  });
  var expected = view.hasAttribute("data-sb-primary-expected") ? +view.getAttribute("data-sb-primary-expected") : 1;
  var unknown = Object.keys(n.unknown);
  n.pass = n.primary === expected && unknown.length === 0 && n.textOnColour === 0;
  n.line = "Farbprüfung: Hauptaktion " + n.primary + " · Ort " + n.place + " · Status " + n.status + " · App-Zeichen " +
    n.signs + " · Farben ohne Rolle " + unknown.length + " · Text auf Farbfläche " + n.textOnColour + " · " +
    (n.pass ? "bestanden" : "nicht bestanden");
  n.unknown = unknown;
  return n;
}

(function () {
  function run() {
    document.querySelectorAll("[data-sb-view]").forEach(function (view) {
      var out = document.querySelector('[data-sb-colour-count="' + view.getAttribute("data-sb-view") + '"]');
      if (out) out.textContent = sbColourCount(view).line;
    });
  }
  // After a mode change the colour transitions (--sb-motion-duration-short) are still running: count once they end,
  // otherwise a half-way colour reads as a colour without a role.
  function runSettled() {
    requestAnimationFrame(function () {
      var running = document.getAnimations ? document.getAnimations().map(function (a) { return a.finished.catch(function () {}); }) : [];
      Promise.race([Promise.all(running), new Promise(function (r) { setTimeout(r, 1000); })]).then(run);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
  document.addEventListener("sb-theme-change", runSettled);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", runSettled);
})();
