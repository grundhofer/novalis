// theme-button.js: the labelled button „Hell oder Dunkel“ (D36; behaviour spec/03 §6.2, code spec/09 §6).
// Toggles to the other mode of what is shown. Storing the system's own mode would mean "follow the system", so the
// choice is removed instead: two presses always return to the system mode. The label never changes; a visually
// hidden role="status" element ([data-sb-theme-status]) announces the result after a press. Classic script, no
// modules (pages open from file://), CSP-safe.
// Messages follow the language of the status element (its closest [lang], else <html lang>): German is the default,
// English is built in; a page adds a language with window.sbMessages = { "theme-button": { fr: { … } } } before this
// script (D87, spec/09 §6.1).
(function () {
  var MESSAGES = {
    de: { light: "Hell ist an.", dark: "Dunkel ist an." },
    en: { light: "Light is on.", dark: "Dark is on." }
  };
  var extra = window.sbMessages && window.sbMessages["theme-button"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  function messages(el) {
    var holder = el && el.closest("[lang]");
    var lang = ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
    return MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de;
  }

  var root = document.documentElement;
  var system = window.matchMedia("(prefers-color-scheme: dark)");
  function shown() { return root.dataset.theme || (system.matches ? "dark" : "light"); }
  document.addEventListener("click", function (event) {
    var button = event.target.closest(".sb-theme-button");
    if (!button) return;
    var next = shown() === "dark" ? "light" : "dark";
    try {
      if (next === (system.matches ? "dark" : "light")) { delete root.dataset.theme; localStorage.removeItem("sb-theme"); }
      else { root.dataset.theme = next; localStorage.setItem("sb-theme", next); }
    } catch (e) { root.dataset.theme = next; }
    var status = document.querySelector("[data-sb-theme-status]");
    if (status) status.textContent = messages(status)[next];
    document.dispatchEvent(new CustomEvent("sb-theme-change", { detail: { theme: next } }));
  });
})();
