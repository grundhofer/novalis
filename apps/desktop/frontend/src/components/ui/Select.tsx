interface Option {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

export function Select({
  value,
  onChange,
  options,
  disabled,
  id,
  className = "",
  ...rest
}: SelectProps) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      aria-label={rest["aria-label"]}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm text-fg outline-none transition-colors hover:bg-active disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
