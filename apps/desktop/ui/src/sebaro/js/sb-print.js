// sb-print.js: what a printed page needs besides its print CSS (D91 W8a; spec/09 §18.3). Classic script, CSP-safe,
// writes no words. Before printing it opens every closed <details> outside navigation (frequent questions; a closed
// table of contents row is navigation and stays off paper); after printing it closes them again. The colours need no
// script: tokens.css carries a generated @media print block with the light values (TOKEN-CONTRACT 1.9 §9.1), the
// illustration pair of spec/06 §8 has its print rule, and sb-media.js shows the light poster while printing. Until
// 2026-10-25 this script also set html[data-theme="light"] before printing; checked on the demo pages in dark and with
// a stored dark choice, that half did nothing the CSS does not, and it went (OR-11, CHECKS.md §29.5). The print rules
// of css/sebaro.css hide navigation and action zones.
(function () {
  var opened = null;
  window.addEventListener("beforeprint", function () {
    if (opened) return;
    opened = [];
    document.querySelectorAll("details:not([open])").forEach(function (d) {
      if (d.closest("nav")) return;
      d.open = true;
      opened.push(d);
    });
  });
  window.addEventListener("afterprint", function () {
    if (!opened) return;
    opened.forEach(function (d) { d.open = false; });
    opened = null;
  });
})();
