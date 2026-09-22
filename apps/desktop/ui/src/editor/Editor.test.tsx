import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deferLine } from "../lib/editorBridge";
import { forgetPositions, keptPosition } from "../lib/positions";
import { useEditorSave } from "../stores/editorSave";
import Editor from "./Editor";

vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

const TEXT = "# One\n\nfirst paragraph\n\nsecond paragraph\n";

function doc(path: string, text: string) {
  useEditorSave.setState({
    docs: { [path]: { path, text, readOnly: false, plainMode: false } as never },
  });
}

/** Mount the editor for `path` and wait until CodeMirror has its view. */
async function mount(path: string, revision = 0) {
  const rendered = render(
    <Editor path={path} revision={revision} spellcheck={false} onFollowLink={() => undefined} notePaths={() => []} />,
  );
  let view: EditorView | null = null;
  for (let i = 0; i < 50 && !view; i += 1) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    const dom = rendered.container.querySelector<HTMLElement>(".cm-editor");
    view = dom ? EditorView.findFromDOM(dom) : null;
  }
  if (!view) throw new Error("the editor never mounted");
  return { ...rendered, view };
}

// docs/research/2026-09-20-feature-gaps.md A4: a tab switch, `Cmd+E` and a
// reload rebuild the view; the reader stays where they were.
describe("Editor keeps the place", () => {
  beforeEach(() => {
    forgetPositions();
    deferLine(null);
    doc("a.md", TEXT);
  });

  it("brings the selection back when the view is rebuilt", async () => {
    const first = await mount("a.md");
    first.view.dispatch({ selection: { anchor: 9, head: 14 } });
    first.unmount();

    expect(keptPosition("a.md")).toMatchObject({ line: 3, last: "editor" });
    const again = await mount("a.md");
    expect(again.view.state.selection.main).toMatchObject({ anchor: 9, head: 14 });
    again.unmount();
  });

  it("clamps a kept selection to a text that shrank on disk", async () => {
    const first = await mount("a.md");
    first.view.dispatch({ selection: { anchor: TEXT.length } });
    first.unmount();

    doc("a.md", "# One\n");
    const again = await mount("a.md", 1);
    expect(again.view.state.selection.main.head).toBe(6);
    again.unmount();
  });

  it("lets a jump win over the kept place", async () => {
    const first = await mount("a.md");
    first.view.dispatch({ selection: { anchor: 2 } });
    first.unmount();

    deferLine({ line: 5, snippet: "second paragraph" });
    const again = await mount("a.md");
    expect(again.view.state.doc.lineAt(again.view.state.selection.main.head).number).toBe(5);
    again.unmount();
  });
});
