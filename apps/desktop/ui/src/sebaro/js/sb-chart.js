// sb-chart.js: keyboard and value read-out for the heatmap of spec/02 §3.7 (D91 G6a: colour in the cell, numbers
// in the legend; every cell also gives its value as text on focus and on pointing).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval, no style attribute.
// Markup carries everything (table.sb-heatmap; each day cell holds its value sentence in .sb-visually-hidden, today
// has aria-current="date"; a .sb-chart__readout[hidden] in the same figure). Without this script the page shows a
// plain table that screen readers read cell by cell, the legend and the table „Werte als Tabelle“. This file adds:
//   - one Tab stop: the table becomes an ARIA grid (role="grid"), today's cell (else the last cell with a value)
//     has tabindex 0, the other day cells -1; arrows move by day and week, Home / End to the first / last day of the
//     week, Ctrl+Home / Ctrl+End to the first / last day of all; cells without a value (days still to come) are
//     skipped, so focus never lands on an empty place; right-to-left tables swap the two arrows;
//   - the read-out: the focused cell, or the cell under the pointer, shows its own sentence in .sb-chart__readout
//     (aria-hidden: assistive technology already reads the focused cell); a tap focuses the cell and shows it too;
//     leaving restores the hint the page wrote into the read-out.
// No motion. The script writes no words of its own (D87): the read-out copies the page's text.
(function () {
  var GRID = "table.sb-heatmap";

  function sentence(cell) {
    var t = cell && cell.querySelector(".sb-visually-hidden");
    return t ? t.textContent.trim() : "";
  }
  function isDay(cell) { return !!(cell && cell.tagName === "TD" && sentence(cell)); }
  function rows(table) { return Array.prototype.slice.call(table.tBodies[0] ? table.tBodies[0].rows : []); }
  function dayCells(table) { return Array.prototype.filter.call(table.querySelectorAll("tbody td"), isDay); }
  function readout(table) {
    var fig = table.closest("figure");
    return fig ? fig.querySelector(".sb-chart__readout") : null;
  }

  function show(table, cell) {
    var out = readout(table);
    if (!out) return;
    if (out.sbHint === undefined) out.sbHint = out.textContent;
    out.textContent = cell ? sentence(cell) : out.sbHint;
  }

  // dc = ±1: the next / previous day in reading order (a week's end continues in the next week);
  // dr = ±1: the same weekday one week later / earlier. Days without a value are skipped.
  function move(table, from, dr, dc) {
    if (dc) {
      var days = dayCells(table), at = days.indexOf(from);
      return days[at + dc] || null;
    }
    var all = rows(table), r = from.parentElement.sectionRowIndex, c = from.cellIndex;
    for (r += dr; r >= 0 && r < all.length; r += dr) {
      if (isDay(all[r].cells[c])) return all[r].cells[c];
    }
    return null;
  }

  function focusCell(table, cell) {
    if (!cell) return;
    dayCells(table).forEach(function (td) { td.tabIndex = td === cell ? 0 : -1; });
    cell.focus();
  }

  document.addEventListener("keydown", function (event) {
    if (event.altKey || event.metaKey || !(event.target instanceof Element)) return;
    var cell = event.target.closest(GRID + " td");
    if (!cell || !isDay(cell)) return;
    var table = cell.closest(GRID);
    var rtl = getComputedStyle(table).direction === "rtl";
    var days = dayCells(table), row = cell.parentElement, to = null;
    var inRow = Array.prototype.filter.call(row.cells, isDay);
    switch (event.key) {
      case "ArrowRight": if (event.ctrlKey) return; to = move(table, cell, 0, rtl ? -1 : 1); break;
      case "ArrowLeft": if (event.ctrlKey) return; to = move(table, cell, 0, rtl ? 1 : -1); break;
      case "ArrowDown": if (event.ctrlKey) return; to = move(table, cell, 1, 0); break;
      case "ArrowUp": if (event.ctrlKey) return; to = move(table, cell, -1, 0); break;
      case "Home": to = event.ctrlKey ? days[0] : inRow[0]; break;
      case "End": to = event.ctrlKey ? days[days.length - 1] : inRow[inRow.length - 1]; break;
      default: return;
    }
    event.preventDefault();   // the grid keeps arrow keys even at its edges (no page scroll)
    if (to && to !== cell) focusCell(table, to);
  });

  document.addEventListener("focusin", function (event) {
    var cell = event.target instanceof Element && event.target.closest(GRID + " td");
    if (cell && isDay(cell)) {
      var table = cell.closest(GRID);
      dayCells(table).forEach(function (td) { td.tabIndex = td === cell ? 0 : -1; });
      show(table, cell);
    }
  });
  document.addEventListener("focusout", function (event) {
    var cell = event.target instanceof Element && event.target.closest(GRID + " td");
    if (!cell) return;
    var table = cell.closest(GRID), next = event.relatedTarget;
    if (!(next instanceof Element && table.contains(next))) show(table, table.sbPointed || null);
  });
  document.addEventListener("pointerover", function (event) {
    if (!(event.target instanceof Element)) return;
    var cell = event.target.closest(GRID + " td");
    var table = cell ? cell.closest(GRID) : null;
    if (!cell || !isDay(cell)) return;
    table.sbPointed = cell;
    show(table, cell);
  });
  document.addEventListener("pointerout", function (event) {
    if (!(event.target instanceof Element)) return;
    var table = event.target.closest(GRID);
    if (!table) return;
    var next = event.relatedTarget;
    var nextCell = next instanceof Element ? next.closest(GRID + " td") : null;
    if (nextCell && table.contains(nextCell) && isDay(nextCell)) return;
    table.sbPointed = null;
    var focused = document.activeElement && document.activeElement.closest && document.activeElement.closest(GRID + " td");
    show(table, focused && table.contains(focused) ? focused : null);
  });

  function init() {
    document.querySelectorAll(GRID).forEach(function (table) {
      var days = dayCells(table);
      if (!days.length) return;
      table.setAttribute("role", "grid");
      var start = table.querySelector("tbody td[aria-current='date']");
      if (!isDay(start)) start = days[days.length - 1];
      days.forEach(function (td) { td.tabIndex = td === start ? 0 : -1; });
      var out = readout(table);
      if (out) { out.sbHint = out.textContent; out.hidden = false; }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
