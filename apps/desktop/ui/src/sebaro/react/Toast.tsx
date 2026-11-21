import { useCallback, useEffect, useRef, useState } from "react";

type Message = { text: string; undo?: () => void };
type Props = {
  id: string;
  message: Message | null;
  /** the word of the action that takes the result back: „Rückgängig“ */
  undoWord: string;
  onHide(): void;
};

const STAY = 6000;

/** The toast: the sentence of a result, with „Rückgängig“ where it can be taken back. It stays 6 s, counted anew
 *  after the pointer was over it or the focus inside; Escape closes it unless a dialog or popover is open. */
export function Toast({ id, message, undoWord, onHide }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const from = useRef<Element | null>(null);
  const [written, setWritten] = useState<Message | null>(null);
  const [held, setHeld] = useState(false);

  // `onHide` keeps its identity while a toast shows (a store's action does): a new function counts the 6 s anew
  const hide = useCallback(() => {
    // focus inside the toast goes back to where it was, else to the content: never to nowhere
    if (ref.current?.contains(document.activeElement)) {
      const back =
        from.current instanceof HTMLElement && from.current.isConnected
          ? from.current
          : document.querySelector<HTMLElement>("main, [role='main']");
      back?.focus({ preventScroll: true });
    }
    onHide();
  }, [onHide]);

  // the region is shown empty and gets its sentence two frames later, so a screen reader hears a region that was
  // already there
  useEffect(() => {
    if (!message) return;
    from.current = document.activeElement;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setWritten(message));
    });
    return () => cancelAnimationFrame(frame);
  }, [message]);

  useEffect(() => {
    if (!message || held) return;
    const timer = window.setTimeout(hide, STAY);
    return () => window.clearTimeout(timer);
  }, [message, held, hide]);

  useEffect(() => {
    if (!message) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      const inside = event.target instanceof Node && ref.current?.contains(event.target);
      if (inside || !document.querySelector("dialog:modal, :popover-open")) hide();
    };
    // in the capture phase and never consumed: a field or an editor gets its Escape as before
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [message, hide]);

  return (
    <div
      ref={ref}
      id={id}
      className={message ? "sb-toast sb-enter" : "sb-toast"}
      role="status"
      hidden={!message}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <p>{message && written === message ? message.text : ""}</p>
      {message?.undo && (
        <button
          className="sb-toast__action"
          type="button"
          onClick={() => {
            message.undo?.();
            hide();
          }}
        >
          {undoWord}
        </button>
      )}
    </div>
  );
}
