// sb-menu.js: the menu button of spec/02 §4.10 (ARIA menu button pattern, D80 „Skripte für Bedienung“), with
// submenus (spec/02 §4.24, D91 F4b: „Untermenüs mit Pfeiltasten“).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval, position only through the CSSOM.
// Progressive enhancement over markup that already works without it, through the Popover API:
//   <button class="sb-icon-button" type="button" aria-label="Mehr" aria-haspopup="menu" aria-expanded="false"
//           popovertarget="m1">…</button>
// (popovertarget already ties the button to the menu for assistive technology; aria-controls is optional and only
// needed on a button without popovertarget, where this script toggles the menu itself. axe cannot decide an
// aria-controls that points into a closed popover and reports it as "needs review".)
//   <ul class="sb-menu" role="menu" id="m1" aria-label="Mehr" popover>
//     <li role="none"><button class="sb-menu__item" type="button" role="menuitem" tabindex="-1">…</button></li> …
// A submenu is the ARIA APG form: the item that opens it and the submenu share one <li role="none">, the item carries
// aria-haspopup="menu", aria-expanded and popovertarget, the submenu is a nested popover named like its item:
//     <li role="none"><button class="sb-menu__item" type="button" role="menuitem" tabindex="-1" aria-haspopup="menu"
//         aria-expanded="false" popovertarget="m1-file">Datei<span class="sb-menu__sub" aria-hidden="true">…</span></button>
//       <ul class="sb-menu" role="menu" id="m1-file" aria-label="Datei" popover>…</ul></li>
// Without this script the browser already opens and closes the menu (click, Escape, click outside). The script adds:
//   - aria-expanded on the button follows the menu; the menu sits under the button, its end on the button's end
//     (above it when there is no room below), and follows on scroll and on a change of the window's height; a
//     change of the window's width, or a scroll that takes the button out of the window, closes the menu with all
//     its submenus, and focus goes back to the button if it was in the menu (D95 (a)); a submenu stands beside its
//     parent menu at the height of its item, on the side its parent went to (the top menu's submenus: the reading
//     side, else the other side; never over a visible part of a menu further up); without such a side it takes the
//     place and width of its parent, which stays open but hidden, and starts with a row „‹ <parent's name>“
//     (.sb-menu__back, made here from the parent's aria-label and the item's chevron, named „Zurück zu <parent's
//     name>“ for assistive technology) that goes back (D95 (c/d));
//   - opening by click, Enter or Space focuses the first item, ArrowDown the first, ArrowUp the last (the first item
//     after the back row);
//   - ArrowDown / ArrowUp move through the items of one menu and wrap, Home / End jump, typing letters jumps to the
//     next item that starts with them (typeahead, 500 ms; also a letter typed right after the key that opened it);
//   - on an item with a submenu, Enter, Space, a click and ArrowRight (ArrowLeft right to left) open the submenu on
//     its first item; in a submenu ArrowLeft (ArrowRight right to left), Escape and the back row close it and go
//     back to its item;
//   - Escape closes and returns focus to the button; Tab (focus leaving the menu) closes the menu with all its
//     submenus and lets focus move on; a click outside closes;
//   - choosing an item closes the menu with all its submenus and puts focus back on the button before the item's own
//     click handlers run, so an item that opens a dialog (data-sb-opens, sb-controls.js) hands focus back to the
//     button when it closes.
// Another script may open a menu for a key of its own (sb-window.js: F10 and a lone Alt open the window menu, F4b):
//   button.dispatchEvent(new CustomEvent("sb-menu-open", { bubbles: true, detail: { returnTo: element } }))
// opens on the first item; Escape and a chosen item then give focus back to returnTo instead of the button.
// Disabled items (disabled or aria-disabled="true") are skipped. Motion: the menu enters through the
// .sb-menu:popover-open rule of sebaro.css (an answer to the press, D80); it closes without motion.
// Its one message (the back row's name) follows the language of the menu (closest [lang], else <html lang>): German
// default, English built in; more via window.sbMessages["sb-menu"] (spec/09 §6.1, D87).
(function () {
  if (typeof HTMLElement.prototype.showPopover !== "function") return;   // the menu stays a static list
  var MESSAGES = {
    de: { back: "Zurück zu {name}" },
    en: { back: "Back to {name}" }
  };
  var extra = window.sbMessages && window.sbMessages["sb-menu"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  function t(el, key, vars) {
    var holder = el && el.closest("[lang]");
    var lang = ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
    var table = MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de;
    var text = table[key] != null ? table[key] : MESSAGES.de[key];
    return text.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }
  var ITEM = "[role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio']";
  var TYPEAHEAD_MS = 500;
  var REPLACED = "data-sb-replaced";                                     // on a menu whose submenu took its place (D95)
  var state = new WeakMap();                                              // menu -> { focus, noReturn, focusInside, returnTo, typed, typedAt, side, drill, up }

  function menuOf(button) {
    var id = button.getAttribute("aria-controls") || button.getAttribute("popovertarget");
    var menu = id ? document.getElementById(id) : null;
    return menu && menu.classList.contains("sb-menu") ? menu : null;
  }
  function buttonOf(menu) {
    if (!menu.id) return null;
    var id = CSS.escape(menu.id);
    return document.querySelector("[aria-haspopup='menu'][aria-controls='" + id + "'], [aria-haspopup='menu'][popovertarget='" + id + "']");
  }
  function parentMenu(menu) { return menu.parentElement ? menu.parentElement.closest(".sb-menu") : null; }
  function rootOf(menu) { var m = menu, p; while ((p = parentMenu(m))) m = p; return m; }
  function opensSub(item) { return item.getAttribute("aria-haspopup") === "menu" && !!menuOf(item); }
  function s(menu) { var x = state.get(menu); if (!x) { x = { focus: "first", noReturn: false, focusInside: false, returnTo: null, typed: "", typedAt: 0, side: null, drill: false, up: false }; state.set(menu, x); } return x; }
  // the items of this menu, not those of its submenus
  function items(menu) {
    return Array.prototype.filter.call(menu.querySelectorAll(ITEM), function (i) {
      return i.closest(".sb-menu") === menu && !i.disabled && i.getAttribute("aria-disabled") !== "true";
    });
  }
  function isBack(item) { return item.classList.contains("sb-menu__back"); }
  function focusItem(menu, which) {
    var list = items(menu);
    if (!list.length) return;
    var i = which === "last" ? list.length - 1 : list.length > 1 && isBack(list[0]) ? 1 : 0;
    list[i].focus();
  }
  function visible(el) { return !!el && el.isConnected && el.getClientRects().length > 0; }
  function inView(el) {                                                    // some part of it inside the window
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < document.documentElement.clientWidth;
  }
  // The back row of a submenu that took its parent's place (D95 (c/d)): a real menu item, first in the submenu, showing
  // the parent's name (its aria-label, else its aria-labelledby, else the text of the control that opened it: the words
  // come from the markup), named „Zurück zu <name>“, with the item's chevron turned back.
  function nameOf(menu) {
    var by = menu.getAttribute("aria-labelledby"), el = by && document.getElementById(by.split(/\s+/)[0]);
    var opener = buttonOf(menu);
    return (menu.getAttribute("aria-label") || (el ? el.textContent : "") ||
      (opener ? opener.getAttribute("aria-label") || opener.textContent : "")).trim();
  }
  function backRow(menu) { var li = menu.firstElementChild; return li && li.classList.contains("sb-menu__back-row") ? li : null; }
  function addBack(menu, item) {
    if (backRow(menu)) return;
    var li = document.createElement("li"), b = document.createElement("button"), mark = document.createElement("span");
    li.setAttribute("role", "none"); li.className = "sb-menu__back-row";
    b.type = "button"; b.className = "sb-menu__item sb-menu__back"; b.setAttribute("role", "menuitem"); b.tabIndex = -1;
    mark.className = "sb-menu__back-mark"; mark.setAttribute("aria-hidden", "true");
    var chevron = item.querySelector(".sb-menu__sub > svg");
    if (chevron) mark.appendChild(chevron.cloneNode(true)); else mark.textContent = "‹";
    var name = nameOf(parentMenu(menu));
    b.appendChild(mark);
    b.appendChild(document.createTextNode(name));
    b.setAttribute("aria-label", t(menu, "back", { name: name }));
    li.appendChild(b);
    menu.insertBefore(li, menu.firstChild);
  }
  function removeBack(menu) { var li = backRow(menu); if (li) li.remove(); }
  // back from a submenu to the item that opened it (ArrowLeft, the back row; Escape is the browser's)
  function goBack(menu) {
    var item = buttonOf(menu);
    s(menu).noReturn = true;
    menu.hidePopover();                                                    // beforetoggle shows a replaced parent again
    if (item) item.focus({ preventScroll: true });
  }
  // where focus goes back to when the menu closes: the element another script named (F10), else the button
  function backTo(menu, button) {
    var x = s(menu), to = x.returnTo && visible(x.returnTo) ? x.returnTo : button;
    return to;
  }
  // closes the menu that holds this one at the top, with every submenu, without the usual focus return
  function closeAll(menu) {
    for (var m = menu; m; m = parentMenu(m)) s(m).noReturn = true;
    var top = rootOf(menu);
    if (top.matches(":popover-open")) top.hidePopover();
    return top;
  }
  function openSub(item, which) {
    var sub = menuOf(item);
    if (!sub) return;
    if (sub.matches(":popover-open")) { focusItem(sub, which); return; }
    s(sub).focus = which;
    item.click();                                                          // popovertarget keeps the native nesting
  }

  // Place the menu under the button with its end on the button's end; above when the room below is too small.
  function place(menu, button, estimate, keep) {
    if (parentMenu(menu)) { placeSub(menu, button, estimate, keep); return; }
    var b = button.getBoundingClientRect();
    var gap = 4, edge = 8;
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var h = estimate ? items(menu).length * 48 + 16 : menu.getBoundingClientRect().height;
    var w = estimate ? 0 : menu.getBoundingClientRect().width;
    var rtl = getComputedStyle(button).direction === "rtl";
    var below = vh - b.bottom - gap - edge, above = b.top - gap - edge;
    menu.style.top = ""; menu.style.bottom = ""; menu.style.left = ""; menu.style.right = "";
    if (h <= below || below >= above) menu.style.top = Math.round(b.bottom + gap) + "px";
    else menu.style.bottom = Math.round(vh - b.top + gap) + "px";
    var start = rtl ? b.left : b.right - w;                                // the menu's left edge
    if (estimate) {
      if (rtl) menu.style.left = Math.round(Math.max(edge, b.left)) + "px";
      else menu.style.right = Math.round(Math.max(edge, vw - b.right)) + "px";
      return;
    }
    menu.style.left = Math.round(Math.min(Math.max(edge, start), Math.max(edge, vw - w - edge))) + "px";
  }
  // A submenu: beside its parent menu, its first item level with the item that opened it; the two layer lines lie
  // on each other. A submenu of a submenu keeps the direction its parent went (a parent that had to open to the left
  // has all its submenus open to the left too, as the menus of macOS and Windows do) and never turns back; a submenu
  // of the top menu (and of a submenu that took its parent's place) tries the reading side, then the other side. A
  // side counts only when the submenu fits into the window there and covers no visible part of a menu further up. No
  // such side (a narrow window, or the parent's direction runs out of room): drill-in (D95 (c/d)). The submenu takes
  // the left edge and the width of its parent and starts where the replaced path began: the top of the level the
  // first replacing level of this path took the place of (the parent itself, unless the parent replaced its own
  // parent), or upwards from that level's bottom when it stands above its button. A replaced parent that was taller
  // than the room there moved up, a shorter submenu does not follow it; only a submenu taller than the room moves up
  // (and may then lie over the button). The parent stays open but hidden (data-sb-replaced, set once focus is in the
  // submenu), and the back row leads back; nothing lies over the items of another level. While a menu is open it
  // keeps the way it was placed (keep: scroll and height changes only move it).
  function placeSub(menu, item, estimate, keep) {
    var parent = parentMenu(menu), sx = s(menu), edge = 8;
    if (!keep) { removeBack(menu); menu.style.inlineSize = ""; sx.drill = false; sx.up = false; }
    var p = parent.getBoundingClientRect(), it = item.getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var cs = getComputedStyle(menu);
    var line = parseFloat(cs.borderTopWidth) || 0, pad = parseFloat(cs.paddingTop) || 0;
    function size() {
      return {
        w: estimate ? (sx.drill ? p.width : parseFloat(cs.minWidth) || 240) : menu.getBoundingClientRect().width,
        h: estimate ? items(menu).length * it.height + 2 * (pad + line) : menu.getBoundingClientRect().height
      };
    }
    var z = size(), w = z.w, h = z.h;
    function clampY(t) { return Math.min(Math.max(edge, t), Math.max(edge, vh - h - edge)); }
    var left, top, side = null;
    if (!sx.drill) {
      var rtl = getComputedStyle(item).direction === "rtl";
      var x = { right: p.right - line, left: p.left - w + line };          // left edge on either side of the parent
      var reading = rtl ? "left" : "right", other = rtl ? "right" : "left";
      var went = s(parent).side;
      var order = keep ? (sx.side ? [sx.side] : []) : went ? [went] : [reading, other];
      var above = [];                                                      // the menus above the parent stay readable
      for (var m = parentMenu(parent); m; m = parentMenu(m)) if (!m.hasAttribute(REPLACED)) above.push(m.getBoundingClientRect());
      top = clampY(it.top - pad - line);
      for (var k = 0; k < order.length && side === null; k++) {
        var at = x[order[k]];
        if (keep || (at >= edge && at + w <= vw - edge && !covers(at, top))) { side = order[k]; left = at; }
      }
    }
    if (side === null) {                                                   // drill-in: in the parent's place
      if (!sx.drill) { sx.drill = true; addBack(menu, item); menu.style.inlineSize = Math.round(p.width) + "px"; }
      z = size(); w = z.w; h = z.h;
      sx.up = parent.style.bottom !== "" || s(parent).up;                 // a parent above its button: grow upwards
      var base = parent;                                                   // the level whose place this path took
      while (s(base).drill && parentMenu(base)) base = parentMenu(base);
      var b0 = base.getBoundingClientRect();
      left = p.left;
      top = clampY(sx.up ? b0.bottom - h : b0.top);
    }
    sx.side = side;
    left = Math.min(Math.max(edge, left), Math.max(edge, vw - w - edge));
    menu.style.right = ""; menu.style.bottom = "";
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
    function cut(a, b) {
      return { left: Math.max(a.left, b.left), right: Math.min(a.right, b.right), top: Math.max(a.top, b.top), bottom: Math.min(a.bottom, b.bottom) };
    }
    function area(r) { return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top); }
    function covers(left, top) {                                           // what the parent already covers does not count
      var box = { left: left, right: left + w, top: top, bottom: top + h };
      return above.some(function (r) {
        var seen = cut(box, { left: r.left + line, right: r.right - line, top: r.top + line, bottom: r.bottom - line });
        return area(seen) - area(cut(seen, p)) > 0;
      });
    }
  }

  // The browser shows and hides the popover (popovertarget, Escape, click outside); these two events keep the rest in step.
  document.addEventListener("beforetoggle", function (event) {
    var menu = event.target;
    if (!(menu instanceof Element) || !menu.classList.contains("sb-menu")) return;
    var button = buttonOf(menu);
    if (event.newState === "open") { if (button) place(menu, button, true); return; }
    var x = s(menu);
    x.focusInside = !x.noReturn && menu.contains(document.activeElement);
    var pm = parentMenu(menu);
    if (x.drill && pm) pm.removeAttribute(REPLACED);                       // the parent is seen again before focus goes back
  }, true);
  document.addEventListener("toggle", function (event) {
    var menu = event.target;
    if (!(menu instanceof Element) || !menu.classList.contains("sb-menu")) return;
    var button = buttonOf(menu), x = s(menu);
    var open = event.newState === "open";
    if (button) button.setAttribute("aria-expanded", String(open));
    if (open) {
      items(menu).forEach(function (i) { i.tabIndex = -1; });
      if (button) place(menu, button, false);
      scrollStop(menu);
      if (!menu.contains(document.activeElement)) focusItem(menu, x.focus);   // a letter typed at once already moved in
      x.focus = "first"; x.noReturn = false;
      if (x.drill && parentMenu(menu) && menu.matches(":popover-open")) parentMenu(menu).setAttribute(REPLACED, "");   // focus is in: hide the parent
      return;
    }
    // focus was in the menu (Escape, ArrowLeft in a submenu): back to the button, unless focus has gone elsewhere
    // meanwhile (a click outside on something that takes focus) or the button itself went away with a parent menu
    var a = document.activeElement;
    var lost = !a || a === document.body || menu.contains(a) || a === button;
    if (x.focusInside && button && lost) {
      var to = backTo(menu, button);
      if (visible(to)) to.focus({ preventScroll: true });
    }
    x.focusInside = false; x.noReturn = false; x.returnTo = null;
    if (x.drill) { removeBack(menu); menu.style.inlineSize = ""; x.drill = false; x.up = false; }
    if (menu.getAttribute("data-sb-scroll-stop") === "") { menu.removeAttribute("tabindex"); menu.removeAttribute("data-sb-scroll-stop"); }
  }, true);
  // a menu taller than its room scrolls (max-block-size in sebaro.css), but every item has tabindex -1 (roving focus),
  // so nothing in it could be reached to scroll it by keys: while it scrolls the menu itself is a tab stop; when it
  // fits again, or closes, the stop goes (a tabindex the page set itself is left alone)
  function scrollStop(menu) {
    var mine = menu.getAttribute("data-sb-scroll-stop") === "";
    if (menu.hasAttribute("tabindex") && !mine) return;
    if (menu.scrollHeight > menu.clientHeight + 1) { menu.tabIndex = 0; menu.setAttribute("data-sb-scroll-stop", ""); }
    else if (mine) { menu.removeAttribute("tabindex"); menu.removeAttribute("data-sb-scroll-stop"); }
  }
  window.addEventListener("resize", function () {
    document.querySelectorAll(".sb-menu:popover-open").forEach(scrollStop);
  });

  // A button without popovertarget: the script toggles the menu itself, naming the button as the source so that a
  // press on it is not also a click outside (where the browser cannot take a source, the state before the press counts).
  var openAtPress = new WeakMap();
  document.addEventListener("pointerdown", function (event) {
    var button = event.target instanceof Element ? event.target.closest("[aria-haspopup='menu']:not([popovertarget])") : null;
    var menu = button && menuOf(button);
    if (menu) openAtPress.set(button, menu.matches(":popover-open"));
  }, true);
  document.addEventListener("click", function (event) {
    var button = event.target instanceof Element ? event.target.closest("[aria-haspopup='menu']") : null;
    if (!button || button.hasAttribute("popovertarget")) return;
    var menu = menuOf(button);
    if (!menu) return;
    var wasOpen = openAtPress.has(button) ? openAtPress.get(button) : menu.matches(":popover-open");
    openAtPress.delete(button);
    if (wasOpen) { if (menu.matches(":popover-open")) menu.hidePopover(); return; }
    if (!menu.matches(":popover-open")) {
      try { menu.showPopover({ source: button }); } catch (e) { menu.showPopover(); }
    }
  });

  // Another script opens a menu for its own key (sb-window.js: F10, a lone Alt) and names where focus goes back to.
  document.addEventListener("sb-menu-open", function (event) {
    var button = event.target instanceof Element ? event.target.closest("[aria-haspopup='menu']") : null;
    var menu = button && menuOf(button);
    if (!menu) return;
    var x = s(menu), to = event.detail && event.detail.returnTo;
    x.returnTo = to instanceof Element && to !== document.body ? to : null;
    if (menu.matches(":popover-open")) { focusItem(menu, "first"); return; }
    x.focus = "first";
    if (button.hasAttribute("popovertarget")) button.click();                // keeps the native invoker link
    else { try { menu.showPopover({ source: button }); } catch (e) { menu.showPopover(); } }
  });

  // Choosing an item: close the whole menu and give focus back first (capture phase, before the item's own handlers).
  // An item with a submenu is not a choice: its press opens the submenu (popovertarget). The back row goes back.
  document.addEventListener("click", function (event) {
    var item = event.target instanceof Element ? event.target.closest(".sb-menu " + ITEM) : null;
    if (!item || opensSub(item)) return;
    var menu = item.closest(".sb-menu");
    if (!menu.matches(":popover-open")) return;
    if (isBack(item)) { goBack(menu); return; }
    var top = rootOf(menu), button = buttonOf(top), to = button && backTo(top, button);
    closeAll(menu);
    s(top).returnTo = null;
    if (to && visible(to)) to.focus({ preventScroll: true });
  }, true);

  document.addEventListener("keydown", function (event) {
    if (!(event.target instanceof Element)) return;
    var button = event.target.closest("[aria-haspopup='menu']"), typedMenu = null;
    if (button && !button.closest(".sb-menu") && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      var m = menuOf(button);
      if (!m) return;
      event.preventDefault();
      var which = event.key === "ArrowUp" ? "last" : "first";
      if (m.matches(":popover-open")) { focusItem(m, which); return; }
      s(m).focus = which;
      if (button.hasAttribute("popovertarget")) button.click();                         // keeps the native invoker link
      else { try { m.showPopover({ source: button }); } catch (e) { m.showPopover(); } }
      return;
    }
    // a letter typed right after the key that opened the menu, before its toggle event moved focus in: the menu's
    if (button && !button.closest(".sb-menu") && event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      typedMenu = menuOf(button);
      if (!typedMenu || !typedMenu.matches(":popover-open")) return;
      focusItem(typedMenu, s(typedMenu).focus);
    }
    var menu = typedMenu || event.target.closest(".sb-menu");
    if (!menu || !menu.matches(":popover-open")) return;
    var list = items(menu), at = list.indexOf(document.activeElement), next = -1;
    var rtl = getComputedStyle(menu).direction === "rtl";
    var inward = rtl ? "ArrowLeft" : "ArrowRight", outward = rtl ? "ArrowRight" : "ArrowLeft";
    switch (event.key) {
      case "ArrowDown": next = at < 0 || at === list.length - 1 ? 0 : at + 1; break;
      case "ArrowUp": next = at <= 0 ? list.length - 1 : at - 1; break;
      case "Home": case "PageUp": next = 0; break;
      case "End": case "PageDown": next = list.length - 1; break;
      case inward:
        if (at >= 0 && opensSub(list[at])) { event.preventDefault(); openSub(list[at], "first"); }
        return;
      case outward:
        if (!parentMenu(menu) || !buttonOf(menu)) return;
        event.preventDefault();
        goBack(menu);
        return;
      default:
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        var x = s(menu), now = Date.now();
        x.typed = (now - x.typedAt > TYPEAHEAD_MS ? "" : x.typed) + event.key.toLowerCase();
        x.typedAt = now;
        // one letter, or the same letter again („gg“), moves to the next item with it; a word searches from here
        var same = x.typed.split("").every(function (c) { return c === x.typed[0]; });
        var key = same ? x.typed[0] : x.typed, from = same ? at + 1 : Math.max(at, 0);
        for (var k = 0; k < list.length; k++) {
          var i = (from + k) % list.length;
          if (list[i].textContent.trim().toLowerCase().indexOf(key) === 0) { next = i; break; }
        }
        if (next < 0) return;
    }
    if (next < 0 || !list.length) return;
    event.preventDefault();
    list[next].focus();
  });

  // Tab (or any other way focus leaves the open menu) closes it with all its submenus and lets focus go where it went.
  document.addEventListener("focusout", function (event) {
    var menu = event.target instanceof Element ? event.target.closest(".sb-menu") : null;
    if (!menu || !menu.matches(":popover-open")) return;
    var top = rootOf(menu), to = event.relatedTarget;
    if (to instanceof Node && (top.contains(to) || to === buttonOf(top))) return;   // a press on the button toggles it
    closeAll(menu);
  });

  // D95 (a): a change of the window's width, or a scroll that takes the button out of the window, closes the whole
  // menu like a native one (focus back to the button if it was in the menu); a change of the height alone (address
  // bar, on-screen keyboard) and any other scroll only move the open menus with their buttons
  var lastWidth = window.innerWidth;
  function closeTree(top) {
    var button = buttonOf(top), inside = top.contains(document.activeElement);
    s(top).noReturn = true;
    top.querySelectorAll(".sb-menu:popover-open").forEach(function (m) { s(m).noReturn = true; });
    top.hidePopover();
    s(top).returnTo = null;
    if (inside && button && visible(button)) button.focus({ preventScroll: true });
  }
  function follow(event) {
    var resized = event.type === "resize" && window.innerWidth !== lastWidth;
    if (event.type === "resize") lastWidth = window.innerWidth;
    document.querySelectorAll(".sb-menu:popover-open").forEach(function (menu) {
      if (parentMenu(menu) || !menu.matches(":popover-open")) return;      // a top menu; its submenus follow it
      var b = buttonOf(menu);
      if (!b) return;
      if (resized || !inView(b)) { closeTree(menu); return; }
      place(menu, b, false, true);
      menu.querySelectorAll(".sb-menu:popover-open").forEach(function (sub) { var item = buttonOf(sub); if (item) place(sub, item, false, true); });
    });
  }
  window.addEventListener("resize", follow);
  window.addEventListener("scroll", follow, { passive: true, capture: true });
})();
