// sb-calendar.js: the calendar of spec/02 §3.21 (D91 B7a, Z4a): the month on top, the list of the chosen day below
// (side by side when the calendar is wide). Classic script (pages open from file://), CSP-safe: no inline handlers,
// no eval, no innerHTML; DOM built with createElement.
// Markup carries the state, rendered at build time exactly as this script renders it, so a page without the script
// shows the month, today, the chosen day and its list:
//   <div class="sb-calendar" data-sb-calendar data-sb-month="2026-10"     (a div: no region landmark per calendar)
//            data-sb-selected="2026-10-21" data-sb-entries="2026-10-02 2026-10-21" [data-sb-today="2026-10-20"]>
//     <div class="sb-calendar__body">
//       <div class="sb-calendar__month">
//         <div class="sb-calendar__head"><p class="sb-calendar__title" id="c1-title" aria-live="polite">Oktober 2026</p>
//           <div class="sb-calendar__nav"><button class="sb-icon-button" type="button" data-sb-calendar-step="-1"
//             aria-label="Voriger Monat">…</button><button … data-sb-calendar-step="1" aria-label="Nächster Monat">…</button></div></div>
//         <table class="sb-calendar__grid" role="grid" aria-labelledby="c1-title">… thead with two-letter heads (once a day's column is narrower than two letters sebaro.css leaves every second one out of sight, D104 (21)), tbody
//           with td.sb-calendar__day[data-sb-date][tabindex], aria-current="date" on today, aria-selected="true" on the
//           chosen day …</table>
//       </div>
//       <div class="sb-calendar__agenda">
//         <h4 class="sb-calendar__agenda-title" data-sb-calendar-heading>Mittwoch, 21. Oktober</h4>
//         <ul class="sb-calendar__entries" data-sb-calendar-day="2026-10-21">…</ul>   (one list per day with entries)
//         <p class="sb-calendar__none" data-sb-calendar-day="" hidden>Nichts eingetragen.</p>
//       </div>
//     </div>
//   </div>
// What the script adds (ARIA grid, APG date grid):
//   - roving tabindex: one day is in the tab order (the chosen day, else the 1st); arrows move by a day / a week,
//     Home / End to the start / end of the week, PageUp / PageDown by a month (with Shift by a year); moving past the
//     month renders the next one; Enter, Space or a click chooses the day;
//   - „Voriger Monat“ / „Nächster Monat“ (data-sb-calendar-step) render the month in place; the title is a polite
//     live region, so the new month is announced; focus stays on the button;
//   - choosing a day sets aria-selected, shows the list with data-sb-calendar-day="<date>" (else the one with
//     data-sb-calendar-day=""), writes the day heading and fires "sb-calendar-select" (detail.date, ISO) on the root.
// Words and formats per language (D87, spec/09 §6.1): month and day names come from Intl in the language of the
// calendar (closest [lang], else <html lang>); the two-letter weekday heads (D82, spec/07 §3.1 rule 8), the week start
// fallback and the hidden words „heute“, „mit Eintrag“ from MESSAGES; window.sbMessages["sb-calendar"] adds a language.
// The week start comes from Intl.Locale weekInfo where the browser has it.
// No motion (D80): a new month replaces the grid in place. The dot of a day with entries is a glyph (D91 Z4a) drawn by
// CSS, and the day says „mit Eintrag“ in words. Products leave data-sb-today out (today = the device's date); tests
// and specimens set it so screenshots stay the same.
// sbCalendar.render(root) re-renders after a product changed data-sb-entries or data-sb-month.
(function () {
  "use strict";
  var MESSAGES = {
    de: { weekdays: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], today: "heute", withEntry: "mit Eintrag", firstDay: 1 },
    en: { weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"], today: "today", withEntry: "has entries", firstDay: 7 }
  };
  var extra = window.sbMessages && window.sbMessages["sb-calendar"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });

  function langOf(el) {
    var holder = el.closest("[lang]");
    return ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
  }
  function table(lang) { return MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de; }
  function t(lang, key) { var tb = table(lang); return tb[key] != null ? tb[key] : MESSAGES.de[key]; }
  function firstDay(lang) {                         // 1 = Monday … 7 = Sunday
    try {
      var loc = new Intl.Locale(lang);
      var info = typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
      if (info && info.firstDay) return info.firstDay;
    } catch (e) { /* no Intl.Locale: the table below */ }
    return t(lang, "firstDay");
  }

  // dates as local calendar days, ISO "YYYY-MM-DD" in attributes
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) {
    var p = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s || "");
    return p ? new Date(+p[1], +p[2] - 1, p[3] ? +p[3] : 1) : null;
  }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function addMonths(d, n) {                        // the same day in the target month, clamped to its last day
    var last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
    return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
  }
  function isoWeekday(d) { return d.getDay() === 0 ? 7 : d.getDay(); }

  function state(root) {
    var lang = langOf(root);
    var selected = parse(root.getAttribute("data-sb-selected"));
    var month = parse(root.getAttribute("data-sb-month")) || selected || new Date();
    return {
      lang: lang,
      month: new Date(month.getFullYear(), month.getMonth(), 1),
      selected: selected,
      today: parse(root.getAttribute("data-sb-today")) || new Date(),
      entries: (root.getAttribute("data-sb-entries") || "").split(/[\s,]+/).filter(Boolean)
    };
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ------------------------------------------------------------------ render the month (title + grid)
  function render(root, focusDate) {
    var s = state(root), grid = root.querySelector(".sb-calendar__grid"), title = root.querySelector(".sb-calendar__title");
    if (!grid) return;
    var start = firstDay(s.lang), heads = t(s.lang, "weekdays");
    var longDay = new Intl.DateTimeFormat(s.lang, { weekday: "long" });
    var cellName = new Intl.DateTimeFormat(s.lang, { weekday: "long", day: "numeric", month: "long" });
    if (title) title.textContent = new Intl.DateTimeFormat(s.lang, { month: "long", year: "numeric" }).format(s.month);

    var thead = el("thead"), hr = el("tr");
    for (var i = 0; i < 7; i++) {
      var wd = ((start - 1 + i) % 7) + 1;            // ISO weekday of column i
      var th = el("th", null, heads[wd - 1]);
      th.scope = "col";
      th.abbr = longDay.format(new Date(2024, 0, wd));   // 1 Jan 2024 was a Monday
      hr.appendChild(th);
    }
    thead.appendChild(hr);

    var tbody = el("tbody"), first = s.month, days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    var lead = (isoWeekday(first) - start + 7) % 7, row = el("tr"), todayIso = iso(s.today);
    var selIso = s.selected ? iso(s.selected) : "", inMonth = s.selected && s.selected.getMonth() === first.getMonth() && s.selected.getFullYear() === first.getFullYear();
    var tabIso = focusDate && focusDate.getMonth() === first.getMonth() ? iso(focusDate) : inMonth ? selIso : iso(first);
    for (var k = 0; k < lead; k++) row.appendChild(el("td"));
    for (var day = 1; day <= days; day++) {
      var d = new Date(first.getFullYear(), first.getMonth(), day), key = iso(d);
      var td = el("td", "sb-calendar__day");
      td.setAttribute("data-sb-date", key);
      td.tabIndex = key === tabIso ? 0 : -1;
      var words = [cellName.format(d)];
      if (key === todayIso) { td.setAttribute("aria-current", "date"); words.push(t(s.lang, "today")); }
      if (s.entries.indexOf(key) >= 0) { td.setAttribute("data-sb-entry", ""); words.push(t(s.lang, "withEntry")); }
      if (key === selIso) td.setAttribute("aria-selected", "true");
      var num = el("span", "sb-calendar__date", String(day));
      num.setAttribute("aria-hidden", "true");
      td.appendChild(num);
      td.appendChild(el("span", "sb-visually-hidden", words.join(", ")));
      row.appendChild(td);
      if ((lead + day) % 7 === 0) { tbody.appendChild(row); row = el("tr"); }
    }
    if (row.children.length) {
      while (row.children.length < 7) row.appendChild(el("td"));
      tbody.appendChild(row);
    }
    grid.replaceChildren(thead, tbody);
    root.setAttribute("data-sb-month", first.getFullYear() + "-" + pad(first.getMonth() + 1));
  }

  // ------------------------------------------------------------------ the chosen day's list
  function showDay(root) {
    var s = state(root), agenda = root.querySelector(".sb-calendar__agenda");
    if (!agenda || !s.selected) return;
    var key = iso(s.selected), lists = agenda.querySelectorAll("[data-sb-calendar-day]"), match = null, none = null;
    Array.prototype.forEach.call(lists, function (l) {
      var d = l.getAttribute("data-sb-calendar-day");
      if (d === key) match = l; else if (d === "") none = none || l;
    });
    Array.prototype.forEach.call(lists, function (l) { l.hidden = l !== (match || none); });
    var head = agenda.querySelector("[data-sb-calendar-heading]");
    if (head) head.textContent = new Intl.DateTimeFormat(s.lang, { weekday: "long", day: "numeric", month: "long" }).format(s.selected);
  }

  function choose(root, date) {
    root.setAttribute("data-sb-selected", iso(date));
    root.querySelectorAll(".sb-calendar__day[aria-selected]").forEach(function (c) { c.removeAttribute("aria-selected"); });
    var cell = root.querySelector('.sb-calendar__day[data-sb-date="' + iso(date) + '"]');
    if (cell) cell.setAttribute("aria-selected", "true");
    showDay(root);
    root.dispatchEvent(new CustomEvent("sb-calendar-select", { bubbles: true, detail: { date: iso(date) } }));
  }

  function focusDay(root, date) {
    var cell = root.querySelector('.sb-calendar__day[data-sb-date="' + iso(date) + '"]');
    if (!cell) {                                     // another month: render it, then focus
      root.setAttribute("data-sb-month", date.getFullYear() + "-" + pad(date.getMonth() + 1));
      render(root, date);
      cell = root.querySelector('.sb-calendar__day[data-sb-date="' + iso(date) + '"]');
    }
    if (!cell) return;
    root.querySelectorAll(".sb-calendar__day[tabindex='0']").forEach(function (c) { c.tabIndex = -1; });
    cell.tabIndex = 0;
    cell.focus();
  }

  document.addEventListener("keydown", function (event) {
    var cell = event.target instanceof Element ? event.target.closest(".sb-calendar__day") : null;
    var root = cell && cell.closest("[data-sb-calendar]");
    if (!root || event.altKey || event.ctrlKey || event.metaKey) return;
    var d = parse(cell.getAttribute("data-sb-date")), s = state(root), rtl = getComputedStyle(root).direction === "rtl";
    var start = firstDay(s.lang), col = (isoWeekday(d) - start + 7) % 7, next = null;
    switch (event.key) {
      case "ArrowRight": next = addDays(d, rtl ? -1 : 1); break;
      case "ArrowLeft": next = addDays(d, rtl ? 1 : -1); break;
      case "ArrowDown": next = addDays(d, 7); break;
      case "ArrowUp": next = addDays(d, -7); break;
      case "Home": next = addDays(d, -col); break;
      case "End": next = addDays(d, 6 - col); break;
      case "PageUp": next = addMonths(d, event.shiftKey ? -12 : -1); break;
      case "PageDown": next = addMonths(d, event.shiftKey ? 12 : 1); break;
      case "Enter": case " ": event.preventDefault(); choose(root, d); return;
      default: return;
    }
    event.preventDefault();
    focusDay(root, next);
  });

  document.addEventListener("click", function (event) {
    if (!(event.target instanceof Element)) return;
    var step = event.target.closest("[data-sb-calendar-step]");
    var root = event.target.closest("[data-sb-calendar]");
    if (!root) return;
    if (step) {
      var s = state(root), n = +step.getAttribute("data-sb-calendar-step") || 0;
      var target = new Date(s.month.getFullYear(), s.month.getMonth() + n, 1);
      root.setAttribute("data-sb-month", target.getFullYear() + "-" + pad(target.getMonth() + 1));
      render(root);
      return;
    }
    var cell = event.target.closest(".sb-calendar__day");
    if (!cell) return;
    var d = parse(cell.getAttribute("data-sb-date"));
    focusDay(root, d);
    choose(root, d);
  });

  function init() {
    document.querySelectorAll("[data-sb-calendar]").forEach(function (root) { render(root); showDay(root); });
  }
  window.sbCalendar = { render: function (root) { render(root); showDay(root); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
