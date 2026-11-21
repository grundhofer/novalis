import { useRef } from "react";
import { Icon } from "./Icon";

type Props = {
  id: string;
  label: string;
  placeholder: string;
  /** the name of the button that empties the field: „Suche leeren“ */
  clearWord: string;
  value: string;
  onChange(value: string): void;
};

/** A search field. „Suche leeren“ shows only while the field has text; the button and Escape empty it and leave the
 *  focus in the field. */
export function SearchField({ id, label, placeholder, clearWord, value, onChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const clear = () => {
    onChange("");
    input.current?.focus();
  };
  return (
    <div className="sb-field">
      <label className="sb-visually-hidden" htmlFor={id}>
        {label}
      </label>
      <div className="sb-field__control sb-search">
        <Icon name="search" />
        <input
          ref={input}
          id={id}
          type="search"
          placeholder={placeholder}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !value) return;
            // empties the field only: a dialog around it stays open
            event.preventDefault();
            event.stopPropagation();
            clear();
          }}
        />
        {value && (
          <button className="sb-icon-button" type="button" aria-label={clearWord} onClick={clear}>
            <Icon name="close" />
          </button>
        )}
      </div>
    </div>
  );
}
