import { act, fireEvent, render, screen } from "@testing-library/react";
import mermaid from "mermaid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commands, unwrap } from "../ipc/client";
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

describe("Preview", () => {
  // jsdom has no object URLs; the preview only needs them to exist.
  const created: string[] = [];
  const revoked: string[] = [];
  let fragment = "";

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
});
