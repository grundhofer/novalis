import { useId, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { dispatchCommand } from "../lib/commands";
import { previewKind } from "../lib/fileTypes";
import { ariaKeyshortcutsOf, bindingFor } from "../lib/keymap";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { DEFAULT_FONT_SIZE, FONT_SIZE, useUi } from "../stores/ui";
import Icon from "./Icon";
import Tool from "./Tool";
import ToolRow from "./ToolRow";

/**
 * A press on a tool leaves focus where it is, in the text or the find bar,
 * as the tab's cross does (spec/02 §4.21, NV-H9); the keyboard still
 * reaches every tool, by Tab into the row and the arrows in it.
 */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * The tool row of a file in the editor (ADR-0051 #72, #73), under the tabs
 * where a viewer has its own: sebaro's row under the document tabs
 * (`sb-doc-bar`, role `toolbar`, spec/02 §4.25.3, §4.25.4), one tab stop
 * with the arrows inside (ToolRow.tsx, ADR-0051 #80), groups apart by
 * `__sep`; it wraps at a large root font, a group as one unit (as the
 * viewers' groups, docs/sebaro-luecken.md O).
 *
 * First the preview switch (ADR-0020, ADR-0051 #16): sebaro's compact
 * switch with the eye before its word (spec/02 §4.17, D102 (2), D105 (2):
 * 20 px, never the eye alone), its state in `aria-pressed`, ⌘E in
 * `aria-keyshortcuts`; 32 px high as sebaro's (#78). A CSV, a TSV
 * and an SVG have the switch alone; a Markdown file has its tools after it:
 * Bold, Italic, Link; Heading 1–3, List, Task, Code, Quote; Find; text size
 * smaller and larger. Link, Code, Quote, Find and the text size are icon
 * tools (`link`, `code`, `quote`, `search`, and `zoom-out` / `zoom-in`,
 * which sebaro's reader gives the same ⌘− / ⌘+, §4.25.3); the others are
 * compact word buttons until sebaro has their icons (#75). While the
 * preview shows, the format tools are off in their place (#74), so the row
 * keeps its width; Find and the text size act on the preview too. The text
 * size tools are off at the smallest and largest size (spec/02 §4.19).
 */
export default function DocTools() {
  const { t } = useTranslation();
  const uid = useId();
  const active = useTabs((s) => s.active);
  const boardVisible = useUi((s) => s.boardVisible);
  const previewing = useUi((s) => (active ? !!s.previewing[active] : false));
  const readOnly = useEditorSave((s) => (active ? s.docs[active]?.readOnly : undefined));
  const fontSize = useUi((s) => s.settings?.editor.fontSize ?? DEFAULT_FONT_SIZE);
  const kind = active ? previewKind(active) : null;
  // Only once the file is read: a file on its way shows no tools.
  if (!active || boardVisible || !kind || readOnly === undefined) return null;
  const previewChord = bindingFor("note.togglePreview")?.chord;
  // A format writes into the text: not while the preview shows (#74), and
  // not into a file the editor cannot write.
  const formatsOff = previewing || readOnly;
  const format = (id: string, command: string, label: string, look: { icon: "link" | "code" | "quote" } | { word: string }) => (
    <Tool
      id={`${uid}-${id}`}
      {...look}
      label={label}
      command={command}
      disabled={formatsOff}
      onClick={() => dispatchCommand(command)}
    />
  );
  return (
    <ToolRow className="sb-doc-bar nv-doc-tools" label={t("editor.tools.label")}>
      <button
        className="sb-secondary-action sb-secondary-action--compact"
        type="button"
        aria-pressed={previewing}
        aria-keyshortcuts={previewChord ? ariaKeyshortcutsOf(previewChord) : undefined}
        data-sb-own-shortcut=""
        onClick={() => dispatchCommand("note.togglePreview")}
      >
        <Icon name="eye" size={20} />
        <span className="nv-doc-tools__word" data-nv-word={t("editor.preview")}>
          {t("editor.preview")}
        </span>
      </button>
      {kind === "markdown" && (
        <>
          <span className="sb-doc-bar__sep" aria-hidden="true" />
          <div className="nv-doc-tools__group" onMouseDown={keepFocus}>
            {format("bold", "markdown.bold", t("menu.edit.bold"), { word: t("menu.edit.bold") })}
            {format("italic", "markdown.italic", t("menu.edit.italic"), { word: t("menu.edit.italic") })}
            {format("link", "markdown.link", t("menu.edit.insertLink"), { icon: "link" })}
          </div>
          <span className="sb-doc-bar__sep" aria-hidden="true" />
          <div className="nv-doc-tools__group" onMouseDown={keepFocus}>
            {format("h1", "markdown.heading1", t("palette.cmd.heading1"), { word: t("editor.tools.heading1") })}
            {format("h2", "markdown.heading2", t("palette.cmd.heading2"), { word: t("editor.tools.heading2") })}
            {format("h3", "markdown.heading3", t("palette.cmd.heading3"), { word: t("editor.tools.heading3") })}
            {format("list", "markdown.list", t("palette.cmd.list"), { word: t("palette.cmd.list") })}
            {format("task", "markdown.task", t("palette.cmd.task"), { word: t("palette.cmd.task") })}
            {format("code", "markdown.code", t("palette.cmd.code"), { icon: "code" })}
            {format("quote", "markdown.quote", t("palette.cmd.quote"), { icon: "quote" })}
          </div>
          <span className="sb-doc-bar__sep" aria-hidden="true" />
          <div className="nv-doc-tools__group" onMouseDown={keepFocus}>
            <Tool
              id={`${uid}-find`}
              icon="search"
              label={t("editor.tools.find")}
              command="find.open"
              onClick={() => dispatchCommand("find.open")}
            />
          </div>
          <span className="sb-doc-bar__sep" aria-hidden="true" />
          <div className="nv-doc-tools__group" onMouseDown={keepFocus}>
            <Tool
              id={`${uid}-smaller`}
              icon="zoom-out"
              label={t("menu.view.fontSmaller")}
              command="view.fontSmaller"
              disabled={fontSize <= FONT_SIZE.min}
              onClick={() => dispatchCommand("view.fontSmaller")}
            />
            <Tool
              id={`${uid}-larger`}
              icon="zoom-in"
              label={t("menu.view.fontLarger")}
              command="view.fontLarger"
              disabled={fontSize >= FONT_SIZE.max}
              onClick={() => dispatchCommand("view.fontLarger")}
            />
          </div>
        </>
      )}
    </ToolRow>
  );
}
