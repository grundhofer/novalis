// TagSuggestion: a `#` autocomplete for inline tags, built on
// @tiptap/suggestion. Typing `#` at a word start lists existing tags (from the
// host's index) and inserts a plain `#tag` text token — no custom node, so the
// markdown round-trip is unaffected and the tag is just text the index already
// understands.

import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion, type SuggestionMatch, type Trigger } from "@tiptap/suggestion";

import { createSuggestRenderer } from "./suggestPopover";

export interface TagSuggestionOptions {
  /** Tag search the host wires to its index; returns bare tags (no `#`). */
  onSearch?: (query: string) => Promise<string[]>;
}

const tagSuggestKey = "tagSuggestion";

/** Match a `#tag` token at a word start (start of line or after whitespace),
 *  capturing the partial tag. Allows `/` and `-` for nested/hyphenated tags.
 *  Skips code blocks. */
function findTagMatch({ $position }: Trigger): SuggestionMatch {
  if ($position.parent.type.name === "codeBlock") return null;
  const from = $position.start();
  const textBefore = $position.doc.textBetween(from, $position.pos, "\n", "\0");
  const m = /(?:^|\s)#([\w/-]*)$/.exec(textBefore);
  if (!m) return null;
  const token = m[0].slice(m[0].indexOf("#")); // "#partial" without any leading space
  return {
    range: { from: $position.pos - token.length, to: $position.pos },
    query: m[1],
    text: token,
  };
}

export const TagSuggestion = Extension.create<TagSuggestionOptions>({
  name: "tagSuggestion",

  addOptions() {
    return { onSearch: undefined };
  },

  addProseMirrorPlugins() {
    const onSearch = this.options.onSearch;
    return [
      Suggestion<string, string>({
        editor: this.editor,
        pluginKey: new PluginKey(tagSuggestKey),
        char: "#",
        allowSpaces: false,
        findSuggestionMatch: findTagMatch,
        items: ({ query }) => (onSearch ? onSearch(query) : Promise.resolve([])),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [{ type: "text", text: `#${props}` }])
            .run();
        },
        render: () => createSuggestRenderer<string>({ getLabel: (tag) => `#${tag}` }),
      }),
    ];
  },
});
