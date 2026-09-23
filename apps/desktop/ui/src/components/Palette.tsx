import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap } from "../ipc/client";
import { createNoteNamed, dispatchCommand, paletteCommands } from "../lib/commands";
import { resolveWikiTarget } from "../lib/links";
import { goToEditorLine } from "../lib/editorBridge";
import { previewKind } from "../lib/fileTypes";
import { rank } from "../lib/fuzzy";
import { headingsOf } from "../lib/headings";
import { positionRanges } from "../lib/matchRanges";
import { bindingFor, glyphsOf } from "../lib/keymap";
import { fileNameOf, folderOf, isNote, stemOf } from "../lib/paths";
import { goToPreviewLine, previewMounted } from "../lib/previewBridge";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";
import "../styles/overlay.css";
import Marked from "./Marked";

/**
 * Quick-open (`Cmd+P`), the command palette (`Shift+Cmd+P`) and the settings
 * list behind the sidebar's gear are the same component: one list, three
 * sources; the settings mode is the palette on the four settings alone.
 *
 * The palette is "the home of every transient toggle" (PLAN.md §5.3) and it
 * carries the heading jump that replaces the dropped outline panel (§4.3).
 * There is still no preferences window (ADR-0004).
 */

type Entry =
  | { kind: "file"; path: string }
  | { kind: "create"; name: string; text: string }
  | { kind: "tag"; tag: string; count: number }
  | { kind: "board"; slug: string; name: string }
  | { kind: "command"; id: string; label: string }
  | { kind: "heading"; line: number; text: string };

const SECTION_KEY: Record<Entry["kind"], string> = {
  file: "palette.section.notes",
  create: "palette.section.notes",
  board: "palette.section.boards",
  command: "palette.section.commands",
  heading: "palette.section.headings",
  tag: "palette.section.tags",
};

/**
 * The open note's headings, read from its text rather than from the editor,
 * so the jump works in the preview too (ADR-0020 amended: "die shortcuts
 * sollten auch im view mode funktionieren") and before the editor's chunk
 * has loaded. Only a Markdown file has them; a `# comment` is not one.
 */
function headingsOfActiveDocument(): Entry[] {
  const active = useTabs.getState().active;
  if (!active || previewKind(active) !== "markdown") return [];
  const text = useEditorSave.getState().flush(active) ?? "";
  return headingsOf(text).map((h) => ({ kind: "heading", line: h.line, text: h.text }));
}

export type PaletteMode = "quickOpen" | "palette" | "settings" | "pickNote" | "headings";

const PLACEHOLDER_KEY: Record<PaletteMode, string> = {
  quickOpen: "palette.quickOpenPlaceholder",
  palette: "palette.placeholder",
  settings: "palette.settingsPlaceholder",
  pickNote: "board.linkNote",
  headings: "palette.cmd.gotoHeading",
};

/**
 * `@` first in ⌘P or ⇧⌘P narrows to the open note's headings (ADR-0037), as
 * Go to Heading… does; the `@` is not part of what is matched.
 */
function headingQuery(mode: PaletteMode, query: string): string | null {
  if (mode === "headings") return query;
  if ((mode === "quickOpen" || mode === "palette") && query.startsWith("@")) return query.slice(1);
  return null;
}

/** What the note picker (ADR-0030) leaves out and where the choice goes. */
export interface PickRequest {
  exclude: readonly string[];
  onPick: (path: string) => Promise<void>;
}

