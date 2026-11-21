// Palette.tsx: the command palette, a modal dialog with a search field over a list of options in groups.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { KeyWords } from "./chords";
import { Icon } from "./Icon";
import { Keys } from "./Keys";
import { reveal } from "./reveal";

export type PaletteOption = {
  id: string;
  label: string;
  /** more words the search finds the option by */
  keywords?: string;
  keys?: string;
  /** a setting: the option carries a check while it is on */
  checked?: boolean;
  run(): void;
};
export type PaletteGroup = { label: string; options: PaletteOption[] };

type Props = {
  id: string;
  open: boolean;
  label: string;
  searchLabel: string;
  groups: PaletteGroup[];
  /** the words under the list: what the arrows, Enter and Escape do */
  hints: { move: string; run: string; close: string };
  /** the names of the keys in the page's language, for the shortcuts of the options and of the hints */
  keyWords: KeyWords;
  /** what the palette says when no option matches: „Kein Befehl passt zu „xyz“.“ */
  noneWord(query: string): string;
  /** The palette has closed; the owner sets `open` to false here. */
  onClose(): void;
};

const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** A name with the letters the search matched in a stronger weight, never a fill. */
function Hits({ name, words }: { name: string; words: string[] }): ReactNode {
  const low = plain(name);
  if (low.length !== name.length) return name;
  const spans = words
    .map((word) => [low.indexOf(word), low.indexOf(word) + word.length] as const)
    .filter(([from]) => from >= 0);
  const out: ReactNode[] = [];
  let at = 0;
  for (const [from, to] of spans.sort((a, b) => a[0] - b[0])) {
    if (to <= at) continue;
    out.push(name.slice(at, Math.max(at, from)));
    out.push(
      <b key={from} className="sb-command-palette__hit">
        {name.slice(Math.max(at, from), to)}
      </b>,
    );
    at = to;
  }
  return [...out, name.slice(at)];
}

/** Typing filters by name, keywords and group; the arrows move the active option, Enter runs it, Escape and a press
 *  beside the palette close it. The focus goes back to where it was. */
export function Palette({ id, open, label, searchLabel, groups, hints, keyWords, noneWord, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);

  // whichever way it closed: the next time it opens with an empty search. Reset here, while rendering, not on the
  // dialog's close event: the browser sends that event later, possibly when the palette is open again.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setActive(null);
    }
  }

  // the dialog is open exactly while `open` says so
  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open === open) return;
    if (open) element.showModal();
    else element.close();
  }, [open]);

  const words = plain(query).split(/\s+/).filter(Boolean);
  const found = groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => {
        const text = plain(`${option.label} ${option.keywords ?? ""} ${group.label}`);
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((group) => group.options.length);
  const shown = found.flatMap((group) => group.options);
  // a match in the name goes before a match in the keywords or the group
  const byName = words.length
    ? shown.find((option) => words.every((word) => plain(option.label).includes(word)))
    : null;
  const current = shown.find((option) => option.id === active) ?? byName ?? shown[0];

  const close = () => {
    dialog.current?.close();
    onClose();
  };
  // the active option stays in view while the arrows move through a long list
  useEffect(() => {
    const [list, option] = [document.getElementById(`${id}-list`), current && document.getElementById(current.id)];
    if (open && list && option) reveal(list, option);
  }, [open, id, current]);
  const run = (option: PaletteOption) => {
    close(); // first, so the focus is back in the window when the option acts
    option.run();
  };

  return (
    <dialog
      ref={dialog}
      id={id}
      className="sb-command-palette"
      aria-label={label}
      data-sb-density="window"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <div className="sb-command-palette__search">
        <Icon name="search" />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={current?.id}
          aria-label={searchLabel}
          placeholder={searchLabel}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(null);
          }}
          onKeyDown={(event) => {
            const at = current ? shown.indexOf(current) : -1;
            const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
            if (step && shown.length) setActive(shown[(at + step + shown.length) % shown.length]?.id ?? null);
            else if (event.key === "Enter" && current) run(current);
            else return;
            event.preventDefault();
          }}
        />
      </div>
      <div className="sb-command-palette__list" id={`${id}-list`} role="listbox" aria-label={label}>
        {found.map((group, at) => (
          <div key={group.label} className="sb-command-palette__section">
            <div className="sb-command-palette__group" id={`${id}-group-${at}`}>
              {group.label}
            </div>
            <div role="group" aria-labelledby={`${id}-group-${at}`}>
              {group.options.map((option) => (
                <div
                  key={option.id}
                  className="sb-row"
                  role="option"
                  id={option.id}
                  aria-selected={option === current}
                  aria-checked={option.checked}
                  onClick={() => run(option)}
                >
                  <span className="sb-row__check" aria-hidden="true">
                    {option.checked !== undefined && <Icon name="check--16" size={16} />}
                  </span>
                  <span className="sb-row__name">
                    <Hits name={option.label} words={words} />
                  </span>
                  {option.keys && <Keys spec={option.keys} words={keyWords} />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="sb-command-palette__empty" role="status">
        {shown.length ? "" : noneWord(query.trim())}
      </p>
      <p className="sb-command-palette__foot">
        <span>
          <Keys spec="Up Down" words={keyWords} />
          {hints.move}
        </span>
        <span>
          <Keys spec="Enter" words={keyWords} />
          {hints.run}
        </span>
        <span>
          <Keys spec="Escape" words={keyWords} />
          {hints.close}
        </span>
      </p>
    </dialog>
  );
}
