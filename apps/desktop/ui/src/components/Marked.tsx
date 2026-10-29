import type { ReactNode } from "react";

import type { Range } from "../lib/matchRanges";

/** Where a file name may break: after `-`, `.`, `_` and `/` (D100 (6), as FileName). */
function breakPoints(text: string): number[] {
  const points: number[] = [];
  for (let at = 1; at < text.length; at += 1) if (/[-._/]/u.test(text[at - 1]!)) points.push(at);
  return points;
}

/**
 * `text` with each range marked; ranges are sorted and do not overlap. A
 * search hit in rendered text is sebaro's `mark.sb-mark` (FAR-12: the fill
 * with its 2 px edge at the foot); the letters a palette's filter matched are
 * `hit`: `b.sb-command-palette__hit`, body-strong without a fill (spec/02
 * §4.16, D102 (6)). A `fileName` is sebaro's `.sb-file-name` and breaks only
 * after `- . _ /` (ZUG-09), with a `<wbr>` as FileName writes it, inside a
 * mark too.
 */
export default function Marked({
  text,
  ranges,
  fileName = false,
  hit = false,
}: {
  text: string;
  ranges: readonly Range[];
  fileName?: boolean;
  hit?: boolean;
}) {
  const breaks = fileName ? breakPoints(text) : [];
  const pieces = (from: number, to: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let at = from;
    for (const point of breaks) {
      if (point < from || point >= to) continue;
      if (point > at) out.push(text.slice(at, point));
      out.push(<wbr key={`b${point}`} />);
      at = point;
    }
    if (to > at) out.push(text.slice(at, to));
    return out;
  };
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], index) => {
    if (from > at) parts.push(...pieces(at, from));
    parts.push(
      hit ? (
        <b className="sb-command-palette__hit" key={`m${index}`}>
          {pieces(from, to)}
        </b>
      ) : (
        <mark className="sb-mark" key={`m${index}`}>
          {pieces(from, to)}
        </mark>
      ),
    );
    at = to;
  });
  if (at < text.length) parts.push(...pieces(at, text.length));
  return fileName ? <span className="sb-file-name">{parts}</span> : <>{parts}</>;
}
