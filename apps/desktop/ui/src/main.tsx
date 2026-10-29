import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { startI18n } from "./i18n";
import { failStart, holdStart } from "./lib/start";
// sebaro's stylesheets in the order of spec/09 §1 (WEB-01, ADR-0051), after
// `theme-init.js` in index.html and before novalis's own. `sebaro.css` comes
// in the export's parts (ADOPTION §2.1a, D102 (37)), in their order, all but
// the website's (site header and footer, forms, pagination, shots: a window
// has none); they are the same rules, unlayered, so novalis's rules that
// follow win at equal specificity. The export's `fonts.css` is the only place
// a face is registered (ADR-0051 #27), and its `tokens.css` the source of
// every sebaro value, which novalis names as `--sb-*` (TEC-07, ADR-0051 #23),
// light and dark by `data-theme` on <html>.
import "./sebaro/fonts/fonts.css";
import "./sebaro/tokens.css";
import "./sebaro/icons/sprite.css";
import "./sebaro/css/parts/01-base.css";
import "./sebaro/css/parts/02-prose.css";
import "./sebaro/css/parts/04-actions.css";
import "./sebaro/css/parts/05-inputs.css";
import "./sebaro/css/parts/06-display.css";
import "./sebaro/css/parts/07-window.css";
import "./sebaro/css/parts/08-forced-print.css";
import sprite from "./sebaro/icons/sprite.svg?raw";
import "./styles/app.css";

// The icon symbols, once, at the top of <body> and as exported: `<use>` finds
// them by id (spec/09 §1; the sprite hides itself).
document.body.insertAdjacentHTML("afterbegin", sprite);

// A failure before React mounts would otherwise leave an empty window with no
// way to find out why (Rule 5: fail loud). This paints the reason into the
// document itself, so it survives a dead React tree and a missing catalog:
// sebaro's last-resort notice (`div.sb-fatal[role=alert]`, spec/09 §13.1,
// D108), the message in a `samp`, `textContent` only. It is the last child
// of <body>, outside any container React owns, and lies over the window, so
// a render error that empties the tree after mounting shows too, and a
// working UI is not destroyed by a benign error either.
function reportFatal(what: string): void {
  document.title = `novalis — ${what}`;
  // The start tile would cover the reason (lib/start.ts).
  failStart();
  const id = "fatal-notice";
  const existing = document.getElementById(id);
  const notice = existing ?? document.createElement("div");
  notice.id = id;
  notice.className = "sb-fatal";
  notice.setAttribute("role", "alert");
  const message = document.createElement("samp");
  message.textContent = what;
  notice.replaceChildren(message);
  if (!existing) document.body.appendChild(notice);
}
window.addEventListener("error", (event) => reportFatal(String(event.message)));
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  reportFatal(reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));
});

// The start tile stays until the first view is up (App.tsx, lib/start.ts):
// held here, before React mounts and long before the page's `load`.
holdStart();
startI18n();

const host = document.getElementById("root");
if (!host) throw new Error("index.html is missing #root");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
