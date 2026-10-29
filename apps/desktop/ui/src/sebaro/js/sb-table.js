// sb-table.js: sortable table heads of spec/02 §3.9 (D80 „Tabellen-Sortierung“, D91 B5a).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval.
// Markup carries the state, so a page without this script shows the order it was rendered in:
//   <th scope="col" class="sb-num" aria-sort="descending"><button class="sb-table__sort" type="button">
//     <svg class="sb-icon sb-icon--16" aria-hidden="true" focusable="false"><use href="#arrow-down--16"/></svg>Betrag</button></th>
//   Only the sorted column has aria-sort and the arrow; every other sortable head is a button with its word only.
// What the script adds:
//   - a press on a head sorts the rows of every tbody (tfoot and its sum row stay where they are); the first press
//     sorts numbers and dates descending and words ascending, the next press on the same head turns the order round;
//   - aria-sort moves to the sorted head, the arrow (arrow-down--16 / arrow-up--16) moves with it: before the word in a
//     number column (th.sb-num), after it in the others;
//   - the sentence „Sortiert nach Betrag, absteigend“ in a status line after the table (created when missing).
// Values: a cell's data-sb-value (machine form: 1250.00, 2026-10-01) wins; else a <time datetime> in the cell; else
// the cell text, read as a number in the table's language for number columns (de „1.250,00 €“, en „1,250.00“, both
// signs - and − U+2212) and compared as words with Intl.Collator (numeric) otherwise. A column type can be forced
// with data-sb-sort="number" | "date" | "text" on the th. Empty cells and words without a number („keine Angabe“) go
// last in both directions (D82: a gap is never 0). Rows that compare equal keep their order (stable).
// Messages follow the language of the table (closest [lang], else <html lang>): German default, English built in;
// window.sbMessages = { "sb-table": { fr: { sorted: "…", ascending: "…", descending: "…" } } } adds one (spec/09 §6.1).
// No motion: rows change place at once.
(function () {
  var MESSAGES = {
    de: { sorted: "Sortiert nach {column}, {direction}", ascending: "aufsteigend", descending: "absteigend" },
    en: { sorted: "Sorted by {column}, {direction}", ascending: "ascending", descending: "descending" }
  };
  var extra = window.sbMessages && window.sbMessages["sb-table"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  function langOf(el) {
    var holder = el && el.closest("[lang]");
    return ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
  }
  function t(el, key, vars) {
    var lang = langOf(el);
    var table = MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de;
    var text = table[key] != null ? table[key] : MESSAGES.de[key];
    return text.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }

  // the decimal sign of a language, from Intl (de „,“, en „.“)
  function decimalSign(lang) {
    try {
      var parts = new Intl.NumberFormat(lang).formatToParts(1.5);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "decimal") return parts[i].value;
    } catch (e) {}
    return ".";
  }
  function parseNumber(text, decimal) {
    var s = text.replace(/−/g, "-");
    var keep = new RegExp("[^0-9\\-" + (decimal === "." ? "\\." : decimal) + "]", "g");
    s = s.replace(keep, "");
    if (decimal !== ".") s = s.split(decimal).join(".");
    if (!/[0-9]/.test(s)) return NaN;
    return parseFloat(s);
  }

  function headRow(th) { return th.parentElement; }
  function columnIndex(th) {
    var index = 0, cells = headRow(th).cells;
    for (var i = 0; i < cells.length && cells[i] !== th; i++) index += cells[i].colSpan || 1;
    return index;
  }
  function cellAt(row, index) {
    var at = 0;
    for (var i = 0; i < row.cells.length; i++) {
      if (at === index) return row.cells[i];
      at += row.cells[i].colSpan || 1;
      if (at > index) return null;
    }
    return null;
  }
  function kindOf(th, rows, index) {
    var forced = th.getAttribute("data-sb-sort");
    if (forced === "number" || forced === "date" || forced === "text") return forced;
    if (th.classList.contains("sb-num")) return "number";
    var dates = rows.length > 0 && rows.every(function (r) { var c = cellAt(r, index); return !c || !c.textContent.trim() || c.querySelector("time[datetime]"); });
    return dates ? "date" : "text";
  }
  function valueOf(cell, kind, decimal) {
    if (!cell) return null;
    var raw = cell.getAttribute("data-sb-value");
    if (raw == null && kind !== "text") {
      var time = cell.querySelector("time[datetime]");
      if (time) raw = time.getAttribute("datetime");
    }
    if (kind === "number") {
      var n = raw != null ? parseFloat(raw) : parseNumber(cell.textContent, decimal);
      return isNaN(n) ? null : n;
    }
    if (kind === "date") {
      if (raw == null) return null;
      var d = Date.parse(raw);
      return isNaN(d) ? (raw || null) : d;
    }
    var text = (raw != null ? raw : cell.textContent).trim();
    return text === "" ? null : text;
  }

  function arrowFor(table, dir) {
    var icon = table.querySelector("thead .sb-table__sort > .sb-icon");
    if (icon) icon.parentElement.removeChild(icon);
    var NS = "http://www.w3.org/2000/svg";
    if (!icon) {
      icon = document.createElementNS(NS, "svg");
      icon.setAttribute("class", "sb-icon sb-icon--16"); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("focusable", "false");
      icon.appendChild(document.createElementNS(NS, "use"));
    }
    var use = icon.querySelector("use");
    var old = use.getAttribute("href") || use.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "#arrow-down--16";
    var base = old.indexOf("#") >= 0 ? old.slice(0, old.indexOf("#")) : "";
    use.setAttribute("href", base + "#arrow-" + (dir === "ascending" ? "up" : "down") + "--16");
    return icon;
  }
  function statusFor(table) {
    var wrap = table.closest(".sb-table-wrap") || table;
    var next = wrap.nextElementSibling;
    if (next && next.hasAttribute("data-sb-table-status")) return next;
    var p = document.createElement("p");
    p.className = "sb-visually-hidden";
    p.setAttribute("role", "status");
    p.setAttribute("data-sb-table-status", "");
    wrap.parentNode.insertBefore(p, wrap.nextSibling);
    return p;
  }

  function sort(button) {
    var th = button.closest("th"), table = th && th.closest("table");
    if (!table) return;
    var index = columnIndex(th), lang = langOf(table), decimal = decimalSign(lang);
    var bodies = Array.prototype.slice.call(table.tBodies);
    var allRows = [];
    bodies.forEach(function (b) { allRows = allRows.concat(Array.prototype.slice.call(b.rows)); });
    var kind = kindOf(th, allRows, index);
    var current = th.getAttribute("aria-sort");
    var dir = current === "ascending" ? "descending" : current === "descending" ? "ascending" : (kind === "text" ? "ascending" : "descending");
    var collator;
    try { collator = new Intl.Collator(lang, { numeric: true, sensitivity: "base" }); } catch (e) { collator = new Intl.Collator(undefined, { numeric: true }); }
    var sign = dir === "ascending" ? 1 : -1;
    bodies.forEach(function (body) {
      var rows = Array.prototype.slice.call(body.rows).map(function (row, at) { return { row: row, at: at, v: valueOf(cellAt(row, index), kind, decimal) }; });
      rows.sort(function (a, b) {
        if (a.v === null || b.v === null) return a.v === b.v ? a.at - b.at : (a.v === null ? 1 : -1);
        var c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : collator.compare(String(a.v), String(b.v));
        return c !== 0 ? sign * c : a.at - b.at;
      });
      rows.forEach(function (r) { body.appendChild(r.row); });
    });
    Array.prototype.forEach.call(headRow(th).cells, function (cell) { if (cell !== th) cell.removeAttribute("aria-sort"); });
    th.setAttribute("aria-sort", dir);
    var icon = arrowFor(table, dir);
    if (th.classList.contains("sb-num")) button.insertBefore(icon, button.firstChild); else button.appendChild(icon);
    var name = button.textContent.trim();
    statusFor(table).textContent = t(table, "sorted", { column: name, direction: t(table, dir) });
  }

  document.addEventListener("click", function (event) {
    var button = event.target instanceof Element ? event.target.closest(".sb-table__sort") : null;
    if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") sort(button);
  });
  window.sbTable = { sort: sort };
})();
