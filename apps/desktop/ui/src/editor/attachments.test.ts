import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFiles } from "../stores/files";
import { attachments, linkTo } from "./attachments";

vi.mock("../ipc/client", () => ({ commands: {}, unwrap: vi.fn() }));

// ADR-0040: a tree row dropped on a note is a link there, not its path.
describe("a tree row dropped on a note", () => {
  beforeEach(() => {
    useFiles.setState({ notes: ["notes/Plan.md", "Ideas.md"], files: [], loaded: true });
  });

  it("is a wikilink for a note, an embed for an image, a link for anything else", () => {
    expect(linkTo("notes/Today.md", "Ideas.md")).toBe("[[Ideas]]");
    expect(linkTo("notes/Today.md", "notes/pics/shot.png")).toBe("![](pics/shot.png)");
    expect(linkTo("notes/Today.md", "docs/Spec v2.pdf")).toBe("[Spec v2.pdf](../docs/Spec%20v2.pdf)");
  });

  it("inserts the link instead of the path", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "see ", extensions: [attachments("notes/Today.md")] }),
      parent: document.body,
    });
    view.dispatch({ selection: { anchor: 4 } });
    const event = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
    Object.assign(event, {
      dataTransfer: {
        getData: (type: string) => (type === "application/x-novalis-entry" ? "Ideas.md" : "Ideas.md"),
        files: [],
      },
      clientX: 0,
      clientY: 0,
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    // jsdom has no layout: the drop point resolves to the start.
    expect(view.state.doc.toString()).toBe("[[Ideas]]see ");
    view.destroy();
  });
});
