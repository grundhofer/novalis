import type { ReactNode } from "react";
import { Icon } from "./Icon";

type Props = {
  tone: "info" | "neutral" | "success" | "warning" | "danger";
  icon: string;
  small?: boolean;
  children: ReactNode;
};

/** A status: a glyph and a word, never colour alone. */
export function Status({ tone, icon, small, children }: Props) {
  return (
    <span className={`sb-status sb-status--${tone}`}>
      <Icon name={icon} size={small ? 16 : 20} />
      {children}
    </span>
  );
}
