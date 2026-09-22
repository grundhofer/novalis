import type { Range } from "../lib/matchRanges";

/** `text` with each range in a `<mark>`; ranges are sorted and do not overlap. */
export default function Marked({ text, ranges }: { text: string; ranges: readonly Range[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], index) => {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <mark className="match" key={index}>
        {text.slice(from, to)}
      </mark>,
    );
    at = to;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
