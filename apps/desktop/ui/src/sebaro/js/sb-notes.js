// sb-notes.js: footnote popover below 1024 px (spec/03 §5.3, spec/09 §9; research/12 §6.9 sketch A as a classic
// script, because pages open from file:// cannot load modules). The list „Belege“ always stays visible; the popover
// only saves the jump. Without script or the Popover API the digit's link jumps to the note (progressive enhancement).
// Needs one element: <div class="sb-note-popover" id="sb-note-popover" popover aria-labelledby="sb-note-popover-claim">
// with .sb-note-popover__claim, .sb-note-popover__body and the „Schließen“ button .sb-note-popover__close.
// Focus after a jump (spec/03 §5.3, also without the popover element): a digit's jump puts focus on its note
// (tabindex="-1", no ring while the note's edge stands), so a screen reader reads it and Tab reaches its back links;
// a back link puts focus back on its digit.
(function () {
  function focusAfterJump(el, event) {
    if (!el) return;
    setTimeout(function () {                                       // after the browser's own jump
      if (event.defaultPrevented) return;                          // the popover below took the press
      if (!el.matches("a[href], button, input, select, textarea, summary, [tabindex]")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    }, 0);
  }
  function byHash(a) {
    try { return document.getElementById(decodeURIComponent(a.hash.slice(1))); } catch (e) { return null; }
  }
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var a = event.target.closest(".sb-note-ref[href^='#'], .sb-note__back[href^='#']");
    if (a) focusAfterJump(byHash(a), event);
  });
})();
(function () {
  var pop = document.getElementById("sb-note-popover");
  if (!pop || typeof pop.showPopover !== "function") return;     // jump to the note instead
  var narrow = window.matchMedia("(max-width: 63.99rem)");
  var from = null, focusWasInside = false;
  document.addEventListener("click", function (event) {
    var ref = event.target.closest(".sb-note-ref");
    if (!ref || !narrow.matches) return;
    var note = document.getElementById(ref.hash.slice(1));
    if (!note) return;                                            // broken reference: let the jump fail visibly
    event.preventDefault();
    pop.querySelector(".sb-note-popover__claim").textContent = ref.getAttribute("data-claim-text") || "";
    var body = note.querySelector(".sb-note__body").cloneNode(true);
    body.removeAttribute("id");
    pop.querySelector(".sb-note-popover__body").replaceChildren(body);
    from = ref;
    ref.setAttribute("aria-expanded", "true");
    pop.showPopover();
    pop.querySelector(".sb-note-popover__close").focus();
  });
  pop.addEventListener("beforetoggle", function (event) {
    if (event.newState === "closed") focusWasInside = pop.contains(document.activeElement);
  });
  pop.addEventListener("toggle", function (event) {               // Escape, light dismiss, Android back, „Schließen“
    if (event.newState !== "closed" || !from) return;
    from.setAttribute("aria-expanded", "false");
    if (focusWasInside) from.focus({ preventScroll: true });
    from = null;
  });
})();
