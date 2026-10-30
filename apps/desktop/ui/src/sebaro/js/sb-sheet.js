// sb-sheet.js: the bottom sheet of spec/02 §4.7 as a modal (D80 „Sheet mit Fokusfalle“).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval.
// Markup carries the state; the sheet is a native modal dialog, so the page behind it is inert while it is open:
//   <button class="sb-secondary-action" type="button" data-sb-opens="s1" aria-haspopup="dialog">Kategorie: Gesundheit</button>
//   <dialog class="sb-sheet" id="s1" aria-labelledby="s1-title">
//     <form method="dialog">
//       <div class="sb-sheet__head"><h2 class="sb-sheet__title" id="s1-title">Kategorie wählen</h2>
//         <button class="sb-icon-button" aria-label="Schließen">…</button></div>
//       … radio rows, the checked one with autofocus …
//     </form>
//   </dialog>
// Opening: [data-sb-opens="<id>"] (sb-controls.js, the same trigger as the confirmation dialog) or
// sbSheet.open(sheet) from product code; both call showModal(). Closing without this script: Escape and the close
// button (form method="dialog"). What this script adds:
//   - a press on the scrim (outside the sheet) closes it;
//   - focus trap: Tab and Shift+Tab wrap inside the sheet instead of leaving for the browser's own controls;
//   - focus goes back to what opened the sheet when it closes (also when the opener is not the native fallback);
//   - sbSheet.open(sheet) / sbSheet.close(sheet, value) for product code.
// Motion: the sheet enters from below through the .sb-sheet:modal rule of sebaro.css (an answer to the press; fade
// only under reduced motion or data-sb-motion="reduce", D80); it closes without motion. The page behind does not
// scroll while a sheet is open (scripts.css). The script writes no words (D87).
(function () {
  var FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), " +
                  "textarea:not([disabled]), [tabindex]:not([tabindex='-1']), summary";
  var from = new WeakMap();                                   // sheet -> element that had focus before it opened

  function isSheet(el) { return el instanceof HTMLDialogElement && el.classList.contains("sb-sheet"); }
  function open(sheet, opener) {
    if (!isSheet(sheet) || sheet.open) return;
    from.set(sheet, opener || document.activeElement);
    sheet.showModal();
  }
  function close(sheet, value) { if (isSheet(sheet) && sheet.open) sheet.close(value); }
  window.sbSheet = { open: open, close: close };

  // Remember the opener of a [data-sb-opens] sheet before sb-controls.js opens it (capture phase runs first).
  document.addEventListener("click", function (event) {
    var opener = event.target instanceof Element ? event.target.closest("[data-sb-opens]") : null;
    if (!opener) return;
    var sheet = document.getElementById(opener.getAttribute("data-sb-opens"));
    if (isSheet(sheet) && !sheet.open) from.set(sheet, opener);
  }, true);

  // The scrim: a press on the dialog element outside its box is a press on ::backdrop.
  document.addEventListener("click", function (event) {
    var sheet = event.target;
    if (!isSheet(sheet) || !sheet.open || event.detail === 0) return;   // detail 0 = a keyboard "click"
    var r = sheet.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(sheet, "");
  });

  // Focus trap: wrap Tab inside the open sheet.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Tab") return;
    var sheet = document.querySelector("dialog.sb-sheet:modal");
    if (!sheet) return;
    var list = Array.prototype.filter.call(sheet.querySelectorAll(FOCUSABLE), function (el) {
      if (el.getClientRects().length === 0) return false;     // not rendered
      if (el.type === "radio" && el.name && !el.checked) {    // a radio group is one Tab stop: its checked radio
        var group = sheet.querySelectorAll("input[type='radio'][name='" + CSS.escape(el.name) + "']");
        return !Array.prototype.some.call(group, function (r) { return r.checked; }) && el === group[0];
      }
      return true;
    });
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1], active = document.activeElement;
    if (!sheet.contains(active)) { event.preventDefault(); first.focus(); return; }
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  });

  // Focus back to the opener (close does not bubble: listen in the capture phase).
  document.addEventListener("close", function (event) {
    var sheet = event.target;
    if (!isSheet(sheet)) return;
    var opener = from.get(sheet);
    from.delete(sheet);
    if (opener && opener !== document.body && document.contains(opener) &&
        (document.activeElement === document.body || document.activeElement === null || sheet.contains(document.activeElement))) {
      opener.focus({ preventScroll: true });
    }
  }, true);
})();
