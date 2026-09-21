import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { describe, expect, it } from "vitest";

import { EXTENSION_KINDS, NAME_KINDS, PATTERN_KINDS } from "./fileTypes.generated";
import {
  EXTENSION_PRESENTATION,
  grammarNameOf,
  NAME_PRESENTATION,
  PATTERN_PRESENTATION,
  presentationOf,
  PRESETS,
} from "./fileTypes.presentation";

describe("fileTypes.presentation", () => {
  // The list is the shell's; the dress is the editor's. A text row without
  // a dress would open with the fallback, a dress without a row is dead.
  it("dresses exactly the note and text rows of the generated table", () => {
    const rows = (kinds: Readonly<Record<string, string>>) =>
      Object.entries(kinds)
        .filter(([, kind]) => kind !== "view")
        .map(([key]) => key)
        .sort();
    expect(Object.keys(EXTENSION_PRESENTATION).sort()).toEqual(rows(EXTENSION_KINDS));
    expect(Object.keys(NAME_PRESENTATION).sort()).toEqual(rows(NAME_KINDS));
    expect(Object.keys(PATTERN_PRESENTATION).sort()).toEqual(rows(PATTERN_KINDS));
  });

  // An upstream rename in `language-data` would otherwise turn a grammar
  // off without a word.
  it("names only grammars the installed language-data table has", () => {
    const names = new Set(
      [
        ...Object.values(EXTENSION_PRESENTATION),
        ...Object.values(NAME_PRESENTATION),
        ...Object.values(PATTERN_PRESENTATION),
      ]
        .map((dress) => dress.grammar)
        .filter((grammar): grammar is string => grammar !== null),
    );
    names.add("Nginx");
    names.add("CMake");
    for (const name of names) {
      const found = LanguageDescription.matchLanguageName(languages, name, false);
      expect(found?.name, name).toBe(name);
    }
  });

  // The defects of the path lookup (docs/research/2026-09-20-formats-plan.md
  // §2.3): `.text` was LaTeX, `.cfg` TTCN-3, `.zsh` and a Dockerfile in a
  // folder nothing, an upper-case extension nothing.
  it("resolves by name and pattern, exactly", () => {
    for (const [path, grammar] of [
      ["a.md", "Markdown"],
      ["a.zsh", "Shell"],
      ["sub/Dockerfile", "Dockerfile"],
      ["Dockerfile.dev", "Dockerfile"],
      ["Containerfile", "Dockerfile"],
      ["Dockerfile.md", "Markdown"],
      ["Dockerfile.txt", null],
      ["sub/nginx.conf", "Nginx"],
      ["conf/NGINX-site.conf", "Nginx"],
      ["my-nginx.conf", "Nginx"],
      ["nginx/site.conf", null],
      ["CMakeLists.txt", "CMake"],
      ["notes/CMakeLists.txt.md", "Markdown"],
      ["X.JSON", "JSON"],
      ["notes.text", null],
      ["app.cfg", "Properties files"],
      ["dev.env", "Properties files"],
      ["data.csv", null],
      ["a.conf", null],
      ["Makefile", null],
      ["GNUmakefile", null],
      ["justfile", null],
      ["LICENSE", null],
      ["README", null],
      ["Gemfile", "Ruby"],
      ["Jenkinsfile", "Groovy"],
      ["main.go", "Go"],
      ["paper.tex", "LaTeX"],
      ["x.diff", "diff"],
      ["notes.mdx", null],
      ["app.js.map", null],
      ["song.wav", null],
      ["constructor", null],
    ] as const) {
      expect(grammarNameOf(path), path).toBe(grammar);
    }
  });

  it("gives Makefile a tab and prose a wrap", () => {
    expect(PRESETS[presentationOf("Makefile")?.preset ?? "data"].indent).toBe("\t");
    expect(PRESETS[presentationOf("main.go")?.preset ?? "data"].indent).toBe("\t");
    expect(presentationOf("README")?.preset).toBe("prose");
    expect(presentationOf("LICENSE")?.preset).toBe("prose");
    expect(presentationOf("paper.tex")?.preset).toBe("prose");
    expect(presentationOf("Dockerfile.dev")?.preset).toBe("code2");
    // A name pattern dresses the whole row, not just its grammar.
    expect(presentationOf("CMakeLists.txt")).toEqual({ preset: "code2", grammar: "CMake" });
    expect(presentationOf("sub/nginx.conf")).toEqual({ preset: "data", grammar: "Nginx" });
    expect(presentationOf("notes/CMakeLists.txt.md")?.preset).toBe("prose");
    expect(PRESETS[presentationOf("a.md")?.preset ?? "data"]).toMatchObject({ wrap: true, numbers: false });
    expect(PRESETS[presentationOf("a.py")?.preset ?? "data"].indent).toBe("    ");
    expect(PRESETS[presentationOf("a.csv")?.preset ?? "data"]).toMatchObject({ wrap: false, numbers: true });
    expect(presentationOf("a.pdf")).toBeNull();
    expect(presentationOf("song.wav")).toBeNull();
  });
});
