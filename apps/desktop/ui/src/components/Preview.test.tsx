import { act, fireEvent, render, screen } from "@testing-library/react";
import mermaid from "mermaid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commands, unwrap } from "../ipc/client";
import { deferLine, takeDeferredLine } from "../lib/editorBridge";
import { goToPreviewLine, previewMounted, runPreviewCommand } from "../lib/previewBridge";
import { useEditorSave } from "../stores/editorSave";
import { useUi } from "../stores/ui";
import Preview from "./Preview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// The fragment comes from the core and the image bytes from the shell; here
// both answer with the value itself and `unwrap` passes it on (ADR-0011).
vi.mock("../ipc/client", () => ({
  commands: { renderMarkdown: vi.fn(), readBlob: vi.fn() },
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));
// mermaid is its own chunk; only the hand-over and the swap count here.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg data-testid="diagram"></svg>' })),
  },
}));

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** The component's `RENDER_DEBOUNCE_MS`, which stays private to it. */
const RENDER_DEBOUNCE_MS = 150;

/** A buffer for the preview to read; nothing else of the doc is looked at. */
function doc(path: string, text: string) {
  useEditorSave.setState({ docs: { [path]: { path, text } as never } });
}

/** The `<mark>`s in document order, the current one flagged. */
function hits(container: HTMLElement) {
  return [...container.querySelectorAll("mark.preview-hit")].map((mark) => ({
    text: mark.textContent,
    current: mark.classList.contains("current"),
  }));
}

