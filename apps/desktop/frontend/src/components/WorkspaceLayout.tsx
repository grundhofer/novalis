import { Fragment, useRef } from "react";

import { useIsMobile } from "../lib/useIsMobile";
import { useUi } from "../stores/uiStore";
import { EditorPane } from "./EditorPane";
import { TabStrip } from "./TabStrip";

/** Smallest flex share a pane can be dragged down to (~1/5 of an equal split). */
const MIN_PANE_FLEX = 0.2;

/** The notes-view workspace: 1–4 panes split along one axis, each a TabStrip +
 *  EditorPane, with draggable dividers between them. Clicking into a pane's
 *  editor focuses the pane (tab clicks focus via setActiveTab instead, so a
 *  tab click doesn't first re-open the pane's OLD active tab). */
export function WorkspaceLayout() {
  const workspace = useUi((s) => s.workspace);
  const focusPane = useUi((s) => s.focusPane);
  const resizePanes = useUi((s) => s.resizePanes);
  const containerRef = useRef<HTMLDivElement>(null);
  const row = workspace.direction === "row";
  const isMobile = useIsMobile();

  // A phone can't show side-by-side splits — render only the focused pane (its
  // tabs still work). The other panes stay in the store, so rotating to a
  // tablet width restores the split with no data loss.
  const focused = workspace.panes.find((p) => p.id === workspace.focusedPaneId);
  const panes =
    isMobile && workspace.panes.length > 1
      ? [focused ?? workspace.panes[0]]
      : workspace.panes;

  // Divider drag between pane i-1 and i: redistribute the two panes' flex
  // shares, live while dragging, persisted once on release (the same pointer
  // pattern as the sidebar-width divider in App.tsx).
  const onDividerDown = (e: React.PointerEvent, i: number) => {
    e.preventDefault();
    const container = containerRef.current;
    if (container == null) return;
    const a = workspace.panes[i - 1];
    const b = workspace.panes[i];
    const total = (a.flex ?? 1) + (b.flex ?? 1);
    const sumFlex = workspace.panes.reduce((acc, p) => acc + (p.flex ?? 1), 0);
    const containerSize = row ? container.clientWidth : container.clientHeight;
    if (containerSize <= 0 || sumFlex <= 0) return;
    const pxPerFlex = containerSize / sumFlex;
    const start = row ? e.clientX : e.clientY;
    const startA = a.flex ?? 1;
    let latest: Record<string, number> | null = null;
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      const delta = ((row ? ev.clientX : ev.clientY) - start) / pxPerFlex;
      const flexA = Math.max(MIN_PANE_FLEX, Math.min(total - MIN_PANE_FLEX, startA + delta));
      latest = { [a.id]: flexA, [b.id]: total - flexA };
      resizePanes(latest, false);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
      if (latest) resizePanes(latest, true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={containerRef}
      className={`flex min-h-0 min-w-0 flex-1 ${row ? "flex-row" : "flex-col"}`}
    >
      {panes.map((pane, i) => (
        <Fragment key={pane.id}>
          {i > 0 && (
            <div
              role="separator"
              aria-orientation={row ? "vertical" : "horizontal"}
              onPointerDown={(e) => onDividerDown(e, i)}
              className={`shrink-0 bg-border transition-colors hover:bg-accent/40 ${
                row ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"
              }`}
            />
          )}
          <div
            className="flex min-h-0 min-w-0 flex-col"
            style={{ flexGrow: pane.flex ?? 1, flexBasis: 0 }}
          >
            <TabStrip pane={pane} />
            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col"
              onPointerDownCapture={(e) => {
                // The external-change banner's actions (Reload / Keep mine)
                // resolve a conflict for ALL panes; the focus-switch flush
                // would save the dirty side over the disk version before the
                // click handler runs — exempt the banner from focus capture.
                if ((e.target as Element).closest?.("[data-external-banner]")) return;
                focusPane(pane.id);
              }}
            >
              <EditorPane pane={pane} />
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
