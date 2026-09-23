import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { resolveWikiTarget } from "../lib/links";

/**
 * `[[links]]` that resolve to no note are drawn dimmed and dashed
 * (ADR-0038), so a link written before its note exists is visible as one;
 * `Cmd`-click on it offers to create the note.
 */

/** The vault's note list changed: every link is looked at again. */
export const notesChanged = StateEffect.define<null>();

const unresolved = Decoration.mark({ class: "nv-link-unresolved" });

/**
 * The note a `[[…]]` names: the text before `|` and `#`, without the
 * brackets; empty for `[[#heading]]`, which is the note it is written in.
 */
export function wikiName(raw: string): string {
  return raw
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]!
    .split("#")[0]!
    .trim();
}

export function unresolvedLinks(notePaths: () => readonly string[]): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    const paths = notePaths();
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter: (node) => {
          if (node.name !== "WikiLink") return;
          const name = wikiName(view.state.sliceDoc(node.from, node.to));
          if (name && !resolveWikiTarget(name, paths)) builder.add(node.from, node.to, unresolved);
          return false;
        },
      });
    }
    return builder.finish();
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTree(update.startState) !== syntaxTree(update.state) ||
          update.transactions.some((tr) => tr.effects.some((e) => e.is(notesChanged)))
        ) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
