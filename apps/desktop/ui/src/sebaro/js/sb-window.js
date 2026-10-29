// sb-window.js: behaviour of the sebaro desktop window (spec/02 §4.12–§4.24; D67, D72, D75, D81, D84, D91 F1–F14).
// Tauri windows and web apps with a window. Classic script (pages open from file://), CSP-safe: no inline handlers, no
// eval, no style attributes in markup (widths of dragged panes are set through the CSSOM, like sb-menu.js places its
// menu). Progressive enhancement: the markup already carries every state (aria-expanded on the pane toggles,
// hidden on hidden panes, aria-selected / aria-current on rows, aria-checked on check items, the macOS form of every
// shortcut); without this script the window shows that state and only loses the interaction.
//   .sb-keys[data-sb-keys]        shortcut text per platform and language: „⌘K“ on macOS, „Strg+K“ / „Ctrl+K“ on
//                                 Windows and Linux (D84, spec/01 §2.1), plus the spoken form for screen readers;
//                                 aria-keyshortcuts="Meta+…" becomes "Control+…" off macOS
//   [data-sb-window-toggle]       shows / hides the pane named by aria-controls (sidebar, inspector; D81) and keeps
//                                 aria-expanded (aria-checked on a menuitemcheckbox in „Darstellung“); a pane that no longer fits beside the content (480 px) becomes an
//                                 overlay (CSS container query) and is closed here; opened again it lies over the
//                                 content edge, Escape or a click outside closes it; Escape returns focus to the
//                                 toggle, a click outside leaves it on what was clicked when that takes focus, else
//                                 on the toggle (OR-12, as sb-menu.js);
//                                 opened from a menu item focus stays with the menu's button, where Escape closes
//                                 it too and focus stays (D95 (b)); a pane that hides while it holds focus gives
//                                 focus to its visible toggle (NV-J)
//   .sb-listbox[role="listbox"]   ↑ ↓ Home End move and choose; with aria-multiselectable: ⇧ + arrow / click extends,
//                                 ⌘ / Strg + click toggles, Space toggles, ⌘A / Strg+A chooses all, Escape keeps only
//                                 the current row (D67 (8)); data-sb-selection-status="<id>" names the state sentence
//                                 that says „3 ausgewählt“ while two or more are chosen (D72); fires "sb-selection-change"
//   [data-sb-theme-choice]        „Wie das System“ / „Hell“ / „Dunkel“ (system | light | dark) in the menu „Darstellung“
//                                 and in the palette (D75), and as radio inputs in the settings view (F10a); stores
//                                 sb-theme like theme-button.js, read by theme-init.js; keeps aria-checked (checked on
//                                 a radio) on every choice; fires "sb-theme-change" on document
//   .sb-command-palette           dialog.sb-command-palette opens with ⌘K (macOS) / Strg+K (Windows, Linux) and with
//                                 [data-sb-palette-open="<id>"]; typing filters (name, data-sb-keywords, group head),
//                                 ↑ ↓ move the active option, Enter runs it, Escape closes, focus returns (D67 (4),
//                                 D84). Running an option: data-sb-theme-choice is applied, data-sb-palette-click="<id>"
//                                 clicks that control (one code path for the tool and the palette), and "sb-command"
//                                 (bubbles, detail.command = data-sb-command) is fired on the option. Check marks of
//                                 setting options follow their control (aria-expanded / aria-pressed / aria-checked).
//                                 While a palette is open its own shortcut closes it, and the shortcut of another
//                                 overlay (an opener with data-sb-palette-open or data-sb-find-open that announces it
//                                 in aria-keyshortcuts) closes it and opens that one (spec/02 §4.16)
//   fixed shortcuts (F5a)         the window shortcuts of spec/02 §4.19 press the visible control of the window that
//                                 announces them in aria-keyshortcuts (⌘, Einstellungen, ⌘N the area's primary
//                                 action, ⌘O, ⌘F (focuses a search field), ⌃⌘S / Strg+Alt+S Seitenleiste, ⌥⌘I /
//                                 Strg+Alt+I Inspektor, ⇧⌘N, ⌘⌫ / Entf (not inside a text field), ⌘+ / ⌘−); ⌘K, F6,
//                                 ⌃⇥ and ⌘W are handled here; undo, redo and the clipboard stay with the text fields
//   F6 / ⇧F6 (F6a)                focus moves through the window's areas: title bar, sidebar, content, inspector,
//                                 action zone; hidden areas are skipped; each area gets back the element that had
//                                 focus there last (else its first control, an editor [contenteditable] counting
//                                 as one, else the area itself); „Nächster Bereich“ from the menu or the palette
//                                 (data-sb-area) counts from the area that had focus before it opened (spec/02 §4.20)
//   .sb-window__divider (F3a)     role="separator" between sidebar / inspector and content: drag with limits
//                                 (aria-valuemin / -max, else the pane tokens --sb-x-sebaro-pane-*; the content keeps
//                                 480 px), ← → 8 px, ⇧ + arrow 32 px,
//                                 Home / End smallest / largest, Enter collapses and restores, double click restores
//                                 the start width; dragging under the smallest width collapses; widths are stored per
//                                 window (sb-pane:<window id>:<pane id>) and give way when the window narrows
//   [data-sb-pane-width]          the way without dragging (WCAG 2.5.7): „Schmal · Normal · Breit“ in the menu
//                                 „Darstellung“ (menuitemradio, aria-controls = the pane; "min" | "start" | "max")
//                                 set the width through the divider of that pane, store it like a drag and keep
//                                 aria-checked on the width that is shown (none while a dragged width is between);
//                                 a pane that is an overlay in a narrow window only keeps the width and stays as it
//                                 is (D95 (b))
//   F10, a lone Alt (F4b)         open the window menu behind „Menü“ (.sb-menu--window) on its first item, like a
//                                 menu bar, only while „Menü“ is in the window (D95 (a)); again (or Escape) closes
//                                 it and focus goes back to where it was. Alt only off macOS (on a Mac ⌥ types
//                                 characters); not while a dialog has the keyboard
//   .sb-doc-tabs (F7a)            document tabs: click or ← → Home End choose, ⌃⇥ / ⌃⇧⇥ next / previous, Entf or ⌘W
//                                 / Strg+W close the tab (the cross is a pointer shortcut, aria-hidden), middle click
//                                 closes; "sb-doc-tab-close" (cancelable) is fired on the tab before it goes; the
//                                 chosen tab is scrolled into the row (spec/02 §4.21); a pinned tab (.sb-doc-tabs__item--pinned,
//                                 D102 (5)) stays first and is not closed; a tab with data-sb-drag is reordered by
//                                 dragging, [data-sb-tab-move="previous" | "next"] in the menu „Fenster“ and the
//                                 palette moves the current tab without a pointer ("sb-move", cancelable)
//   [data-sb-drag] rows (F8a)     drag with the pointer (pointer events, not HTML drag and drop: Tauri's file drop
//                                 would swallow it on Windows): the dragged row keeps an ink frame, a folder target
//                                 gets the cobalt frame, between rows a cobalt line; [data-sb-drop="none"] refuses
//                                 (no frame, the forbidden cursor); Escape cancels. "sb-move" (cancelable) is fired
//                                 on the row; by default the row moves in the tree; the free space under a tree's
//                                 rows takes it into the top level (spec/02 §4.22). The same move runs from
//                                 dialog[data-sb-move-dialog] („Verschieben nach …“, the way without a pointer) and
//                                 from the folder picker dialog.sb-command-palette[data-sb-move-palette] (D102 (16):
//                                 the folder opens and the row is shown, else the toast with „Rückgängig“). Commands
//                                 act on the focused row while the tree had the keyboard, else on the chosen one
//                                 (D102 (17))
//   [data-sb-switch]              a compact switch with the eye icon and its word (D102 (2), D105 (2), „Vorschau“): a press turns aria-pressed
//                                 over and fires "sb-switch-change" (bubbles, detail.pressed); the app shows the view
//   [data-sb-sort-choice]         the sort choice over a tree or list (D102 (3)): compact switches with their word
//                                 and aria-pressed; a press on another one chooses it (ascending), a press on the
//                                 chosen one turns its direction; the chosen one shows arrow-up--16 / arrow-down--16
//                                 and the hidden word „aufsteigend“ / „absteigend“ (data-sb-sort-dir="asc" | "desc");
//                                 fires "sb-sort-change" (bubbles, detail.key = data-sb-sort-key, detail.dir)
//   .sb-primary-action-bar__message[data-sb-message]  the failure sentence of a command without field and primary
//                                 action (D102 (11)): "command" stays until the next key (not a lone modifier, not
//                                 Tab), the next pointer press or Escape in its window (sb-window.js clears only the
//                                 window the key or press was in); "background" (no action of the user caused it, e.g. an
//                                 autosave) stays at least 10 s and then until the next of them. Without the attribute
//                                 the app clears it (the primary action's own failure, spec/03 §16)
//   [data-sb-escape]              Escape in the window (when nothing else took it) presses this control, e.g.
//                                 „Zurück zu Wochenplan“ in the settings view (F10a)
//   html[data-sb-window-active]   "false" while the window is not in front (the path recedes, F9a)
//   .sb-command-palette[data-sb-fulltext]  the full-text search in the palette's frame (D104 (1), (2), (4); spec/02
//                                 §4.25.1): the script does not filter its options (the app fills the list); typing
//                                 and a press on an option chip ([data-sb-search-option] with aria-pressed) fire
//                                 "sb-search" (bubbles, detail { query, matchCase, regex }); while the list carries
//                                 aria-busy="true" and holds no option for 1 s, __empty says „Suche läuft …“ in place
//                                 of the list (no spinner), until an option arrives or aria-busy goes; the first option
//                                 the app adds becomes the active one
//   .sb-find-bar[data-sb-find-target="<id>"]  the find bar over the text (D104 (3), spec/02 §4.25.2): opened by
//                                 [data-sb-find-open="<bar id>"] (the tool that announces ⌘F), its field marks every
//                                 hit in the target's rendered text as mark.sb-mark (the current one aria-current) and
//                                 says „Treffer 2 von 5“; Eingabe / ⇧Eingabe and [data-sb-find="next" | "previous"]
//                                 move, Escape or [data-sb-find="close"] closes and takes the marks away, focus back to
//                                 the opener; [data-sb-find-mode="replace" | "line" | "find"] shows that row;
//                                 [data-sb-find="replace" | "replace-all"] fire "sb-find-replace" (cancelable; else the
//                                 rendered words are replaced), [data-sb-find="line"] checks 1 … data-sb-lines and
//                                 fires "sb-find-line" (detail { line })
//   .sb-reader[data-sb-pages]     the document reader's tools (D104 (5)–(7), spec/02 §4.25.3): [data-sb-reader-command
//                                 ="previous" | "next" | "zoom-out" | "zoom-in" | "fit"], the page field
//                                 [data-sb-reader-page] (Eingabe jumps; an entry outside 1 … n goes back to the page
//                                 shown), Bild auf / Bild ab in the view; keeps data-sb-page and data-sb-zoom, writes the
//                                 zoom value („100 %“, a status), shows only the current [data-sb-reader-sheet] and fires
//                                 "sb-reader-change" (bubbles, detail { page, zoom, fit })
// Tool tooltips („Name Kürzel“) are the system tooltip of sb-tooltip.js (aria-describedby + popover="manual").
// Platform: <html data-sb-platform="mac|windows|linux"> (a Tauri app sets it from its OS), else the user agent.
// Messages follow the language of the element (closest [lang], else <html lang>): German default, English built in;
// window.sbMessages = { "sb-window": { fr: { … } } } before this script adds one (D87, spec/09 §6.1).
(function () {
  "use strict";
  var MESSAGES = {
    de: {
      selected: "{n} ausgewählt",
      noMatch: "Kein Befehl passt zu „{q}“.",
      width: "{n} Pixel",
      collapsed: "zugeklappt",
      moved: "Nach „{target}“ verschoben.",
      ascending: "aufsteigend",
      descending: "absteigend",
      // D104 (1)–(7): the full-text search, the find bar and the reader (spec/02 §4.25)
      searching: "Suche läuft …",
      findCount: "Treffer {n} von {m}",
      findNone: "Kein Treffer",
      lineRange: "Gib eine Zeile von 1 bis {m} ein.",
      lineOf: "von {m}",
      zoomValue: "{z}\u00a0%",
      // visible key words off macOS, spoken names (screen readers); macOS shows the font's key glyphs (D68). Pos1, Ende,
      // Bild auf and Bild ab are words on every system, macOS too (D102 (12): the fonts have no ↖ ↘ ⇞ ⇟)
      keyWords: { Mod: "Strg", Ctrl: "Strg", Shift: "Umschalt", Alt: "Alt", Enter: "Eingabe", Escape: "Esc", Backspace: "Rücktaste", Delete: "Entf", Tab: "Tab", Space: "Leertaste", Home: "Pos1", End: "Ende", PageUp: "Bild auf", PageDown: "Bild ab" },
      keySpoken: { Mod: "Befehl", Ctrl: "Control", Shift: "Umschalt", Alt: "Wahl", Enter: "Eingabe", Escape: "Escape", Backspace: "Rückschritt", Delete: "Entfernen", Tab: "Tabulator", Space: "Leertaste", Up: "Pfeil nach oben", Down: "Pfeil nach unten", Left: "Pfeil nach links", Right: "Pfeil nach rechts", Comma: "Komma", Period: "Punkt", Plus: "Plus", Minus: "Minus", Backslash: "Backslash", Slash: "Schrägstrich", Home: "Pos1", End: "Ende", PageUp: "Bild auf", PageDown: "Bild ab" },
      // off macOS the keys are said by the names they carry there (spec/09 §6.1: English Windows said „Return“, „Delete“ and
      // „Forward delete“ for Enter, Backspace and Delete; spec/07 §4.8 has the tables)
      keySpokenOther: { Mod: "Steuerung", Ctrl: "Steuerung", Alt: "Alt", Backspace: "Rücktaste" }
    },
    en: {
      selected: "{n} selected",
      noMatch: "No command matches “{q}”.",
      width: "{n} pixels",
      collapsed: "collapsed",
      moved: "Moved to “{target}”.",
      ascending: "ascending",
      descending: "descending",
      searching: "Searching …",
      findCount: "Match {n} of {m}",
      findNone: "No match",
      lineRange: "Enter a line from 1 to {m}.",
      lineOf: "of {m}",
      zoomValue: "{z}\u00a0%",
      keyWords: { Mod: "Ctrl", Ctrl: "Ctrl", Shift: "Shift", Alt: "Alt", Enter: "Enter", Escape: "Esc", Backspace: "Backspace", Delete: "Del", Tab: "Tab", Space: "Space", Home: "Home", End: "End", PageUp: "Page Up", PageDown: "Page Down" },
      keySpoken: { Mod: "Command", Ctrl: "Control", Shift: "Shift", Alt: "Option", Enter: "Return", Escape: "Escape", Backspace: "Delete", Delete: "Forward delete", Tab: "Tab", Space: "Space", Up: "Up arrow", Down: "Down arrow", Left: "Left arrow", Right: "Right arrow", Comma: "Comma", Period: "Period", Plus: "Plus", Minus: "Minus", Backslash: "Backslash", Slash: "Slash", Home: "Home", End: "End", PageUp: "Page up", PageDown: "Page down" },
      keySpokenOther: { Mod: "Control", Ctrl: "Control", Alt: "Alt", Enter: "Enter", Backspace: "Backspace", Delete: "Delete" }
    }
  };
  var extra = window.sbMessages && window.sbMessages["sb-window"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  function table(el) {
    var holder = el && el.closest && el.closest("[lang]");
    var lang = ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
    return { lang: lang, m: MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de };
  }
  function t(el, key, values) {
    var tb = table(el), s = tb.m[key] != null ? tb.m[key] : MESSAGES.de[key];
    if (typeof s !== "string") return s;
    return s.replace(/\{(\w+)\}/g, function (_, k) {
      var v = values && values[k];
      if (typeof v === "number") { try { return new Intl.NumberFormat(tb.lang).format(v); } catch (e) { return String(v); } }
      return v == null ? "" : String(v);
    });
  }
  function closestIn(event, selector) { return event.target instanceof Element ? event.target.closest(selector) : null; }
  var root = document.documentElement;

  // ------------------------------------------------------------------ platform and shortcuts
  function isMac() {
    var p = root.getAttribute("data-sb-platform");
    if (p) return p === "mac";
    var ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "";
    return /mac|iphone|ipad|ipod/i.test(ua);
  }
  function modKey(event) { return isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey; }
  var GLYPHS = { Mod: "⌘", Ctrl: "⌃", Shift: "⇧", Alt: "⌥", Enter: "↩", Escape: "⎋", Backspace: "⌫", Delete: "⌦", Tab: "⇥",
                 Up: "↑", Down: "↓", Left: "←", Right: "→", Comma: ",", Period: ".", Plus: "+", Minus: "-", Backslash: "\\", Slash: "/" };
  var ARROWS = { Up: "↑", Down: "↓", Left: "←", Right: "→", Comma: ",", Period: ".", Plus: "+", Minus: "-", Backslash: "\\", Slash: "/" };
  var MAC_ORDER = ["Ctrl", "Alt", "Shift", "Mod"], OTHER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"];
  // chords whose Windows / Linux form is not the macOS form with Strg for ⌘ (spec/02 §4.19): ⌘⌫ is Entf, ⇧⌘Z is Strg+Y,
  // Zurück / Vor ⌘← / ⌘→ (in a text field ⌃⌘← / ⌃⌘→) are Alt+← / Alt+→ (D102 (14); Strg+← moves by word in a text
  // field and Strg+Alt+← is the workspace switch of GNOME)
  var OTHER_KEYS = { "Mod+Backspace": "Delete", "Shift+Mod+Z": "Mod+Y", "Mod+Left": "Alt+Left", "Mod+Right": "Alt+Right",
                     "Ctrl+Mod+Left": "Alt+Left", "Ctrl+Mod+Right": "Alt+Right" };
  var OTHER_ARIA = { "Meta+Backspace": "Delete", "Shift+Meta+Z": "Control+Y Control+Shift+Z",
                     "Meta+ArrowLeft": "Alt+ArrowLeft", "Meta+ArrowRight": "Alt+ArrowRight",
                     "Control+Meta+ArrowLeft": "Alt+ArrowLeft", "Control+Meta+ArrowRight": "Alt+ArrowRight" };
  // aria-keyshortcuts: the markup carries the macOS chord; elsewhere Meta becomes Control, ⌃⌘ becomes Control+Alt
  function otherAria(list) {
    return list.trim().split(/\s+/).map(function (chord) {
      if (OTHER_ARIA[chord]) return OTHER_ARIA[chord];
      var parts = chord.split("+");
      if (parts.indexOf("Meta") < 0) return chord;
      var hadCtrl = parts.indexOf("Control") >= 0, key = parts[parts.length - 1];
      var mods = parts.slice(0, -1).filter(function (p) { return p !== "Meta" && p !== "Control"; });
      if (hadCtrl && mods.indexOf("Alt") < 0) mods.unshift("Alt");
      return ["Control"].concat(mods).concat([key]).join("+");
    }).join(" ");
  }
  // "Shift+Mod+P" → one chord; "Up Down" → two keys shown side by side („↑↓“)
  function keyText(spec, el) {
    var m = table(el).m, mac = isMac();
    var words = m.keyWords || MESSAGES.de.keyWords, spoken = m.keySpoken || MESSAGES.de.keySpoken;
    var spokenOther = m.keySpokenOther || MESSAGES.de.keySpokenOther;
    var shown = [], said = [];
    spec.trim().split(/\s+/).forEach(function (chord) {
      if (!mac && OTHER_KEYS[chord]) chord = OTHER_KEYS[chord];
      var parts = chord.split("+").filter(Boolean);
      // off macOS ⌃⌘ becomes Strg+Alt (⌃⌘S → Strg+Alt+S): Strg already stands for ⌘ there (spec/02 §4.19)
      if (!mac && parts.indexOf("Mod") >= 0 && parts.indexOf("Ctrl") >= 0) parts = parts.map(function (p) { return p === "Ctrl" ? "Alt" : p; });
      var mods = parts.filter(function (p) { return MAC_ORDER.indexOf(p) >= 0; });
      var keys = parts.filter(function (p) { return MAC_ORDER.indexOf(p) < 0; });
      mods.sort(function (a, b) { var o = mac ? MAC_ORDER : OTHER_ORDER; return o.indexOf(a) - o.indexOf(b); });
      var all = mods.concat(keys);
      if (mac) shown.push(all.map(function (k) { return GLYPHS[k] || words[k] || k.toUpperCase(); }).join(""));
      else shown.push(all.map(function (k) { return ARROWS[k] || words[k] || k.toUpperCase(); }).join("+"));
      said.push(all.map(function (k) {
        return (!mac && spokenOther[k]) || spoken[k] || (k.length === 1 ? k.toUpperCase() : k);
      }).join(" "));
    });
    return { shown: shown.join(""), said: said.join(", ") };
  }
  function renderKeys(scope) {
    (scope || document).querySelectorAll(".sb-keys[data-sb-keys]").forEach(function (box) {
      var txt = keyText(box.getAttribute("data-sb-keys"), box);
      var vis = box.querySelector("[aria-hidden='true']"), sr = box.querySelector(".sb-visually-hidden");
      if (!vis) { vis = document.createElement("span"); vis.setAttribute("aria-hidden", "true"); box.textContent = ""; box.appendChild(vis); }
      if (!sr) { sr = document.createElement("span"); sr.className = "sb-visually-hidden"; box.appendChild(sr); }
      vis.textContent = txt.shown;
      sr.textContent = txt.said;
    });
    if (!isMac()) {
      (scope || document).querySelectorAll("[aria-keyshortcuts*='Meta']").forEach(function (el) {
        el.setAttribute("aria-keyshortcuts", otherAria(el.getAttribute("aria-keyshortcuts")));
      });
    }
  }

  // ------------------------------------------------------------------ panes (D81)
  var panes = {};   // pane id → { pane, toggles, want, overlay }
  function paneState(id) {
    var pane = document.getElementById(id);
    if (!pane) return null;
    var s = panes[id];
    if (!s || s.pane !== pane) {
      s = panes[id] = { pane: pane, want: !pane.hidden, overlay: false };
      s.overlay = isOverlay(pane);
    }
    s.toggles = Array.prototype.slice.call(document.querySelectorAll("[data-sb-window-toggle][aria-controls='" + id + "']"));
    return s;
  }
  function isOverlay(pane) { return getComputedStyle(pane).position === "absolute"; }
  function focusInto(pane) {
    var el = pane.querySelector("[role='treeitem'][tabindex='0'], [role='option'][tabindex='0'], [aria-current]:not([aria-current='false']), a[href], button:not([disabled]), input:not([disabled]), [tabindex='0']");
    if (el) el.focus({ preventScroll: true });
  }
  function setPane(s, open, how, stay) {   // stay: a menu command opened it, focus stays where the menu put it (D95 (b))
    // a pane that hides while it holds focus gives focus to its visible toggle (NV-J; provisional, agent), so focus
    // never falls to the page; a menu item that hid it keeps focus where the menu puts it
    var held = !open && !s.pane.hidden && s.pane.contains(document.activeElement);
    s.pane.hidden = !open;
    if (held) {
      var tool = s.toggles.filter(function (b) { return b.hasAttribute("aria-expanded") && shown(b); })[0];
      if (tool) tool.focus({ preventScroll: true });
    }
    s.toggles.forEach(function (b) { b.setAttribute(b.getAttribute("role") === "menuitemcheckbox" ? "aria-checked" : "aria-expanded", String(open)); });
    if (how === "user" && !s.overlay) s.want = open;
    if (open && s.overlay && how === "user") {
      s.pane.classList.remove("sb-enter"); void s.pane.offsetWidth; s.pane.classList.add("sb-enter");
      if (!stay) focusInto(s.pane);
    }
    updateDividers(s.pane);   // F3a: the dividers say „zugeklappt“ or the width, the open panes share the room again
  }
  function closeOverlay(s, focusToggle) {
    setPane(s, false, "auto");
    var back = s.toggles.filter(function (b) { return b.hasAttribute("aria-expanded"); })[0];
    if (focusToggle && back) back.focus({ preventScroll: true });
  }
  function relayout(win) {
    win.querySelectorAll("[data-sb-window-toggle][aria-controls]").forEach(function (b) {
      var s = paneState(b.getAttribute("aria-controls"));
      if (!s) return;
      var now = isOverlay(s.pane);
      if (now === s.overlay && s.seen) return;
      s.seen = true;
      if (now && !s.overlay) setPane(s, false, "auto");        // no room beside the content: the side part goes first
      else if (now && !s.pane.hidden) setPane(s, false, "auto"); // first look: an overlay never starts open
      else if (!now && s.overlay) setPane(s, s.want, "auto");   // room again: the pane comes back as the user left it
      s.overlay = now;
    });
  }
  document.addEventListener("animationend", function (event) {
    if (event.target instanceof Element && event.target.matches(".sb-window__sidebar, .sb-window__inspector")) event.target.classList.remove("sb-enter");
  });

  // ------------------------------------------------------------------ list selection (D67 (8), D72)
  function options(lb) {
    return Array.prototype.slice.call(lb.querySelectorAll("[role='option']")).filter(function (o) { return !o.hidden; });
  }
  function multi(lb) { return lb.getAttribute("aria-multiselectable") === "true"; }
  function chosen(lb) { return options(lb).filter(function (o) { return o.getAttribute("aria-selected") === "true"; }); }
  function setCurrent(lb, opt) {
    options(lb).forEach(function (o) {
      o.tabIndex = o === opt ? 0 : -1;
      if (multi(lb)) { if (o === opt) o.setAttribute("aria-current", "true"); else o.removeAttribute("aria-current"); }
    });
    if (opt) opt.focus();
  }
  function choose(lb, list, keepOthers) {
    options(lb).forEach(function (o) {
      if (list.indexOf(o) >= 0) o.setAttribute("aria-selected", "true");
      else if (!keepOthers) o.setAttribute("aria-selected", "false");
    });
    announce(lb);
  }
  function range(lb, a, b) {
    var all = options(lb), i = all.indexOf(a), j = all.indexOf(b);
    if (i < 0) i = j;
    return all.slice(Math.min(i, j), Math.max(i, j) + 1);
  }
  function announce(lb) {
    var status = document.getElementById(lb.getAttribute("data-sb-selection-status") || "");
    var n = chosen(lb).length;
    if (status) {
      if (!status.hasAttribute("data-sb-text")) status.setAttribute("data-sb-text", status.textContent);
      status.textContent = multi(lb) && n > 1 ? t(status, "selected", { n: n }) : status.getAttribute("data-sb-text");
    }
    lb.dispatchEvent(new CustomEvent("sb-selection-change", { bubbles: true, detail: { count: n } }));
  }
  function listKey(event, lb, opt) {
    var all = options(lb), i = all.indexOf(opt), next = null, m = multi(lb);
    switch (event.key) {
      case "ArrowDown": next = all[Math.min(i + 1, all.length - 1)]; break;
      case "ArrowUp": next = all[Math.max(i - 1, 0)]; break;
      case "Home": next = all[0]; break;
      case "End": next = all[all.length - 1]; break;
      case " ":
        if (m) choose(lb, opt.getAttribute("aria-selected") === "true" ? chosen(lb).filter(function (o) { return o !== opt; }) : chosen(lb).concat(opt));
        else choose(lb, [opt]);
        event.preventDefault(); return;
      case "Escape":
        if (m && chosen(lb).length > 1) { choose(lb, [opt]); lb._sbAnchor = opt; event.preventDefault(); }
        return;
      default:
        if (m && (event.key === "a" || event.key === "A") && modKey(event)) { choose(lb, all); event.preventDefault(); }
        return;
    }
    event.preventDefault();
    if (!next) return;
    if (m && event.shiftKey) choose(lb, range(lb, lb._sbAnchor || opt, next));
    else { choose(lb, [next]); lb._sbAnchor = next; }
    setCurrent(lb, next);
  }
  function listClick(event, lb, opt) {
    var m = multi(lb);
    if (m && modKey(event)) {
      var on = opt.getAttribute("aria-selected") === "true";
      choose(lb, on ? chosen(lb).filter(function (o) { return o !== opt; }) : chosen(lb).concat(opt));
      lb._sbAnchor = opt;
    } else if (m && event.shiftKey) choose(lb, range(lb, lb._sbAnchor || opt, opt));
    else { choose(lb, [opt]); lb._sbAnchor = opt; }
    setCurrent(lb, opt);
  }

  // ------------------------------------------------------------------ Hell oder Dunkel in the menu „Darstellung“ (D75)
  function themeChoice() { return root.dataset.theme === "light" || root.dataset.theme === "dark" ? root.dataset.theme : "system"; }
  function syncTheme() {
    var c = themeChoice();
    document.querySelectorAll("[data-sb-theme-choice]").forEach(function (el) {
      var on = el.getAttribute("data-sb-theme-choice") === c;
      if (el.tagName === "INPUT") el.checked = on;   // the radios of the settings view (F10a) carry no aria-checked
      else el.setAttribute("aria-checked", String(on));
    });
  }
  function applyTheme(choice) {
    try {
      if (choice === "light" || choice === "dark") { root.dataset.theme = choice; localStorage.setItem("sb-theme", choice); }
      else { delete root.dataset.theme; localStorage.removeItem("sb-theme"); }
    } catch (e) { if (choice === "light" || choice === "dark") root.dataset.theme = choice; else delete root.dataset.theme; }
    syncTheme();
    var shown = root.dataset.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.dispatchEvent(new CustomEvent("sb-theme-change", { detail: { theme: shown, choice: themeChoice() } }));
  }
  document.addEventListener("sb-theme-change", syncTheme);

  // ------------------------------------------------------------------ command palette (D67 (4), D84)
  function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function paletteInput(pal) { return pal.querySelector(".sb-command-palette__search input"); }
  function paletteOptions(pal) { return Array.prototype.slice.call(pal.querySelectorAll("[role='option']")); }
  function syncChecks(pal) {
    var c = themeChoice();
    paletteOptions(pal).forEach(function (o) {
      if (!o.hasAttribute("aria-checked")) return;
      if (o.hasAttribute("data-sb-theme-choice")) { o.setAttribute("aria-checked", String(o.getAttribute("data-sb-theme-choice") === c)); return; }
      var target = document.getElementById(o.getAttribute("data-sb-palette-click") || "");
      if (!target) return;
      var state = target.getAttribute("aria-expanded") || target.getAttribute("aria-pressed") || target.getAttribute("aria-checked");
      if (state) o.setAttribute("aria-checked", String(state === "true"));
    });
  }
  function activate(pal, opt) {
    var input = paletteInput(pal);
    paletteOptions(pal).forEach(function (o) { o.setAttribute("aria-selected", String(o === opt)); });
    if (input) { if (opt) input.setAttribute("aria-activedescendant", opt.id); else input.removeAttribute("aria-activedescendant"); }
    if (opt && opt.scrollIntoView) opt.scrollIntoView({ block: "nearest" });
  }
  // D102 (6): the letters of the name a search matched carry body-strong weight, no fill (.sb-command-palette__hit);
  // the name's text is kept in _sbText and written again on every filter. A name whose only markup is marks (a
  // static specimen's hand-written ones) or sb-fit.js's hyphen spans is taken as its text (review of the desktop lane,
  // DSK-R8); a name with other markup of its own is left alone
  var MARKS_ONLY = ".sb-command-palette__hit, span[data-sb-fit-word], span[data-sb-fit-text]";
  function markHits(name, words) {
    if (name._sbText == null) {
      if (Array.prototype.some.call(name.querySelectorAll("*"), function (c) { return !c.matches(MARKS_ONLY); })) return;
      name._sbText = name.textContent;
    }
    var text = name._sbText, low = norm(text), marks = [];
    if (low.length !== text.length) { name.textContent = text; return; }   // a letter normalises to several: no marks
    words.forEach(function (w) { var i = low.indexOf(w); if (i >= 0) marks.push([i, i + w.length]); });
    marks.sort(function (a, b) { return a[0] - b[0]; });
    name.textContent = "";
    var at = 0;
    marks.forEach(function (m) {
      var from = Math.max(m[0], at);
      if (from >= m[1]) return;
      if (from > at) name.appendChild(document.createTextNode(text.slice(at, from)));
      var b = document.createElement("b");
      b.className = "sb-command-palette__hit";
      b.textContent = text.slice(from, m[1]);
      name.appendChild(b);
      at = m[1];
    });
    if (at < text.length) name.appendChild(document.createTextNode(text.slice(at)));
    if (window.sbFit) window.sbFit.refresh(name);   // sb-fit.js hyphenates a word across a mark as one word (DSK-R4)
  }
  function filter(pal, query) {
    if (pal.hasAttribute("data-sb-fulltext")) { fulltextSearch(pal); return; }   // the app fills the list (D104 (1))
    var words = norm(query).split(/\s+/).filter(Boolean), first = null, byName = null, count = 0;
    pal.querySelectorAll(".sb-command-palette__section").forEach(function (sec) {
      var head = sec.querySelector(".sb-command-palette__group"), any = false;
      sec.querySelectorAll("[role='option']").forEach(function (o) {
        var name = o.querySelector(".sb-row__name"), own = norm(name ? name.textContent : o.textContent);
        if (name) markHits(name, words);
        var hay = own + " " + norm((o.getAttribute("data-sb-keywords") || "") + " " + (head ? head.textContent : ""));
        var ok = words.every(function (w) { return hay.indexOf(w) >= 0; });
        o.hidden = !ok;
        if (ok) {
          any = true; count++;
          if (!first) first = o;
          if (!byName && words.length && words.every(function (w) { return own.indexOf(w) >= 0; })) byName = o;
        }
      });
      sec.hidden = !any;
    });
    var empty = pal.querySelector(".sb-command-palette__empty");
    if (empty) empty.textContent = count ? "" : t(empty, "noMatch", { q: query.trim() });
    activate(pal, byName || first);   // a match in the name goes before a match in keywords or the group head
  }
  function wirePalette(dlg) {
    if (dlg._sbWired) return;
    dlg._sbWired = true;
    dlg.addEventListener("close", function () {
      var from = dlg._sbFrom, active = document.activeElement;
      if (from && document.contains(from) && (!active || active === document.body || dlg.contains(active))) from.focus({ preventScroll: true });
    });
    dlg.addEventListener("click", function (event) { if (event.target === dlg) dlg.close(); });   // the backdrop
  }
  function openPalette(dlg, from) {
    if (!dlg || typeof dlg.showModal !== "function") return;
    wirePalette(dlg);
    dlg._sbFrom = from && from !== document.body ? from : null;
    var moveTree = document.getElementById(dlg.getAttribute("data-sb-move-palette") || "");
    if (moveTree) {   // the folder picker takes its row now, before the palette has the keyboard (D102 (17))
      dlg._sbRow = commandRow(moveTree);
      var area = windowOf(moveTree) && windowOf(moveTree)._sbArea;
      dlg._sbTreeHad = !!(dlg._sbRow && area && area._sbLast === dlg._sbRow);
    }
    var input = paletteInput(dlg);
    if (input) input.value = "";
    syncChecks(dlg);
    renderKeys(dlg);
    filter(dlg, "");
    if (!dlg.open) dlg.showModal();
    if (input) input.focus();
  }
  // spec/02 §4.16 (provisional, agent): an overlay's own shortcut closes it again, the shortcut of another overlay switches to
  // that one. The openers are the controls that announce the chord in aria-keyshortcuts and open a palette
  // (data-sb-palette-open) or a find bar (data-sb-find-open), in the window the palette came from, else on the page
  function overlayKey(event, pal) {
    var chord = eventChord(event), from = pal._sbFrom, scope = (from && windowOf(from)) || document;
    var openers = Array.prototype.filter.call(scope.querySelectorAll("[aria-keyshortcuts]:is([data-sb-palette-open], [data-sb-find-open])"), function (el) {
      return !el.closest(".sb-command-palette") && !el.disabled && el.getAttribute("aria-disabled") !== "true" &&
        el.getAttribute("aria-keyshortcuts").trim().split(/\s+/).some(function (x) { return canon(x) === chord; });
    });
    var el = openers.filter(shown)[0] || openers[0];
    if (!el) return false;
    event.preventDefault();
    var back = from && document.contains(from) ? from : el;
    pal.close();   // focus goes back to where the palette came from
    if (el.hasAttribute("data-sb-palette-open")) {
      var id = el.getAttribute("data-sb-palette-open"), next = id ? document.getElementById(id) : document.querySelector("dialog.sb-command-palette");
      if (next && next !== pal) openPalette(next, back);   // its own shortcut only closes it
    } else {
      var bar = findBar(el.getAttribute("data-sb-find-open"));
      if (bar) findOpen(bar, back, el.getAttribute("data-sb-find-mode"));
    }
    return true;
  }
  // „Nächster Bereich“ / „Vorheriger Bereich“ from a menu item or a palette option (data-sb-area): count from the area
  // that had focus before the menu or palette opened (spec/02 §4.20), not from the title bar that holds „Menü“
  function runArea(el, near) {
    var win = windowOf(near);
    if (!win) return;
    var start = el.closest(".sb-menu, .sb-command-palette") && win._sbArea && shown(win._sbArea) ? win._sbArea : null;
    moveArea(win, el.getAttribute("data-sb-area") === "previous", start);
  }
  function runOption(pal, opt) {
    if (!opt) return;
    if (pal.tagName === "DIALOG" && pal.open) pal.close();
    if (opt.hasAttribute("data-sb-move-to")) movePick(pal, opt);
    if (opt.hasAttribute("data-sb-palette-open")) {   // an option that opens another palette (the folder picker, a pick mode)
      var next = document.getElementById(opt.getAttribute("data-sb-palette-open"));
      if (next && next !== pal) openPalette(next, pal._sbFrom || null);
    }
    if (opt.hasAttribute("data-sb-tab-move")) runTabMove(opt, pal._sbFrom || opt);
    if (opt.hasAttribute("data-sb-area")) runArea(opt, pal._sbFrom || opt);
    if (opt.hasAttribute("data-sb-theme-choice")) applyTheme(opt.getAttribute("data-sb-theme-choice"));
    var target = document.getElementById(opt.getAttribute("data-sb-palette-click") || "");
    if (target) target.click();
    opt.dispatchEvent(new CustomEvent("sb-command", { bubbles: true, detail: { command: opt.getAttribute("data-sb-command") || "", option: opt } }));
    syncChecks(pal);
  }
  function paletteKey(event, pal) {
    var list = paletteOptions(pal).filter(function (o) { return !o.hidden; });
    var cur = list.filter(function (o) { return o.getAttribute("aria-selected") === "true"; })[0];
    var i = list.indexOf(cur);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!list.length) return;
      var step = event.key === "ArrowDown" ? 1 : -1;
      activate(pal, list[(i + step + list.length) % list.length]);
      event.preventDefault();
    } else if (event.key === "Enter") {
      runOption(pal, cur);
      event.preventDefault();
    }
  }

  // ------------------------------------------------------------------ full-text search in the palette (D104 (1), (2), (4))
  // The app searches and fills the list; the script names what to search for and says „Suche läuft …“ after 1 s
  // without an option while the list is busy (spec/02 §4.25.1, D102 (26): no spinner)
  var WAIT_MS = 1000;
  function fulltextSearch(pal) {
    var input = paletteInput(pal), opts = {};
    pal.querySelectorAll("[data-sb-search-option]").forEach(function (c) {
      opts[c.getAttribute("data-sb-search-option")] = c.getAttribute("aria-pressed") === "true";
    });
    pal.dispatchEvent(new CustomEvent("sb-search", { bubbles: true, detail: {
      query: input ? input.value : "", matchCase: !!opts["case"], regex: !!opts.regex } }));
  }
  function fulltextWait(pal) {
    var list = pal.querySelector(".sb-command-palette__list"), empty = pal.querySelector(".sb-command-palette__empty");
    if (!list || !empty) return;
    var busy = list.getAttribute("aria-busy") === "true", any = paletteOptions(pal).some(function (o) { return !o.hidden; });
    var waiting = t(empty, "searching");
    if (busy && !any) {
      if (!pal._sbWait && empty.textContent !== waiting) {
        pal._sbWait = setTimeout(function () {
          pal._sbWait = 0;
          var still = list.getAttribute("aria-busy") === "true" && !paletteOptions(pal).some(function (o) { return !o.hidden; });
          if (still) empty.textContent = waiting;
        }, WAIT_MS);
      }
      return;
    }
    if (pal._sbWait) { clearTimeout(pal._sbWait); pal._sbWait = 0; }
    if (empty.textContent === waiting) empty.textContent = "";
    if (any && !paletteOptions(pal).some(function (o) { return o.getAttribute("aria-selected") === "true" && !o.hidden; })) {
      activate(pal, paletteOptions(pal).filter(function (o) { return !o.hidden; })[0]);
    }
  }
  function watchFulltext(pal) {
    if (pal._sbFulltext || typeof MutationObserver !== "function") return;
    pal._sbFulltext = new MutationObserver(function () { fulltextWait(pal); });
    pal._sbFulltext.observe(pal, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy", "hidden"] });
    fulltextWait(pal);
  }

  // ------------------------------------------------------------------ find bar over the text (D104 (3))
  // Marks the hits of a rendered text (a page, a preview, a viewer) as mark.sb-mark (spec/02 §3.1b: the fill is for
  // rendered text); an editor (CodeMirror) draws its own hits as the 1 px frame of D102 (30) and only uses the bar
  function findBar(id) { var b = document.getElementById(id || ""); return b && b.classList.contains("sb-find-bar") ? b : null; }
  function findInput(bar) { return bar.querySelector("[data-sb-find-row='find'] input, .sb-find-bar__row:not([data-sb-find-row]) input"); }
  function findTarget(bar) { return document.getElementById(bar.getAttribute("data-sb-find-target") || ""); }
  function findRow(bar, name) { return bar.querySelector("[data-sb-find-row='" + name + "']"); }
  function unmark(bar) {
    (bar._sbHits || []).forEach(function (m) {
      var parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    bar._sbHits = [];
    bar._sbAt = -1;
  }
  function findCount(bar) {
    var out = bar.querySelector(".sb-doc-bar__count"), input = findInput(bar), hits = bar._sbHits || [];
    if (!out) return;
    out.textContent = !input || !input.value ? "" : hits.length ? t(out, "findCount", { n: bar._sbAt + 1, m: hits.length }) : t(out, "findNone");
  }
  function findShow(bar, at) {
    var hits = bar._sbHits || [];
    if (!hits.length) { findCount(bar); return; }
    bar._sbAt = (at + hits.length) % hits.length;
    hits.forEach(function (m, i) { if (i === bar._sbAt) m.setAttribute("aria-current", "true"); else m.removeAttribute("aria-current"); });
    var cur = hits[bar._sbAt];
    if (cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
    findCount(bar);
  }
  function findRun(bar) {
    unmark(bar);
    var input = findInput(bar), target = findTarget(bar), q = input ? input.value : "";
    if (!target || !q) { findCount(bar); return; }
    var low = q.toLowerCase(), nodes = [], walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentElement;
        return p && !p.closest(".sb-find-bar, script, style, .sb-visually-hidden, [hidden]") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    var hits = [];
    nodes.forEach(function (node) {
      var text = node.nodeValue, lowText = text.toLowerCase();
      if (lowText.length !== text.length) return;   // a letter that changes its length in lower case: left out
      var at = lowText.indexOf(low), from = 0, frag = null;
      while (at >= 0) {
        frag = frag || document.createDocumentFragment();
        if (at > from) frag.appendChild(document.createTextNode(text.slice(from, at)));
        var m = document.createElement("mark");
        m.className = "sb-mark";
        m.setAttribute("data-sb-find-hit", "");
        m.textContent = text.slice(at, at + q.length);
        frag.appendChild(m);
        hits.push(m);
        from = at + q.length;
        at = lowText.indexOf(low, from);
      }
      if (!frag) return;
      if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
      node.parentNode.replaceChild(frag, node);
    });
    bar._sbHits = hits;
    bar._sbAt = -1;
    findShow(bar, 0);
  }
  function findMode(bar, mode) {
    ["find", "replace", "line"].forEach(function (name) {
      var row = findRow(bar, name);
      if (!row) return;
      row.hidden = mode === "line" ? name !== "line" : name === "line" || (name === "replace" && mode !== "replace");
    });
    bar.setAttribute("data-sb-find-mode", mode);
    var focus = mode === "line" ? findRow(bar, "line") && findRow(bar, "line").querySelector("input")
      : mode === "replace" ? findRow(bar, "replace") && findRow(bar, "replace").querySelector("input") : findInput(bar);
    if (focus) { focus.focus(); if (typeof focus.select === "function") focus.select(); }
  }
  // „von n“ follows the document while the row is open: the app writes the new count into data-sb-lines, and the
  // suffix and a shown range error follow (spec/02 §4.25.2)
  function findLines(bar) {
    var row = findRow(bar, "line"), max = parseInt(bar.getAttribute("data-sb-lines"), 10);
    if (!row || !isFinite(max)) return;
    var suffix = row.querySelector(".sb-field__suffix"), err = row.querySelector(".sb-field__error");
    // line numbers without a thousands separator (D105 (45)): the number goes in as text
    if (suffix) suffix.textContent = t(suffix, "lineOf", { m: String(max) });
    if (err && !err.hidden) (err.querySelector("span") || err).textContent = t(err, "lineRange", { m: String(max) });
  }
  function findOpen(bar, from, mode) {
    bar._sbFrom = from && from !== document.body && !bar.contains(from) ? from : bar._sbFrom || null;
    if (!bar._sbLines && typeof MutationObserver === "function") {
      bar._sbLines = new MutationObserver(function () { findLines(bar); });
      bar._sbLines.observe(bar, { attributes: true, attributeFilter: ["data-sb-lines"] });
    }
    findLines(bar);   // a count written before the first open (or while the bar was hidden) is not stale either
    var was = bar.hidden;
    bar.hidden = false;
    findMode(bar, mode || (was ? "find" : bar.getAttribute("data-sb-find-mode") || "find"));
    if (was && (mode || "find") === "find") findRun(bar);
  }
  function findClose(bar) {
    unmark(bar);
    bar.hidden = true;
    var line = findRow(bar, "line"), err = line && line.querySelector(".sb-field__error");
    if (err) err.hidden = true;
    if (line) line.querySelectorAll("[aria-invalid]").forEach(function (i) { i.removeAttribute("aria-invalid"); });
    var back = bar._sbFrom && document.contains(bar._sbFrom) ? bar._sbFrom : findTarget(bar);
    if (back) {
      if (!back.matches(TABBABLE) && !back.hasAttribute("tabindex")) back.setAttribute("tabindex", "-1");
      back.focus({ preventScroll: true });
    }
  }
  function findReplace(bar, all) {
    var row = findRow(bar, "replace"), field = row && row.querySelector("input"), input = findInput(bar);
    var hits = bar._sbHits || [];
    if (!field || !input || !hits.length) return;
    var ok = bar.dispatchEvent(new CustomEvent("sb-find-replace", { bubbles: true, cancelable: true,
      detail: { query: input.value, replacement: field.value, all: !!all, index: bar._sbAt } }));
    if (!ok) return;   // the app (an editor) replaced it
    var at = bar._sbAt < 0 ? 0 : bar._sbAt, done = all ? hits.slice() : [hits[at]];
    done.forEach(function (m) {   // the replaced words are text again; findRun marks the hits that are left anew
      var parent = m.parentNode;
      parent.replaceChild(document.createTextNode(field.value), m);
      parent.normalize();
    });
    bar._sbHits = hits.filter(function (m) { return done.indexOf(m) < 0; });
    findRun(bar);
    if (!all && bar._sbHits.length) findShow(bar, at);
  }
  function findLine(bar) {
    var row = findRow(bar, "line"), input = row && row.querySelector("input"), err = row && row.querySelector(".sb-field__error");
    if (!input) return;
    var max = parseInt(bar.getAttribute("data-sb-lines"), 10), v = input.value.trim(), n = /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
    if (!(n >= 1) || (isFinite(max) && n > max)) {
      input.setAttribute("aria-invalid", "true");
      if (err) {
        var words = err.querySelector("span") || err;
        words.textContent = t(err, "lineRange", { m: String(isFinite(max) ? max : 1) });
        err.hidden = false;
        if (err.id) input.setAttribute("aria-describedby", err.id);
      }
      input.focus();
      if (typeof input.select === "function") input.select();
      return;
    }
    input.removeAttribute("aria-invalid");
    if (err) err.hidden = true;
    bar.dispatchEvent(new CustomEvent("sb-find-line", { bubbles: true, detail: { line: n } }));
    findClose(bar);
  }
  function findKey(event, bar) {
    if (event.key === "Escape") { event.preventDefault(); findClose(bar); return true; }
    if (event.key !== "Enter" || !(event.target instanceof Element) || !event.target.matches("input")) return false;
    var row = event.target.closest("[data-sb-find-row]"), name = row ? row.getAttribute("data-sb-find-row") : "find";
    event.preventDefault();
    if (name === "line") findLine(bar);
    else if (name === "replace") findReplace(bar, false);
    else findShow(bar, (bar._sbAt < 0 ? 0 : bar._sbAt) + (event.shiftKey ? -1 : 1));
    return true;
  }
  function findClick(event) {
    var open = closestIn(event, "[data-sb-find-open]");
    if (open) {
      var b = findBar(open.getAttribute("data-sb-find-open"));
      if (b) { event.preventDefault(); findOpen(b, document.activeElement && document.activeElement !== document.body ? document.activeElement : open, open.getAttribute("data-sb-find-mode")); }
      return;
    }
    var bar = closestIn(event, ".sb-find-bar");   // the „Mehr“ menu stands inside the bar
    if (!bar) return;
    var mode = closestIn(event, "[data-sb-find-mode]");
    if (mode && mode !== bar) { findMode(bar, mode.getAttribute("data-sb-find-mode")); return; }
    var cmd = closestIn(event, "[data-sb-find]");
    if (!cmd) return;
    var what = cmd.getAttribute("data-sb-find");
    if (what === "next" || what === "previous") findShow(bar, (bar._sbAt < 0 ? 0 : bar._sbAt) + (what === "next" ? 1 : -1));
    else if (what === "close") findClose(bar);
    else if (what === "replace" || what === "replace-all") findReplace(bar, what === "replace-all");
    else if (what === "line") findLine(bar);
  }

  // ------------------------------------------------------------------ the document reader (D104 (5)–(7))
  // Steps of the zoom (provisional, agent: the browsers' steps), the value as a status, the page as a field
  var ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];
  function readerNum(reader, name, fallback) { var v = parseInt(reader.getAttribute(name), 10); return isFinite(v) ? v : fallback; }
  function readerSync(reader, fire) {
    var pages = readerNum(reader, "data-sb-pages", 1), page = Math.min(Math.max(readerNum(reader, "data-sb-page", 1), 1), pages);
    var zoom = readerNum(reader, "data-sb-zoom", 100), fit = reader.hasAttribute("data-sb-reader-fit");
    reader.setAttribute("data-sb-page", String(page));
    var field = reader.querySelector("[data-sb-reader-page]");
    if (field && document.activeElement !== field) field.value = String(page);
    else if (field && fire) field.value = String(page);
    reader.querySelectorAll("[data-sb-reader-command]").forEach(function (b) {
      var c = b.getAttribute("data-sb-reader-command"), off =
        c === "previous" ? page <= 1 : c === "next" ? page >= pages :
        c === "zoom-out" ? zoom <= ZOOM_STEPS[0] : c === "zoom-in" ? zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1] : false;
      b.setAttribute("aria-disabled", String(off));
      if (c === "fit") b.setAttribute("aria-pressed", String(fit));
    });
    var value = reader.querySelector("[data-sb-reader-zoom-value]");
    if (value) {
      var text = t(value, "zoomValue", { z: zoom });
      if (value.textContent !== text) value.textContent = text;
    }
    var view = reader.querySelector(".sb-reader__view");
    if (view) view.style.setProperty("--sb-reader-zoom", String(zoom / 100));
    reader.querySelectorAll("[data-sb-reader-sheet]").forEach(function (s) {
      s.hidden = parseInt(s.getAttribute("data-sb-reader-sheet"), 10) !== page;
    });
    if (fire) reader.dispatchEvent(new CustomEvent("sb-reader-change", { bubbles: true, detail: { page: page, zoom: zoom, fit: fit } }));
  }
  function readerFit(reader) {
    var view = reader.querySelector(".sb-reader__view"), sheet = reader.querySelector("[data-sb-reader-sheet]:not([hidden])") || reader.querySelector(".sb-reader__sheet");
    if (!view || !sheet) return readerNum(reader, "data-sb-zoom", 100);
    var cs = getComputedStyle(view), room = view.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    var now = readerNum(reader, "data-sb-zoom", 100) / 100, natural = sheet.getBoundingClientRect().width / (now || 1);
    return natural > 0 ? Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.floor(room / natural * 100))) : 100;
  }
  function readerCommand(reader, c) {
    var page = readerNum(reader, "data-sb-page", 1), zoom = readerNum(reader, "data-sb-zoom", 100);
    if (c === "previous" || c === "next") reader.setAttribute("data-sb-page", String(page + (c === "next" ? 1 : -1)));
    else if (c === "zoom-in" || c === "zoom-out") {
      var next = c === "zoom-in" ? ZOOM_STEPS.filter(function (z) { return z > zoom; })[0] : ZOOM_STEPS.filter(function (z) { return z < zoom; }).pop();
      if (next == null) return;
      reader.removeAttribute("data-sb-reader-fit");
      reader.setAttribute("data-sb-zoom", String(next));
    } else if (c === "fit") {
      reader.setAttribute("data-sb-zoom", String(readerFit(reader)));
      reader.setAttribute("data-sb-reader-fit", "");
    }
    readerSync(reader, true);
  }
  function readerGo(reader, field) {
    var pages = readerNum(reader, "data-sb-pages", 1), v = field.value.trim(), n = /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
    if (n >= 1 && n <= pages) { reader.setAttribute("data-sb-page", String(n)); readerSync(reader, true); }
    else field.value = reader.getAttribute("data-sb-page") || "1";   // the field shows the page that is shown
    if (typeof field.select === "function") field.select();
  }
  function readerKey(event, reader) {
    var field = event.target instanceof Element && event.target.matches("[data-sb-reader-page]") ? event.target : null;
    if (field && event.key === "Enter") { event.preventDefault(); readerGo(reader, field); return true; }
    if ((event.key === "PageDown" || event.key === "PageUp") && !event.altKey && !event.ctrlKey && !event.metaKey &&
        event.target instanceof Element && event.target.closest(".sb-reader__view") && !isTextField(event.target)) {
      var c = event.key === "PageDown" ? "next" : "previous", b = reader.querySelector("[data-sb-reader-command='" + c + "']");
      event.preventDefault();
      if (!b || b.getAttribute("aria-disabled") !== "true") readerCommand(reader, c);
      return true;
    }
    return false;
  }
  function readerClick(event) {
    var b = closestIn(event, "[data-sb-reader-command]"), reader = b && b.closest(".sb-reader");
    if (!reader) return;
    if (b.getAttribute("aria-disabled") === "true") return;
    readerCommand(reader, b.getAttribute("data-sb-reader-command"));
  }

  // ------------------------------------------------------------------ the window and its areas (F6a, F9a, F10a)
  function shown(el) { return !!el && !el.hidden && el.getClientRects().length > 0; }
  function inView(el) {   // some part of it inside the window (sb-menu.js closes the menu when none is)
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < document.documentElement.clientWidth;
  }
  function windowOf(el) {
    var win = el instanceof Element ? el.closest(".sb-window") : null;
    if (win) return win;
    var fill = document.querySelectorAll(".sb-window--fill");   // focus on the page itself: the product's one window
    return fill.length === 1 ? fill[0] : null;
  }
  function isWindowMenuButton(el) {   // „Menü“: the button of a window menu (.sb-menu--window)
    if (!(el instanceof Element) || !el.matches("[aria-haspopup='menu']")) return false;
    var menu = document.getElementById(el.getAttribute("popovertarget") || el.getAttribute("aria-controls") || "");
    return !!menu && menu.classList.contains("sb-menu--window");
  }
  function isTextField(el) {
    return el instanceof Element && (el.isContentEditable ||
      el.matches("input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='range']), textarea, select"));
  }
  var AREA = ".sb-window__titlebar, .sb-window__sidebar, .sb-window__content, .sb-window__inspector, .sb-window > .sb-bottom-block";
  // an editor (contenteditable, e.g. CodeMirror) counts as a control (spec/02 §4.20); an element with tabindex -1 does not
  // (spec/02 §4.20): roving tab stops (tabs, tree rows, list rows) are entered on their one tabindex 0, the current tab
  var NOT_ROVING = ":not([tabindex='-1'])";
  var TABBABLE = ["a[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])", "select:not([disabled])",
                  "textarea:not([disabled])", "[contenteditable]:not([contenteditable='false'])", "[tabindex]"]
                 .map(function (x) { return x + NOT_ROVING; }).join(", ");
  function areas(win) {
    var list = [win.querySelector(":scope > .sb-window__titlebar")];
    var body = win.querySelector(":scope > .sb-window__body");
    if (body) list = list.concat(Array.prototype.slice.call(body.querySelectorAll(":scope > .sb-window__sidebar, :scope > .sb-window__content, :scope > .sb-window__inspector")));
    list.push(win.querySelector(":scope > .sb-bottom-block"));
    return list.filter(shown);
  }
  function firstTabbable(area) {
    var all = area.querySelectorAll(TABBABLE);
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!shown(el)) continue;
      if (el.type === "radio" && !el.checked && el.name && el.form !== undefined) {   // a radio group is entered on its chosen radio
        var group = (el.form || document).querySelectorAll("input[type='radio'][name='" + CSS.escape(el.name) + "']");
        if (Array.prototype.some.call(group, function (r) { return r.checked; })) continue;
      }
      return el;
    }
    return null;
  }
  // F6 / ⇧F6: area by area, back to where focus was in each (spec/02 §4.20). from: the area to count from; „Nächster
  // Bereich“ in a menu or the palette counts from the area that had focus before the menu or palette opened (spec/02 §4.20),
  // not from the title bar that holds „Menü“
  function moveArea(win, back, from) {
    var list = areas(win);
    if (!list.length) return;
    var at = from ? list.indexOf(from) : -1;
    if (!from) list.forEach(function (a, i) { if (a.contains(document.activeElement)) at = i; });
    var next = list[at < 0 ? (back ? list.length - 1 : 0) : (at + (back ? -1 : 1) + list.length) % list.length];
    var target = next._sbLast && next.contains(next._sbLast) && shown(next._sbLast) && next._sbLast.matches(TABBABLE + ", [tabindex='-1']") ? next._sbLast : firstTabbable(next);
    if (!target) {   // an area with nothing to press (a text): the area itself takes focus and shows the ring
      if (!next.hasAttribute("tabindex")) next.setAttribute("tabindex", "-1");
      target = next;
    }
    target.focus();
  }
  document.addEventListener("focusin", function (event) {
    var el = event.target;
    if (!(el instanceof Element)) return;
    var area = el.closest(AREA);
    if (area && el !== area && !el.closest(".sb-menu[popover], .sb-tooltip")) area._sbLast = el;
    // the area the user works in: not „Menü“, a menu, the palette or another dialog, which only pass through (spec/02 §4.20)
    var win = area && windowOf(area);
    if (win && !el.closest(".sb-menu[popover], .sb-tooltip, dialog") && !isWindowMenuButton(el)) win._sbArea = area;
    revealInSideNav(el);
  });
  // a sidebar with a foot (spec/02 §4.17): the upper block scrolls by itself, so the row that gets focus (also one a
  // virtualiser focused without scrolling) could lie under the foot or inside the tree's own scroller. Every scroller
  // from the row up to the block scrolls, innermost first, by the least amount that shows the row in it; the block
  // also shows the bottom edge of the scroller just inside it, as far as its height allows (block: "nearest"). Only
  // these scroll, never the page or the content (review r13: moving the block alone could not uncover a row clipped
  // inside the tree's scroller)
  function revealInSideNav(el) {
    var block = el.closest(".sb-side-nav__scroll");
    if (!block || el === block) return;
    var outer = null;
    for (var up = el.parentElement; up; up = up.parentElement) {
      var oy = getComputedStyle(up).overflowY;
      var scroller = up === block || ((oy === "auto" || oy === "scroll") && up.scrollHeight > up.clientHeight);
      if (scroller) {
        var b = up.getBoundingClientRect(), r = el.getBoundingClientRect();
        var bottom = up === block && outer ? Math.max(r.bottom, outer.getBoundingClientRect().bottom) : r.bottom;
        var top = b.top + up.clientTop, end = top + up.clientHeight;
        var delta = 0;
        if (bottom > end) delta = Math.min(bottom - end, r.top - top);
        else if (r.top < top) delta = r.top - top;
        if (delta) up.scrollTop += delta;
        if (up !== block) outer = up;
      }
      if (up === block) break;
    }
  }
  // F9a: a window that is not in front lets its path recede (sebaro.css); the attribute is absent while in front
  window.addEventListener("blur", function () { root.setAttribute("data-sb-window-active", "false"); });
  window.addEventListener("focus", function () { root.removeAttribute("data-sb-window-active"); });

  // ------------------------------------------------------------------ fixed shortcuts (F5a; spec/02 §4.19)
  // The chords the script presses through the control that announces them (aria-keyshortcuts, macOS form in the
  // markup). ⌘K, F6, ⌃⇥ and ⌘W have their own code; ⌘Z, ⇧⌘Z and the clipboard belong to the text fields.
  var PRESSED = ["Meta+,", "Meta+N", "Meta+O", "Meta+F", "Control+Meta+S", "Alt+Meta+I", "Shift+Meta+N", "Meta+Backspace", "Meta+Plus", "Meta+Minus",
                 "Meta+ArrowLeft", "Meta+ArrowRight", "Control+Meta+ArrowLeft", "Control+Meta+ArrowRight"];
  // a text field keeps these chords on macOS (⌘⌫ deletes to the line start, ⌘← / ⌘→ go to the line's start and end);
  // there Zurück / Vor are ⌃⌘← / ⌃⌘→ (D102 (14)). Off macOS Entf stays the field's
  var FIELD_KEYS = ["Meta+Backspace", "Meta+ArrowLeft", "Meta+ArrowRight"];
  var HISTORY = ["Meta+ArrowLeft", "Meta+ArrowRight", "Control+Meta+ArrowLeft", "Control+Meta+ArrowRight"];   // Zurück / Vor
  var KEY_NAMES = { ",": "Comma", "+": "Plus", "=": "Plus", "-": "Minus", "−": "Minus", "Del": "Delete", "Esc": "Escape", " ": "Space", "Spacebar": "Space" };
  var ARIA_MODS = ["Control", "Alt", "Shift", "Meta"];
  function canon(chord) {
    var parts = chord.split("+"), key = parts.pop();
    if (key === "") { key = "+"; parts = parts.filter(Boolean); }   // "Meta++"
    key = KEY_NAMES[key] || (key.length === 1 ? key.toUpperCase() : key);
    var mods = ARIA_MODS.filter(function (m) { return parts.indexOf(m) >= 0; });
    if (key === "Plus" || key === "Minus") mods = mods.filter(function (m) { return m !== "Shift"; });   // „+“ needs ⇧ on some layouts
    return mods.concat([key]).join("+");
  }
  function eventChord(event) {
    var key = event.key;
    // ⌥ on macOS turns letters into other characters (⌥⌘I gives „ˆ“): take the letter from the key's position then
    if (event.altKey && /^Key[A-Z]$/.test(event.code || "") && !/^[a-z]$/i.test(key)) key = event.code.slice(3);
    var mods = [];
    if (event.ctrlKey) mods.push("Control");
    if (event.altKey) mods.push("Alt");
    if (event.shiftKey) mods.push("Shift");
    if (event.metaKey) mods.push("Meta");
    return canon(mods.concat([key]).join("+"));
  }
  function pressFixed(event, win) {
    var chord = eventChord(event), mac = isMac();
    var fixed = PRESSED.some(function (c) { return (mac ? [c] : otherAria(c).split(" ")).some(function (x) { return canon(x) === chord; }); });
    if (!fixed) return false;
    if (isTextField(event.target) && (chord === "Delete" || (mac && FIELD_KEYS.indexOf(chord) >= 0))) return false;   // the field's own key
    // a tab announces the keys that act on it while it has focus (Entf, ⌘W): those are not window keys
    var found = Array.prototype.filter.call(win.querySelectorAll("[aria-keyshortcuts]:not([role='tab'])"), function (el) {
      return !el.disabled && el.getAttribute("aria-disabled") !== "true" &&
        el.getAttribute("aria-keyshortcuts").trim().split(/\s+/).some(function (x) { return canon(x) === chord; });
    });
    var el = found.filter(shown)[0] || found[0];   // the visible tool first, else the item of the closed „Menü“
    if (!el) {
      // Zurück / Vor without a target (its control disabled) still take the chord, so ⌘← / Alt+← never fall through
      // to the browser's Back and leave the app (review of the desktop lane, DSK-R7); a window without the control
      // leaves the chord alone
      var backOrForward = HISTORY.some(function (c) { return (mac ? [c] : otherAria(c).split(" ")).some(function (x) { return canon(x) === chord; }); });
      var announced = Array.prototype.some.call(win.querySelectorAll("[aria-keyshortcuts]:not([role='tab'])"), function (x) {
        return x.getAttribute("aria-keyshortcuts").trim().split(/\s+/).some(function (k) { return canon(k) === chord; });
      });
      if (backOrForward && announced) { event.preventDefault(); return true; }
      return false;
    }
    event.preventDefault();
    if (el.matches("input, textarea")) { el.focus(); if (typeof el.select === "function") el.select(); }
    else el.click();
    return true;
  }

  // ------------------------------------------------------------------ dividers between window parts (F3a, F2a, D81)
  var CONTENT_MIN = 480, STEP = 8, STEP_BIG = 32, COLLAPSE_AT = 48;   // dragging 48 px under the smallest width collapses
  function dividerPane(d) { return document.getElementById(d.getAttribute("aria-controls") || ""); }
  function atEnd(d) { var p = dividerPane(d); return !!p && !!(d.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING); }
  function attrNum(el, name, fallback) { var v = parseInt(el.getAttribute(name), 10); return isFinite(v) ? v : fallback; }
  // the limits come from the pane tokens of tokens.css (--sb-x-sebaro-pane-sidebar / -inspector with -min, -max;
  // spec/02 §4.23); the markup's aria-valuemin / -max / -now win where a page sets them, and the script writes the ones it
  // lacks, so the separator always says its values
  function tokenNum(name, fallback) {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sb-x-sebaro-pane-" + name));
    return isFinite(v) ? Math.round(v) : fallback;
  }
  function dState(d) {
    if (!d._sb) {
      var p = dividerPane(d), side = p && p.classList.contains("sb-window__inspector") ? "inspector" : "sidebar";
      var def = side === "inspector" ? [240, 400, 280] : [200, 360, 240];
      var min = attrNum(d, "aria-valuemin", tokenNum(side + "-min", def[0]));
      var max = Math.max(min, attrNum(d, "aria-valuemax", tokenNum(side + "-max", def[1])));
      var start = Math.min(max, Math.max(min, attrNum(d, "aria-valuenow", tokenNum(side, def[2]))));
      d._sb = { min: min, max: max, start: start, width: start };
      if (!d.hasAttribute("aria-valuemin")) d.setAttribute("aria-valuemin", String(min));
      if (!d.hasAttribute("aria-valuemax")) d.setAttribute("aria-valuemax", String(max));
      if (!d.hasAttribute("aria-valuenow")) d.setAttribute("aria-valuenow", String(start));
    }
    return d._sb;
  }
  function clampW(s, w) { return Math.round(Math.min(s.max, Math.max(s.min, w))); }
  function storeKey(d) {
    var win = d.closest(".sb-window");
    return "sb-pane:" + ((win && (win.getAttribute("data-sb-window-id") || win.id)) || "") + ":" + d.getAttribute("aria-controls");
  }
  function loadWidth(d) { try { var v = parseInt(localStorage.getItem(storeKey(d)), 10); return isFinite(v) ? v : null; } catch (e) { return null; } }
  function saveWidth(d) { try { localStorage.setItem(storeKey(d), String(dState(d).width)); } catch (e) { /* not stored: the width holds until reload */ } }
  function dividersOf(win) {
    var body = win && win.querySelector(":scope > .sb-window__body");
    return body ? Array.prototype.slice.call(body.querySelectorAll(":scope > .sb-window__divider")) : [];
  }
  function showWidth(d, w) {
    var p = dividerPane(d);
    if (p) p.style.inlineSize = w + "px";
    d.setAttribute("aria-valuenow", String(w));
    d.setAttribute("aria-valuetext", t(d, "width", { n: w }));
    checkWidths(d);
  }
  // „Schmal · Normal · Breit“ (F3a, WCAG 2.5.7): the item of the pane's own width carries the check (the width the
  // user chose, also while the pane gives way to a narrow window); none while a dragged width lies between
  function widthOf(d, which) { var s = dState(d); return which === "min" ? s.min : which === "max" ? s.max : s.start; }
  function checkWidths(d) {
    var id = d.getAttribute("aria-controls"), w = dState(d).width;
    if (!id) return;
    document.querySelectorAll("[data-sb-pane-width][aria-controls='" + CSS.escape(id) + "']").forEach(function (el) {
      el.setAttribute("aria-checked", String(widthOf(d, el.getAttribute("data-sb-pane-width")) === w));
    });
  }
  function dividerFor(paneId) { return paneId ? document.querySelector(".sb-window__divider[aria-controls='" + CSS.escape(paneId) + "']") : null; }
  // The content keeps 480 px: the user's widths hold while they fit; otherwise the end pane (inspector) gives way
  // first, then the start pane (sidebar), each down to its smallest width. Below that the container steps of
  // sebaro.css take the pane out of the row (overlay), so the stored width is never lost.
  function fit(win) {
    var ds = dividersOf(win);
    if (!ds.length) return;
    var body = ds[0].parentElement, room = body.clientWidth - CONTENT_MIN;
    var docked = ds.filter(shown);
    docked.forEach(function (d) { room -= d.offsetWidth; });
    var open = docked.filter(function (d) { var p = dividerPane(d); return p && !p.hidden; });
    var want = open.map(function (d) { return dState(d).width; });
    var total = want.reduce(function (a, b) { return a + b; }, 0);
    open.map(function (d, i) { return i; }).sort(function (a, b) { return atEnd(open[b]) - atEnd(open[a]); }).forEach(function (i) {
      if (total <= room) return;
      var cut = Math.min(want[i] - dState(open[i]).min, total - room);
      want[i] -= cut; total -= cut;
    });
    open.forEach(function (d, i) { showWidth(d, want[i]); });
    ds.forEach(function (d) {
      var p = dividerPane(d);
      if (p && p.hidden) { d.setAttribute("aria-valuenow", String(dState(d).min)); d.setAttribute("aria-valuetext", t(d, "collapsed")); }
      else if (open.indexOf(d) < 0) showWidth(d, dState(d).width);   // an overlay pane keeps the user's width
    });
  }
  function roomFor(d) {   // the widest this pane may be now, beside the content's 480 px and the other docked pane
    var body = d.parentElement, room = body.clientWidth - CONTENT_MIN;
    dividersOf(d.closest(".sb-window")).forEach(function (x) {
      if (!shown(x)) return;
      room -= x.offsetWidth;
      var p = dividerPane(x);
      if (x !== d && p && !p.hidden) room -= p.offsetWidth;
    });
    return room;
  }
  function paneOpen(d, open) {
    var p = dividerPane(d), s = p && paneState(p.id);
    if (s && (p.hidden === open)) { s.overlay = isOverlay(p); setPane(s, open, "user"); }
  }
  function setWidth(d, w, how) {   // how: "drag" may collapse under the smallest width, "key" stops at it
    var s = dState(d), max = Math.min(s.max, roomFor(d));
    if (how === "drag" && w < s.min - COLLAPSE_AT) { paneOpen(d, false); return; }
    if (max < s.min) return;   // no room for this pane beside the content: it stays as it is
    s.width = Math.round(Math.min(max, Math.max(s.min, w)));
    paneOpen(d, true);
    showWidth(d, s.width);
  }
  function dividerKey(event, d) {
    var s = dState(d), p = dividerPane(d);
    if (!p) return false;
    var rtl = getComputedStyle(d).direction === "rtl", grow = (atEnd(d) ? -1 : 1) * (rtl ? -1 : 1);
    var now = p.hidden ? s.min : s.width, step = event.shiftKey ? STEP_BIG : STEP;
    switch (event.key) {
      case "ArrowRight": setWidth(d, now + grow * step, "key"); break;
      case "ArrowLeft": setWidth(d, now - grow * step, "key"); break;
      case "Home": setWidth(d, s.min, "key"); break;
      case "End": setWidth(d, s.max, "key"); break;
      case "Enter": paneOpen(d, p.hidden); break;
      default: return false;
    }
    saveWidth(d);
    event.preventDefault();
    return true;
  }
  var resize = null;   // { d, x, from, sign }
  function startResize(event, d) {
    var p = dividerPane(d);
    if (!p || event.button !== 0) return;
    var rtl = getComputedStyle(d).direction === "rtl";
    resize = { d: d, x: event.clientX, from: p.hidden ? 0 : p.getBoundingClientRect().width, sign: (atEnd(d) ? -1 : 1) * (rtl ? -1 : 1), id: event.pointerId };
    try { d.setPointerCapture(event.pointerId); } catch (e) { /* the move still arrives while the pointer stays on the page */ }
    root.setAttribute("data-sb-dragging", "resize");
    event.preventDefault();
  }
  function endResize() {
    if (!resize) return;
    saveWidth(resize.d);
    resize = null;
    root.removeAttribute("data-sb-dragging");
  }
  function updateDividers(pane) {
    var win = pane && pane.closest(".sb-window");
    if (win && dividersOf(win).length) fit(win);
  }

  // ------------------------------------------------------------------ document tabs (F7a; spec/02 §4.21)
  function docTabs(list) { return Array.prototype.slice.call(list.querySelectorAll("[role='tab']")); }
  function docPanel(tab) { return document.getElementById(tab.getAttribute("aria-controls") || ""); }
  function selectDocTab(tab, focus) {
    var list = tab.closest("[role='tablist']"), before = document.activeElement, oldPanel = null;
    docTabs(list).forEach(function (x) {
      var on = x === tab, p = docPanel(x);
      if (x.getAttribute("aria-selected") === "true" && p && p.contains(before)) oldPanel = p;
      x.setAttribute("aria-selected", String(on));
      x.tabIndex = on ? 0 : -1;
      if (p) p.hidden = !on;
    });
    if (focus === "tab") tab.focus({ preventScroll: true });
    else if (oldPanel) { var p = docPanel(tab); if (p) p.focus({ preventScroll: true }); }   // ⌃⇥ from inside the text: stay in the text
    revealTab(tab);   // spec/02 §4.21: the current tab is in view, also when focus stayed in the text
  }
  // scroll only the tab row, sideways, so the tab stands inside it (after the row's scroll-padding, spec/02 §4.21); never the
  // page or the content (scrollIntoView would move them too)
  function revealTab(tab) {
    var list = tab.closest("[role='tablist']"), item = tab.closest(".sb-doc-tabs__item") || tab;
    if (!list || list.scrollWidth <= list.clientWidth) return;
    var lr = list.getBoundingClientRect(), r = item.getBoundingClientRect(), cs = getComputedStyle(list);
    var padStart = parseFloat(cs.scrollPaddingInlineStart) || 0, rtl = cs.direction === "rtl";
    var startEdge = rtl ? lr.right - padStart : lr.left + padStart, endEdge = rtl ? lr.left : lr.right;
    // D108 (4): the pinned tab stays at the row's start (sticky), so another tab is revealed after its end, not under it
    var pin = list.querySelector(".sb-doc-tabs__item--pinned");
    if (pin && pin !== item) { var pr = pin.getBoundingClientRect(); startEdge = rtl ? Math.min(startEdge, pr.left) : Math.max(startEdge, pr.right); }
    var delta = 0;
    if (!rtl) { if (r.left < startEdge) delta = r.left - startEdge; else if (r.right > endEdge) delta = Math.min(r.right - endEdge, r.left - startEdge); }
    else { if (r.right > startEdge) delta = r.right - startEdge; else if (r.left < endEdge) delta = Math.max(r.left - endEdge, r.right - startEdge); }
    if (delta) list.scrollLeft += delta;
  }
  function isPinned(tab) { var item = tab.closest(".sb-doc-tabs__item"); return !!item && item.classList.contains("sb-doc-tabs__item--pinned"); }
  // D102 (5): reorder without a pointer, „Reiter nach vorn / nach hinten“ (data-sb-tab-move="previous" | "next") in the
  // menu „Fenster“ and the palette move the current tab one place; a pinned tab stays first and is never moved
  function moveDocTab(tab, to) {
    var list = tab.closest("[role='tablist']"), item = tab.closest(".sb-doc-tabs__item");
    if (!list || !item || isPinned(tab)) return false;
    var items = Array.prototype.slice.call(list.querySelectorAll(":scope > .sb-doc-tabs__item"));
    var i = items.indexOf(item), j = typeof to === "number" ? to : i + (to === "previous" ? -1 : 1);
    if (j < 0 || j >= items.length || j === i || items[j].classList.contains("sb-doc-tabs__item--pinned")) return false;
    var pos = j < i ? "before" : "after";
    if (!tab.dispatchEvent(new CustomEvent("sb-move", { bubbles: true, cancelable: true, detail: { item: tab, target: items[j].querySelector("[role='tab']"), position: pos } }))) return false;
    var had = item.contains(document.activeElement) ? document.activeElement : null;
    list.insertBefore(item, pos === "before" ? items[j] : items[j].nextElementSibling);
    if (had) had.focus({ preventScroll: true });   // a moved node loses focus
    revealTab(tab);
    return true;
  }
  function runTabMove(el, near) {
    var win = windowOf(near), cur = win && currentDocTab(win);
    if (cur) moveDocTab(cur, el.getAttribute("data-sb-tab-move") === "previous" ? "previous" : "next");
  }

  // ------------------------------------------------------------------ the sort choice (D102 (3))
  function sortChoose(btn) {
    var group = btn.closest("[data-sb-sort-choice]");
    if (!group) return;
    var on = btn.getAttribute("aria-pressed") === "true";
    var dir = on ? (btn.getAttribute("data-sb-sort-dir") === "desc" ? "asc" : "desc") : (btn.getAttribute("data-sb-sort-dir") || "asc");
    group.querySelectorAll("[aria-pressed]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
    btn.setAttribute("data-sb-sort-dir", dir);
    sortShow(btn);
    group.dispatchEvent(new CustomEvent("sb-sort-change", { bubbles: true, detail: { key: btn.getAttribute("data-sb-sort-key") || "", dir: dir } }));
  }
  // the chosen switch: arrow-up--16 for ascending, arrow-down--16 for descending, and the hidden word after its own
  function sortShow(btn) {
    var dir = btn.getAttribute("data-sb-sort-dir") === "desc" ? "desc" : "asc";
    var use = btn.querySelector("svg use");
    if (use) use.setAttribute("href", dir === "desc" ? "#arrow-down--16" : "#arrow-up--16");
    var word = btn.querySelector("[data-sb-sort-word]");
    if (!word) { word = document.createElement("span"); word.className = "sb-visually-hidden"; word.setAttribute("data-sb-sort-word", ""); btn.appendChild(word); }
    word.textContent = btn.getAttribute("aria-pressed") === "true" ? ", " + t(btn, dir === "desc" ? "descending" : "ascending") : "";
  }

  // ------------------------------------------------------------------ the failure sentence of a command (D102 (11))
  var MESSAGE_MIN = 10000;   // ms a sentence without a trigger stays at least
  function stampMessage(m) {
    var filled = m.textContent.trim() !== "" || !!m.querySelector("svg");
    m._sbAt = filled ? (m._sbAt || Date.now()) : 0;
  }
  function watchMessages(scope) {
    if (typeof MutationObserver !== "function") return;
    scope.querySelectorAll(".sb-primary-action-bar__message").forEach(function (m) {
      if (m._sbWatched) return;
      m._sbWatched = true;
      stampMessage(m);
      new MutationObserver(function () { m._sbAt = 0; stampMessage(m); }).observe(m, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["data-sb-message"] });
    });
  }
  // a key or press inside the sentence (its „Details“, D102 (23)) and Tab, which only moves focus there, keep it
  // (provisional, agent). Only the window the key or press was in (windowOf: a dialog outside the window belongs to
  // the product's one fill window) loses its sentence: a press in another window or outside every window keeps it
  // (review of the desktop lane, DSK-R6; provisional, agent)
  function clearMessages(event) {
    if (event && event.type === "keydown" && event.key === "Tab") return;
    var win = event ? windowOf(event.target) : null;
    if (!win) return;
    win.querySelectorAll(".sb-primary-action-bar__message[data-sb-message]").forEach(function (m) {
      if (!m._sbAt || (event && event.target instanceof Node && m.contains(event.target))) return;
      var min = m.getAttribute("data-sb-message") === "background" ? MESSAGE_MIN : 0;
      if (Date.now() - m._sbAt < min) return;
      m.textContent = "";
      m._sbAt = 0;
    });
  }
  var LONE_KEYS = ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn"];
  document.addEventListener("keydown", function (event) { if (LONE_KEYS.indexOf(event.key) < 0) clearMessages(event); }, true);
  document.addEventListener("pointerdown", clearMessages, true);
  function currentDocTab(win) {
    var list = Array.prototype.filter.call(win.querySelectorAll(".sb-doc-tabs[role='tablist']"), shown)[0];
    return list ? list.querySelector("[role='tab'][aria-selected='true']") : null;
  }
  function cycleDocTab(win, step) {
    var cur = currentDocTab(win);
    if (!cur) return false;
    var all = docTabs(cur.closest("[role='tablist']")), i = all.indexOf(cur);
    selectDocTab(all[(i + step + all.length) % all.length], document.activeElement === cur ? "tab" : "panel");
    return true;
  }
  function closeDocTab(tab) {
    var list = tab.closest("[role='tablist']");
    if (isPinned(tab)) return;   // D102 (5): a pinned tab is not closed by Entf, ⌘W or the middle button
    if (!tab.dispatchEvent(new CustomEvent("sb-doc-tab-close", { bubbles: true, cancelable: true, detail: { tab: tab } }))) return;
    var all = docTabs(list), i = all.indexOf(tab), next = all[i + 1] || all[i - 1] || null;
    var panel = docPanel(tab), active = document.activeElement;
    var focusHere = tab === active || (panel && panel.contains(active)) || (tab.closest(".sb-doc-tabs__item") || tab).contains(active);
    var wasSelected = tab.getAttribute("aria-selected") === "true";
    (tab.closest(".sb-doc-tabs__item") || tab).remove();
    if (panel && !list.querySelector("[aria-controls='" + CSS.escape(panel.id) + "']")) panel.remove();
    if (next) {
      if (wasSelected) selectDocTab(next, focusHere ? "tab" : null);
      else if (focusHere) next.focus();
      return;
    }
    list.hidden = true;   // an empty tab list is no tab list: the sentence after it says that nothing is open
    var none = list.parentElement && list.parentElement.querySelector(":scope > .sb-doc-tabs__none");
    if (none) { none.hidden = false; if (focusHere) { none.tabIndex = -1; none.focus(); } }
  }
  function docTabKey(event, tab) {
    var all = docTabs(tab.closest("[role='tablist']")), i = all.indexOf(tab);
    var rtl = getComputedStyle(tab).direction === "rtl", next = null;
    switch (event.key) {
      case "ArrowRight": next = all[(i + (rtl ? -1 : 1) + all.length) % all.length]; break;
      case "ArrowLeft": next = all[(i + (rtl ? 1 : -1) + all.length) % all.length]; break;
      case "Home": next = all[0]; break;
      case "End": next = all[all.length - 1]; break;
      case "Delete": closeDocTab(tab); event.preventDefault(); return true;   // Entf, fn+⌫ on a Mac; ⌫ alone never (D104 (38))
      default: return false;
    }
    selectDocTab(next, "tab");
    event.preventDefault();
    return true;
  }

  // ------------------------------------------------------------------ drag and drop of rows (F8a; spec/02 §4.22)
  var DRAG_START = 4, dnd = null, swallowClick = false;   // dnd: { row, x, y, id, on, hit }
  function setState(el, value) {   // data-sb-state holds other states too („done“): keep and give back what was there
    if (value) { if (!("_sbState" in el)) el._sbState = el.getAttribute("data-sb-state"); el.setAttribute("data-sb-state", value); }
    else if ("_sbState" in el) { if (el._sbState == null) el.removeAttribute("data-sb-state"); else el.setAttribute("data-sb-state", el._sbState); delete el._sbState; }
  }
  function container(row) { return row.closest("[role='tree'], [role='listbox'], [role='tablist']"); }
  function dropAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (dnd.row.matches("[role='tab']")) return dropTabAt(el, x);
    var row = el && el.closest("[role='treeitem'], [role='option']");
    // the free space under the rows of a tree takes the row into the top level (spec/02 §4.22; provisional, agent)
    if (!row && el && el.matches("[role='tree']") && el === container(dnd.row)) return { row: el, pos: "root" };
    if (!row || row === dnd.row || container(row) !== container(dnd.row)) return null;
    var item = dnd.row.closest("li");
    if (item && item !== dnd.row && item.contains(row)) return null;   // never into itself
    if (row.getAttribute("data-sb-drop") === "none") return { row: row, pos: "refuse" };
    var r = row.getBoundingClientRect(), into = row.hasAttribute("aria-owns") || row.getAttribute("data-sb-drop") === "into";
    if (into && y > r.top + r.height / 4 && y < r.bottom - r.height / 4) return { row: row, pos: "into" };
    return { row: row, pos: y < r.top + r.height / 2 ? "before" : "after" };
  }
  // a dragged document tab (D102 (5)): lands before or after the tab under the pointer, by the half it is in (swapped
  // right to left); never before a pinned tab, never on itself
  function dropTabAt(el, x) {
    var tab = el && el.closest(".sb-doc-tabs__item"), own = dnd.row.closest(".sb-doc-tabs__item");
    if (!tab || tab === own || tab.parentElement !== own.parentElement) return null;
    var r = tab.getBoundingClientRect(), rtl = getComputedStyle(tab).direction === "rtl";
    var first = (x < r.left + r.width / 2) !== rtl;
    if (tab.classList.contains("sb-doc-tabs__item--pinned")) return first ? null : { row: tab, pos: "after" };
    return { row: tab, pos: first ? "before" : "after" };
  }
  function markDrop(hit) {
    if (dnd.hit && (!hit || hit.row !== dnd.hit.row || hit.pos !== dnd.hit.pos)) setState(dnd.hit.row, null);
    dnd.hit = hit;
    if (hit) setState(hit.row, "drop-" + (hit.pos === "root" ? "into" : hit.pos));
    root.setAttribute("data-sb-dragging", hit && hit.pos === "refuse" ? "refuse" : "move");
  }
  function endDnd() {
    if (!dnd) return;
    if (dnd.hit) setState(dnd.hit.row, null);
    if (dnd.on) setState(dnd.row.matches("[role='tab']") ? dnd.row.closest(".sb-doc-tabs__item") || dnd.row : dnd.row, null);
    root.removeAttribute("data-sb-dragging");
    dnd = null;
  }
  function levelOf(ul) {
    if (ul.getAttribute("role") !== "group") return 1;
    var owner = (ul.id && ul.closest("[role='tree']").querySelector("[aria-owns~='" + CSS.escape(ul.id) + "']")) || ul.previousElementSibling;
    return owner ? (parseInt(owner.getAttribute("aria-level"), 10) || 1) + 1 : 1;
  }
  function relevel(item) {
    var row = item.matches("[aria-level]") ? item : item.querySelector(":scope > [aria-level]");
    if (row) row.setAttribute("aria-level", String(levelOf(item.parentElement)));
    item.querySelectorAll(":scope > [role='group'] > li").forEach(relevel);
  }
  function rowName(row) { var n = row.querySelector(".sb-row__name"); return (n ? n.textContent : row.textContent).trim(); }
  function groupOf(folder) { return document.getElementById(folder.getAttribute("aria-owns") || "") || (folder.closest("li") || folder).querySelector(":scope > [role='group']"); }
  // one code path for the pointer and for „Verschieben nach …“ (D67 (6): every drag has a way without a pointer)
  // reveal (the folder picker of the palette, D102 (16)): after the move the target folder opens and the row is shown
  // (it becomes the tree's tab stop, focused when the tree had the keyboard); only when that is not possible (the pane
  // is hidden) the toast says where it went
  function moveRow(row, target, pos, undo, reveal) {
    var item = row.closest("li"), root = pos === "root" ? target : null, at = root ? null : target.closest("li");
    if (!item || (!at && !root)) return;
    var group = pos === "into" ? groupOf(target) : root;
    if ((pos === "into" || root) && (!group || group === item.parentElement)) return;   // already there
    if (!undo && !row.dispatchEvent(new CustomEvent("sb-move", { bubbles: true, cancelable: true, detail: { item: row, target: target, position: pos } }))) return;
    var back = { parent: item.parentElement, next: item.nextElementSibling };
    var had = document.activeElement === row || reveal === "focus";
    if (pos === "into" || root) group.appendChild(item);
    else at.parentElement.insertBefore(item, pos === "before" ? at : at.nextElementSibling);
    relevel(item);
    if (reveal && pos === "into" && target.getAttribute("aria-expanded") === "false") {
      target.setAttribute("aria-expanded", "true");
      group.hidden = false;
    }
    if (shown(row)) {
      if (reveal) {
        var tree = row.closest("[role='tree']");
        if (tree) tree.querySelectorAll("[role='treeitem']").forEach(function (r) { r.tabIndex = r === row ? 0 : -1; });
        row.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      if (had) row.focus({ preventScroll: true });
      return;
    }
    // the row went into a closed folder: the folder becomes the tree's stop and a toast says where it went (D78)
    var folder = pos === "into" ? target : null;
    if (row.tabIndex === 0 && folder) { row.tabIndex = -1; folder.tabIndex = 0; }
    if (had && folder) folder.focus();
    var win = row.closest(".sb-window"), toast = win && win.querySelector(".sb-toast[data-sb-move-toast]");
    if (toast && folder && !undo && window.sbToast) {
      var line = toast.querySelector("p");
      if (line) line.textContent = t(toast, "moved", { target: rowName(folder) });
      toast._sbUndo = function () {
        back.parent.insertBefore(item, back.next && back.next.parentElement === back.parent ? back.next : null);
        relevel(item);
        row.dispatchEvent(new CustomEvent("sb-move", { bubbles: true, detail: { item: row, target: null, position: "back", undo: true } }));
      };
      window.sbToast.show(toast);
    }
  }
  document.addEventListener("sb-toast-action", function (event) {
    var toast = event.target;
    if (toast instanceof Element && typeof toast._sbUndo === "function") { toast._sbUndo(); toast._sbUndo = null; }
  });
  document.addEventListener("close", function (event) {   // dialog[data-sb-move-dialog="<tree id>"], value „move“
    var dlg = event.target;
    if (!(dlg instanceof Element) || !dlg.hasAttribute("data-sb-move-dialog") || dlg.returnValue !== "move") return;
    var tree = document.getElementById(dlg.getAttribute("data-sb-move-dialog"));
    var choice = dlg.querySelector("input[type='radio']:checked"), target = choice && document.getElementById(choice.value);
    var row = tree && commandRow(tree);
    if (row && target && row !== target) moveRow(row, target, "into");
  }, true);
  // D102 (17): a command from the menu, the palette or a dialog acts on the row that had focus while the tree had the
  // keyboard (the area the user worked in last is the tree's, and its last focused element is a row of this tree),
  // else on the chosen row
  function commandRow(tree) {
    var win = windowOf(tree), area = win && win._sbArea, last = area && area._sbLast;
    if (last && tree.contains(last) && last.matches("[role='treeitem']") && document.contains(last)) return last;
    return tree.querySelector("[aria-selected='true']") || tree.querySelector("[role='treeitem'][tabindex='0']");
  }
  // D102 (16): the folder picker, the second form of „Verschieben nach …“: dialog.sb-command-palette with
  // data-sb-move-palette="<tree id>", options with data-sb-move-to="<folder row id>"; the row is taken when it opens
  function movePick(pal, opt) {
    var tree = document.getElementById(pal.getAttribute("data-sb-move-palette") || "");
    var target = document.getElementById(opt.getAttribute("data-sb-move-to") || "");
    var row = pal._sbRow && tree && tree.contains(pal._sbRow) ? pal._sbRow : tree && commandRow(tree);
    if (!row || !target || row === target) return;
    moveRow(row, target, "into", false, pal._sbTreeHad ? "focus" : true);
  }

  // ------------------------------------------------------------------ events
  // the click that ends a drag is not a click on the row (capture: before sb-tree.js and the listbox choose it)
  document.addEventListener("click", function (event) {
    if (swallowClick) { swallowClick = false; event.preventDefault(); event.stopPropagation(); }
  }, true);
  document.addEventListener("click", function (event) {
    var option = closestIn(event, ".sb-command-palette[data-sb-fulltext] [data-sb-search-option]");
    if (option) { fulltextSearch(option.closest(".sb-command-palette")); return; }   // sb-controls.js has turned aria-pressed
    if (closestIn(event, "[data-sb-find-open], .sb-find-bar")) { findClick(event); return; }
    if (closestIn(event, "[data-sb-reader-command]")) { readerClick(event); return; }
    var close = closestIn(event, ".sb-doc-tabs__close");
    if (close) {
      var owner = close.closest(".sb-doc-tabs__item"), tabToClose = owner && owner.querySelector("[role='tab']");
      if (tabToClose) closeDocTab(tabToClose);
      return;
    }
    var docTab = closestIn(event, ".sb-doc-tabs [role='tab']");
    if (docTab) { selectDocTab(docTab, null); return; }
    var sw = closestIn(event, "[data-sb-switch][aria-pressed]");
    if (sw) {
      var on = sw.getAttribute("aria-pressed") !== "true";
      sw.setAttribute("aria-pressed", String(on));
      sw.dispatchEvent(new CustomEvent("sb-switch-change", { bubbles: true, detail: { pressed: on } }));
      return;
    }
    var sort = closestIn(event, "[data-sb-sort-choice] [aria-pressed]");
    if (sort) { sortChoose(sort); return; }
    var tabMove = closestIn(event, "[data-sb-tab-move]");   // „Reiter nach vorn / nach hinten“ (D102 (5))
    if (tabMove && !tabMove.closest(".sb-command-palette")) { runTabMove(tabMove, tabMove); return; }
    var area = closestIn(event, "[data-sb-area]");   // „Nächster Bereich“ / „Vorheriger Bereich“ in the menu „Fenster“
    if (area && !area.closest(".sb-command-palette")) { runArea(area, area); return; }   // a palette option: runOption
    var opener = closestIn(event, "[data-sb-palette-open]");
    if (opener) {
      var id = opener.getAttribute("data-sb-palette-open");
      openPalette(id ? document.getElementById(id) : document.querySelector("dialog.sb-command-palette"), opener);
      return;
    }
    var palOpt = closestIn(event, ".sb-command-palette [role='option']");
    if (palOpt) { runOption(palOpt.closest(".sb-command-palette"), palOpt); return; }
    var paneWidth = closestIn(event, "[data-sb-pane-width][aria-controls]");
    if (paneWidth) {   // „Schmal · Normal · Breit“: the same width code as the keyboard on the divider
      var pd = dividerFor(paneWidth.getAttribute("aria-controls"));
      if (pd) {   // the chosen width is the pane's width from now on; fit() shows what the window has room for
        var ps = dState(pd), pp = dividerPane(pd);
        ps.width = clampW(ps, widthOf(pd, paneWidth.getAttribute("data-sb-pane-width")));
        saveWidth(pd);
        if (pp && !isOverlay(pp)) paneOpen(pd, true);   // D95 (b): a pane that gives way to a narrow window stays as it is
        fit(pd.closest(".sb-window"));
        checkWidths(pd);
      }
      return;
    }
    var toggle = closestIn(event, "[data-sb-window-toggle][aria-controls]");
    if (toggle) {
      var s = paneState(toggle.getAttribute("aria-controls"));
      if (s) { s.overlay = isOverlay(s.pane); setPane(s, s.pane.hidden, "user", !!toggle.closest(".sb-menu")); }
      return;
    }
    var opt = closestIn(event, ".sb-listbox [role='option']");
    if (opt) { listClick(event, opt.closest("[role='listbox']"), opt); return; }
    var theme = closestIn(event, "[data-sb-theme-choice]");
    if (theme && theme.tagName !== "INPUT") applyTheme(theme.getAttribute("data-sb-theme-choice"));   // radios: "change"
  });
  document.addEventListener("change", function (event) {
    var radio = event.target;
    if (radio instanceof HTMLInputElement && radio.checked && radio.hasAttribute("data-sb-theme-choice")) applyTheme(radio.getAttribute("data-sb-theme-choice"));
  });
  // Shift / ⌘ + click must not select text in a list
  document.addEventListener("mousedown", function (event) {
    if ((event.shiftKey || modKey(event)) && closestIn(event, ".sb-listbox[aria-multiselectable='true'] [role='option']")) event.preventDefault();
    // the cross of a tab keeps focus where it is; the middle button on a tab closes it instead of scrolling
    if (closestIn(event, ".sb-doc-tabs__close") || (event.button === 1 && closestIn(event, ".sb-doc-tabs__item"))) event.preventDefault();
  });
  document.addEventListener("auxclick", function (event) {
    var item = event.button === 1 && closestIn(event, ".sb-doc-tabs__item"), tab = item && item.querySelector("[role='tab']");
    if (tab) { closeDocTab(tab); event.preventDefault(); }
  });
  document.addEventListener("dblclick", function (event) {   // a double click on a divider gives back the start width
    var d = closestIn(event, ".sb-window__divider");
    if (!d) return;
    setWidth(d, dState(d).start, "key");
    saveWidth(d);
  });
  document.addEventListener("pointerdown", function (event) {
    var d = closestIn(event, ".sb-window__divider");
    if (d) { startResize(event, d); return; }
    var row = event.button === 0 && event.isPrimary && !closestIn(event, ".sb-tree__twist") ? closestIn(event, "[data-sb-drag]") : null;
    if (row) dnd = { row: row, x: event.clientX, y: event.clientY, id: event.pointerId, on: false, hit: null };
  });
  document.addEventListener("pointermove", function (event) {
    if (resize && event.pointerId === resize.id) { setWidth(resize.d, resize.from + resize.sign * (event.clientX - resize.x), "drag"); return; }
    if (!dnd || event.pointerId !== dnd.id) return;
    if (!dnd.on) {
      if (Math.abs(event.clientX - dnd.x) + Math.abs(event.clientY - dnd.y) < DRAG_START) return;
      if (!(event.buttons & 1)) { dnd = null; return; }
      dnd.on = true;
      setState(dnd.row.matches("[role='tab']") ? dnd.row.closest(".sb-doc-tabs__item") || dnd.row : dnd.row, "dragging");
    }
    markDrop(dropAt(event.clientX, event.clientY));
  });
  document.addEventListener("pointerup", function (event) {
    if (resize && event.pointerId === resize.id) { endResize(); return; }
    if (!dnd || event.pointerId !== dnd.id) return;
    var was = dnd.on, row = dnd.row, hit = dnd.hit;
    endDnd();
    if (!was) return;
    swallowClick = true;
    setTimeout(function () { swallowClick = false; }, 0);
    if (hit && hit.pos !== "refuse") {
      if (row.matches("[role='tab']")) {   // a tab: to the index of the tab it lands beside
        var items = Array.prototype.slice.call(hit.row.parentElement.querySelectorAll(":scope > .sb-doc-tabs__item"));
        var from = items.indexOf(row.closest(".sb-doc-tabs__item")), to = items.indexOf(hit.row) + (hit.pos === "after" ? 1 : 0);
        if (to > from) to--;
        if (to !== from) moveDocTab(row, to);
      } else moveRow(row, hit.row, hit.pos);
    }
  });
  document.addEventListener("pointercancel", function () { endResize(); endDnd(); });
  document.addEventListener("pointerdown", function (event) {
    Object.keys(panes).forEach(function (id) {
      var s = panes[id];
      if (!s.overlay || s.pane.hidden || !(event.target instanceof Node)) return;
      if (s.pane.contains(event.target) || s.toggles.some(function (b) { return b.contains(event.target); })) return;
      var had = s.pane.contains(document.activeElement);
      closeOverlay(s, false);
      // like a menu (sb-menu.js): focus stays on what was clicked when that takes focus; else, when focus was in the
      // pane, it goes back to the toggle instead of falling to the page (OR-12). The press moves focus after this event
      if (had) setTimeout(function () {
        var a = document.activeElement;
        if (!a || a === document.body || s.pane.contains(a)) {
          var back = s.toggles.filter(function (b) { return b.hasAttribute("aria-expanded") && shown(b); })[0];
          if (back) back.focus({ preventScroll: true });
        }
      }, 0);
    });
  });
  document.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || event.isComposing) return;
    // ⌘K / Strg+K opens (or closes) the palette everywhere in the app (D84)
    if ((event.key === "k" || event.key === "K") && modKey(event) && !event.altKey && !event.shiftKey) {
      var dlg = document.querySelector("dialog.sb-command-palette");
      if (dlg) {
        event.preventDefault();
        if (dlg.open) dlg.close(); else openPalette(dlg, document.activeElement);
        return;
      }
    }
    var pal = closestIn(event, ".sb-command-palette");
    if (pal && pal.tagName === "DIALOG" && pal.open && (event.metaKey || event.ctrlKey) && overlayKey(event, pal)) return;
    if (pal && event.target.matches(".sb-command-palette__search input")) { paletteKey(event, pal); return; }
    var bar = closestIn(event, ".sb-find-bar");
    if (bar && !event.target.closest(".sb-menu") && findKey(event, bar)) return;   // D104 (3); the „Mehr“ menu keeps its keys
    var reader = closestIn(event, ".sb-reader");
    if (reader && readerKey(event, reader)) return;   // D104 (5)–(7)
    if (dnd && dnd.on) { if (event.key === "Escape") { endDnd(); event.preventDefault(); } return; }   // Escape cancels a drag
    var opt = closestIn(event, ".sb-listbox [role='option']");
    if (opt && event.target === opt) { listKey(event, opt.closest("[role='listbox']"), opt); if (event.defaultPrevented) return; }
    var divider = closestIn(event, ".sb-window__divider");
    if (divider && event.target === divider && dividerKey(event, divider)) return;
    var docTab = closestIn(event, ".sb-doc-tabs [role='tab']");
    if (docTab && event.target === docTab && docTabKey(event, docTab)) return;
    if (event.key === "Escape") {
      Object.keys(panes).forEach(function (id) {
        var s = panes[id];
        if (!s.overlay || s.pane.hidden || !(event.target instanceof Node)) return;
        if (s.pane.contains(event.target) || s.toggles.some(function (b) { return b.contains(event.target); })) { closeOverlay(s, true); event.preventDefault(); }
        // opened from the menu, focus stayed on „Menü“ (D95 (b)): Escape there closes it too, focus stays
        else if (isWindowMenuButton(event.target) && windowOf(event.target) === windowOf(s.pane)) { closeOverlay(s, false); event.preventDefault(); }
      });
      if (event.defaultPrevented) return;
    }
    // window keys: not while a dialog, the palette or a menu has the keyboard
    if (event.target instanceof Element && event.target.closest("dialog[open], .sb-menu:popover-open, .sb-toast")) return;
    var win = windowOf(event.target);
    if (!win) return;
    if (event.key === "Escape") {   // „Zurück zu …“ of a view such as the settings (F10a)
      var back = isTextField(event.target) ? null : win.querySelector("[data-sb-escape]");
      if (back && shown(back)) { event.preventDefault(); back.click(); }
      return;
    }
    if (event.key === "F6" && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); moveArea(win, event.shiftKey); return; }
    if (event.key === "Tab" && event.ctrlKey && !event.metaKey && !event.altKey) { if (cycleDocTab(win, event.shiftKey ? -1 : 1)) event.preventDefault(); return; }
    if ((event.key === "w" || event.key === "W") && modKey(event) && !event.shiftKey && !event.altKey) {
      var cur = currentDocTab(win);
      if (cur) { event.preventDefault(); closeDocTab(cur); }
      return;
    }
    pressFixed(event, win);
  });
  // F4b: F10 and a lone Alt (pressed and let go with no other key; Windows and Linux) open the window menu behind
  // „Menü“ like a menu bar, on its first item; pressed again inside the menu they close it. Escape or a chosen item
  // give focus back to where it was (sb-menu.js, "sb-menu-open" with returnTo). AltGr (key "AltGraph") is not Alt.
  function windowMenuToggle(from) {
    if (!(from instanceof Element) || from.closest("dialog[open]")) return false;
    var openMenu = from.closest(".sb-menu--window:popover-open");
    if (openMenu) { openMenu.hidePopover(); return true; }   // sb-menu.js gives focus back
    var win = windowOf(from), menu = win && win.querySelector(".sb-menu--window[popover][id]");
    if (!menu) return false;
    var id = CSS.escape(menu.id);
    var button = document.querySelector("[aria-haspopup='menu'][popovertarget='" + id + "'], [aria-haspopup='menu'][aria-controls='" + id + "']");
    if (!button || !shown(button) || !inView(button)) return false;   // D95 (a): only while „Menü“ is in the window
    var back = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    button.dispatchEvent(new CustomEvent("sb-menu-open", { bubbles: true, detail: { returnTo: back } }));
    return true;
  }
  var altAlone = false;
  document.addEventListener("keydown", function (event) {
    if (event.key === "Alt") {
      altAlone = event.repeat ? altAlone : !(event.ctrlKey || event.metaKey || event.shiftKey);
      return;
    }
    altAlone = false;
    if (event.key !== "F10" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
    if (windowMenuToggle(event.target)) event.preventDefault();   // Shift+F10 stays the context menu
  }, true);
  document.addEventListener("keyup", function (event) {
    if (event.key !== "Alt" || !altAlone) return;
    altAlone = false;
    if (isMac() || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (windowMenuToggle(event.target)) event.preventDefault();
  }, true);
  document.addEventListener("pointerdown", function () { altAlone = false; }, true);
  window.addEventListener("blur", function () { altAlone = false; });

  document.addEventListener("input", function (event) {
    var pal = closestIn(event, ".sb-command-palette");
    if (pal && event.target.matches(".sb-command-palette__search input")) filter(pal, event.target.value);
    var fb = closestIn(event, ".sb-find-bar");   // D104 (3): typing in the find field searches again
    if (fb && event.target === findInput(fb)) findRun(fb);
  });

  function init() {
    renderKeys(document);
    syncTheme();
    document.querySelectorAll(".sb-command-palette").forEach(function (pal) {
      if (pal.tagName === "DIALOG") wirePalette(pal);
      syncChecks(pal);
      if (pal.tagName !== "DIALOG") {
        var active = pal.querySelector("[role='option'][aria-selected='true']"), input = paletteInput(pal);
        if (active && input) input.setAttribute("aria-activedescendant", active.id);
      }
    });
    document.querySelectorAll(".sb-listbox[role='listbox']").forEach(function (lb) {
      var all = options(lb), cur = all.filter(function (o) { return o.getAttribute("aria-current") === "true"; })[0] || chosen(lb)[0] || all[0];
      all.forEach(function (o) { o.tabIndex = o === cur ? 0 : -1; });
      lb._sbAnchor = cur;
      var status = document.getElementById(lb.getAttribute("data-sb-selection-status") || "");
      if (status && !status.hasAttribute("data-sb-text") && !(multi(lb) && chosen(lb).length > 1)) status.setAttribute("data-sb-text", status.textContent);
    });
    document.querySelectorAll(".sb-window__divider[role='separator']").forEach(function (d) {
      var s = dState(d), stored = loadWidth(d);
      if (stored != null) s.width = clampW(s, stored);
      if (!d.hasAttribute("tabindex")) d.tabIndex = 0;   // without this script the line is only the layer line
    });
    document.querySelectorAll(".sb-doc-tabs[role='tablist']").forEach(function (list) {
      var all = docTabs(list), cur = all.filter(function (x) { return x.getAttribute("aria-selected") === "true"; })[0] || all[0];
      all.forEach(function (x) { x.tabIndex = x === cur ? 0 : -1; });
      if (cur) revealTab(cur);   // spec/02 §4.21: the current tab in view from the start, too
    });
    document.querySelectorAll("[data-sb-sort-choice] [aria-pressed]").forEach(sortShow);
    document.querySelectorAll(".sb-command-palette[data-sb-fulltext]").forEach(watchFulltext);
    document.querySelectorAll(".sb-reader[data-sb-pages]").forEach(function (r) { readerSync(r, false); });
    document.querySelectorAll(".sb-find-bar:not([hidden])").forEach(function (b) { var q = findInput(b); if (q && q.value) findRun(b); });
    watchMessages(document);
    document.querySelectorAll(".sb-window").forEach(function (win) {
      relayout(win);
      fit(win);
      if (typeof ResizeObserver === "function") new ResizeObserver(function () { relayout(win); fit(win); }).observe(win);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
