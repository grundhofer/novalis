import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

/**
 * A compact filter field that suggests values (a tag, a folder): sebaro's
 * field with suggestions (spec/02 §4.26, NV-M12), never a `<datalist>`, which
 * WebKit draws in its own look and without marked letters. The field is
 * `sb-field--compact` with its visible label (EIN-01), its input a
 * `combobox` (`aria-autocomplete="list"`, `aria-expanded`, `aria-controls`,
 * `aria-activedescendant`), its list an `sb-completion` under it with
 * `sb-row` options, the letters typed so far in `sb-completion__hit`
 * (body-strong, D102 (6)).
 *
 * Keys stay in the field (it keeps focus): typing opens the list with the
 * values that contain the text, ↓ / ↑ move the active option (none is active
 * until an arrow is pressed, so Eingabe never replaces what was typed by
 * surprise), Eingabe or ⇥ takes it, Escape closes the list first and keeps
 * the text — a second Escape is the dialog's. A press on an option takes
 * it. The list closes when the field loses focus.
 */
export default function SuggestField({
  label,
  listLabel,
  value,
  suggestions,
  onChange,
}: {
  /** The field's visible label. */
  label: string;
  /** The list's name for screen readers. */
  listLabel: string;
  value: string;
  /** Every value the field may suggest, in the order to show them. */
  suggestions: readonly string[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const needle = value.trim().toLowerCase();
  const matches = useMemo(
    () => (needle === "" ? [...suggestions] : suggestions.filter((s) => s.toLowerCase().includes(needle))),
    [suggestions, needle],
  );
  const shown = open && matches.length > 0;
  const optionId = (index: number) => `${id}-o${index}`;

  // The active option stays in view while the arrows walk past the list's
  // edge (`.sb-completion` scrolls from about nine rows on).
  useEffect(() => {
    if (shown && active >= 0) document.getElementById(`${id}-o${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, shown, active]);

  const take = (suggestion: string) => {
    onChange(suggestion);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="sb-field sb-field--compact nv-suggest">
      <label className="sb-field__label" htmlFor={`${id}-input`}>
        {label}
      </label>
      <div className="sb-field__control">
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-activedescendant={shown && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!shown) {
                setOpen(true);
                setActive(event.key === "ArrowDown" ? 0 : matches.length - 1);
                return;
              }
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((index) => (index < 0 && step < 0 ? matches.length - 1 : (index + step + matches.length) % matches.length));
            } else if ((event.key === "Enter" || event.key === "Tab") && shown && active >= 0) {
              if (event.key === "Enter") event.preventDefault();
              take(matches[active]!);
            } else if (event.key === "Enter" && shown) {
              event.preventDefault();
              setOpen(false);
            } else if (event.key === "Escape" && shown) {
              // The list closes first; the dialog keeps its own Escape.
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setActive(-1);
            }
          }}
        />
      </div>
      {shown && (
        // A press on an option keeps the focus in the field (§4.26).
        <div
          className="sb-completion"
          id={`${id}-list`}
          role="listbox"
          aria-label={listLabel}
          onMouseDown={(event) => event.preventDefault()}
        >
          {matches.map((suggestion, index) => (
            <div
              className="sb-row"
              role="option"
              id={optionId(index)}
              aria-selected={index === active}
              key={suggestion}
              onClick={() => take(suggestion)}
            >
              <span className="sb-row__name">{marked(suggestion, needle)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The suggestion with the first place it contains the typed text in `sb-completion__hit`. */
function marked(suggestion: string, needle: string): ReactNode {
  const lower = suggestion.toLowerCase();
  // A letter whose small form is longer (İ) would shift the mark: unmarked.
  const at = needle === "" || lower.length !== suggestion.length ? -1 : lower.indexOf(needle);
  if (at < 0) return suggestion;
  return (
    <>
      {suggestion.slice(0, at)}
      <b className="sb-completion__hit">{suggestion.slice(at, at + needle.length)}</b>
      {suggestion.slice(at + needle.length)}
    </>
  );
}
