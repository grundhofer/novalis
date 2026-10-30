/**
 * sebaro's start (STR-01, spec/03 §14; ADR-0051 #26): the exported
 * `sb-start.js` keeps the 96 px tile in the middle of the window while the
 * app really loads, then moves it into the title bar's tile
 * (`data-sb-start-target`); with reduced motion it fades where it stands.
 * It waits for the page's `load` and for every `hold()` to be released, so
 * the app holds it from before React mounts until the first view is up. A
 * boot that failed, or a failure before React owns the window (main.tsx),
 * ends it at once with `sbStart.fail()` (spec/03 §14.1, NV-E5): the tile
 * fades where it stands and never covers the reason. It runs once per
 * webview session (`sessionStorage`, D85): a reload shows none. The script
 * takes `.sb-enter` off the entering parts after their animation (NV-E16).
 *
 * Without the script (the tests, a page that has none) both calls do
 * nothing; each hold is released at most once.
 *
 * The script ends the start only in the `finish` of its Web Animation. One
 * that never finishes (a hidden or throttled webview) would leave the
 * opaque ground over the working app, so the start is ended by hand
 * `START_FALLBACK_MS` after the release if it is still on (STR-01: never
 * longer than the real loading; docs/sebaro-luecken.md J). The time counts
 * from when the script can run, the release and the page's `load` both: a
 * late `load` would otherwise end the start before it began.
 */
interface SbStart {
  hold(): void;
  release(): void;
  fail(): void;
}

declare global {
  interface Window {
    sbStart?: SbStart;
  }
}

let held = false;

/** Longer than the start's run (`--sb-motion-duration-long`, the fade: 200 ms). */
export const START_FALLBACK_MS = 1000;

/** What sb-start.js's `finish` does, for a start whose animation never ends. */
function endStuckStart(): void {
  const root = document.documentElement;
  if (!root.classList.contains("sb-starting")) return;
  const overlay = document.querySelector("body > .sb-start");
  overlay?.classList.remove("is-moving");
  for (const element of [overlay, overlay?.querySelector(".sb-start__tile")]) {
    element?.getAnimations?.().forEach((animation) => animation.cancel());
  }
  const target = document.querySelector<HTMLElement>("[data-sb-start-target]");
  if (target) target.style.visibility = "";
  root.classList.remove("sb-starting");
}

export function holdStart(): void {
  if (held || !window.sbStart) return;
  window.sbStart.hold();
  held = true;
}

/** The fallback: ends the start by hand if its animation never finishes. */
function armFallback(): void {
  const arm = () => window.setTimeout(endStuckStart, START_FALLBACK_MS);
  if (document.readyState === "complete") arm();
  else window.addEventListener("load", arm, { once: true });
}

export function releaseStart(): void {
  if (!held) return;
  held = false;
  window.sbStart?.release();
  armFallback();
}

/** Loading failed: the start ends now, whatever else holds it (NV-E5). */
export function failStart(): void {
  if (!held) return;
  held = false;
  window.sbStart?.fail();
  armFallback();
}
