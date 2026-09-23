import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { WikiLink } from "./markdownExt";
import { notesChanged, unresolvedLinks, wikiName } from "./unresolvedLinks";

// ADR-0038: a `[[link]]` to no note is marked; one that resolves is not.
describe("unresolvedLinks", () => {
  it("reads the note a link names", () => {
    expect(wikiName("[[Ideas|my ideas]]")).toBe("Ideas");
    expect(wikiName("[[Plan#Open]]")).toBe("Plan");
    expect(wikiName("[[#Open]]")).toBe("");
  });

  it("marks only the links that resolve to nothing, and follows the note list", () => {
    let notes = ["Ideas.md"];
    const state = EditorState.create({
      doc: "see [[Ideas]] and [[Missing]] and [[#here]]\n",
      extensions: [markdown({ base: markdownLanguage, extensions: [WikiLink] }), unresolvedLinks(() => notes)],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const view = new EditorView({ state, parent: document.body });
    const marked = () => [...view.dom.querySelectorAll(".nv-link-unresolved")].map((el) => el.textContent);
    expect(marked()).toEqual(["[[Missing]]"]);

    notes = ["Ideas.md", "Missing.md"];
    view.dispatch({ effects: notesChanged.of(null) });
    expect(marked()).toEqual([]);
    view.destroy();
  });
});