/** A selection over `[from, to)` of the first text node in `element`. */
function select(element: Element, from: number, to: number): Selection {
  const range = document.createRange();
  range.setStart(element.firstChild as Text, from);
  range.setEnd(element.firstChild as Text, to);
  const selection = window.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("Preview", () => {
  // jsdom has no object URLs; the preview only needs them to exist.
  const created: string[] = [];
  const revoked: string[] = [];
  let fragment = "";
  // A mark writes through the store's `setText`; the tests that need it put
  // a spy there and get the real one back afterwards.
  const setText = useEditorSave.getState().setText;

  beforeEach(() => {
    created.length = 0;
    revoked.length = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:${created.length}`;
      created.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
    vi.mocked(unwrap).mockImplementation((call) => Promise.resolve(call as never));
    vi.mocked(commands.renderMarkdown).mockImplementation(() => fragment as never);
    vi.mocked(commands.readBlob).mockImplementation(
      (path) => ({ path, base64: btoa("png"), size: "3" }) as never,
    );
    useUi.setState({ toast: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
    useEditorSave.setState({ setText });
  });

  it("shows the fragment the core rendered from the buffer", async () => {
    doc("n.md", "# Hi");
    fragment = "<h1>Hi</h1>";
    render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    expect(screen.getByText("editor.loading")).toBeTruthy();
    await flush();

    expect(commands.renderMarkdown).toHaveBeenCalledWith("# Hi");
    expect(screen.getByText("Hi").tagName).toBe("H1");
  });

  it("re-renders a changed buffer after the pause, keeping the old fragment meanwhile", async () => {
    doc("n.md", "one");
    fragment = "<p>one</p>";
    render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();
    expect(screen.getByText("one")).toBeTruthy();

    vi.useFakeTimers();
    fragment = "<p>two</p>";
    act(() => doc("n.md", "two"));
    expect(commands.renderMarkdown).toHaveBeenCalledTimes(1);
    expect(screen.getByText("one")).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS));
    expect(commands.renderMarkdown).toHaveBeenCalledTimes(2);
    expect(commands.renderMarkdown).toHaveBeenLastCalledWith("two");
    expect(screen.getByText("two")).toBeTruthy();
  });

  it("follows an internal link with the destination as written, decoded", async () => {
    const onFollowLink = vi.fn();
    doc("n.md", "x");
    fragment = '<p><a href="Other%20Note">see</a> <a href="sub/b.md">b</a></p>';
    render(<Preview path="n.md" onFollowLink={onFollowLink} />);
    await flush();

    fireEvent.click(screen.getByText("see"));
    expect(onFollowLink).toHaveBeenCalledWith("Other Note");
    fireEvent.click(screen.getByText("b"));
    expect(onFollowLink).toHaveBeenLastCalledWith("sub/b.md");
    expect(useUi.getState().toast).toBeNull();
  });

  // Mode 1 opens nothing outside the vault (docs/PRIVACY.md): the click is
  // swallowed and the toast says why, so it does not look broken.
  it("does not follow an external link, and says so", async () => {
    const onFollowLink = vi.fn();
    doc("n.md", "x");
    fragment = '<p><a href="https://example.com/">out</a></p>';
    render(<Preview path="n.md" onFollowLink={onFollowLink} />);
    await flush();

    fireEvent.click(screen.getByText("out"));
    expect(onFollowLink).not.toHaveBeenCalled();
    expect(useUi.getState().toast?.key).toBe("editor.previewExternalLink");
  });

  it("replaces a mermaid fence with the diagram it renders", async () => {
    doc("n.md", "x");
    fragment = '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre><p>after</p>';
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict" }),
    );
    expect(mermaid.render).toHaveBeenCalledWith(expect.stringMatching(/^novalis-mermaid-\d+$/), "graph TD; A-->B");
    expect(await screen.findByTestId("diagram")).toBeTruthy();
    expect(container.querySelector("code.language-mermaid")).toBeNull();
    expect(container.querySelector(".preview-diagram svg")).toBeTruthy();
    expect(screen.getByText("after")).toBeTruthy();
  });

  it("leaves a fence mermaid cannot read as a code block and reports it", async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("Parse error"));
    doc("n.md", "x");
    fragment = '<pre><code class="language-mermaid">graph TD; A--&gt;</code></pre>';
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    expect(container.querySelector("code.language-mermaid")).toBeTruthy();
    expect(container.querySelector(".preview-diagram")).toBeNull();
    expect(useUi.getState().toast?.key).toBe("errors.internal");
  });

  it("shows a relative image from the shell's bytes and frees the URL with the fragment", async () => {
    doc("Notes/n.md", "x");
    fragment = '<p><img src="attachments/x.png" alt="x"> <img src="https://example.com/y.png" alt="y"></p>';
    const { unmount } = render(<Preview path="Notes/n.md" onFollowLink={vi.fn()} />);
    await flush();

    // Resolved against the note's folder (PLAN.md §7.2); the external one is
    // not the shell's business.
    expect(commands.readBlob).toHaveBeenCalledTimes(1);
    expect(commands.readBlob).toHaveBeenCalledWith("Notes/attachments/x.png");
    expect((screen.getByAltText("x") as HTMLImageElement).src).toContain("blob:0");
    expect((screen.getByAltText("y") as HTMLImageElement).getAttribute("src")).toBe("https://example.com/y.png");

    unmount();
    expect(revoked).toEqual(["blob:0"]);
  });

  it("reports an image the shell cannot read and leaves the alt text", async () => {
    vi.mocked(commands.readBlob).mockImplementation(() => Promise.reject(new Error("ENOENT")) as never);
    doc("n.md", "x");
    fragment = '<p><img src="missing.png" alt="gone"></p>';
    render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    expect(screen.getByAltText("gone").getAttribute("src")).toBeNull();
    expect(useUi.getState().toast?.key).toBe("errors.internal");
    expect(created).toEqual([]);
  });

  // ---- the chords (lib/previewBridge; owner, 2026-09-16) -------------------
  it("answers the editor's chords while mounted, and not after", async () => {
    doc("n.md", "x");
    fragment = "<p>x</p>";
    expect(previewMounted()).toBe(false);
    const { unmount } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    expect(previewMounted()).toBe(true);
    await flush();
    expect(previewMounted()).toBe(true);

    unmount();
    expect(previewMounted()).toBe(false);
  });

  it("finds in the rendered text: every hit marked, stepped through, gone on Escape", async () => {
    doc("n.md", "x");
    fragment = '<p data-pos="0-9">Hallo Welt</p><p data-pos="10-20">welt ende</p>';
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();
    expect(container.querySelector(".preview-find")).toBeNull();

    act(() => void runPreviewCommand("find.open"));
    const input = screen.getByPlaceholderText("editor.find.placeholder") as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    // Case-insensitive, and the hits are in document order.
    fireEvent.change(input, { target: { value: "welt" } });
    expect(hits(container)).toEqual([
      { text: "Welt", current: true },
      { text: "welt", current: false },
    ]);
    expect(screen.getByText("editor.find.matchCount")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(hits(container).map((h) => h.current)).toEqual([false, true]);
    // `Cmd+G` wraps around; `Shift+Enter` goes back.
    act(() => void runPreviewCommand("find.next"));
    expect(hits(container).map((h) => h.current)).toEqual([true, false]);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(hits(container).map((h) => h.current)).toEqual([false, true]);
    act(() => void runPreviewCommand("find.previous"));
    expect(hits(container).map((h) => h.current)).toEqual([true, false]);

    // `Cmd+F` over an open bar selects the query, so typing replaces it.
    input.setSelectionRange(1, 1);
    act(() => void runPreviewCommand("find.open"));
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);

    fireEvent.change(input, { target: { value: "nothing" } });
    expect(hits(container)).toEqual([]);
    expect(screen.getByText("editor.find.noMatches")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(container.querySelector(".preview-find")).toBeNull();
    expect(hits(container)).toEqual([]);
    // The text nodes are whole again, not the pieces the marks split off.
    expect(container.querySelector("p")?.childNodes.length).toBe(1);
  });

  it("keeps the hits over a fragment re-rendered from a live edit", async () => {
    doc("n.md", "Hallo Welt");
    fragment = '<p data-pos="0-10">Hallo Welt</p>';
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();
    act(() => void runPreviewCommand("find.open"));
    fireEvent.change(screen.getByPlaceholderText("editor.find.placeholder"), { target: { value: "welt" } });
    expect(hits(container)).toHaveLength(1);

    vi.useFakeTimers();
    fragment = '<p data-pos="0-15">Welt Hallo Welt</p>';
    act(() => doc("n.md", "Welt Hallo Welt"));
    await act(() => vi.advanceTimersByTimeAsync(RENDER_DEBOUNCE_MS));
    expect(hits(container)).toEqual([
      { text: "Welt", current: true },
      { text: "Welt", current: false },
    ]);
    expect(screen.getByText("editor.find.matchCount")).toBeTruthy();
  });

  it("opens the bar from find next when it is closed", async () => {
    doc("n.md", "x");
    fragment = "<p>x</p>";
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    act(() => void runPreviewCommand("find.next"));
    expect(container.querySelector(".preview-find")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText("editor.find.placeholder"));
  });

  it("writes a mark around the selection into the source and drops the selection", async () => {
    const written = vi.fn();
    useEditorSave.setState({ setText: written });
    doc("n.md", "Hallo Welt\n");
    fragment = '<p data-pos="0-11">Hallo Welt</p>';
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    const selection = select(container.querySelector("p[data-pos]") as Element, 6, 10);
    expect(selection.toString()).toBe("Welt");
    expect(runPreviewCommand("markdown.bold")).toBe(true);
    expect(written).toHaveBeenCalledWith("n.md", "Hallo **Welt**\n");
    expect(window.getSelection()?.isCollapsed).toBe(true);

    select(container.querySelector("p[data-pos]") as Element, 6, 10);
    expect(runPreviewCommand("markdown.italic")).toBe(true);
    expect(written).toHaveBeenLastCalledWith("n.md", "Hallo _Welt_\n");
  });

  // Nothing selected, or a selection the source cannot place: the registry
  // hands the chord to the editor, so the answer is `false` and no write.
  it("declines a collapsed selection and one outside a block", async () => {
    const written = vi.fn();
    useEditorSave.setState({ setText: written });
    doc("n.md", "Hallo Welt\n");
    fragment = '<p data-pos="0-11">Hallo Welt</p><p>no span</p>';
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    window.getSelection()?.removeAllRanges();
    expect(runPreviewCommand("markdown.bold")).toBe(false);
    select(container.querySelectorAll("p")[1] as Element, 0, 2);
    expect(runPreviewCommand("markdown.bold")).toBe(false);
    expect(written).not.toHaveBeenCalled();
  });

  // jsdom has no layout, so `scrollIntoView` is what the test can see; the
  // preview guards for its absence, and the test provides it.
  function scrollable() {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent ?? "");
    };
    return scrolled;
  }

  it("scrolls to the block a source line starts in, on request and for a parked line", async () => {
    const scrolled = scrollable();
    // "# A\n\ntwo\n\n- x\n- y\n": lines 1, 3, 5 and 6 start blocks.
    doc("n.md", "# A\n\ntwo\n\n- x\n- y\n");
    fragment =
      '<h1 data-pos="0-3">A</h1><p data-pos="5-8">two</p>' +
      '<ul data-pos="10-18"><li data-pos="10-13">x</li><li data-pos="14-18">y</li></ul>';
    deferLine(6);
    render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    expect(scrolled).toEqual(["y"]);
    expect(takeDeferredLine()).toBeNull();

    goToPreviewLine(3);
    goToPreviewLine(4); // a blank line: the block after it, the list as a whole
    goToPreviewLine(40); // past the text: nothing
    expect(scrolled).toEqual(["y", "two", "xy"]);
  });
});
