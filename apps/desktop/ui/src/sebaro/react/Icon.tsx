type Props = { name: string; size?: 16 | 20; className?: string };

/** An icon of the sprite that index.html holds inline: decoration, never read out, never a tab stop. */
export function Icon({ name, size, className }: Props) {
  const classes = ["sb-icon", size && `sb-icon--${size}`, className].filter(Boolean).join(" ");
  return (
    <svg className={classes} aria-hidden="true" focusable="false">
      <use href={`#${name}`} />
    </svg>
  );
}
