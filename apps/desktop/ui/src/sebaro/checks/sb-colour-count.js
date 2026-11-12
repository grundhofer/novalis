// D145 / DEMO-CHECK 1.14: semantic view checks, separate from paint counts.
function sbViewTypeCount(view) {
  var key = view.getAttribute('data-sb-view-type');
  var keys = 'entry overview list detail form flow tool result read history search settings about state-empty state-loading state-error state-permission outside account import help'.split(' ');
  var colour = ['entry', 'overview', 'detail', 'result', 'state-empty'];
  var none = ['detail', 'read', 'history', 'search', 'settings', 'about'];
  function visible(e) { return e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; }
  function owned(selector) { return (view.matches(selector) ? [view] : []).concat(Array.from(view.querySelectorAll(selector))).filter(function (e) { return e.closest('[data-sb-view]') === view && visible(e); }); }
  var errors = [];
  if (key !== null && visible(view)) {
    if (keys.indexOf(key) < 0) errors.push('unknown');
    if (colour.indexOf(key) < 0 && owned('.sb-product-area').length) errors.push('product-area');
    if (none.indexOf(key) >= 0 && owned('.sb-primary-action').length) errors.push('primary');
    // A list requires a semantic ul/ol.sb-list or .sb-listbox with role=listbox.
    // Cards, app tiles or collection grids in that view fail even beside a valid list.
    if (key === 'list' && (!owned('ul.sb-list, ol.sb-list, .sb-listbox[role="listbox"]').length ||
        owned('.sb-card, .sb-app-grid, .sb-app-tile, [data-sb-collection="grid"]').length)) errors.push('list');
  }
  var framePrimary = view.matches('.sb-app-frame') ? Array.from(view.querySelectorAll('.sb-primary-action')).filter(visible).length : null;
  return { viewType: key, viewTypeErrors: errors, framePrimary: framePrimary };
}

