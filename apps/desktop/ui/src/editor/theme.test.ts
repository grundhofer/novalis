import { tags as t } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { noteTag } from "./markdownExt";
import { markdownHighlight } from "./theme";

const style = (tag: Parameters<typeof markdownHighlight.style>[0][number]) =>
  markdownHighlight.style([tag]);

describe("markdownHighlight", () => {
  it("wears the chip on the note's own tag and on no grammar's label", () => {
    expect(style(noteTag)).not.toBeNull();
    // A CSS `#id`, a YAML anchor, a Rust loop label, a fence's info string.
    expect(style(t.labelName)).toBeNull();
  });

  it("dresses what the code grammars mark, on the tokens that exist", () => {
    const rules = markdownHighlight.module?.getRules() ?? "";
    for (const tag of [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.function(t.definition(t.variableName)),
      t.operator,
      t.punctuation,
      t.meta,
      t.annotation,
      t.macroName,
      t.namespace,
      t.regexp,
      t.escape,
      t.inserted,
      t.deleted,
      t.changed,
    ]) {
      expect(style(tag), tag.toString()).not.toBeNull();
    }
    // A function name is weighted, never coloured: no thirteenth token.
    expect(rules).toContain("font-weight: 450");
    expect(rules).not.toContain("syntax-function");
  });

  it("leaves a plain variable name and a Markdown marker as they were", () => {
    expect(style(t.variableName)).toBeNull();
    // `processingInstruction` is a `meta`; the marker rule still wins.
    expect(style(t.processingInstruction)).not.toBe(style(t.meta));
  });
});
