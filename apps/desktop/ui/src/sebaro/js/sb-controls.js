// sb-controls.js: behaviour of the interactive sebaro component classes in pages without a framework (spec/02).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval, styles only through the CSSOM.
// Every part works on markup that already carries its ARIA state, so a page without this script still shows the
// right state; the script only makes it change.
//   .sb-claim-row__toggle   aria-expanded + hidden on the controlled note (claim rows, D40)
//   .sb-switch              aria-checked; with data-sb-motion-setting it is „Bewegung immer reduzieren“ (D46): it
//                           sets html[data-sb-motion="reduce"] and stores sb-motion (read again by theme-init.js);
//                           a menuitemcheckbox with data-sb-motion-setting (window menu „Darstellung“, F4b) is the
//                           same setting, and every control of it keeps the same aria-checked
//   [data-sb-language-choice] the language of a page without a language URL (D102 (50); spec/09 §18.2): a
//                           group of radios (one per language, value = the language code) that looks like „DE / EN“;
//                           a choice sets <html lang> without a reload, stores sb-lang (theme-init.js applies it before
//                           first paint on <html data-sb-language="stored">), keeps every such group in step and fires
//                           "sb-language-change" on document (detail { lang }), on which the app swaps its words.
//                           Each group needs a radio name of its own; a group whose name another radio shares is
//                           renamed, with a console warning. Inside [data-sb-language-root] (a specimen) it sets that
//                           element's lang instead and stores nothing (provisional, agent)
//   [data-sb-demo-progress] specimen of D48: the primary action shows its own progress („ok“ or „fail“ run)
//   .sb-chip[aria-pressed]  aria-pressed; one chosen chip per [data-sb-single] group (filter "Alle")
//   [data-sb-opens="id"]    opens <dialog id> as a modal; the dialog's form method="dialog" closes it; a press on the
//                           scrim of a dialog.sb-dialog cancels it like Escape ("cancel", then close), unless the
//                           press began inside it or a field of it has changed since it opened (spec/02 §4.6; provisional,
//                           agent)
//   .sb-range__track        keeps the accent fill between the handles (--sb-range-from / --sb-range-to, 0..1)
//   [data-sb-indeterminate] sets checkbox.indeterminate (no HTML attribute exists for it)
//   .sb-tabs [role="tab"]   aria-selected + hidden on the tab panels (not for aria-disabled="true")
//   .sb-code__copy          copies the code of its block; the label says „Kopiert“ for 2 s
//   .sb-toc[data-sb-follow] the current entry (aria-current="location") follows the reading position
//   .sb-toc--overlay        the contents as an overlay over a reader (D102 (34)): nav.sb-toc.sb-toc--overlay[popover]
//                           opened by its popovertarget button: aria-expanded follows it, it stands under the button
//                           (above it without room), focus goes to the current entry, ArrowDown / ArrowUp / Home / End
//                           move between the entries, Tab out of it closes it; choosing an entry makes it the current
//                           one (aria-current="location") and closes the overlay, then the link jumps and focus moves to
//                           the target (tabindex="-1" where it is not focusable); with data-sb-follow the current entry, on opening, is the last
//                           heading above the reader's top + 96 px
//   jump targets            D102 (32): a jump target in .sb-prose keeps its place line (:target in sebaro.css) until the
//                           next action: the next key (not a lone modifier) or press marks it data-sb-past; a new jump,
//                           or a press on the link to the same place, shows the line again
//   .sb-callout__hide       „Ausblenden“ (D102 (39)): fires "sb-callout-hide" (cancelable) on the callout, then hides it;
//                           focus goes to the next control after it (else the one before)
//   .sb-toast               sbToast.show(toast) / sbToast.hide(toast) and [data-sb-toast-show="id"]: the toast enters
//                           (.sb-enter), stays 6 s, pauses while the pointer is over it or focus is inside (only a toast
//                           with an action can hold focus), Escape closes it from anywhere on the page, without taking
//                           the key from what has focus, unless a modal dialog, an open popover (menu, contents) or
//                           the palette has it (spec/02 §4.8); show() unhides the toast empty and writes its sentence two
//                           frames later, so a screen reader hears a live region that was already there (spec/02 §4.8);
//                           .sb-toast__action fires "sb-toast-action" on the toast, then it closes (D78)
// Keyboard and pointer of menus, tabs, tooltips, sheets and search fields are sb-menu.js, sb-tabs.js, sb-tooltip.js,
// sb-sheet.js and sb-search.js; windows are sb-tree.js and sb-window.js (spec/02 §7, D80).
// State attributes (D85): ARIA where ARIA has the state (aria-busy, aria-current="step"), data-sb-state for the rest
// ("done", "retry"). Messages follow the language of the element (closest [lang], else <html lang>): German default,
// English built in; window.sbMessages = { "sb-controls": { fr: { … } } } before this script adds one (D87, spec/09 §6.1).
(function () {
  function closestIn(event, selector) { return event.target instanceof Element ? event.target.closest(selector) : null; }

  var MESSAGES = {
    de: { copied: "Kopiert", busy: "Läuft …", done: "Fertig", retry: "Noch mal versuchen", failed: "Das hat nicht geklappt." },
    en: { copied: "Copied", busy: "Working …", done: "Done", retry: "Try again", failed: "That did not work." }
  };
  var extra = window.sbMessages && window.sbMessages["sb-controls"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  function t(el, key) {
    var holder = el && el.closest("[lang]");
    var lang = ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
    var table = MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de;
    return table[key] != null ? table[key] : MESSAGES.de[key];
  }

  document.addEventListener("click", function (event) {
    var toggle = closestIn(event, ".sb-claim-row__toggle");
    if (toggle) {
      var open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      var note = document.getElementById(toggle.getAttribute("aria-controls") || "");
      if (note) note.hidden = !open;
      return;
    }
    var sw = closestIn(event, ".sb-switch");
    if (sw && !sw.disabled) {
      var on = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", String(on));
      if (sw.hasAttribute("data-sb-motion-setting")) setMotion(on);
      return;
    }
    var motionItem = closestIn(event, "[role='menuitemcheckbox'][data-sb-motion-setting]");
    if (motionItem) { setMotion(motionItem.getAttribute("aria-checked") !== "true"); return; }
    var demo = closestIn(event, "[data-sb-demo-progress]");
    if (demo) { demoProgress(demo); return; }

    var chip = closestIn(event, ".sb-chip[aria-pressed]");
    if (chip && !chip.disabled) {
      var group = chip.closest("[data-sb-single]");
      if (group) {
        group.querySelectorAll(".sb-chip[aria-pressed]").forEach(function (c) { c.setAttribute("aria-pressed", String(c === chip)); });
      } else {
        chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
      }
      return;
    }
    var opener = closestIn(event, "[data-sb-opens]");
    if (opener) {
      var dialog = document.getElementById(opener.getAttribute("data-sb-opens"));
      if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
      return;
    }
    var tab = closestIn(event, ".sb-tabs [role='tab']");
    if (tab && tab.getAttribute("aria-disabled") === "true") return;   // a disabled tab is never selected (spec/02 §4.4)
    if (tab) {
      var list = tab.closest("[role='tablist']");
      list.querySelectorAll("[role='tab']").forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls") || "");
        if (panel) panel.hidden = !on;
      });
      return;
    }
    var calloutHide = closestIn(event, ".sb-callout__hide");
    if (calloutHide) {
      hideCallout(calloutHide.closest(".sb-callout"));
      return;
    }
    var toastAction = closestIn(event, ".sb-toast__action");
    if (toastAction) {
      var owner = toastAction.closest(".sb-toast");
      if (owner) {
        owner.dispatchEvent(new CustomEvent("sb-toast-action", { bubbles: true, detail: { action: toastAction.value || toastAction.textContent } }));
        window.sbToast.hide(owner);
      }
      return;
    }
    var toastOpener = closestIn(event, "[data-sb-toast-show]");
    if (toastOpener) {
      var shown = document.getElementById(toastOpener.getAttribute("data-sb-toast-show"));
      if (shown) window.sbToast.show(shown);
      return;
    }
    var copy = closestIn(event, ".sb-code__copy");
    if (copy) {
      var code = copy.closest(".sb-code");
      var text = code ? (code.querySelector("pre") || code).textContent : "";
      var label = copy.querySelector(".sb-code__copy-label") || copy;
      var done = function () { var was = label.textContent; label.textContent = t(copy, "copied"); setTimeout(function () { label.textContent = was; }, 2000); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
      } catch (e) { /* no clipboard in this context: nothing to do */ }
    }
  });

  function setMotion(reduce) {
    var root = document.documentElement;
    if (reduce) root.dataset.sbMotion = "reduce"; else delete root.dataset.sbMotion;
    try { if (reduce) localStorage.setItem("sb-motion", "reduce"); else localStorage.removeItem("sb-motion"); } catch (e) {}
    document.querySelectorAll("[data-sb-motion-setting]").forEach(function (s) { s.setAttribute("aria-checked", String(reduce)); });
  }

  // D102 (50): the language as a stored choice
  function languageRoot(el) { return (el && el.closest("[data-sb-language-root]")) || document.documentElement; }
  // WA-R3: radios of one name are one group for the browser, so a second language group with the same name would
  // show no choice after the first is used; such a group gets a name of its own (and the page a warning)
  var languageNames = 0;
  function ownName(group) {
    var radios = group.querySelectorAll("input[type='radio']");
    var name = radios.length ? radios[0].name : "";
    var shared = Array.prototype.some.call(document.querySelectorAll("input[type='radio']"), function (r) {
      return r.name === name && !group.contains(r);
    });
    if (!radios.length || (name && !shared)) return;
    var fresh;
    do { fresh = "sb-language-choice-" + (++languageNames); } while (document.getElementsByName(fresh).length);
    radios.forEach(function (r) { r.name = fresh; });
    if (name) console.warn("sb-controls.js: two [data-sb-language-choice] groups share the radio name \"" + name + "\"; one is now \"" + fresh + "\" (spec/03 §6.6)");
  }
  function syncLanguage(root) {
    var lang = (root.getAttribute("lang") || "").toLowerCase();
    document.querySelectorAll("[data-sb-language-choice]").forEach(function (group) {
      if (languageRoot(group) !== root) return;
      ownName(group);
      group.querySelectorAll("input[type='radio']").forEach(function (input) {
        var v = input.value.toLowerCase();
        input.checked = v === lang || v === lang.split("-")[0];
      });
    });
  }
  function setLanguage(input) {
    var root = languageRoot(input), lang = input.value;
    if (root.getAttribute("lang") === lang) return;
    root.setAttribute("lang", lang);
    if (root === document.documentElement) { try { localStorage.setItem("sb-lang", lang); } catch (e) {} }
    syncLanguage(root);
    (root === document.documentElement ? document : root).dispatchEvent(new CustomEvent("sb-language-change", { bubbles: true, detail: { lang: lang } }));
  }
  document.addEventListener("change", function (event) {
    var input = event.target instanceof Element ? event.target.closest("[data-sb-language-choice] input[type='radio']") : null;
    if (input && input.checked) setLanguage(input);
  });

  function icon(href, cls) {
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"), use = document.createElementNS(NS, "use");
    svg.setAttribute("class", cls || "sb-icon"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    use.setAttribute("href", href); svg.appendChild(use);
    return svg;
  }

  // D48 specimen: label says what runs, the bar grows over 1.8 s, then the check icon and „<done>“ for the dwell time, or the reason in
  // the bar's message slot and the label „Noch mal versuchen“. The check is the icon, not the character (D10). An app drives the same attributes from its real work.
  function demoProgress(button) {
    if (button.getAttribute("aria-busy") === "true") return;
    var label = button.querySelector(".sb-primary-action__label");
    var bar = button.querySelector(".sb-primary-action__bar");
    var zone = button.closest(".sb-primary-action-bar");
    var message = zone && zone.querySelector(".sb-primary-action-bar__message");
    if (!label || !bar) return;
    var idle = button.getAttribute("data-sb-label") || label.textContent;
    button.setAttribute("data-sb-label", idle);
    if (message) message.textContent = "";
    button.removeAttribute("data-sb-state");
    label.textContent = button.getAttribute("data-sb-busy") || t(button, "busy");
    button.setAttribute("aria-busy", "true");
    button.style.setProperty("--sb-progress", "0");
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      bar.style.transition = "transform 1800ms linear";
      button.style.setProperty("--sb-progress", "1");
    }); });
    setTimeout(function () {
      bar.style.transition = "";
      button.removeAttribute("aria-busy");
      button.style.removeProperty("--sb-progress");
      if (button.getAttribute("data-sb-demo-progress") === "fail") {
        label.textContent = t(button, "retry");
        button.setAttribute("data-sb-state", "retry");
        if (message) {
          message.appendChild(icon("#error--16", "sb-icon sb-icon--16"));
          var sentence = document.createElement("span");   // the glyph and one span with the sentence (spec/02 §1.1)
          sentence.textContent = button.getAttribute("data-sb-fail") || t(button, "failed");
          message.appendChild(sentence);
        }
        button.setAttribute("data-sb-demo-progress", "ok");
        return;
      }
      label.textContent = "";
      label.appendChild(icon("#check"));
      label.appendChild(document.createTextNode(button.getAttribute("data-sb-done") || t(button, "done")));
      button.setAttribute("data-sb-state", "done");
      setTimeout(function () { label.textContent = idle; button.removeAttribute("data-sb-state"); }, 1500);
    }, 1800);
  }

  // D102 (39), spec/02 §3.11: „Ausblenden“ of a callout. "sb-callout-hide" (cancelable, bubbles) tells the product, which keeps
  // the choice; unless it is cancelled the callout gets hidden and focus, which was on the button, moves to the next
  // control after the callout (else the one before it), never to the page's start (provisional, agent).
  var FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), " +
    "textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";
  function hideCallout(callout) {
    if (!callout || !callout.dispatchEvent(new CustomEvent("sb-callout-hide", { bubbles: true, cancelable: true }))) return;
    var all = Array.prototype.filter.call(document.querySelectorAll(FOCUSABLE), function (el) {
      return !callout.contains(el) && el.getClientRects().length > 0;
    });
    var after = all.filter(function (el) { return callout.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING; });
    var before = all.filter(function (el) { return callout.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING; });
    var focusWasInside = callout.contains(document.activeElement);
    callout.hidden = true;
    var next = after[0] || before[before.length - 1];
    if (focusWasInside && next) next.focus({ preventScroll: true });
  }

  // D78: the toast's lifetime. 6 s, the same for every toast (spec/02 §4.8); never used for errors, which stay next to
  // what failed. The timer stops while the pointer is over the toast or focus is inside it and runs on with the time
  // that was left; Escape closes it; focus that was inside goes back to where it came from.
  // spec/02 §4.8 (provisional, agent): a live region that enters the accessibility tree together with its text is often not
  // announced (WebKit / VoiceOver); show() therefore unhides the toast with its sentence taken out and puts the
  // sentence back two animation frames later, when the empty region is already in the tree. The toast keeps its size
  // meanwhile (the sentence's box stays, only its text is out), and its action stays in place. Not checked with
  // VoiceOver here.
  var TOAST_MS = 6000;
  function toastSentence(toast) { return toast.querySelector("p, .sb-toast__text"); }
  window.sbToast = {
    show: function (toast) {
      if (!toast) return;
      var s = toast._sbToast || (toast._sbToast = { timer: 0, left: 0, since: 0, hold: { pointer: false, focus: false }, from: null, words: null, frame: 0 });
      clearTimeout(s.timer);
      cancelAnimationFrame(s.frame);
      s.from = document.activeElement;
      var sentence = toastSentence(toast);
      if (sentence && s.words === null) {
        s.words = document.createDocumentFragment();
        while (sentence.firstChild) s.words.appendChild(sentence.firstChild);
        sentence.style.minBlockSize = "1lh";   // the line stays while its words are out (CSSOM, CSP-safe)
      }
      toast.hidden = false;
      toast.classList.remove("sb-enter"); void toast.offsetWidth; toast.classList.add("sb-enter");
      s.frame = requestAnimationFrame(function () {
        s.frame = requestAnimationFrame(function () { putBack(toast); });
      });
      s.left = TOAST_MS;
      run(toast);
    },
    hide: function (toast) {
      var s = toast && toast._sbToast;
      if (s) { clearTimeout(s.timer); cancelAnimationFrame(s.frame); }
      if (toast && s) putBack(toast);
      if (!toast || toast.hidden) return;
      var focusInside = toast.contains(document.activeElement);
      toast.hidden = true;
      toast.classList.remove("sb-enter");
      if (!focusInside || !s) return;
      var from = s.from;
      if (from && from !== document.body && document.contains(from) && !from.closest("[hidden], [inert]")) {
        from.focus({ preventScroll: true });
        if (document.activeElement === from) return;   // a style that hides it (display: none) lets focus() do nothing
      }
      // the origin is gone (its row was deleted, its view closed or hidden): focus goes to the main content of the area
      // the toast stands in, never to the page's body (spec/02 §4.8)
      var area = toast.closest(".sb-window, .sb-view") || document;
      var main = null;
      [".sb-doc-tabs__panel:not([hidden])", ".sb-window__content", ".sb-view__content", "main"].some(function (sel) { return (main = area.querySelector(sel)); });
      if (!main) return;
      if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    }
  };
  function putBack(toast) {
    var s = toast._sbToast, sentence = toastSentence(toast);
    if (!s || s.words === null || !sentence) return;
    sentence.appendChild(s.words);
    sentence.style.minBlockSize = "";
    s.words = null;
  }
  function run(toast) {
    var s = toast._sbToast;
    clearTimeout(s.timer);
    if (s.hold.pointer || s.hold.focus || toast.hidden) return;
    s.since = Date.now();
    s.timer = setTimeout(function () { window.sbToast.hide(toast); }, s.left);
  }
  function hold(toast, kind, on) {
    var s = toast._sbToast;
    if (!s || toast.hidden) return;
    if (on && !s.hold.pointer && !s.hold.focus) { clearTimeout(s.timer); s.left = Math.max(0, s.left - (Date.now() - s.since)); }
    s.hold[kind] = on;
    if (!on) run(toast);
  }
  document.addEventListener("pointerover", function (event) { var x = closestIn(event, ".sb-toast"); if (x) hold(x, "pointer", true); });
  document.addEventListener("pointerout", function (event) {
    var x = closestIn(event, ".sb-toast");
    if (x && !(event.relatedTarget instanceof Node && x.contains(event.relatedTarget))) hold(x, "pointer", false);
  });
  document.addEventListener("focusin", function (event) { var x = closestIn(event, ".sb-toast"); if (x) hold(x, "focus", true); });
  document.addEventListener("focusout", function (event) {
    var x = closestIn(event, ".sb-toast");
    if (x && !(event.relatedTarget instanceof Node && x.contains(event.relatedTarget))) hold(x, "focus", false);
  });
  // spec/02 §4.8 (provisional, agent): a toast without an action never gets focus, so Escape is heard on the whole page, in the
  // capture phase (a palette, search or dialog that stops its Escape would otherwise keep the toast open) and never
  // consumed (no preventDefault, no stopPropagation): an editor or field gets its Escape as before. Escape that belongs
  // to an open modal dialog (sheet, palette, confirmation) or an open popover (menu, contents overlay, note, tooltip)
  // leaves the toast alone, unless it comes from inside the toast itself.
  function escapeTaken() {
    try { return !!document.querySelector("dialog:modal, :popover-open"); } catch (e) { return !!document.querySelector("dialog[open]"); }
  }
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || event.isComposing) return;
    var inside = closestIn(event, ".sb-toast");
    if (inside) { if (inside._sbToast) window.sbToast.hide(inside); return; }
    if (escapeTaken()) return;
    var shown = document.querySelectorAll(".sb-toast:not([hidden])");
    for (var i = 0; i < shown.length; i++) if (shown[i]._sbToast) window.sbToast.hide(shown[i]);
  }, true);

  function syncRange(track) {
    var inputs = track.querySelectorAll("input[type='range']");
    if (!inputs.length) return;
    function frac(input) {
      var min = parseFloat(input.min || "0"), max = parseFloat(input.max || "100"), v = parseFloat(input.value);
      return max > min ? (v - min) / (max - min) : 0;
    }
    var from = inputs.length > 1 ? Math.min(frac(inputs[0]), frac(inputs[1])) : 0;
    var to = inputs.length > 1 ? Math.max(frac(inputs[0]), frac(inputs[1])) : frac(inputs[0]);
    track.style.setProperty("--sb-range-from", String(from));
    track.style.setProperty("--sb-range-to", String(to));
  }
  document.addEventListener("input", function (event) {
    var track = closestIn(event, ".sb-range__track");
    if (track) syncRange(track);
  });

  function followToc(toc) {
    var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
    var targets = links.map(function (a) { return document.getElementById(a.hash.slice(1)); });
    if (!links.length || targets.some(function (t) { return !t; })) return;
    function update() {
      var current = 0, root = document.documentElement;
      targets.forEach(function (t, i) { if (t.getBoundingClientRect().top <= 96) current = i; });
      if (window.innerHeight + window.scrollY >= root.scrollHeight - 2) current = links.length - 1;
      links.forEach(function (a, i) { if (i === current) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current"); });
    }
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  // D102 (32): the place line of a jump target lasts until the next action
  function currentTarget() {
    var id = location.hash.slice(1), el = null;
    try { el = id ? document.getElementById(decodeURIComponent(id)) : null; } catch (e) { el = null; }
    return el && el.closest(".sb-prose") ? el : null;
  }
  function leaveTarget() { var el = currentTarget(); if (el) el.setAttribute("data-sb-past", ""); }
  document.addEventListener("keydown", function (event) {
    if (!/^(Shift|Control|Alt|AltGraph|Meta|CapsLock|Fn|OS)$/.test(event.key)) leaveTarget();
  }, true);
  document.addEventListener("pointerdown", leaveTarget, true);
  window.addEventListener("hashchange", function () { var el = currentTarget(); if (el) el.removeAttribute("data-sb-past"); });
  document.addEventListener("click", function (event) {
    var a = closestIn(event, "a[href^='#']");
    if (!a || a.hash !== location.hash) return;                    // a new jump: hashchange shows the line
    var el = currentTarget();
    if (el) el.removeAttribute("data-sb-past");                     // the same place again: show it again
  });

  // D102 (34): the contents as an overlay over a reader (sb-menu's surface, sb-toc's rows); without the Popover API the
  // overlay stays a list in the page
  var POPOVER = typeof HTMLElement.prototype.showPopover === "function";
  function overlayButton(toc) {
    return toc.id ? document.querySelector("[popovertarget='" + CSS.escape(toc.id) + "']") : null;
  }
  function overlayLinks(toc) { return Array.prototype.slice.call(toc.querySelectorAll("a[href]")); }
  function scrollerOf(el) {
    for (var p = el && el.parentElement; p && p !== document.body; p = p.parentElement) {
      var o = getComputedStyle(p).overflowY;
      if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  }
  function followOverlay(toc) {
    var links = overlayLinks(toc).filter(function (a) { return a.hash; });
    var targets = links.map(function (a) { try { return document.getElementById(decodeURIComponent(a.hash.slice(1))); } catch (e) { return null; } });
    if (!links.length || targets.some(function (t) { return !t; })) return;
    var box = scrollerOf(targets[0]), top = (box ? box.getBoundingClientRect().top : 0) + 96, current = 0;
    targets.forEach(function (t, i) { if (t.getBoundingClientRect().top <= top) current = i; });
    links.forEach(function (a, i) { if (i === current) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current"); });
  }
  function placeOverlay(toc) {
    var button = overlayButton(toc);
    if (!button) return;
    var b = button.getBoundingClientRect(), m = 8, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var w = toc.offsetWidth, h = toc.offsetHeight, rtl = getComputedStyle(button).direction === "rtl";
    var left = rtl ? b.right - w : b.left;
    left = Math.max(m, Math.min(left, vw - w - m));
    var below = b.bottom + 4, top = below + h <= vh - m || b.top - 4 - h < m ? below : b.top - 4 - h;
    toc.style.left = Math.round(left) + "px";
    toc.style.top = Math.round(Math.max(m, top)) + "px";
  }
  document.addEventListener("toggle", function (event) {
    var toc = event.target;
    if (!(toc instanceof Element) || !toc.matches(".sb-toc--overlay[popover]")) return;
    var button = overlayButton(toc), open = event.newState === "open";
    if (button) button.setAttribute("aria-expanded", String(open));
    if (!open) return;
    if (toc.hasAttribute("data-sb-follow")) followOverlay(toc);
    placeOverlay(toc);
    var links = overlayLinks(toc);
    var first = toc.querySelector("a[aria-current]") || links[0];
    if (first) first.focus({ preventScroll: true });
  }, true);
  document.addEventListener("keydown", function (event) {
    var toc = closestIn(event, ".sb-toc--overlay[popover]");
    if (!toc || !/^(ArrowDown|ArrowUp|Home|End)$/.test(event.key)) return;
    var links = overlayLinks(toc), i = links.indexOf(document.activeElement);
    if (!links.length) return;
    event.preventDefault();
    var next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1
      : event.key === "ArrowDown" ? (i + 1) % links.length : (i - 1 + links.length) % links.length;
    links[next].focus();
  });
  document.addEventListener("focusout", function (event) {
    var toc = POPOVER ? closestIn(event, ".sb-toc--overlay[popover]") : null;
    if (!toc || !toc.matches(":popover-open")) return;
    var to = event.relatedTarget;
    if (to instanceof Node && toc.contains(to)) return;
    if (to) toc.hidePopover();                                      // Tab out of it; a press outside closes it anyway
    if (to && to !== document.activeElement) to.focus({ preventScroll: true });
  });
  document.addEventListener("click", function (event) {
    var a = POPOVER ? closestIn(event, ".sb-toc--overlay[popover] a[href]") : null;
    if (!a) return;
    var toc = a.closest(".sb-toc--overlay");
    overlayLinks(toc).forEach(function (l) { if (l === a) l.setAttribute("aria-current", "location"); else l.removeAttribute("aria-current"); });
    if (toc.matches(":popover-open")) toc.hidePopover();            // then the jump, and focus moves to its target
    var target = null;
    try { target = a.hash ? document.getElementById(decodeURIComponent(a.hash.slice(1))) : null; } catch (e) { target = null; }
    if (!target) return;
    if (!target.matches("a[href], button, input, select, textarea, summary, [tabindex]")) target.setAttribute("tabindex", "-1");
    setTimeout(function () { target.focus({ preventScroll: true }); }, 0);   // after the browser's own jump
  });
  function replaceOpenOverlays() { if (POPOVER) document.querySelectorAll(".sb-toc--overlay[popover]:popover-open").forEach(placeOverlay); }
  window.addEventListener("resize", replaceOpenOverlays);
  window.addEventListener("scroll", replaceOpenOverlays, { passive: true, capture: true });

  // .sb-dialog: a press on the scrim cancels like Escape (spec/02 §4.6; provisional, agent). Only a press that
  // begins and ends on the scrim (a selection dragged out of a field does not close), never a keyboard "click", and not
  // while a field has changed since the dialog opened (its values are taken when focus first enters it, which
  // showModal() does at once). A sheet (sb-sheet.js) and the palette (sb-window.js) have their own
  function sbDialog(el) { return el instanceof HTMLDialogElement && el.classList.contains("sb-dialog") && el.open ? el : null; }
  function outsideBox(dlg, event) {
    var r = dlg.getBoundingClientRect();
    return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
  }
  function fieldValues(dlg) {
    return Array.prototype.map.call(dlg.querySelectorAll("input, textarea, select"), function (f) {
      return f.type === "checkbox" || f.type === "radio" ? String(f.checked) : f.value;
    }).join("\u0000");
  }
  var scrimDown = null;
  document.addEventListener("focusin", function (event) {
    var dlg = event.target instanceof Element ? sbDialog(event.target.closest("dialog")) : null;
    if (dlg && dlg._sbValues == null) dlg._sbValues = fieldValues(dlg);
  }, true);
  document.addEventListener("close", function (event) {
    if (event.target instanceof HTMLDialogElement) event.target._sbValues = null;
  }, true);
  document.addEventListener("pointerdown", function (event) {
    var dlg = sbDialog(event.target);
    scrimDown = dlg && outsideBox(dlg, event) ? dlg : null;
  }, true);
  document.addEventListener("click", function (event) {
    var dlg = sbDialog(event.target), down = scrimDown;
    scrimDown = null;
    if (!dlg || dlg !== down || event.detail === 0 || !outsideBox(dlg, event)) return;
    if (dlg._sbValues != null && fieldValues(dlg) !== dlg._sbValues) return;   // an input dialog keeps changed text
    if (dlg.dispatchEvent(new Event("cancel", { cancelable: true }))) dlg.close();
  });

  function init() {
    document.querySelectorAll(".sb-toc[data-sb-follow]:not(.sb-toc--overlay)").forEach(followToc);
    document.querySelectorAll(".sb-range__track").forEach(syncRange);
    document.querySelectorAll("[data-sb-indeterminate]").forEach(function (box) { box.indeterminate = true; });
    var reduceSet = document.documentElement.getAttribute("data-sb-motion") === "reduce";
    document.querySelectorAll("[data-sb-motion-setting]").forEach(function (s) { s.setAttribute("aria-checked", String(reduceSet)); });
    var roots = [];
    document.querySelectorAll("[data-sb-language-choice]").forEach(function (g) { var r = languageRoot(g); if (roots.indexOf(r) < 0) roots.push(r); });
    roots.forEach(syncLanguage);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
