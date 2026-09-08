import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "@novalis/tokens/tokens.css";
import "./styles/fonts.css";
import "./styles/app.css";

// Before anything renders: the theme this viewer last chose. `index.html`
// stamps dark statically, so this only ever corrects a light preference, and
// it runs in the module that already blocks the first paint.
try {
  const stored = localStorage.getItem("novalis.appearance");
  const dark =
    stored === "dark" ||
    ((!stored || stored === "system") && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch {
  // Private mode or blocked storage: the static `dark` stands until settings
  // arrive.
}

// A failure before React mounts would otherwise leave an empty window with no
// way to find out why (Rule 5: fail loud). This paints the reason into the
// document itself, so it survives a dead React tree and a missing catalog.
function reportFatal(what: string): void {
  document.title = `novalis — ${what}`;
  const root = document.getElementById("root");
  if (root && root.childElementCount === 0) {
    // Nothing mounted: the window would otherwise be blank, so own it.
    const pre = document.createElement("pre");
    pre.className = "fatal";
    pre.textContent = what;
    root.appendChild(pre);
    return;
  }
  // React is mounted. Bailing out here is what made a post-mount failure
  // invisible: a render error empties the tree and the window just goes white
  // with no way to find out why. Overlay instead of replacing, so a working UI
  // is not destroyed by a benign error either.
  const id = "fatal-banner";
  const existing = document.getElementById(id);
  const banner = existing ?? document.createElement("pre");
  banner.id = id;
  banner.className = "fatal";
  banner.textContent = what;
  if (!existing) document.body.appendChild(banner);
}
window.addEventListener("error", (event) => reportFatal(String(event.message)));
window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason;
  reportFatal(reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));
});

const host = document.getElementById("root");
if (!host) throw new Error("index.html is missing #root");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