// D143 (7), D144 (6): task boundaries, not arbitrary layout wrappers (spec/02 §1.0).
function sbControlLevels(view) {
  var boundary = '[data-sb-action-area], [data-sb-view], [data-sb-web-app-head], header, section, .sb-site-header, .sb-section, .sb-card, .sb-list-row, .sb-top-bar, .sb-toolbar, .sb-dialog__actions, .sb-window__part, .sb-window__head, .sb-window__bar, .sb-board__column, .sb-find-bar';
  var counts = new Map(), themeButtons = 0, areas = Array.from(view.querySelectorAll(boundary));
  function visible(e) { return e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'; }
  view.querySelectorAll('.sb-secondary-action, .sb-theme-button, [data-sb-theme-button]').forEach(function (e) {
    if (e.closest('[data-sb-view]') !== view || !visible(e)) return;
    if (e.matches('.sb-theme-button, [data-sb-theme-button]') && e.closest('[data-sb-web-app-head]')) themeButtons++;
    if (!e.matches('.sb-secondary-action, .sb-theme-button, [data-sb-theme-button]')) return;
    var area = e.parentElement.closest(boundary) || view;
    var count = counts.get(area) || { area: area.getAttribute('data-sb-action-area') || area.id || area.getAttribute('data-sb-view') || (area.className || area.tagName) + ' [' + areas.indexOf(area) + ']', outlined: 0, cancels: 0 };
    // Only one explicitly marked cancel in dialog actions is exempt. Never infer a role from translated words.
    if (e.hasAttribute('data-sb-dialog-cancel') && area.matches('.sb-dialog__actions') && !count.cancels) count.cancels++;
    else count.outlined++;
    counts.set(area, count);
  });
  return { outlinedAreas: Array.from(counts.values()), headerThemeButtons: themeButtons };
}

// sb-colour-count.js: the colour count per view (spec/03 §1.4), a port of sketch A's live check
// (concepts/runde-2/colour-is-function/skizze.js checkFrame). A review aid for demos and app stand-ins, and since
// 2026-10-22 the gate group `colour` of tools/check_demo.py (COL1-COL6), which calls sbColourCount on every view.
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
  // Product area paints have a local job only inside their own component (D143/D144).
  ["studio", "collaboration", "everyday", "learning", "tools", "media", "money", "system"].forEach(function (id) {
    ["", "-glyph"].forEach(function (suffix) {
      probe.style.color = "var(--sb-tile-" + id + suffix + ")";
      var c = getComputedStyle(probe).color;
      (local[c] = local[c] || []).push(".sb-product-area");
    });
  });
  view.removeChild(probe);
  function clear(c) { return !c || c === "none" || c === "transparent" || /, 0\)$/.test(c); }
  function ownText(e) {
    return Array.prototype.some.call(e.childNodes, function (t) { return t.nodeType === 3 && /\S/.test(t.nodeValue); });
  }
  var SHAPES = /^(path|circle|rect|polygon|polyline|ellipse|line)$/i;
  var areas = Array.from(view.querySelectorAll(".sb-product-area")).filter(function (e) {
    return e.closest("[data-sb-view]") === view && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden";
  });
  if (view.matches(".sb-product-area")) areas.unshift(view);
  var areaErrors = [];
  var forced = typeof window !== "undefined" && window.matchMedia("(forced-colors: active)").matches;
  if (areas.length > 1) areaErrors.push("more than one product area");
  var products = new Set();
  function luminance(c) {
    var v = c.match(/[\d.]+/g).slice(0, 3).map(function (n) {
      n = +n / 255; return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    });
    return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
  }
  areas.forEach(function (area) {
    var style = getComputedStyle(area), product = area.getAttribute("data-sb-product");
    products.add(product);
    if (!product || !style.getPropertyValue("--sb-product-tile").trim()) areaErrors.push("unknown product");
    var test = document.createElement("span");
    area.appendChild(test);
    test.style.color = "var(--sb-product-tile)";
    var expectedTile = getComputedStyle(test).color;
    test.style.color = "var(--sb-product-glyph)";
    var expectedGlyph = getComputedStyle(test).color;
    area.removeChild(test);
    if (!forced && style.backgroundColor !== expectedTile) areaErrors.push("wrong product ground");
    if (area.matches(".sb-product-area--picture") && !area.querySelector(".sb-product-area__picture")) areaErrors.push("missing framed picture");
    var controls = 'a, button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="slider"], [role="radio"], [tabindex], [contenteditable]:not([contenteditable="false"]), .sb-primary-action';
    if (area.matches(controls) || area.querySelector(controls) || area.closest("a, button, [role=button], [role=link]")) areaErrors.push("control in product area");
    [area].concat(Array.from(area.querySelectorAll("*"))).forEach(function (e) {
      if (area.matches(".sb-product-area--picture")) {
        if (ownText(e) && !e.closest(".sb-product-area__picture")) areaErrors.push("text on picture ground");
        if (e.closest(".sb-product-area__picture")) return;
      }
      if (!ownText(e) || !e.getClientRects().length) return;
      var cs = getComputedStyle(e);
      if (cs.visibility === "hidden") return;
      if (!forced && cs.color !== expectedGlyph) areaErrors.push("wrong product glyph colour");
      var a = luminance(cs.color), b = luminance(style.backgroundColor);
      var ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      var large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.6667 && parseFloat(cs.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) areaErrors.push("text too small for product contrast");
    });
  });
  if (products.size > 1) areaErrors.push("second product colour");
  var levels = sbControlLevels(view), types = sbViewTypeCount(view);
  var n = { viewType: types.viewType, viewTypeErrors: types.viewTypeErrors, framePrimary: types.framePrimary, outlinedAreas: levels.outlinedAreas, headerThemeButtons: levels.headerThemeButtons, productAreas: areas.length, areaErrors: areaErrors, primary: 0, place: 0, status: 0, signs: view.querySelectorAll(".sb-sign-tile").length, unknown: {}, textOnColour: 0 };
  view.querySelectorAll("*").forEach(function (e) {
    if (e.closest(".sb-sign-tile, .sb-keymark") || e.closest("[data-sb-view]") !== view || !e.getClientRects().length) return;
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
      if (e.closest(".sb-product-area") && local[p[1]] && local[p[1]].includes(".sb-product-area")) return;
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
      if (g !== "neutral" && g !== "primary" && !own && !e.closest(".sb-product-area")) n.textOnColour++;
    }
  });
  var expected = view.hasAttribute("data-sb-primary-expected") ? +view.getAttribute("data-sb-primary-expected") : 1;
  if (!view.getClientRects().length) expected = 0;
  var frame = view.closest('.sb-app-frame');
  if (frame && view.matches('.sb-app-frame__pane--start')) {
    var end = frame.querySelector('.sb-app-frame__pane--end');
    if (end && Array.from(end.querySelectorAll('.sb-primary-action')).some(function (e) { return e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'; })) expected = 0;
  }
  n.expected = expected;
  var unknown = Object.keys(n.unknown);
  n.pass = types.viewTypeErrors.length === 0 && (types.framePrimary === null || types.framePrimary <= 1) && n.primary === expected && unknown.length === 0 && n.textOnColour === 0 && areaErrors.length === 0 && !levels.headerThemeButtons && !levels.outlinedAreas.some(function (a) { return a.outlined > 1; });
  n.line = "Farbprüfung: Hauptaktion " + n.primary + " · Ort " + n.place + " · Status " + n.status + " · App-Zeichen " +
    n.signs + " · Produktflächen " + areas.length + " · Flächenfehler " + areaErrors.length + " · Farben ohne Rolle " + unknown.length + " · Text auf Farbfläche " + n.textOnColour + " · " +
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
