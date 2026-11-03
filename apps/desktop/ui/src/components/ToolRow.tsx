import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";

/** What in a row is a tool: its buttons and its field; a natively disabled one is skipped. */
const TOOLS = "button:not([disabled]), input:not([disabled])";

/**
 * A text field keeps its arrows, so it is never the row's stop: from it the
 * arrows could not reach the other tools (found in review, ADR-0051 #80).
 */
const isField = (tool: HTMLElement) => tool instanceof HTMLInputElement;

/** The tools of `row` in their order, not those of a row inside it. */
function toolsOf(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(TOOLS)].filter((tool) => tool.closest("[role='toolbar']") === row);
}

/**
 * A row of tools under the document tabs, sebaro's `sb-doc-bar` (spec/02
 * §4.25.3, §4.25.4) as a toolbar: the editor's (DocTools.tsx) and the
 * viewers' (image, comic, PDF, EPUB). It is one tab stop (ADR-0051 #80, the
 * WAI-ARIA toolbar pattern, roving tabindex), not one per tool as in
 * sebaro's reader specimen (docs/sebaro-luecken.md Z8): ← → move to the
 * previous / next tool and go round, as sebaro's tabs do (`sb-tabs.js`),
 * Pos1 / Ende to the first / last; right to left the two arrows swap. A tool
 * that is `aria-disabled` (Tool.tsx) keeps its place in the order and can
 * take focus; a natively disabled one is skipped.
 *
 * The stop is the tool used last, by keys or by the pointer, so a press
 * that keeps the focus in the text (DocTools.tsx) still moves it; once that
 * tool is gone (another file's row, a rebuilt row) the stop is the first.
 * A text field in the row (the PDF's page number) keeps its own arrows,
 * Pos1 and Ende; the arrows reach it from its neighbours, but it is never
 * the stop, which stays the tool used before it. Tab and ⇧Tab leave the
 * field for the stop when it lies on that side, else out of the row.
 */
export default function ToolRow({
  label,
  className = "sb-doc-bar",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement | null>(null);
  const last = useRef<HTMLElement | null>(null);

  // Every render, which is when tools come and go: one stop, the tool used
  // last while it is there, else the first.
  const settle = () => {
    if (!row.current) return;
    const tools = toolsOf(row.current);
    const stop = last.current && tools.includes(last.current) ? last.current : (tools.find((tool) => !isField(tool)) ?? tools[0]);
    for (const tool of tools) tool.tabIndex = tool === stop ? 0 : -1;
  };
  useLayoutEffect(settle);

  const use = (event: SyntheticEvent) => {
    const tool = event.target instanceof Element ? event.target.closest<HTMLElement>(TOOLS) : null;
    if (!row.current || !tool || !toolsOf(row.current).includes(tool)) return;
    if (!isField(tool)) last.current = tool;
    settle();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // A text field keeps its keys (the WAI-ARIA toolbar pattern).
    if (event.target instanceof HTMLInputElement || !row.current) return;
    const tools = toolsOf(row.current);
    const at = tools.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    const rtl = getComputedStyle(row.current).direction === "rtl";
    const to =
      event.key === (rtl ? "ArrowLeft" : "ArrowRight")
        ? (at + 1) % tools.length
        : event.key === (rtl ? "ArrowRight" : "ArrowLeft")
          ? (at - 1 + tools.length) % tools.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tools.length - 1
              : null;
    if (to === null) return;
    // Taken, so a pane around the row (the PDF's) does not turn its page.
    event.preventDefault();
    if (!isField(tools[to]!)) last.current = tools[to]!;
    settle();
    tools[to]!.focus();
  };

  return (
    <div className={className} ref={row} role="toolbar" aria-label={label} onKeyDown={onKeyDown} onFocus={use} onClick={use}>
      {children}
    </div>
  );
}
