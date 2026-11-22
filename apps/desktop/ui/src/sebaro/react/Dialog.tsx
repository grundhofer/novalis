import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

type Props = {
  id: string;
  open: boolean;
  title: string;
  text: string;
  /** more than a sentence, between the text and the actions: a table, a list */
  body?: ReactNode;
  /** The dialog has closed with an answer: the value of the pressed action, "" for Escape or a press beside it.
   *  The owner sets `open` to false here. */
  onClose(value: string): void;
  /** the actions: buttons with a value, the cancelling one first; beside another outlined action it is marked
   *  data-sb-dialog-cancel, so the check of a view does not count it as the dialog's one outlined action */
  children: ReactNode;
};

/** A modal dialog that asks before something is lost. It opens with the focus on its first action and gives the
 *  focus back when it closes; Escape and a press beside it cancel. */
export function Dialog({ id, open, title, text, body, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const pressedBeside = useRef(false);

  // after every render the dialog is open exactly while `open` says so
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open === open) return;
    if (!open) return dialog.close();
    dialog.showModal();
    // the first action, also when something before it could take the focus (a table that scrolls)
    actions.current?.querySelector("button")?.focus();
  });

  // an answer closes the dialog first, so the focus is back in the page when the owner hears of it
  const answer = (value: string) => {
    ref.current?.close();
    onClose(value);
  };

  // actions that do not fit one line stand one under the other at the full width, in their order. Measured in the
  // one-line form, when the dialog opens and when the window changes its size.
  useEffect(() => {
    const row = actions.current;
    if (!open || !row) return;
    const fit = () => {
      row.removeAttribute("data-sb-fit");
      const tops = [...row.children].map((action) => action.getBoundingClientRect().top);
      const [first] = tops;
      if (first !== undefined && tops.some((top) => Math.abs(top - first) > 1))
        row.setAttribute("data-sb-fit", "stack");
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);

  // a press counts as beside the dialog when it begins and ends on the scrim (a keyboard "click" has detail 0)
  const beside = (event: MouseEvent<HTMLDialogElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    return event.target === event.currentTarget && !inside;
  };

  return (
    <dialog
      ref={ref}
      id={id}
      className="sb-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      onCancel={(event) => {
        event.preventDefault();
        answer("");
      }}
      onPointerDown={(event) => (pressedBeside.current = beside(event))}
      onClick={(event) => {
        if (pressedBeside.current && event.detail !== 0 && beside(event)) answer("");
        pressedBeside.current = false;
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          const action = (event.nativeEvent as SubmitEvent).submitter;
          answer(action instanceof HTMLButtonElement ? action.value : "");
        }}
      >
        <h2 className="sb-dialog__title" id={`${id}-title`}>
          {title}
        </h2>
        <p className="sb-dialog__text" id={`${id}-text`}>
          {text}
        </p>
        {body && <div className="sb-dialog__body">{body}</div>}
        <div ref={actions} className="sb-dialog__actions">
          {children}
        </div>
      </form>
    </dialog>
  );
}
