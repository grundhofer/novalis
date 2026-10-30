// sb-tree.js: keyboard and pointer behaviour of the sebaro tree (spec/02 §4.14; ARIA APG tree view pattern; D67 (2),
// (9), D80). Classic script (pages open from file://), CSP-safe: no inline handlers, no eval, no style attributes in
// markup (the indent of a deep row is set through the CSSOM, like sb-window.js sets a pane's width).
// Progressive enhancement: the markup already carries the state (aria-expanded on parent rows, hidden on the groups of
// closed ones, aria-selected on the chosen row, tabindex 0 on one row); without this script the tree shows that state
// and only loses the interaction.
//   ul.sb-tree[role="tree"] > li[role="none"] > .sb-tree__row[role="treeitem"][aria-level][aria-owns="<group id>"]
//                                             + ul.sb-tree__group[role="group"][id]
//   ↓ ↑            next / previous visible row          Home / End   first / last visible row
//   →              opens a closed row; on an open row moves to its first child
//   ←              closes an open row; on a child moves to its parent
//   Enter, Space   chooses the row (aria-selected; one per tree) and fires "sb-tree-select" (bubbles, detail.item)
//   letters        typeahead: the next visible row whose name starts with what was typed (within 500 ms)
//   pointer        a click chooses the row; a click on the twist (.sb-tree__twist) or a double click opens / closes it
//   folders        a folder without a view of its own (data-sb-folder-toggle on the row or the tree, D102 (17)):
//                  choosing it also opens or closes it (click, Enter, Space; provisional, agent: a toggle)
//   ⌘↓ (macOS)     opens the row like Enter (a folder opens, never closes), as in the Finder (D102 (17))
//   indent         sebaro.css indents levels 1–8 by 16 px each; a row deeper than 8 gets --sb-tree-indent = level − 1
//                  here, so every level keeps its 16 px (spec/02 §4.14), also for rows added or moved later
// The tree writes no words, so it has no message table (D87).
(function () {
  "use strict";
  var TYPEAHEAD_MS = 500;

  function rows(tree) { return Array.prototype.slice.call(tree.querySelectorAll("[role='treeitem']")); }
  function isShown(tree, row) {
    var group = row.parentElement && row.parentElement.closest("[role='group']");
    while (group && tree.contains(group)) {
      if (group.hidden) return false;
      group = group.parentElement && group.parentElement.closest("[role='group']");
    }
    return true;
  }
  function visibleRows(tree) { return rows(tree).filter(function (r) { return isShown(tree, r); }); }
  function groupOf(row) {
    var id = row.getAttribute("aria-owns");
    var g = id ? document.getElementById(id.split(/\s+/)[0]) : null;
    if (!g && row.nextElementSibling && row.nextElementSibling.getAttribute("role") === "group") g = row.nextElementSibling;
    return g;
  }
  function parentOf(tree, row) {
    var group = row.parentElement && row.parentElement.closest("[role='group']");
    if (!group || !tree.contains(group)) return null;
    var owner = group.id ? tree.querySelector("[role='treeitem'][aria-owns~='" + group.id + "']") : null;
    if (!owner && group.previousElementSibling && group.previousElementSibling.getAttribute("role") === "treeitem") owner = group.previousElementSibling;
    return owner;
  }
  function isParent(row) { return row.hasAttribute("aria-expanded"); }
  function isOpen(row) { return row.getAttribute("aria-expanded") === "true"; }
  function setOpen(row, open) {
    if (!isParent(row)) return;
    row.setAttribute("aria-expanded", String(open));
    var g = groupOf(row);
    if (g) g.hidden = !open;
  }
  function focusRow(tree, row) {
    if (!row) return;
    rows(tree).forEach(function (r) { r.tabIndex = r === row ? 0 : -1; });
    row.focus();
  }
  function choose(tree, row) {
    rows(tree).forEach(function (r) { r.setAttribute("aria-selected", String(r === row)); });
    row.dispatchEvent(new CustomEvent("sb-tree-select", { bubbles: true, detail: { item: row } }));
  }
  function folderToggles(tree, row) {
    return isParent(row) && (row.hasAttribute("data-sb-folder-toggle") || tree.hasAttribute("data-sb-folder-toggle"));
  }
  function isMac() {
    var p = document.documentElement.getAttribute("data-sb-platform");
    if (p) return p === "mac";
    var ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "";
    return /mac|iphone|ipad|ipod/i.test(ua);
  }
  function nameOf(row) {
    var n = row.querySelector(".sb-row__name");
    return (n || row).textContent.trim().toLowerCase();
  }

  function typeahead(tree, row, ch) {
    var s = tree._sbType || (tree._sbType = { text: "", timer: 0 });
    clearTimeout(s.timer);
    s.text += ch.toLowerCase();
    s.timer = setTimeout(function () { s.text = ""; }, TYPEAHEAD_MS);
    var list = visibleRows(tree), start = list.indexOf(row);
    var single = s.text.split("").every(function (c) { return c === s.text[0]; });
    // the same letter pressed again cycles through the rows with that letter; more letters search from this row
    for (var i = 1; i <= list.length; i++) {
      var cand = list[(start + (single ? i : i - 1) + list.length) % list.length];
      var name = nameOf(cand);
      if (single ? name.charAt(0) === s.text[0] : name.indexOf(s.text) === 0) { focusRow(tree, cand); return; }
    }
  }

  document.addEventListener("keydown", function (event) {
    var row = event.target instanceof Element ? event.target.closest(".sb-tree [role='treeitem']") : null;
    if (!row || event.target !== row) return;
    var tree = row.closest("[role='tree']");
    if (!tree) return;
    if (event.key === "ArrowDown" && event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && isMac()) {
      if (isParent(row)) setOpen(row, true);   // ⌘↓ opens: a folder, a document by choosing it
      if (!folderToggles(tree, row)) choose(tree, row);
      event.preventDefault();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    var list = visibleRows(tree), i = list.indexOf(row), handled = true;
    switch (event.key) {
      case "ArrowDown": focusRow(tree, list[i + 1]); break;
      case "ArrowUp": focusRow(tree, list[i - 1]); break;
      case "Home": focusRow(tree, list[0]); break;
      case "End": focusRow(tree, list[list.length - 1]); break;
      case "ArrowRight":
        if (isParent(row) && !isOpen(row)) setOpen(row, true);
        else if (isOpen(row)) { var g = groupOf(row); focusRow(tree, g && g.querySelector("[role='treeitem']")); }
        break;
      case "ArrowLeft":
        if (isOpen(row)) setOpen(row, false);
        else focusRow(tree, parentOf(tree, row));
        break;
      case "Enter": case " ": choose(tree, row); if (folderToggles(tree, row)) setOpen(row, !isOpen(row)); break;
      default:
        handled = false;
        if (event.key.length === 1 && /\S/.test(event.key)) { typeahead(tree, row, event.key); handled = true; }
    }
    if (handled) event.preventDefault();
  });

  document.addEventListener("click", function (event) {
    var row = event.target instanceof Element ? event.target.closest(".sb-tree [role='treeitem']") : null;
    if (!row) return;
    var tree = row.closest("[role='tree']");
    if (!tree) return;
    if (event.target.closest(".sb-tree__twist") && isParent(row)) setOpen(row, !isOpen(row));
    else { choose(tree, row); if (folderToggles(tree, row) && event.detail < 2) setOpen(row, !isOpen(row)); }
    focusRow(tree, row);
  });
  document.addEventListener("dblclick", function (event) {
    var row = event.target instanceof Element ? event.target.closest(".sb-tree [role='treeitem']") : null;
    // a toggling folder already turned with each click of the double click
    var tree = row && row.closest("[role='tree']");
    if (row && tree && isParent(row) && !event.target.closest(".sb-tree__twist") && !folderToggles(tree, row)) setOpen(row, !isOpen(row));
  });

  // levels 1–8 have their rule in sebaro.css (also without this script); deeper rows get the same 16 px per level here
  var CSS_LEVELS = 8;
  function indent(tree) {
    rows(tree).forEach(function (r) {
      var level = parseInt(r.getAttribute("aria-level"), 10);
      if (isFinite(level) && level > CSS_LEVELS) r.style.setProperty("--sb-tree-indent", String(level - 1));
      else if (r.style.getPropertyValue("--sb-tree-indent")) r.style.removeProperty("--sb-tree-indent");
    });
  }

  function init() {
    document.querySelectorAll(".sb-tree[role='tree']").forEach(function (tree) {
      indent(tree);
      if (typeof MutationObserver === "function") {
        new MutationObserver(function () { indent(tree); }).observe(tree, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-level"] });
      }
      rows(tree).forEach(function (r) { if (isParent(r)) { var g = groupOf(r); if (g) g.hidden = !isOpen(r); } });
      var shown = visibleRows(tree);
      var start = shown.filter(function (r) { return r.getAttribute("aria-selected") === "true"; })[0] ||
                  shown.filter(function (r) { return r.tabIndex === 0; })[0] || shown[0];
      rows(tree).forEach(function (r) { r.tabIndex = r === start ? 0 : -1; });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