export default function Palette({ mode, pick }: { mode: PaletteMode; pick?: PickRequest }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const files = useFiles((s) => s.files);
  const notes = useFiles((s) => s.notes);
  const recent = useTabs((s) => s.recent);
  const boards = useBoard((s) => s.boards);
  const [tags, setTags] = useState<readonly { tag: string; count: number }[]>([]);

  // The vault's tags, once per palette (they come from the cache): each is an
  // entry that opens the search filtered by it. Typing `#` narrows to them.
  useEffect(() => {
    if (mode !== "palette") return undefined;
    let live = true;
    unwrap(commands.tags())
      .then((list) => {
        if (live) setTags(list.tags);
      })
      .catch(() => {
        // No cache yet: no tags to offer, nothing to report.
      });
    return () => {
      live = false;
    };
  }, [mode]);

  useEffect(() => {
    const id = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const headingsOnly = headingQuery(mode, query) !== null;

  const pool: Entry[] = useMemo(() => {
    if (headingsOnly) return headingsOfActiveDocument();
    if (mode === "pickNote") {
      // The note being read is the likeliest one to link: first, so an
      // empty query and Enter link it, as the button did before.
      const active = useTabs.getState().active;
      const skip = new Set(pick?.exclude ?? []);
      const ordered = active && notes.includes(active) ? [active, ...notes.filter((n) => n !== active)] : notes;
      return ordered.filter((path) => !skip.has(path)).map((path) => ({ kind: "file", path }));
    }
    // Every listed file, not only notes (ADR-0022); a note shows its stem,
    // anything else its name with the extension. The recently current ones
    // come first (ADR-0037), so an empty query lists them at the top.
    // The file already current is not among them: Enter on the first row
    // should go somewhere else.
    const listed = new Set(files);
    const current = useTabs.getState().active;
    const recentListed = recent.filter((path) => listed.has(path) && path !== current);
    const firsts = new Set(recentListed);
    const fileEntries: Entry[] = [...recentListed, ...files.filter((path) => !firsts.has(path))].map(
      (path) => ({ kind: "file", path }),
    );
    const boardEntries: Entry[] = boards.map((b) => ({
      kind: "board",
      slug: b.slug,
      name: b.name,
    }));
    if (mode === "quickOpen") return [...fileEntries, ...boardEntries];
    const commandEntries: Entry[] = paletteCommands().filter((c) => mode !== "settings" || c.settings).map(
      (c) => ({
        kind: "command",
        id: c.id,
        label: c.valueKey ? t(c.labelKey, { value: t(c.valueKey) }) : t(c.labelKey),
      }),
    );
    if (mode === "settings") return commandEntries;
    const tagEntries: Entry[] = tags.map((entry) => ({ kind: "tag", tag: entry.tag, count: entry.count }));
    return [...commandEntries, ...headingsOfActiveDocument(), ...fileEntries, ...boardEntries, ...tagEntries];
  }, [mode, files, notes, recent, boards, tags, t, pick, headingsOnly]);

  const label = (entry: Entry): string => {
    switch (entry.kind) {
      case "file":
        return isNote(entry.path) ? stemOf(entry.path) : fileNameOf(entry.path);
      case "board":
        return entry.name;
      case "command":
        return entry.label;
      case "create":
        return entry.text;
      case "heading":
        return entry.text;
      case "tag":
        return `#${entry.tag}`;
    }
  };

  const matched = headingQuery(mode, query) ?? query;
  const ranked = useMemo(() => rank(matched, pool, label, 60), [matched, pool]);
  // A name no note has (ADR-0038): quick-open offers to create it, last.
  const results = useMemo(() => {
    const name = query.trim();
    // Not for a name a `[[link]]` could not name (`#`, `|`, brackets, `^`).
    if (mode !== "quickOpen" || !name || /[@#|[\]^]/.test(name) || resolveWikiTarget(name, notes)) {
      return ranked;
    }
    const create: Entry = { kind: "create", name, text: t("editor.completion.newNote", { name }) };
    return [...ranked, { item: create, match: { score: 0, positions: [] } }];
  }, [ranked, mode, query, notes, t]);
  const current = useTabs.getState().active;
  const recentShown = new Set(
    query === "" && mode === "quickOpen" ? recent.filter((path) => path !== current) : [],
  );

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
    if (mode === "pickNote") {
      if (entry.kind === "file" && pick) void pick.onPick(entry.path).catch(report);
      return;
    }
    switch (entry.kind) {
      case "file":
        void useTabs.getState().open(entry.path).catch(report);
        break;
      case "board":
        useUi.getState().setActiveBoard(entry.slug);
        void useBoard.getState().load(entry.slug).catch(report);
        break;
      case "command":
        dispatchCommand(entry.id);
        break;
      case "create":
        void createNoteNamed(entry.name).catch(report);
        break;
      case "heading":
        if (previewMounted()) goToPreviewLine(entry.line);
        else goToEditorLine(entry.line);
        break;
      case "tag":
        useUi.getState().setOverlay({ kind: "search", tag: entry.tag });
        return;
    }
  };

  return (
    <div className="scrim" onMouseDown={close}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <div className="palette-input">
          <span className="palette-prompt" aria-hidden="true" />
          <input
            className="palette-text"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            ref={input}
            value={query}
            placeholder={t(PLACEHOLDER_KEY[mode])}
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
                <span className="result-label">
                  <Marked text={label(entry)} ranges={positionRanges(ranked.match.positions)} />
                </span>
                <span className="result-meta">
                  {entry.kind === "file" && recentShown.has(entry.path)
                    ? t("palette.section.recent")
                    : entry.kind === "file"
                    ? folderOf(entry.path) || (isNote(entry.path) ? t(SECTION_KEY.file) : "")
                    : entry.kind === "tag"
                      ? `${t(SECTION_KEY.tag)} · ${entry.count}`
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
          <span>{t(mode === "palette" || mode === "settings" ? "palette.foot.run" : "palette.foot.open")}</span>
          <span>{t("palette.foot.close")}</span>
        </div>
      </div>
    </div>
  );
}
