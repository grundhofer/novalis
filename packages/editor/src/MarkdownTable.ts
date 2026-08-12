// A table serializer that degrades instead of destroying.
//
// A GFM pipe table cannot express two things the editor's schema allows: block
// content inside a cell (`tableCell` is `block+`), and merged cells. Faced with
// either, tiptap-markdown's own serializer gives up on the WHOLE table and
// hands it to the HTML fallback — which, under `html: false`, writes the seven
// literal characters `[table]` and logs a warning.
//
// That is total, silent data loss on an everyday keystroke. Pressing Enter once
// inside a cell splits its paragraph, the cell now has two children, and the
// next autosave replaces the entire table on disk with `[table]`. Reopening the
// note escapes the brackets and cements it as `\[table\]`.
//
// The rule here instead: ALWAYS emit a valid pipe table. Where the structure
// cannot survive, flatten it and keep the text — a cell's blocks are joined
// with a space, span attributes are ignored, and the first row becomes the
// header row whatever its cells are. Structure is lost, which markdown cannot
// hold anyway; content is not.
//
// Output is byte-identical to upstream's for every table upstream would have
// serialized, so the existing round-trip corpus pins both paths at once. Only
// the give-up branch is replaced.

import { Table } from "@tiptap/extension-table";
import type { MarkdownNodeSpec } from "tiptap-markdown";

/** Neither field is in tiptap-markdown's public typings, and both are stable —
 *  `MarkdownText` reaches for `out` the same way. `inTable` gates hardBreak
 *  serialization: inside a table a break must render as HTML, because a
 *  backslash-newline would end the row. */
type SerializerInternals = { inTable: boolean; out: string };

/** Blocks a keypress by reporting it handled without dispatching anything. */
const swallow = () => true;

const serialize: MarkdownNodeSpec["serialize"] = (state, node) => {
  const internals = state as unknown as SerializerInternals;
  internals.inTable = true;

  node.forEach((row, _rowOffset, rowIndex) => {
    state.write("| ");
    row.forEach((cell, _cellOffset, cellIndex) => {
      if (cellIndex) state.write(" | ");
      // Upstream renders `cell.firstChild` and silently drops the rest. Render
      // every block that carries text, space-joined — for the single-block
      // cells upstream could handle, this is the same write in the same order.
      const start = internals.out.length;
      let written = false;
      cell.forEach((block) => {
        if (!block.textContent.trim()) return;
        if (written) state.write(" ");
        // Only a textblock can be rendered inline. Anything else in a cell (a
        // list pasted into one) would emit its own block structure, so take its
        // text and drop the marks — the alternative is losing the row.
        if (block.isTextblock) state.renderInline(block);
        else state.write(block.textContent);
        written = true;
      });
      // A row is one line by definition: a single stray newline anywhere in a
      // cell ends it early and turns the rest of the table into paragraphs.
      // Cheap insurance — for the cells upstream handled this is a no-op,
      // because inline rendering never emits one.
      const cellText = internals.out.slice(start);
      if (cellText.includes("\n")) {
        internals.out = internals.out.slice(0, start) + cellText.replace(/\s*\n\s*/g, " ").trim();
      }
    });
    state.write(" |");
    state.ensureNewLine();

    if (!rowIndex) {
      const delimiter = Array.from({ length: row.childCount })
        .map(() => "---")
        .join(" | ");
      state.write(`| ${delimiter} |`);
      state.ensureNewLine();
    }
  });

  state.closeBlock(node);
  internals.inTable = false;
};

export const MarkdownTable = Table.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize,
        parse: {
          // markdown-it, same as upstream.
        },
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Keep the cell to one block, so what the editor shows is what the file
      // can hold. Without this, Enter splits the cell's paragraph and the
      // second line silently disappears on the next reload — the serializer
      // above keeps the text, but a pipe table has nowhere to put the break.
      // Scoped to a paragraph that is a DIRECT child of a cell, so Enter still
      // works normally inside a list that was pasted into one.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        const container = $from.depth > 0 ? $from.node($from.depth - 1) : null;
        const name = container?.type.name;
        return name === "tableCell" || name === "tableHeader" ? swallow() : false;
      },
    };
  },
});
