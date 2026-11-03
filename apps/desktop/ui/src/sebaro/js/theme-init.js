// theme-init.js: apply a stored "Hell oder Dunkel" choice before first paint (spec/09 §2, TOKEN-CONTRACT §9).
// Load it in <head> before the stylesheets, as a classic script: a file keeps pages working under a CSP without
// 'unsafe-inline'. Nothing stored = the page follows prefers-color-scheme.
// It also applies the app setting „Bewegung immer reduzieren“ (D46, spec/03 §13): sb-motion = "reduce" sets
// html[data-sb-motion="reduce"], which sebaro.css and sb-start.js treat like prefers-reduced-motion: reduce.
// And the colour tone „Farbton: Kühl · Warm“ (D90, D91 C4c; TOKEN-CONTRACT §10.4): sb-tone = "warm" sets
// html[data-sb-tone="warm"] (sb-tone.js stores it); nothing stored = the cool standard palette.
try { var t = localStorage.getItem("sb-theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
try { if (localStorage.getItem("sb-motion") === "reduce") document.documentElement.dataset.sbMotion = "reduce"; } catch (e) {}
try { if (localStorage.getItem("sb-tone") === "warm") document.documentElement.dataset.sbTone = "warm"; } catch (e) {}
// And the language of a page without a language URL (D102 (50); spec/09 §18.2): only on <html
// data-sb-language="stored">, sb-lang (a language code such as "de" or "en", stored by the choice in sb-controls.js)
// becomes <html lang>. A page with a URL per language never has the attribute, so its lang stays the server's.
try {
  if (document.documentElement.getAttribute("data-sb-language") === "stored") {
    var l = localStorage.getItem("sb-lang");
    if (l && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l)) document.documentElement.lang = l;
  }
} catch (e) {}
// The browser and title-bar colour (BRAND-ASSETS 1.7, 1.9): the head snippet of brand_assets.py names the two grounds
// as <meta name="theme-color" media="(prefers-color-scheme: …)">; with a stored choice the chosen one applies to both
// schemes, and every "sb-theme-change" (theme-button.js, sb-window.js) moves them along. Each tag's
// data-sb-tone-<tone> (1.9, e.g. data-sb-tone-warm) is its ground in that tone: while html[data-sb-tone] names the
// tone it becomes the tag's content, else the snippet's own content comes back. A change of data-theme or
// data-sb-tone by any script (sb-tone.js, a framework) moves them too. Pages without the tags: no-op; without
// JavaScript the media queries of the snippet still apply.
(function () {
  var root = document.documentElement;
  function sync() {
    var t = root.dataset.theme, tone = root.dataset.sbTone;
    Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"][media]'), function (m) {
      var own = m.getAttribute("data-sb-media") || m.getAttribute("media");
      m.setAttribute("data-sb-media", own);
      m.setAttribute("media", !t ? own : ((t === "dark") === /dark/.test(own) ? "all" : "not all"));
      if (!m.hasAttribute("data-sb-content")) m.setAttribute("data-sb-content", m.getAttribute("content") || "");
      var toned = tone && /^[a-z][a-z0-9-]*$/.test(tone) ? m.getAttribute("data-sb-tone-" + tone) : null;
      m.setAttribute("content", toned || m.getAttribute("data-sb-content"));
    });
  }
  sync();
  document.addEventListener("DOMContentLoaded", sync);
  document.addEventListener("sb-theme-change", sync);
  document.addEventListener("sb-tone-change", sync);
  if (window.MutationObserver) new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-sb-tone"] });
})();
