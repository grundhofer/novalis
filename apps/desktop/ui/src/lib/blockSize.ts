import { type RefObject, useEffect } from "react";

/** The custom property `useBlockSize` writes on its element. */
export const BLOCK_SIZE = "--nv-block-size";

/**
 * Writes an element's height as `--nv-block-size` on it while it shows,
 * for the editor's room under its last line, which must never be taller
 * than the writing area (editor/theme.ts): 40vh alone was, in a low window,
 * and its last lines lay cut off under the action zone
 * (docs/sebaro-luecken.md Z12). Container units would say it in CSS, but a
 * size container is the containing block of CodeMirror's fixed tooltips,
 * which the editor's `overflow: hidden` would then clip. A height of 0 (the
 * settings view hides the content) is not written: the last one stays, so
 * the room and the scroll position are there when the content comes back.
 * `ready` is false while the element is not there yet.
 */
export function useBlockSize(ref: RefObject<HTMLElement | null>, ready = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!ready || !element || typeof ResizeObserver === "undefined") return undefined;
    const write = () => {
      const height = element.getBoundingClientRect().height;
      if (height > 0) element.style.setProperty("--nv-block-size", `${height}px`);
    };
    const observer = new ResizeObserver(write);
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.style.removeProperty(BLOCK_SIZE);
    };
  }, [ref, ready]);
}
