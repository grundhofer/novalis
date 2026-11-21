import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  /** the state sentence at the start of the zone */
  status?: string;
  /** the line under the action that says where the data goes */
  hint?: string;
  /** the one action of the zone: the primary action of the view or, in a detail view, its one outlined action */
  children: ReactNode;
};

/** The action zone at the bottom of a view: the state sentence, the action and its data-path line. */
export function ActionZone({ status, hint, children }: Props) {
  const block = useRef<HTMLDivElement>(null);

  // the height of the block that sticks to the bottom of its view, for the scroll padding of the box that scrolls:
  // a focused field stops above the block, also with large text
  useEffect(() => {
    const view = block.current?.parentElement;
    if (!block.current || !view) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) view.style.setProperty("--sb-bottom-block-size", `${entry.target.getBoundingClientRect().height}px`);
    });
    observer.observe(block.current);
    return () => {
      observer.disconnect();
      view.style.removeProperty("--sb-bottom-block-size");
    };
  }, []);

  return (
    <div ref={block} className="sb-bottom-block">
      <div className="sb-primary-action-bar">
        <div className="sb-primary-action-bar__message" role="status" />
        {status && <p className="sb-primary-action-bar__status">{status}</p>}
        {children}
        {hint && <p className="sb-action-hint">{hint}</p>}
      </div>
    </div>
  );
}
