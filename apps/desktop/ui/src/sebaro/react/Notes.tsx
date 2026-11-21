import { useEffect, useId, useRef, type ReactNode } from "react";

// Footnotes: the digit in the text (NoteRef), the list of notes (NoteList) and, below 1024 px, the popover that
// saves the jump (NotePopover). `name` joins them: the digit n is the element `<name>-ref-<n>`, its note `<name>-<n>`.

const NARROW = "(max-width: 63.99rem)";

/** After the browser's own jump: the focus follows to the target. */
const focusAfterJump = (id: string) =>
  window.setTimeout(() => document.getElementById(id)?.focus({ preventScroll: true }));

type RefProps = { name: string; n: number; label: string; open: boolean; onOpen(): void };

/** The digit of a note. Wide, it jumps to the note; narrow, it opens the popover. */
export function NoteRef({ name, n, label, open, onOpen }: RefProps) {
  return (
    <a
      className="sb-note-ref"
      id={`${name}-ref-${n}`}
      href={`#${name}-${n}`}
      role="doc-noteref"
      aria-label={label}
      aria-expanded={open ? true : undefined}
      onClick={(event) => {
        if (window.matchMedia(NARROW).matches) {
          event.preventDefault();
          onOpen();
        } else focusAfterJump(`${name}-${n}`);
      }}
    >
      {n}
    </a>
  );
}

type ListProps = { name: string; title: ReactNode; notes: ReactNode[]; backLabel(n: number): string };

/** The list of notes; it always stays on the page. Each note leads back to its digit. */
export function NoteList({ name, title, notes, backLabel }: ListProps) {
  return (
    <section className="sb-notes" role="doc-endnotes" aria-labelledby={`${name}-title`}>
      <h4 className="sb-notes__title" id={`${name}-title`}>
        {title}
      </h4>
      <ol className="sb-notes__list">
        {notes.map((note, at) => (
          <li key={`${name}-${at + 1}`} className="sb-note" id={`${name}-${at + 1}`} tabIndex={-1}>
            <a
              className="sb-note__back"
              href={`#${name}-ref-${at + 1}`}
              role="doc-backlink"
              aria-label={backLabel(at + 1)}
              onClick={() => focusAfterJump(`${name}-ref-${at + 1}`)}
            >
              {at + 1}
            </a>
            <div className="sb-note__body">{note}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

type PopoverProps = {
  open: boolean;
  claim: string;
  /** the word of the button that closes the note: „Schließen“ */
  closeWord: string;
  onClose(): void;
  children: ReactNode;
};

/** One note over the text: the claim, the note, „Schließen“. Escape and a press beside it close it too. */
export function NotePopover({ open, claim, closeWord, onClose, children }: PopoverProps) {
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  // after every render the popover is open exactly while `open` says so (a press on another digit closes it and
  // opens it again); the browser gives the focus back to the digit when it closes
  useEffect(() => {
    const note = popover.current;
    if (!note || note.matches(":popover-open") === open) return;
    if (!open) return note.hidePopover();
    note.showPopover();
    close.current?.focus();
  });

  return (
    <div
      ref={popover}
      className="sb-note-popover"
      popover="auto"
      aria-labelledby={id}
      // Escape or a press beside it: said before the popover hides, so the owner knows at once
      onBeforeToggle={(event) => {
        if (event.newState === "closed") onClose();
      }}
    >
      <p className="sb-note-popover__claim" id={id}>
        {claim}
      </p>
      <div className="sb-note-popover__body">
        <div className="sb-note__body">{children}</div>
      </div>
      <button ref={close} className="sb-secondary-action sb-note-popover__close" type="button" onClick={onClose}>
        {closeWord}
      </button>
    </div>
  );
}
