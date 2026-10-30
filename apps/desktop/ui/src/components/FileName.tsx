import { Fragment, type ReactNode } from "react";

/**
 * A file name or path in running text (sebaro D100 (6), ZUG-09): it breaks
 * only after `-`, `.`, `_` and `/`, without a hyphen. sebaro.css marks it
 * (`.sb-file-name`) and leaves the break points to the page: a `<wbr>` after
 * each run of those characters, none after the ones the name starts with
 * („/“ of an absolute path), which adds no character, so a screen reader and
 * a copy still get the name whole. A part that alone is wider than the line
 * breaks inside it only where its box may shrink below that part
 * (`overflow-wrap: break-word` does not lower min-content): in the action
 * zone's sentences, not in the toast, whose `p` sebaro holds at its
 * min-content (docs/sebaro-luecken.md, F).
 */
export function FileName({ name }: { name: string }) {
  // After the last of a run of separators, and not after the ones a name
  // starts with: an absolute path broken after its leading „/“ would read
  // as a relative one on the next line.
  const parts = name.split(/(?<=[^-._/][-._/]+)(?![-._/])/u);
  return (
    <span className="sb-file-name">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </span>
  );
}

/** The interpolation values that hold a file name, a note name or a path. */
const FILE_VALUES = ["path", "folder", "text", "name"];
/** Marks a value's place in the translated sentence; never in a catalog. */
const MARK = "\u0000";

type Values = Record<string, string | number>;

/**
 * A catalog sentence whose file names and paths break as `FileName` does.
 * The sentence is translated with a mark in each such value's place, so the
 * catalog keeps the word order; the marks become `FileName`s.
 */
export function withFileNames(
  translate: (key: string, values: Values) => string,
  key: string,
  values: Values,
): ReactNode {
  const names: string[] = [];
  const marked: Values = { ...values };
  for (const value of FILE_VALUES) {
    const name = values[value];
    if (typeof name !== "string" || name === "") continue;
    marked[value] = `${MARK}${names.length}${MARK}`;
    names.push(name);
  }
  const sentence = translate(key, marked);
  if (names.length === 0) return sentence;
  return sentence
    .split(MARK)
    .map((piece, index) =>
      index % 2 === 1 ? <FileName key={index} name={names[Number(piece)] ?? piece} /> : piece,
    );
}
