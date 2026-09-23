import { EditorState, type Extension } from "@codemirror/state";

import i18next from "../i18n";

/**
 * CodeMirror's own words — the find and replace panel, Go to Line, what a
 * screen reader hears — in the app's language (PLAN.md §5.8). Without
 * this the panel was English on a German Mac (a defect by the 2026-09-20
 * record, `EditorState.phrases`). `$` is CodeMirror's placeholder, kept as
 * it is in both catalogs.
 */
const KEYS: Record<string, string> = {
  Find: "editor.find.find",
  Replace: "editor.find.replace",
  next: "editor.find.next",
  previous: "editor.find.previous",
  all: "editor.find.all",
  "match case": "editor.find.matchCase",
  regexp: "editor.find.regexp",
  "by word": "editor.find.byWord",
  replace: "editor.find.replaceOne",
  "replace all": "editor.find.replaceAll",
  close: "editor.find.close",
  "current match": "editor.find.currentMatch",
  "on line": "editor.find.onLine",
  "replaced $ matches": "editor.find.replacedMatches",
  "replaced match on line $": "editor.find.replacedMatchOnLine",
  "Go to line": "editor.find.gotoLine",
  go: "editor.find.go",
};

/** The phrases for the current language; the view is rebuilt when it changes. */
export function editorPhrases(): Extension {
  return EditorState.phrases.of(
    Object.fromEntries(Object.entries(KEYS).map(([phrase, key]) => [phrase, i18next.t(key)])),
  );
}
