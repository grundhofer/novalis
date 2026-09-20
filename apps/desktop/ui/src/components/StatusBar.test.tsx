import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import StatusBar, { countWords } from "./StatusBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => (values?.count === undefined ? key : `${key}:${values.count}`),
  }),
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

function doc(text: string, plainMode = false) {
  return {
    path: "a.md",
    text,
    savedText: text,
    writePath: "a.md",
    precondition: null,
    lastWriteHash: null,
    dirty: false,
    saving: false,
    readOnly: false,
    plainMode,
    banner: null,
    revision: 0,
  };
}

describe("StatusBar", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: ["a.md"], active: "a.md" });
  });

  it("counts words and characters of the mirror", () => {
    useEditorSave.setState({ docs: { "a.md": doc("one two  three\n") } });
    render(<StatusBar />);
    expect(screen.getByText("status.words:3")).toBeTruthy();
    expect(screen.getByText("status.characters:15")).toBeTruthy();
  });

  // ADR-0022 F7: a plain-mode buffer (5 MB and up) is never split into words;
  // its length is free. The count itself is pinned below the render guard.
  it("never splits a plain-mode text", () => {
    const text = "one two three";
    const split = vi.spyOn(String.prototype, "split");
    expect(countWords(text, true)).toBe(0);
    expect(split).not.toHaveBeenCalled();
    expect(countWords(text, false)).toBe(3);
    expect(countWords("  ", false)).toBe(0);
    expect(countWords(undefined, false)).toBe(0);
    split.mockRestore();
  });

  it("counts no words in plain mode", () => {
    useEditorSave.setState({ docs: { "a.md": doc("one two three", true) } });
    render(<StatusBar />);
    expect(screen.queryByText(/status\.words/)).toBeNull();
    expect(screen.getByText("status.characters:13")).toBeTruthy();
    expect(screen.getByText("status.plainMode")).toBeTruthy();
  });
});
