import { Icon } from "./Icon";

type Props<T extends string> = {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange(value: T): void;
};

/** Filter chips of which one is chosen. */
export function Chips<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <div className="sb-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          className="sb-chip"
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          <Icon name="check--16" size={16} />
          {option.label}
        </button>
      ))}
    </div>
  );
}
