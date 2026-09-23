import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import de from "../../../../../i18n/de.json";
import i18next from "../i18n";
import { editorPhrases } from "./phrases";

// The find panel was English on a German Mac (2026-09-20 record): its words
// now come from the catalog, `$` kept for CodeMirror to fill in.
describe("editorPhrases", () => {
  it("gives CodeMirror the find panel's words in the app's language", async () => {
    await i18next.init({
      lng: "de",
      resources: { de: { translation: de } },
      keySeparator: false,
      nsSeparator: false,
    });
    const state = EditorState.create({ extensions: [editorPhrases()] });
    expect(state.phrase("Find")).toBe("Suchen");
    expect(state.phrase("replace all")).toBe("alle ersetzen");
    expect(state.phrase("replaced $ matches", 3)).toBe("3 Treffer ersetzt");
    expect(state.phrase("Go to line")).toBe("Gehe zu Zeile");
  });
});
