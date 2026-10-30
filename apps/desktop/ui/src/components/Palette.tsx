import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap, type SettingsDto } from "../ipc/client";
import { createNoteNamed, dispatchCommand, paletteCommands } from "../lib/commands";
import { resolveWikiTarget } from "../lib/links";
import { goToEditorLine } from "../lib/editorBridge";
import { previewKind } from "../lib/fileTypes";
import { rank, type Ranked } from "../lib/fuzzy";
import { headingsOf } from "../lib/headings";
import { positionRanges } from "../lib/matchRanges";
import { bindingFor } from "../lib/keymap";
import { fileNameOf, folderOf, isNote, stemOf } from "../lib/paths";
import { goToPreviewLine, previewMounted } from "../lib/previewBridge";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { report, SIDEBAR_WIDTH, useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import "../styles/overlay.css";
import { FileName } from "./FileName";
import Icon from "./Icon";
import Keys from "./Keys";
import Marked from "./Marked";
import { PaletteFoot, step, usePaletteFrame } from "./PaletteFrame";

/**
 * Quick-open (`Cmd+P`) and the command palette (`Cmd+K`, `Shift+Cmd+P`) are
 * the same component: one list, two sources. The note and folder pickers are
 * quick-open on what they offer.
 *
 * The palette is "the home of every transient toggle" (PLAN.md §5.3) and it
 * carries the heading jump that replaces the dropped outline panel (§4.3).
 * Its settings rows are a second way to the six the settings view shows
 * (DSK-05, ADR-0051 #1).
 *
 * The frame is sebaro's command palette (spec/02 §4.16, NAV-09; the frame
 * in ./PaletteFrame): the search row with its combobox, the rows grouped
 * under heads (`__group`) in the order their best match ranks, a setting's
 * state as the check at the row's start (`aria-checked`, DSK-05), a
 * command's chord at its end, the empty sentence and the key hints. sebaro's
 * palette is for commands only; Quick Open and the pickers reuse the frame
 * (docs/sebaro-luecken.md B „Palette“).
 */

type Entry =
  | { kind: "file"; path: string }
  | { kind: "folder"; path: string; name: string }
  | { kind: "create"; name: string; text: string }
  | { kind: "tag"; tag: string; count: number }
  | { kind: "board"; slug: string; name: string }
  | { kind: "command"; id: string; label: string; settings: boolean }
  | { kind: "heading"; line: number; text: string };

/** The head a row stands under; a file's depends on the mode and on whether it was recent. */
const GROUP_KEY: Record<Exclude<Entry["kind"], "file" | "command">, string> = {
  folder: "palette.section.folders",
  // „Neue Notiz“ over „„Ideen“ anlegen“, last (ADR-0038).
  create: "menu.file.newNote",
  board: "palette.section.boards",
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

export type PaletteMode = "quickOpen" | "palette" | "pickNote" | "pickFolder" | "headings";

/** The dialog's and the list's name (`aria-label`). */
const NAME_KEY: Record<PaletteMode, string> = {
  quickOpen: "palette.name.quickOpen",
  palette: "palette.section.commands",
  pickNote: "palette.name.pickNote",
  pickFolder: "palette.name.pickFolder",
  headings: "palette.section.headings",
};

/** What the empty sentence says when the query matched nothing (NAV-09). */
const NO_MATCH_KEY: Record<PaletteMode, string> = {
  quickOpen: "palette.noMatch.quickOpen",
  palette: "palette.noMatch.palette",
  pickNote: "palette.noMatch.pickNote",
  pickFolder: "palette.noMatch.pickFolder",
  headings: "palette.noMatch.headings",
};

/** What the empty sentence says when there is nothing to list (DAT-07). */
const EMPTY_KEY: Record<PaletteMode, string> = {
  quickOpen: "palette.empty.quickOpen",
  palette: "palette.empty.palette",
  pickNote: "palette.empty.pickNote",
  pickFolder: "palette.empty.pickFolder",
  headings: "palette.empty.headings",
};

/**
 * Whether a choice is the current one, for the check at its row's start
 * (DSK-05, NAV-09): the settings' values and the sidebar's three widths, as
 * the native menu checks them. `undefined` for a command without a state.
 */
function checkedOf(id: string, settings: SettingsDto | null, sidebarWidth: number): boolean | undefined {
  const [, , value = ""] = id.split(".");
  if (id.startsWith("settings.appearance.")) return settings?.appearance === value;
  if (id.startsWith("settings.tone.")) return settings?.tone === value;
  if (id.startsWith("settings.language.")) return settings?.language === value;
  if (id === "settings.spellcheck") return settings?.spellcheck ?? true;
  if (id === "settings.reduceMotion") return settings?.reduceMotion ?? false;
  if (id.startsWith("sidebar.width.") && value in SIDEBAR_WIDTH) {
    return sidebarWidth === SIDEBAR_WIDTH[value as keyof typeof SIDEBAR_WIDTH];
  }
  return undefined;
}

const PLACEHOLDER_KEY: Record<PaletteMode, string> = {
  quickOpen: "palette.quickOpenPlaceholder",
  palette: "palette.placeholder",
  pickNote: "board.linkNote",
  pickFolder: "palette.moveToPlaceholder",
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

/** The folders Move To… offers (DSK-11), `""` the vault root, and where the choice goes. */
export interface FolderPickRequest {
  /** The file being moved, named in the input. */
  name: string;
  folders: readonly string[];
  onPick: (folder: string) => Promise<void>;
}

export default function Palette({
  mode,
  pick,
  pickFolder,
}: {
  mode: PaletteMode;
  pick?: PickRequest;
  pickFolder?: FolderPickRequest;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const { dialog, dismiss } = usePaletteFrame(input);
  const settings = useUi((s) => s.settings);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const files = useFiles((s) => s.files);
  const notes = useFiles((s) => s.notes);
  const recent = useTabs((s) => s.recent);
  const boards = useBoard((s) => s.boards);
  const vaultName = useVault((s) => s.vault?.name ?? "");
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

  const headingsOnly = headingQuery(mode, query) !== null;

  const pool: Entry[] = useMemo(() => {
    if (headingsOnly) return headingsOfActiveDocument();
    if (mode === "pickFolder") {
      // The vault root goes by the vault's name; a folder by its path, so
      // two of the same name differ and a typed path finds one.
      return (pickFolder?.folders ?? []).map((path) => ({
        kind: "folder",
        path,
        name: path === "" ? vaultName : path,
      }));
    }
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
    const commandEntries: Entry[] = paletteCommands().map((c) => ({
      kind: "command",
      id: c.id,
      label: c.valueKey ? t(c.labelKey, { value: t(c.valueKey) }) : t(c.labelKey),
      settings: c.settings === true,
    }));
    const tagEntries: Entry[] = tags.map((entry) => ({ kind: "tag", tag: entry.tag, count: entry.count }));
    return [...commandEntries, ...headingsOfActiveDocument(), ...fileEntries, ...boardEntries, ...tagEntries];
  }, [mode, files, notes, recent, boards, tags, t, pick, pickFolder, vaultName, headingsOnly]);

  const label = (entry: Entry): string => {
    switch (entry.kind) {
      case "file":
        return isNote(entry.path) ? stemOf(entry.path) : fileNameOf(entry.path);
      case "folder":
        return entry.name;
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

  // The rows under their heads, each group where its best match ranks; the
  // arrows walk them in this order.
  const groupOf = (entry: Entry): string => {
    switch (entry.kind) {
      case "file":
        if (recentShown.has(entry.path)) return "palette.section.recent";
        return mode === "pickNote" ? "palette.section.notes" : "palette.section.files";
      case "command":
        return entry.settings ? "sidebar.settings" : "palette.section.commands";
      default:
        return GROUP_KEY[entry.kind];
    }
  };
  const grouped = new Map<string, Ranked<Entry>[]>();
  for (const ranked of results) {
    const key = groupOf(ranked.item);
    grouped.set(key, [...(grouped.get(key) ?? []), ranked]);
  }
  let next = 0;
  const sections = [...grouped].map(([key, members]) => ({
    key,
    rows: members.map((ranked) => ({ ranked, position: next++ })),
  }));
  const rows = sections.flatMap((section) => section.rows);
  const optionId = (position: number) => `${id}-o${position}`;

  // The active row stays in view while the arrows walk past the edge.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  const run = (entry: Entry | undefined) => {
    if (!entry) return;
    dismiss();
    if (mode === "pickNote") {
      if (entry.kind === "file" && pick) void pick.onPick(entry.path).catch(report);
      return;
    }
    if (mode === "pickFolder") {
      if (entry.kind === "folder" && pickFolder) void pickFolder.onPick(entry.path).catch(report);
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
        // A command from the palette may move focus into what it opens (ADR-0051 #48).
        dispatchCommand(entry.id, "palette");
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

  const name = t(NAME_KEY[mode]);
  const placeholder = t(PLACEHOLDER_KEY[mode], { name: pickFolder?.name ?? "" });
  // NAV-09: what was typed and found nothing is named, with what was looked
  // for; with nothing typed, DAT-07 names what there is none of.
  const matchedQuery = matched.trim();
  const sentenceMode = headingsOnly ? "headings" : mode;
  const empty =
    rows.length > 0
      ? ""
      : matchedQuery
        ? t(NO_MATCH_KEY[sentenceMode], { query: matchedQuery })
        : t(EMPTY_KEY[sentenceMode]);

  const meta = (entry: Entry): ReactNode => {
    switch (entry.kind) {
      case "file": {
        const folder = folderOf(entry.path);
        return folder ? <FileName name={folder} /> : null;
      }
      case "folder":
        return entry.path === "" ? t("palette.vaultRoot") : null;
      case "tag":
        return entry.count;
      default:
        return null;
    }
  };

  return (
    <dialog className="sb-command-palette" data-sb-density="window" aria-label={name} {...dialog}>
      <div className="sb-command-palette__search">
        <Icon name="search" size={20} />
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={rows[index] ? optionId(index) : undefined}
          aria-label={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          ref={input}
          value={query}
          placeholder={placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // A command may open a dialog, which takes the focus at once:
              // the rest of this Enter must not press its button or submit
              // its form.
              event.preventDefault();
              run(rows[index]?.ranked.item);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((i) => step(i, rows.length, event.key === "ArrowUp"));
            }
          }}
        />
      </div>

      {/* A press on a row keeps the focus in the field (§4.16). */}
      <div
        className="sb-command-palette__list"
        id={`${id}-list`}
        role="listbox"
        aria-label={name}
        ref={list}
        onMouseDown={(event) => event.preventDefault()}
      >
        {sections.map((section, number) => (
          <div className="sb-command-palette__section" key={section.key}>
            <div className="sb-command-palette__group" id={`${id}-g${number}`}>
              {t(section.key)}
            </div>
            <div role="group" aria-labelledby={`${id}-g${number}`}>
              {section.rows.map(({ ranked, position }) => {
                const entry = ranked.item;
                const chord = entry.kind === "command" ? bindingFor(entry.id)?.chord : undefined;
                const checked = entry.kind === "command" ? checkedOf(entry.id, settings, sidebarWidth) : undefined;
                const rowMeta = meta(entry);
                return (
                  <div
                    className="sb-row"
                    role="option"
                    id={optionId(position)}
                    aria-selected={position === index}
                    aria-checked={checked}
                    key={`${entry.kind}-${label(entry)}-${position}`}
                    onClick={() => run(entry)}
                  >
                    <span className="sb-row__check" aria-hidden="true">
                      {checked !== undefined && <Icon name="check" />}
                    </span>
                    <span className="sb-row__name">
                      <Marked
                        text={label(entry)}
                        ranges={positionRanges(ranked.match.positions)}
                        fileName={entry.kind === "file" || entry.kind === "folder"}
                        hit
                      />
                    </span>
                    {rowMeta !== null && <span className="sb-row__meta">{rowMeta}</span>}
                    {chord && <Keys chord={chord} />}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="sb-command-palette__empty" role="status">
        {empty}
      </p>

      <PaletteFoot
        verbKey={
          mode === "palette"
            ? "palette.foot.run"
            : mode === "pickFolder"
              ? "palette.foot.move"
              : "palette.foot.open"
        }
      />
    </dialog>
  );
}
