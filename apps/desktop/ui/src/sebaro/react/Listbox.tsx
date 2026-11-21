import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

type Props = {
  labelledBy: string;
  options: ReadonlyArray<{ id: string; name: string; icon: string }>;
  selected: string[];
  onChange(selected: string[]): void;
  /** the row that is the tab stop at first */
  start?: string;
};

/** A list in which several rows can be chosen: one tab stop, the arrows move the focus, Space or Enter adds the
 *  focused row or takes it away. */
export function Listbox({ labelledBy, options, selected, onChange, start }: Props) {
  const [stop, setStop] = useState(start ?? options[0]?.id);
  const list = useRef<HTMLUListElement>(null);

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const onKeyDown = (event: KeyboardEvent, at: number) => {
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: options.length - 1 };
    const to = moves[event.key];
    if (to !== undefined) {
      const rows = list.current?.querySelectorAll<HTMLElement>("[role='option']");
      rows?.[Math.max(0, Math.min(options.length - 1, to))]?.focus();
    } else if (event.key === " " || event.key === "Enter") toggle(options[at].id);
    else return;
    event.preventDefault();
  };

  return (
    <ul ref={list} className="sb-listbox" role="listbox" aria-labelledby={labelledBy} aria-multiselectable="true">
      {options.map((option, at) => (
        <li
          key={option.id}
          className="sb-row"
          role="option"
          aria-selected={selected.includes(option.id)}
          aria-current={option.id === stop ? "true" : undefined}
          tabIndex={option.id === stop ? 0 : -1}
          onFocus={() => setStop(option.id)}
          onClick={() => toggle(option.id)}
          onKeyDown={(event) => onKeyDown(event, at)}
        >
          <Icon name={option.icon} className="sb-row__icon" />
          <span className="sb-row__check" aria-hidden="true">
            <Icon name="check--16" size={16} />
          </span>
          <span className="sb-row__name">{option.name}</span>
        </li>
      ))}
    </ul>
  );
}
