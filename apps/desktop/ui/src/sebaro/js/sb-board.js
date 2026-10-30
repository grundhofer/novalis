// sb-board.js: the swipe layout of the board on narrow screens, spec/02 §3.16 (D91 B2b).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval.
// Markup (the board works without this script: below 640 px of its width the columns sit side by side and are
// swiped, the start of the next column stays in view, every column is a named region with heading and count):
//   <div class="sb-board" id="retro-board">
//     <div class="sb-board__columns">
//       <section class="sb-board__column" aria-labelledby="c1-h">
//         <div class="sb-board__head"><h3 class="sb-board__title" id="c1-h"><span class="sb-board__name">Gut gelaufen</span>
//           <span class="sb-board__count">2<span class="sb-visually-hidden"> Karten</span></span></h3> …„Mehr“… </div>
//         <ul class="sb-board__cards">…</ul></section> …
// What the script adds, so that in the swipe layout you always know where you are and can get anywhere without
// swiping (the swipe can collide with the system's back gesture at the screen edge):
//   - the position bar .sb-board__nav before the columns (built when the markup has none): „Vorige Spalte“, the
//     position „Spalte 2 von 3: Verbessern“ (announced politely when it changes), „Nächste Spalte“; a step button at
//     either end is aria-disabled. sebaro.css shows the bar only in the swipe layout;
//   - the step buttons scroll the next / previous column into place (smooth only without reduced motion: system
//     setting, html[data-sb-motion="reduce"] or data-sb-motion="reduce" around the board);
//   - every element with data-sb-board-name="<board id>" (e.g. a span in the label „Neue Karte in „…““) shows the name
//     of the column in place, so the primary action says where a new card goes;
//   - an element with data-sb-board-target="<board id>" (written hidden: „ in „<name>““ after „Neue Karte“ in a
//     window, whose wide board names no column) is shown only while the board is in the swipe layout;
//   - the event "sb-board-column" (detail: { index, column }) on the board when the column in place changes;
//     window.sbBoard.current(board) returns that column.
// window.sbBoard.setup(board) wires a board added later (a framework calls it after mount); window.sbBoard.teardown(board)
// undoes it (before unmount, or before the board's columns are rebuilt): it disconnects the ResizeObserver, removes the
// scroll and click listeners and a pending frame, takes away the position bar the script built (a bar from the markup
// stays, as hidden as the markup had it, with its position text and step buttons as they were), gives the
// data-sb-board-name elements present at setup their markup text back, hides the data-sb-board-target words again and
// forgets the board, so setup can run on it again (spec/02 §7).
// Collaboration patterns of a web app (D104 (9), (14); spec/02 §3.29), for pages without a framework:
//   [data-sb-votes="5"]           a fixed number of votes per person (spec/02 §3.29): every .sb-vote inside it has a minus and a
//                                 plus button ([data-sb-vote="-1"] / [data-sb-vote="1"]) and its number .sb-vote__count;
//                                 a press moves one vote, never below 0 and never past the budget; minus is
//                                 aria-disabled at 0 and every plus once no vote is left; the element named by
//                                 data-sb-votes-status="<id>" says „Noch 3 von 5 Stimmen.“ / „Alle 5 Stimmen
//                                 vergeben.“ (it sits inside the action zone's state sentence, a status); fires
//                                 "sb-vote-change" (bubbles, detail { vote, count, left }) on the .sb-vote
//   svg.sb-wheel                  the wheel (spec/02 §3.29): window.sbWheel.turnTo(wheel, index) turns its .sb-wheel__disc so that
//                                 the pointer stands on the index-th name (text inside the disc, in order), forward and
//                                 less than one turn (the name already under the pointer: no turn), over
//                                 motion.duration.long (sebaro.css; reduced motion: at once),
//                                 names the result in the element of data-sb-wheel-status="<id>" („Als Nächstes: Jonas.“)
//                                 and in the wheel's name; the app calls it with the name its server drew. [data-sb-wheel-turn="<wheel id>"] („Noch mal drehen“ on a specimen page) turns
//                                 it to another name at random: a stand-in for the server, never for a product
// Tab moves through the cards and „Mehr“ buttons column by column; the browser scrolls a focused element into view and
// the scroll snap settles on its column. Messages follow the language of the board (closest [lang], else
// <html lang>): German default, English built in; more via window.sbMessages["sb-board"] (spec/09 §6.1, D87).
(function () {
  var MESSAGES = {
    de: { prev: "Vorige Spalte", next: "Nächste Spalte", position: "Spalte {n} von {m}: {name}",
          votesLeft: "Noch {left} von {n} Stimmen.", votesDone: "Alle {n} Stimmen vergeben.",
          wheelNext: "Als Nächstes: {name}.", wheelName: "Glücksrad mit {n} Namen, der Zeiger steht auf {name}" },
    en: { prev: "Previous column", next: "Next column", position: "Column {n} of {m}: {name}",
          votesLeft: "{left} of {n} votes left.", votesDone: "All {n} votes given.",
          wheelNext: "Next up: {name}.", wheelName: "Wheel with {n} names, the pointer is on {name}" }
  };
  var extra = window.sbMessages && window.sbMessages["sb-board"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  function t(el, key, vars) {
    var holder = el && el.closest("[lang]");
    var lang = ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
    var table = MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de;
    var text = table[key] != null ? table[key] : MESSAGES.de[key];
    return text.replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }
  function reduced(el) {
    return !!el.closest('[data-sb-motion="reduce"]') || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function columnsOf(scroller) {
    return Array.prototype.filter.call(scroller.children, function (c) { return c.classList.contains("sb-board__column"); });
  }
  function nameOf(column) {
    var name = column.querySelector(".sb-board__name") || column.querySelector(".sb-board__title");
    return name ? name.textContent.trim() : "";
  }
  function spriteBase(board) {
    var use = board.querySelector("use");
    var href = use ? (use.getAttribute("href") || "") : "";
    return href.indexOf("#") > 0 ? href.slice(0, href.indexOf("#")) : "";
  }
  function stepButton(board, step) {
    var NS = "http://www.w3.org/2000/svg";
    var button = document.createElement("button");
    button.className = "sb-icon-button";
    button.type = "button";
    button.setAttribute("data-sb-board-step", String(step));
    button.setAttribute("aria-label", t(board, step < 0 ? "prev" : "next"));
    var svg = document.createElementNS(NS, "svg"), use = document.createElementNS(NS, "use");
    svg.setAttribute("class", "sb-icon"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    use.setAttribute("href", spriteBase(board) + (step < 0 ? "#chevron-left" : "#chevron-right"));
    svg.appendChild(use); button.appendChild(svg);
    return button;
  }
  function buildNav(board, scroller) {
    var nav = document.createElement("div");
    nav.className = "sb-board__nav";
    var position = document.createElement("p");
    position.className = "sb-board__position";
    nav.appendChild(stepButton(board, -1));
    nav.appendChild(position);
    nav.appendChild(stepButton(board, 1));
    board.insertBefore(nav, scroller);
    return nav;
  }

  function setup(board) {
    if (board.__sbBoard) return;
    var scroller = board.querySelector(".sb-board__columns");
    if (!scroller) return;
    var own = board.querySelector(".sb-board__nav");
    var nav = own || buildNav(board, scroller);
    var position = nav.querySelector(".sb-board__position");
    var prev = nav.querySelector('[data-sb-board-step="-1"]'), next = nav.querySelector('[data-sb-board-step="1"]');
    var state = { board: board, scroller: scroller, current: -1, column: null, nav: nav, built: !own, observer: null,
                  navHidden: nav.hidden, live: position ? position.getAttribute("aria-live") : null,
                  text: position ? position.textContent : "",
                  names: board.id ? Array.prototype.map.call(document.querySelectorAll('[data-sb-board-name="' + board.id + '"]'),
                    function (el) { return [el, el.textContent]; }) : [],
                  disabled: [prev, next].map(function (b) { return b ? b.getAttribute("aria-disabled") : null; }) };
    board.__sbBoard = state;

    function inPlace(cols) {
      var box = scroller.getBoundingClientRect(), cs = getComputedStyle(scroller), rtl = cs.direction === "rtl";
      var pad = parseFloat(rtl ? cs.paddingRight : cs.paddingLeft) || 0;
      var edge = rtl ? box.right - pad : box.left + pad, best = 0, bestDistance = Infinity;
      cols.forEach(function (c, i) {
        var r = c.getBoundingClientRect(), d = Math.abs((rtl ? r.right : r.left) - edge);
        if (d < bestDistance) { bestDistance = d; best = i; }
      });
      var max = scroller.scrollWidth - scroller.clientWidth;
      if (max > 1 && Math.abs(scroller.scrollLeft) >= max - 1) best = cols.length - 1;
      return best;
    }
    function update() {
      var cols = columnsOf(scroller);
      if (!cols.length) return;
      var i = inPlace(cols), name = nameOf(cols[i]);
      if (board.id) {   // a window's label names the column only while its board swipes (§3.16, B2b weak point 3)
        var swiping = getComputedStyle(nav).display !== "none";
        document.querySelectorAll('[data-sb-board-target="' + board.id + '"]').forEach(function (el) { el.hidden = !swiping; });
      }
      var text = t(board, "position", { n: i + 1, m: cols.length, name: name });
      if (i === state.current && text === position.textContent) return;   // nothing new: no announcement
      state.current = i; state.column = cols[i];
      position.textContent = text;
      if (!position.hasAttribute("aria-live")) position.setAttribute("aria-live", "polite");
      if (prev) prev.setAttribute("aria-disabled", String(i === 0));
      if (next) next.setAttribute("aria-disabled", String(i === cols.length - 1));
      if (board.id) {
        document.querySelectorAll('[data-sb-board-name="' + board.id + '"]').forEach(function (el) { el.textContent = name; });
      }
      board.dispatchEvent(new CustomEvent("sb-board-column", { bubbles: true, detail: { index: i, column: cols[i] } }));
    }
    var frame = 0;
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(function () { frame = 0; update(); });
    }
    scroller.addEventListener("scroll", onScroll, { passive: true });
    function onStep(event) {
      var button = event.target instanceof Element ? event.target.closest("[data-sb-board-step]") : null;
      if (!button || button.getAttribute("aria-disabled") === "true") return;
      var cols = columnsOf(scroller);
      var i = Math.max(0, Math.min(cols.length - 1, state.current + Number(button.getAttribute("data-sb-board-step"))));
      cols[i].scrollIntoView({ behavior: reduced(board) ? "auto" : "smooth", block: "nearest", inline: "start" });
    }
    nav.addEventListener("click", onStep);
    if ("ResizeObserver" in window) {
      state.observer = new ResizeObserver(function () { update(); });
      state.observer.observe(scroller);
    }
    state.stop = function () {
      scroller.removeEventListener("scroll", onScroll, { passive: true });
      nav.removeEventListener("click", onStep);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (state.observer) state.observer.disconnect();
    };
    update();
    nav.hidden = false;
  }
  function teardown(board) {
    var state = board && board.__sbBoard;
    if (!state) return;
    state.stop();
    if (state.built) {
      if (state.nav.parentNode) state.nav.parentNode.removeChild(state.nav);
    } else {   // the markup's own bar: back to how the markup had it
      state.nav.hidden = state.navHidden;
      var position = state.nav.querySelector(".sb-board__position");
      if (position) {
        if (state.live === null) position.removeAttribute("aria-live"); else position.setAttribute("aria-live", state.live);
        position.textContent = state.text;
      }
      [state.nav.querySelector('[data-sb-board-step="-1"]'), state.nav.querySelector('[data-sb-board-step="1"]')].forEach(function (b, i) {
        if (!b) return;
        if (state.disabled[i] === null) b.removeAttribute("aria-disabled"); else b.setAttribute("aria-disabled", state.disabled[i]);
      });
    }
    state.names.forEach(function (pair) { pair[0].textContent = pair[1]; });
    if (board.id) {   // written hidden in the markup: hidden again without the script
      document.querySelectorAll('[data-sb-board-target="' + board.id + '"]').forEach(function (el) { el.hidden = true; });
    }
    delete board.__sbBoard;
  }
  // ---------------------------------------------------------------- votes with a budget (D104 (9), spec/02 §3.29)
  function voteBox(el) { return el.closest("[data-sb-votes]"); }
  function voteSync(box) {
    var n = parseInt(box.getAttribute("data-sb-votes"), 10) || 0, used = 0;
    box.querySelectorAll(".sb-vote__count").forEach(function (c) { used += parseInt(c.textContent, 10) || 0; });
    var left = Math.max(0, n - used);
    box.querySelectorAll(".sb-vote").forEach(function (v) {
      var count = parseInt((v.querySelector(".sb-vote__count") || {}).textContent, 10) || 0;
      v.querySelectorAll("[data-sb-vote]").forEach(function (b) {
        b.setAttribute("aria-disabled", String(b.getAttribute("data-sb-vote") === "-1" ? count <= 0 : left <= 0));
      });
    });
    var status = document.getElementById(box.getAttribute("data-sb-votes-status") || "");
    if (status) {
      var text = left > 0 ? t(box, "votesLeft", { left: left, n: n }) : t(box, "votesDone", { n: n });
      if (status.textContent !== text) status.textContent = text;
    }
    return left;
  }
  document.addEventListener("click", function (event) {
    var b = event.target instanceof Element ? event.target.closest(".sb-vote [data-sb-vote]") : null, box = b && voteBox(b);
    if (!box || b.getAttribute("aria-disabled") === "true") return;
    var vote = b.closest(".sb-vote"), out = vote.querySelector(".sb-vote__count");
    if (!out) return;
    var count = Math.max(0, (parseInt(out.textContent, 10) || 0) + (b.getAttribute("data-sb-vote") === "-1" ? -1 : 1));
    out.textContent = String(count);
    var left = voteSync(box);
    vote.dispatchEvent(new CustomEvent("sb-vote-change", { bubbles: true, detail: { vote: vote, count: count, left: left } }));
  });

  // ---------------------------------------------------------------- the wheel (D104 (14), spec/02 §3.29)
  function wheelNames(wheel) { return Array.prototype.slice.call(wheel.querySelectorAll(".sb-wheel__disc text")); }
  function turnTo(wheel, index) {
    var names = wheelNames(wheel), disc = wheel.querySelector(".sb-wheel__disc");
    if (!names.length || !disc) return;
    var i = ((index % names.length) + names.length) % names.length, step = 360 / names.length;
    // name i stands at i × step clockwise from the top; turned by r it stands at i × step + r. Forward (clockwise) to
    // the next r with i × step + r ≡ 0 (mod 360): less than one turn in 200 ms (a named exception of spec/03 §13.2), no
    // extra spins (decided with D105 (6), BA-13: at most 200 ms like every motion, still under reduced motion)
    // the name already under the pointer drawn again: the disc stays, only the status is written anew (provisional, agent)
    var now = wheel.__sbTurn || 0, base = -i * step, turn = i === (wheel.__sbIndex || 0) ? now : base + 360 * Math.ceil((now + 1 - base) / 360);
    wheel.__sbTurn = turn;
    wheel.__sbIndex = i;
    disc.style.setProperty("--sb-wheel-turn", turn + "deg");
    var name = names[i].textContent.trim();
    wheel.setAttribute("aria-label", t(wheel, "wheelName", { n: names.length, name: name }));
    var status = document.getElementById(wheel.getAttribute("data-sb-wheel-status") || "");
    if (status) status.textContent = t(wheel, "wheelNext", { name: name });
  }
  document.addEventListener("click", function (event) {
    var b = event.target instanceof Element ? event.target.closest("[data-sb-wheel-turn]") : null;
    var wheel = b && document.getElementById(b.getAttribute("data-sb-wheel-turn"));
    if (!wheel) return;
    var n = wheelNames(wheel).length, now = wheel.__sbIndex || 0;
    if (n > 1) turnTo(wheel, (now + 1 + Math.floor(Math.random() * (n - 1))) % n);
  });

  function init() {
    document.querySelectorAll(".sb-board").forEach(setup);
    document.querySelectorAll("[data-sb-votes]").forEach(voteSync);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.sbWheel = { turnTo: turnTo };
  window.sbBoard = {
    setup: setup,
    teardown: teardown,
    current: function (board) { return board && board.__sbBoard ? board.__sbBoard.column : null; }
  };
})();
