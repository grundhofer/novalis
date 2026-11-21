import { useId } from "react";
import { Icon } from "./Icon";

type Props = { label: string; help?: string; checked: boolean; onChange(checked: boolean): void };

/** A switch with its label before it and, where given, a sentence of help under both. */
export function Switch({ label, help, checked, onChange }: Props) {
  const id = useId();
  const row = (
    <div className="sb-switch-row">
      <span id={id}>{label}</span>
      <button
        className="sb-switch"
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        aria-describedby={help ? `${id}-help` : undefined}
        onClick={() => onChange(!checked)}
      >
        <span className="sb-switch__track" />
        <span className="sb-switch__thumb">
          <Icon name="check--16" size={16} />
        </span>
      </button>
    </div>
  );
  if (!help) return row;
  return (
    <div className="sb-switch-field">
      {row}
      <p className="sb-field__help" id={`${id}-help`}>
        {help}
      </p>
    </div>
  );
}
