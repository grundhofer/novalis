import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** What the control of a field carries: its id, and what says it is wrong and describes it. */
export type ControlProps = { id: string; "aria-invalid": true | undefined; "aria-describedby": string | undefined };

type Props = {
  id: string;
  label: string;
  /** the word that says the field may stay empty: „(optional)“; without it the field is required */
  optional?: string;
  help?: string;
  /** the sentence that says what is wrong and what to do */
  error?: string;
  /** a class for the frame of the control, e.g. sb-select */
  frame?: string;
  children(control: ControlProps): ReactNode;
};

/** A field: the label above, the control, then the error (a red line, a glyph and a sentence) and the help. */
export function Field({ id, label, optional, help, error, frame, children }: Props) {
  const described = [error && `${id}-error`, help && `${id}-help`].filter(Boolean).join(" ");
  return (
    <div className="sb-field">
      <label className="sb-field__label" htmlFor={id}>
        {label}
        {optional && (
          <>
            {" "}
            <span className="sb-optional">{optional}</span>
          </>
        )}
      </label>
      <div className={frame ? `sb-field__control ${frame}` : "sb-field__control"}>
        {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": described || undefined })}
      </div>
      {error && (
        <p className="sb-field__error" id={`${id}-error`}>
          <Icon name="error--filled-16" size={16} />
          {error}
        </p>
      )}
      {help && (
        <p className="sb-field__help" id={`${id}-help`}>
          <span>{help}</span>
        </p>
      )}
    </div>
  );
}
