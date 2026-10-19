import { useLayoutEffect, useRef, useState } from "react";

import { AppTile } from "./Icon";

/**
 * The start (sebaro D52, D62; ADR-0048): once the window is ready, the 96 px
 * tile in the middle of the window flies into the title bar's tile and is
 * gone. One move, the long motion step (200 ms); with reduced motion — from
 * macOS or the setting (ADR-0049) — the duration token is 1 ms, so the tile
 * is simply where it belongs. The tile shows the symbol alone, never the code.
 *
 * A timer ends it as well as `transitionend`: a transition that never runs
 * (no target, a hidden window) must not leave the tile over the app.
 */
export default function StartTile() {
  const [done, setDone] = useState(false);
  const tile = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = tile.current;
    const target = document.querySelector(".titlebar .app-tile");
    if (!element || !target) {
      setDone(true);
      return undefined;
    }
    const from = element.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const finish = () => setDone(true);
    element.addEventListener("transitionend", finish, { once: true });
    const fallback = window.setTimeout(finish, 1000);
    const frame = requestAnimationFrame(() => {
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const scale = from.width > 0 ? to.width / from.width : 1;
      element.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      element.removeEventListener("transitionend", finish);
    };
  }, []);

  if (done) return null;
  return (
    <div className="start" aria-hidden="true">
      <div className="start-tile" ref={tile}>
        <AppTile className="start-tile-svg" />
      </div>
    </div>
  );
}
