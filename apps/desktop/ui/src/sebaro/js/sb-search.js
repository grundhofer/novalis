// sb-search.js: the search field of spec/02 §2.2 (D80 „Suche leeren“).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval.
// Markup carries the state: the clear button is in the markup and hidden while the field is empty:
//   <div class="sb-field__control sb-search"><svg class="sb-icon" …><use href="#search"/></svg>
//     <input id="q" type="search" placeholder="Gewohnheit suchen …">
//     <button class="sb-icon-button" type="button" aria-label="Suche leeren" hidden>…close icon…</button></div>
// What the script adds:
//   - the button „Suche leeren“ shows while the field has text and hides when it is empty;
//   - pressing it empties the field, fires "input" on it (so filters update) and puts focus back into the field;
//   - Escape in a filled field empties it the same way (and does not close a dialog or sheet around it); Escape in an
//     empty field does what it does anyway;
//   - a search field written without the button gets one, labelled in the language of the field (D87).
// No motion: the button appears and disappears in place.
// Messages follow the language of the element (closest [lang], else <html lang>): German default, English built in;
// window.sbMessages = { "sb-search": { fr: { clear: "…" } } } before this script adds one (spec/09 §6.1).
(function () {
  var MESSAGES = {
    de: { clear: "Suche leeren" },
    en: { clear: "Clear search" }
  };
  var extra = window.sbMessages && window.sbMessages["sb-search"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  function t(el, key) {
    var holder = el && el.closest("[lang]");
    var lang = ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
    var table = MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de;
    return table[key] != null ? table[key] : MESSAGES.de[key];
  }

  function parts(el) {
    var control = el instanceof Element ? el.closest(".sb-search") : null;
    if (!control) return null;
    var input = control.querySelector("input[type='search']");
    var clear = control.querySelector(":scope > .sb-icon-button");
    return input ? { control: control, input: input, clear: clear } : null;
  }
  function sync(p) { if (p.clear) p.clear.hidden = p.input.value === ""; }
  function empty(p) {
    p.input.value = "";
    p.input.dispatchEvent(new Event("input", { bubbles: true }));
    p.input.focus();
    sync(p);
  }
  function addButton(control, input) {
    var NS = "http://www.w3.org/2000/svg";
    var button = document.createElement("button");
    button.className = "sb-icon-button";
    button.type = "button";
    button.setAttribute("aria-label", t(input, "clear"));
    var svg = document.createElementNS(NS, "svg"), use = document.createElementNS(NS, "use");
    svg.setAttribute("class", "sb-icon"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    use.setAttribute("href", "#close");
    svg.appendChild(use); button.appendChild(svg);
    control.appendChild(button);
    return button;
  }

  document.addEventListener("input", function (event) {
    var p = parts(event.target);
    if (p && event.target === p.input) sync(p);
  });
  document.addEventListener("click", function (event) {
    var p = parts(event.target);
    if (p && p.clear && p.clear.contains(event.target)) empty(p);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    var p = parts(event.target);
    if (!p || event.target !== p.input || p.input.value === "") return;
    event.preventDefault();                       // empty the field only; a dialog or sheet around it stays open
    event.stopPropagation();
    empty(p);
  });

  function init() {
    document.querySelectorAll(".sb-search").forEach(function (control) {
      var input = control.querySelector("input[type='search']");
      if (!input) return;
      var p = parts(input);
      if (!p.clear) p.clear = addButton(control, input);
      sync(p);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
