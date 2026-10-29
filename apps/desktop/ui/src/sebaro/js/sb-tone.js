// sb-tone.js: the choice „Farbton: Kühl · Warm“ (D90, D91 C4c, Z3a; spec/09 §6.2, TOKEN-CONTRACT §10.4). On websites it
// sits in the footer under „Darstellung“; apps put it into their settings next to Hell/Dunkel (D75).
// Markup: a group [data-sb-tone-choice] (starts hidden; this script shows it) holding radio inputs name="sb-tone" with
// the values "cool" and "warm". A choice sets or removes html[data-sb-tone="warm"] and stores it as sb-tone (only
// "warm" is stored; "cool" removes the key, like the theme button returns to the system mode). theme-init.js applies
// the stored tone before first paint. A visually hidden role="status" element ([data-sb-tone-status]) announces the
// result. Classic script, no modules (pages open from file://), CSP-safe.
// The menu „Darstellung“ of a window carries the same choice as „Farbton ›“ right after „Hell oder Dunkel ›“ (D102 (8)):
// menuitemradio items with data-sb-tone-item="cool" | "warm"; a click applies the tone like the radios, and every item
// keeps its aria-checked (a click on the chosen one keeps it chosen).
// Messages follow the language of the status element (its closest [lang], else <html lang>): German is the default,
// English is built in; a page adds a language with window.sbMessages = { "sb-tone": { fr: { … } } } before this
// script (D87, spec/09 §6.1).
(function () {
  var MESSAGES = {
    de: { cool: "Farbton Kühl ist an.", warm: "Farbton Warm ist an." },
    en: { cool: "Cool tone is on.", warm: "Warm tone is on." }
  };
  var extra = window.sbMessages && window.sbMessages["sb-tone"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  function messages(el) {
    var holder = el && el.closest("[lang]");
    var lang = ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
    return MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de;
  }

  var root = document.documentElement;
  function current() { return root.dataset.sbTone === "warm" ? "warm" : "cool"; }
  function sync() {
    var tone = current();
    document.querySelectorAll("[data-sb-tone-choice]").forEach(function (group) {
      group.hidden = false;
      group.querySelectorAll('input[name="sb-tone"]').forEach(function (input) { input.checked = input.value === tone; });
    });
    document.querySelectorAll("[data-sb-tone-item]").forEach(function (item) {
      item.setAttribute("aria-checked", String(item.getAttribute("data-sb-tone-item") === tone));
    });
  }
  function apply(tone) {
    if (tone === "warm") root.dataset.sbTone = "warm"; else delete root.dataset.sbTone;
    try { if (tone === "warm") localStorage.setItem("sb-tone", "warm"); else localStorage.removeItem("sb-tone"); } catch (e) {}
    sync();
    var status = document.querySelector("[data-sb-tone-status]");
    if (status) status.textContent = messages(status)[tone];
    document.dispatchEvent(new CustomEvent("sb-tone-change", { detail: { tone: tone } }));
  }
  function init() {
    sync();
    document.addEventListener("change", function (event) {
      var input = event.target;
      if (!input.matches || !input.matches('[data-sb-tone-choice] input[name="sb-tone"]')) return;
      apply(input.value === "warm" ? "warm" : "cool");
    });
    document.addEventListener("click", function (event) {
      var item = event.target instanceof Element ? event.target.closest("[data-sb-tone-item]") : null;
      if (item) apply(item.getAttribute("data-sb-tone-item") === "warm" ? "warm" : "cool");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
