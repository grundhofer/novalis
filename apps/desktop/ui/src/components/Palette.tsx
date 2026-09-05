import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { dispatchCommand, PALETTE_COMMANDS } from "../lib/commands";
import { editorHeadings, goToEditorLine } from "../lib/editorBridge";
import { rank } from "../lib/fuzzy";
import { bindingFor, glyphsOf } from "../lib/keymap";
import { folderOf, stemOf } from "../lib/paths";
import { useBoard } from "../stores/board";
import { useNotes } from "../stores/notes";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import "../styles/overlay.css";

/**
 * Quick-open (`Cmd+P`) and the command palette (`Shift+Cmd+P`) are the same
 * component: one list, three sources.
 *
 * The palette is "the home of every transient toggle" (PLAN.md §5.3) and it
 * carries the heading jump that replaces the dropped outline panel (§4.3).
 */

type Entry =
  | { kind: "note"; path: string }
  | { kind: "board"; slug: string; name: string }
  | { kind: "command"; id: string; label: string }
  | { kind: "heading"; line: number; text: string };

const SECTION_KEY: Record<Entry["kind"], string> = {
  note: "palette.section.notes",
  board: "palette.section.boards",
  command: "palette.section.commands",
  heading: "palette.section.headings",
};

function headingsOfActiveDocument(): Entry[] {
  return editorHeadings().map((h) => ({ kind: "heading", line: h.line, text: h.text }));
}

export default function Palette({ mode }: { mode: "quickOpen" | "palette" }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const notes = useNotes((s) => s.paths);
  const boards = useBoard((s) => s.boards);

  useEffect(() => {
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const pool: Entry[] = useMemo(() => {
    const noteEntries: Entry[] = notes.map((path) => ({ kind: "note", path }));
    const boardEntries: Entry[] = boards.map((b) => ({
      kind: "board",
      slug: b.slug,
      name: b.name,
    }));
    if (mode === "quickOpen") return [...noteEntries, ...boardEntries];
    const commandEntries: Entry[] = PALETTE_COMMANDS.map((c) => ({
      kind: "command",
      id: c.id,
      label: t(c.labelKey),
    }));
    return [...commandEntries, ...headingsOfActiveDocument(), ...noteEntries, ...boardEntries];
  }, [mode, notes, boards, t]);

  const label = (entry: Entry): string => {
    switch (entry.kind) {
      case "note":
        return stemOf(entry.path);
      case "board":
        return entry.name;
      case "command":
        return entry.label;
      case "heading":
        return entry.text;
    }
  };

  const results = useMemo(() => rank(query, pool, label, 60), [query, pool]);

  // Adjusting state during render is the documented way to derive from props
  // or from other state; an effect here would cost an extra render per key.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setIndex(0);
  }

  const close = () => useUi.getState().setOverlay({ kind: "none" });

  const run = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    switch (entry.kind) {
      case "note":
        void useTabs.getState().open(entry.path);
        break;
      case "board":
        useUi.getState().setActiveBoard(entry.slug);
        void useBoard.getState().load(entry.slug);
        break;
      case "command":
        dispatchCommand(entry.id);
        break;
      case "heading":
        goToEditorLine(entry.line);
        break;
    }
  };

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <span className="palette-prompt" aria-hidden="true" />
          <input
            className="palette-text"
            ref={input}
            value={query}
            placeholder={t(mode === "quickOpen" ? "palette.quickOpenPlaceholder" : "palette.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") close();
              else if (event.key === "Enter") run(results[index]?.item);
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
            }}
          />
        </div>

        <div className="results">
          {results.length === 0 && <div className="result empty">{t("palette.noResults")}</div>}
          {results.map((ranked, position) => {
            const entry = ranked.item;
            const chord = entry.kind === "command" ? bindingFor(entry.id)?.chord : undefined;
            return (
              <div
                className={position === index ? "result active" : "result"}
                key={`${entry.kind}-${label(entry)}-${position}`}
                onMouseEnter={() => setIndex(position)}
                onClick={() => run(entry)}
              >
                <span className={entry.kind === "command" ? "result-glyph command" : "result-glyph"} />
                <span className="result-label">{label(entry)}</span>
                <span className="result-meta">
                  {entry.kind === "note"
                    ? folderOf(entry.path) || t(SECTION_KEY.note)
                    : chord
                      ? glyphsOf(chord)
                      : t(SECTION_KEY[entry.kind])}
                </span>
              </div>
            );
          })}
        </div>

        <div className="palette-foot">
          <span>{t("palette.foot.navigate")}</span>
          <span>{t(mode === "quickOpen" ? "palette.foot.open" : "palette.foot.run")}</span>
          <span>{t("palette.foot.close")}</span>
        </div>
      </div>
    </div>
  );
}
