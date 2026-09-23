import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deferLine } from "../lib/editorBridge";
import { forgetPositions, keptPosition } from "../lib/positions";
import { useCursor } from "../stores/cursor";
import { useEditorSave } from "../stores/editorSave";
import Editor from "./Editor";

vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

// A real view measures after a scroll request, and jsdom's `Range` has no
// layout (ADR-0011). Without these the measure throws from a timer after the
// test has finished — on a slow machine only, which is how CI found it.
beforeAll(() => {
  const empty = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= empty;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

const TEXT = "# One\n\nfirst paragraph\n\nsecond paragraph\n";

function doc(path: string, text: string) {
  useEditorSave.setState({
    docs: { [path]: { path, text, readOnly: false, plainMode: false } as never },
  });
}

/** Mount the editor for `path` and wait until CodeMirror has its view. */
async function mount(path: string, revision = 0) {
  const rendered = render(
    <Editor path={path} revision={revision} spellcheck={false} invisibles={false} onFollowLink={() => undefined} notePaths={() => []} />,
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

  // feature-gaps A9: the status bar's position, selection and cursors.
  it("reports where the cursor is, and forgets it when the view goes", async () => {
    const view = await mount("a.md");
    view.view.dispatch({ selection: { anchor: 9, head: 14 } });
    expect(useCursor.getState().cursor).toEqual({ path: "a.md", line: 3, column: 8, selected: 5, cursors: 1 });
    view.unmount();
    expect(useCursor.getState().cursor).toBeNull();
  });

  // feature-gaps A2: WebKit leaves the first editable of a launch unchecked
  // in the built app; the first key typed sets `spellcheck` once more.
  it("sets spellcheck again at the first key of the session, once", async () => {
    const view = await mount("a.md");
    const content = view.view.contentDOM;
    // Prose with the setting off is never checked; this note has it off.
    expect(content.getAttribute("spellcheck")).toBe("false");
    view.unmount();

    const rendered = render(
      <Editor path="a.md" revision={0} spellcheck invisibles={false} onFollowLink={() => undefined} notePaths={() => []} />,
    );
    let dom: HTMLElement | null = null;
    for (let i = 0; i < 50 && !dom; i += 1) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
      dom = rendered.container.querySelector<HTMLElement>(".cm-content");
    }
    const seen: (string | null)[] = [];
    const observer = new MutationObserver(() => seen.push(dom!.getAttribute("spellcheck")));
    observer.observe(dom!, { attributes: true, attributeFilter: ["spellcheck"] });

    dom!.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    dom!.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    observer.disconnect();

    expect(seen).toEqual(["false", "true"]);
    rendered.unmount();
  });
});

