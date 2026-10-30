import { describe, expect, it } from "vitest";

import sebaroCss from "../sebaro/css/sebaro.css?raw";
import previewCss from "../styles/preview.css?raw";
import { fenceLanguage, highlightFence } from "./fences";
import { CODE_RULES } from "./theme";

describe("fenceLanguage", () => {
  it("resolves a fence's name exactly: a grammar's name or alias, a listed extension, or nothing", () => {
    const table: Record<string, string | null> = {
      // Exact, never fuzzy: `text` used to be LaTeX.
      text: null,
      plaintext: null,
      txt: null,
      // A grammar's own name or alias.
      python: "Python",
      Python: "Python",
      sh: "Shell",
      // A listed extension means what it means for a file.
      py: "Python",
      rs: "Rust",
      jsonc: "JSON",
      go: "Go",
      // The few names only fences use.
      console: "Shell",
      "shell-session": "Shell",
      golang: "Go",
      // Unknown, empty, or a prototype key.
      mermaid: null,
      "": null,
      constructor: null,
    };
    for (const [info, name] of Object.entries(table)) {
      expect(fenceLanguage(info)?.name ?? null, info).toBe(name);
    }
  });
});

describe("highlightFence", () => {
  it("returns the fence's text in runs wearing the editor's code classes, nothing lost", async () => {
    const code = '{"a": 1,\n "b": "x"}\n';
    const runs = await highlightFence(code, "json");
    expect(runs).not.toBeNull();
    expect(runs?.map((run) => run.text).join("")).toBe(code);
    // sebaro's looks (spec/01 §1.8): a number is a constant, a key plain.
    expect(runs?.find((run) => run.text === "1")?.classes).toBe("sb-tok-constant");
    expect(runs?.find((run) => run.text === '"x"')?.classes).toBe("sb-tok-string");
    expect(runs?.find((run) => run.text.includes('"a"'))?.classes).toBe("");
  });

  it("leaves a fence alone that names no grammar, or is too long to parse here", async () => {
    expect(await highlightFence("\\section{x}\n", "text")).toBeNull();
    expect(await highlightFence(`{${"1,".repeat(50_000)}}`, "json")).toBeNull();
  });
});

describe("sebaro.css", () => {
  // The preview cannot mount the editor's style module (ADR-0022 point 8):
  // its fences wear `sb-tok-<look>`, which sebaro.css §6 colours (TEC-08).
  // Here the editor's rule for each look says what sebaro's does, and the
  // preview has no colours of its own for code.
  it("colours every code rule's class with the rule's own style", () => {
    const rules = [...sebaroCss.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    for (const { name, style } of CODE_RULES) {
      const rule = rules.find(([, selector]) => new RegExp(`\\.sb-tok-${name}\\b`).test(selector ?? ""));
      expect(rule, name).toBeDefined();
      const declared = (rule?.[2] ?? "")
        .split(";")
        .map((line) => line.trim())
        .filter(Boolean)
        .sort();
      const expected = Object.entries(style)
        .map(([property, value]) => `${property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: ${value}`)
        .sort();
      expect(declared, name).toEqual(expected);
    }
    expect(CODE_RULES.map((rule) => rule.name)).toEqual(["keyword", "string", "constant", "comment", "invalid"]);
    expect(previewCss).not.toMatch(/\.tok-/);
  });
});
