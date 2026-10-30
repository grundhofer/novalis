import { act, fireEvent, render, screen, within } from "@testing-library/react";
import mermaid from "mermaid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import de from "../../../../../i18n/de.json";
import en from "../../../../../i18n/en.json";

import { commands, unwrap } from "../ipc/client";
import { deferLine, takeDeferredLine } from "../lib/editorBridge";
import { forgetPositions, keepPosition, keptPosition } from "../lib/positions";
import { goToPreviewLine, previewMounted, runPreviewCommand } from "../lib/previewBridge";
import { useEditorSave } from "../stores/editorSave";
import { useUi } from "../stores/ui";
import Preview from "./Preview";

// The key, and the values after it where there are any: the count's
// numbers are what the find bar decides; the words are the catalog's.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join("/")}` : key,
  }),
}));
// The fragment comes from the core and the image bytes from the shell; here
// both answer with the value itself and `unwrap` passes it on (ADR-0011).
vi.mock("../ipc/client", () => ({
  commands: { renderMarkdown: vi.fn(), readBlob: vi.fn(), systemOpen: vi.fn() },
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

/** sebaro's `mark.sb-mark`s in document order, the current one flagged (FAR-12). */
function hits(container: HTMLElement) {
  return [...container.querySelectorAll("mark.sb-mark")].map((mark) => ({
    text: mark.textContent,
    current: mark.getAttribute("aria-current") === "true",
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
    useUi.setState({ message: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    window.getSelection()?.removeAllRanges();
    useEditorSave.setState({ setText });
  });

  // ADR-0039: a task box in the preview flips its `[ ]` in the source; the
  // box itself is not toggled by the click, the re-render shows the new text.
  it("flips a task box in the source when it is clicked, and not in a read-only note", async () => {
    const text = "# T\n\n- [ ] one\n- [x] two\n";
    doc("t.md", text);
    fragment =
      '<h1 data-pos="0-3">T</h1><ul><li data-pos="5-15"><input disabled="" type="checkbox"/>\none</li>' +
      '<li data-pos="15-25"><input disabled="" type="checkbox" checked=""/>two</li></ul>';
    const spy = vi.fn();
    useEditorSave.setState({ setText: spy });
    const { container } = render(<Preview path="t.md" onFollowLink={vi.fn()} />);
    await flush();

    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes[0]!.disabled).toBe(false);
    // sebaro's box (EIN-03) around the input alone, the words beside it.
    expect(boxes[0]!.parentElement?.matches("li[data-pos] > span.sb-checkbox")).toBe(true);
    expect(boxes[0]!.parentElement?.childNodes).toHaveLength(1);
    // The renderer's space after the box stays: sebaro's margin counts on
    // it, so the words of every line start at the content edge (D108 NV-Y1).
    expect(boxes[0]!.parentElement?.nextSibling?.textContent).toBe("\none");
    fireEvent.click(boxes[1]!);
    expect(spy).toHaveBeenCalledWith("t.md", "# T\n\n- [ ] one\n- [ ] two\n");

    spy.mockClear();
    useEditorSave.setState({ docs: { "t.md": { path: "t.md", text, readOnly: true } as never } });
    fireEvent.click(boxes[0]!);
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows the fragment the core rendered from the buffer", async () => {
    doc("n.md", "# Hi");
    fragment = "<h1>Hi</h1>";
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    // Rendering is local work: an empty pane meanwhile, no words (STA-06).
    expect(screen.queryByText("editor.loading")).toBeNull();
    expect(container.querySelector("section.preview")?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).toBe("");
    await flush();

    expect(commands.renderMarkdown).toHaveBeenCalledWith("# Hi");
    expect(screen.getByText("Hi").tagName).toBe("H1");
    // sebaro's prose (TXT-06).
    expect(screen.getByText("Hi").parentElement?.className).toBe("preview-body sb-prose");
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
    expect(useUi.getState().message).toBeNull();
  });

  // Mode 1 opens nothing outside the vault (docs/PRIVACY.md): the click is
  // swallowed and the action zone says why, so it does not look broken.
  // ADR-0044: a web or mail link opens outside through macOS; any other
  // scheme is refused, and said so; neither is followed inside the vault.
  it("hands a web link to the system, and refuses another scheme", async () => {
    const onFollowLink = vi.fn();
    doc("n.md", "x");
    fragment = '<p><a href="https://example.com/">out</a> <a href="file:///etc/hosts">file</a></p>';
    render(<Preview path="n.md" onFollowLink={onFollowLink} />);
    await flush();

    fireEvent.click(screen.getByText("out"));
    expect(commands.systemOpen).toHaveBeenCalledWith({ kind: "url", url: "https://example.com/" });
    fireEvent.click(screen.getByText("file"));
    expect(commands.systemOpen).toHaveBeenCalledTimes(1);
    expect(useUi.getState().message?.key).toBe("editor.externalLinkRefused");
    expect(onFollowLink).not.toHaveBeenCalled();
  });

  // sebaro D56: a link that leaves the app ends in the external-link icon;
  // one into the vault does not.
  it("ends a web or mail link in the external-link icon", async () => {
    doc("n.md", "x");
    fragment =
      '<p><a href="https://example.com/">web</a> <a href="mailto:a@b.c">mail</a> <a href="b.md">note</a></p>';
    render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    // The sprite's 16-unit master, last in the link (ICO-04, LNK-02).
    for (const name of ["web", "mail"]) {
      const icon = screen.getByText(name).querySelector("svg.sb-icon.sb-icon--16:last-child");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(icon?.querySelector("use")?.getAttribute("href")).toBe("#external-link--16");
    }
    expect(screen.getByText("note").querySelector("svg")).toBeNull();
  });

  it("replaces a mermaid fence with the diagram it renders", async () => {
    doc("n.md", "x");
    fragment = '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre><p>after</p>';
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    // mermaid's `base` theme with sebaro's colours (ADR-0051 #27.6); jsdom
    // has no stylesheet, so only the mode is there to hand over.
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: expect.objectContaining({ darkMode: false }),
      }),
    );
    expect(mermaid.render).toHaveBeenCalledWith(expect.stringMatching(/^novalis-mermaid-\d+$/), "graph TD; A-->B");
    expect(await screen.findByTestId("diagram")).toBeTruthy();
    expect(container.querySelector("code.language-mermaid")).toBeNull();
    expect(container.querySelector(".preview-diagram svg")).toBeTruthy();
    expect(screen.getByText("after")).toBeTruthy();
  });

  // spec/09 §17.1 (D102 (31)): a change of mode or tone draws the diagram
  // again in the new colours, without waiting for the next text change.
  it("draws a diagram again when the mode changes", async () => {
    const root = document.documentElement;
    root.dataset.theme = "light";
    try {
      doc("n.md", "x");
      fragment = '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>';
      const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
      await flush();
      const renders = vi.mocked(mermaid.render).mock.calls.length;
      const first = container.querySelector(".preview-diagram");
      expect(first).toBeTruthy();

      root.dataset.theme = "dark";
      await flush();
      expect(vi.mocked(mermaid.render).mock.calls.length).toBe(renders + 1);
      expect(vi.mocked(mermaid.render).mock.lastCall?.[1]).toBe("graph TD; A-->B");
      expect(vi.mocked(mermaid.initialize).mock.lastCall?.[0]).toMatchObject({
        themeVariables: expect.objectContaining({ darkMode: true }),
      });
      expect(container.querySelectorAll(".preview-diagram")).toHaveLength(1);
      expect(container.querySelector(".preview-diagram")).not.toBe(first);

      // The same mode stamped again is no change.
      root.dataset.theme = "dark";
      await flush();
      expect(vi.mocked(mermaid.render).mock.calls.length).toBe(renders + 1);
    } finally {
      delete root.dataset.theme;
    }
  });

  // spec/09 §17.1 (D102 (31)): every role from its token, read off the root
  // when the diagram is drawn; slices at full opacity, branch names framed.
  it("hands mermaid sebaro's table of theme variables", async () => {
    const root = document.documentElement;
    const tokens: Record<string, string> = {
      "--sb-color-bg": "#fffffe",
      "--sb-color-text": "#111110",
      "--sb-color-border": "#ccccc0",
      "--sb-color-border-strong": "#666660",
      "--sb-font-family-ui": "sebaro Sans",
      ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`--sb-category-${n}`, `#00000${n}`])),
    };
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
    try {
      doc("n.md", "x");
      fragment = '<pre><code class="language-mermaid">pie; "a": 1</code></pre>';
      render(<Preview path="n.md" onFollowLink={vi.fn()} />);
      await flush();
      const { themeVariables, themeCSS } = vi.mocked(mermaid.initialize).mock.lastCall![0] as {
        themeVariables: Record<string, string>;
        themeCSS: string;
      };
      expect(themeVariables).toMatchObject({
        mainBkg: "#fffffe",
        noteBkgColor: "#fffffe",
        nodeTextColor: "#111110",
        gitBranchLabel0: "#111110",
        lineColor: "#666660",
        nodeBorder: "#666660",
        clusterBorder: "#ccccc0",
        pie1: "#000001",
        git5: "#000006",
        pieOpacity: "1",
        fontFamily: "sebaro Sans",
      });
      expect(themeCSS).toContain(".branchLabelBkg { fill: #fffffe; stroke-width: 2px; }");
      expect(themeCSS).toContain(".branchLabelBkg.label5 { stroke: #000006; }");
    } finally {
      for (const name of Object.keys(tokens)) root.style.removeProperty(name);
    }
  });

  it("leaves a fence mermaid cannot read as a code block and reports it", async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("Parse error"));
    doc("n.md", "x");
    fragment = '<pre><code class="language-mermaid">graph TD; A--&gt;</code></pre>';
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    expect(container.querySelector("code.language-mermaid")).toBeTruthy();
    expect(container.querySelector(".preview-diagram")).toBeNull();
    expect(useUi.getState().message?.key).toBe("errors.internal");
  });

  // The real `editor/fences`: the JSON grammar is small enough to load here,
  // and the hand-over is the point (ADR-0022 point 8).
  it("highlights a fence that names a grammar with the editor's code classes, text unchanged", async () => {
    doc("n.md", "x");
    fragment = '<pre><code class="language-json">{"a": 1}\n</code></pre><pre><code class="language-text">{"a": 1}\n</code></pre>';
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);

    // sebaro's code looks (TEC-08): a number is a constant, a key plain.
    const number = await screen.findByText("1", { selector: ".sb-tok-constant" });
    const [json, text] = container.querySelectorAll("pre > code");
    expect(json?.contains(number)).toBe(true);
    expect([...(json?.querySelectorAll("span") ?? [])].map((span) => span.textContent)).not.toContain('"a"');
    expect(json?.textContent).toBe('{"a": 1}\n');
    // A fence that names no grammar keeps the core's markup.
    expect(text?.querySelector("span")).toBeNull();
    expect(text?.textContent).toBe('{"a": 1}\n');
  });

  // ADR-0051 #27.5, DAT-05: the core's markup in sebaro's parts.
  it("dresses a code block as the bare pre.sb-code and a table in its scrolling region", async () => {
    doc("n.md", "x");
    fragment =
      "<pre><code>plain\n</code></pre>" +
      "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>";
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    const pre = container.querySelector("pre");
    expect(pre?.className).toBe("sb-code");
    expect(pre?.tabIndex).toBe(0);
    // The bare form: no bar, no copy button.
    expect(pre?.parentElement?.classList.contains("sb-prose")).toBe(true);
    expect(container.querySelector("button")).toBeNull();

    // No heading before it: „Tabelle 1“ (ADR-0051 #52).
    const region = screen.getByRole("region", { name: "preview.tableNumbered:1" });
    expect(region.className).toBe("sb-table-wrap");
    expect(region.tabIndex).toBe(0);
    expect(region.parentElement?.classList.contains("sb-prose")).toBe(true);
    expect(region.children).toHaveLength(1);
    expect(region.firstElementChild?.matches("table.sb-table")).toBe(true);
    expect(within(region).getByRole("columnheader").textContent).toBe("a");
  });

  // ADR-0051 #52, spec/02 §3.9: Markdown has no caption, so a table's
  // region is named after the heading before it; a second table under the
  // same heading has its number, and one without a heading before it is
  // numbered in the order of the text.
  it("names each table after the heading before it", async () => {
    doc("n.md", "x");
    const table = "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>";
    fragment =
      table +
      '<h2 data-pos="0-8">Kosten</h2>' +
      table +
      '<p data-pos="9-12">Text</p>' +
      table +
      '<h3 data-pos="13-20"> Plan </h3>' +
      table;
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();
    expect([...container.querySelectorAll(".sb-table-wrap")].map((wrap) => wrap.getAttribute("aria-label"))).toEqual([
      "preview.tableNumbered:1",
      "preview.tableUnder:Kosten",
      "preview.tableUnderNumbered:2/Kosten",
      "preview.tableUnder:Plan",
    ]);
  });

  // ADR-0051 #53, spec/02 §3.9: a column whose body cells are all numbers,
  // empty ones aside, is `.sb-num` (end-aligned, tabular figures, sebaro.css);
  // an alignment written in the Markdown wins.
  it("marks number columns, unless the Markdown aligns them", async () => {
    doc("n.md", "x");
    fragment =
      "<table><thead><tr><th>Name</th><th>Menge</th><th>Preis</th><th>Anteil</th><th>Mix</th><th>Leer</th></tr></thead>" +
      "<tbody>" +
      '<tr><td>Äpfel</td><td>1.200</td><td style="text-align: right">3,50</td><td>12 %</td><td>4</td><td></td></tr>' +
      '<tr><td>Birnen</td><td></td><td style="text-align: right">2,10</td><td>−3,5%</td><td>viele</td><td></td></tr>' +
      '<tr><td>Kirschen</td><td>17</td><td style="text-align: right">9</td><td>keine Angabe</td><td>2</td><td></td></tr>' +
      "</tbody></table>";
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();
    const table = container.querySelector("table")!;
    const numeric = (column: number) => [...table.rows].map((row) => row.cells[column]!.classList.contains("sb-num"));
    expect(numeric(0)).toEqual([false, false, false, false]);
    // Head and cells, the empty cell too.
    expect(numeric(1)).toEqual([true, true, true, true]);
    // Right-aligned in the Markdown: it keeps its own alignment.
    expect(numeric(2)).toEqual([false, false, false, false]);
    expect(numeric(3)).toEqual([true, true, true, true]);
    expect(numeric(4)).toEqual([false, false, false, false]);
    // Nothing to count: no number column.
    expect(numeric(5)).toEqual([false, false, false, false]);
  });

  // ADR-0051 #64: „not given“ is the English „keine Angabe“ (spec/07 §3.1),
  // a cell without a value, not text.
  it("counts „not given“ as a cell without a value in a number column", async () => {
    doc("n.md", "x");
    fragment =
      "<table><thead><tr><th>Name</th><th>Amount</th><th>Note</th></tr></thead>" +
      "<tbody>" +
      "<tr><td>Apples</td><td>1,200</td><td>not given</td></tr>" +
      "<tr><td>Pears</td><td>Not given</td><td>not given</td></tr>" +
      "<tr><td>Cherries</td><td>17</td><td>not given yet</td></tr>" +
      "</tbody></table>";
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();
    const table = container.querySelector("table")!;
    const numeric = (column: number) => [...table.rows].map((row) => row.cells[column]!.classList.contains("sb-num"));
    expect(numeric(1)).toEqual([true, true, true, true]);
    // Only placeholders and other words: no number column.
    expect(numeric(2)).toEqual([false, false, false, false]);
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

  it("opens an image the viewer shows on a click, and leaves a linked image to its link", async () => {
    const onFollowLink = vi.fn();
    doc("Notes/n.md", "x");
    fragment =
      '<p><img src="attachments/x.png" alt="x"> <img src="icon.svg" alt="svg"> ' +
      '<a href="other.md"><img src="attachments/y.png" alt="linked"></a></p>';
    render(<Preview path="Notes/n.md" onFollowLink={onFollowLink} />);
    await flush();

    // As written: the app's `followLink` resolves it against the note, as
    // it does a link's destination.
    fireEvent.click(screen.getByAltText("x"));
    expect(onFollowLink).toHaveBeenLastCalledWith("attachments/x.png");
    // An SVG is text to the app; it would open as its XML, not in the viewer.
    fireEvent.click(screen.getByAltText("svg"));
    expect(onFollowLink).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByAltText("linked"));
    expect(onFollowLink).toHaveBeenLastCalledWith("other.md");
  });

  // docs/research/2026-09-20-feature-gaps.md A4: back where the reader was.
  it("returns to its own scroll, and records the reader's", async () => {
    forgetPositions();
    doc("n.md", "# Hi");
    fragment = "<h1>Hi</h1>";
    keepPosition("n.md", { previewScroll: 120, last: "preview", line: 1 });
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();
    const section = container.querySelector("section.preview") as HTMLElement;
    expect(section.scrollTop).toBe(120);

    section.scrollTop = 300;
    fireEvent.scroll(section);
    expect(keptPosition("n.md")).toMatchObject({ previewScroll: 300, last: "preview" });
    forgetPositions();
  });

  it("opens at the editor's cursor line when the editor was read last, unlit", async () => {
    forgetPositions();
    doc("n.md", "first\n\nsecond\n");
    fragment = '<p data-pos="0-5">first</p><p data-pos="7-13">second</p>';
    keepPosition("n.md", { line: 3, last: "editor" });
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.textContent ?? "");
    };
    try {
      const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
      await flush();
      expect(scrolled).toEqual(["second"]);
      // A place kept, not a jump: nothing is lit.
      expect(container.querySelector(".preview-target")).toBeNull();
    } finally {
      // jsdom has none; an own `undefined` left behind would shadow the
      // stubs other tests put on `Element.prototype`.
      if (original) HTMLElement.prototype.scrollIntoView = original;
      else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      forgetPositions();
    }
  });

  it("reports an image the shell cannot read and leaves the alt text", async () => {
    vi.mocked(commands.readBlob).mockImplementation(() => Promise.reject(new Error("ENOENT")) as never);
    doc("n.md", "x");
    fragment = '<p><img src="missing.png" alt="gone"></p>';
    render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    expect(screen.getByAltText("gone").getAttribute("src")).toBeNull();
    expect(useUi.getState().message?.key).toBe("errors.internal");
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
    expect(container.querySelector(".sb-find-bar")).toBeNull();

    act(() => void runPreviewCommand("find.open"));
    const input = screen.getByPlaceholderText("editor.find.placeholder") as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    // Case-insensitive, and the hits are in document order.
    fireEvent.change(input, { target: { value: "welt" } });
    expect(hits(container)).toEqual([
      { text: "Welt", current: true },
      { text: "welt", current: false },
    ]);
    expect(screen.getByRole("status").textContent).toBe("editor.find.matchCount:1/2");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("status").textContent).toBe("editor.find.matchCount:2/2");
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
    expect(container.querySelector(".sb-find-bar")).toBeNull();
    // The pane holds focus, not body: sb-tooltip.js would otherwise keep a
    // tooltip of the removed bar as shown (editor/findPanel).
    expect(document.activeElement).toBe(container.querySelector("section.preview"));
    expect(hits(container)).toEqual([]);
    // The text nodes are whole again, not the pieces the marks split off.
    expect(container.querySelector("p")?.childNodes.length).toBe(1);
  });

  // EIN-05, ICO-06, spec/02 §4.18: the editor's find bar, not ‹ › ×.
  it("builds the find bar from sebaro's search field and its tools", async () => {
    doc("n.md", "x");
    fragment = "<p>x</p>";
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();
    act(() => void runPreviewCommand("find.open"));

    const bar = screen.getByRole("search", { name: "editor.find.find" });
    // spec/02 §4.25.2 (D104 (3)): sebaro's find bar with its find row.
    expect(bar.className).toBe("sb-find-bar");
    expect(bar.firstElementChild?.className).toBe("sb-doc-bar");
    expect(bar.firstElementChild?.getAttribute("data-sb-find-row")).toBe("find");
    expect(bar.querySelector(".sb-doc-bar__count")?.getAttribute("role")).toBe("status");
    const field = within(bar).getByRole("searchbox", { name: "editor.find.find" });
    expect(bar.querySelector(`label[for="${field.id}"]`)?.className).toBe("sb-field__label sb-visually-hidden");
    expect(field.parentElement?.matches(".sb-field__control.sb-search")).toBe(true);
    expect(field.parentElement?.querySelector("svg.sb-icon use")?.getAttribute("href")).toBe("#search");

    const tools = within(bar).getAllByRole("button");
    expect(tools.map((tool) => tool.getAttribute("aria-label"))).toEqual([
      "editor.find.previous",
      "editor.find.next",
      "editor.find.close",
    ]);
    for (const tool of tools) expect(tool.className).toBe("sb-icon-button sb-icon-button--compact");
    expect(tools.map((tool) => tool.querySelector("use")?.getAttribute("href"))).toEqual([
      "#chevron-up",
      "#chevron-down",
      "#close",
    ]);
    // The chords of find next and previous, none for Close.
    expect(tools[0]?.getAttribute("aria-keyshortcuts")).toBeTruthy();
    expect(tools[1]?.getAttribute("aria-keyshortcuts")).toBeTruthy();
    expect(tools[2]?.hasAttribute("aria-keyshortcuts")).toBe(false);
    // The field announces ⌘F, which puts focus into it (spec/02 §4.19).
    expect(bar.querySelector("input")?.getAttribute("aria-keyshortcuts")).toBe("Meta+F");
    expect(bar.textContent).not.toMatch(/[‹›×]/);

    tools[2]!.focus();
    fireEvent.click(tools[2]!);
    expect(container.querySelector(".sb-find-bar")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("section.preview"));
  });

  // FAR-12: the search says „Treffer 1 von 2“ in words.
  it("words the count as the catalog's „Treffer … von …“", () => {
    expect(de["editor.find.matchCount"]).toBe("Treffer {{current}} von {{count}}");
    expect(en["editor.find.matchCount"]).toBe("Match {{current}} of {{count}}");
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
    expect(screen.getByText("editor.find.matchCount:1/2")).toBeTruthy();
  });

  it("opens the bar from find next when it is closed", async () => {
    doc("n.md", "x");
    fragment = "<p>x</p>";
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    act(() => void runPreviewCommand("find.next"));
    expect(container.querySelector(".sb-find-bar")).toBeTruthy();
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

  it("scrolls to the block a source line starts in, lit, on request and for a parked line", async () => {
    const scrolled = scrollable();
    // "# A\n\ntwo\n\n- x\n- y\n": lines 1, 3, 5 and 6 start blocks.
    doc("n.md", "# A\n\ntwo\n\n- x\n- y\n");
    fragment =
      '<h1 data-pos="0-3">A</h1><p data-pos="5-8">two</p>' +
      '<ul data-pos="10-18"><li data-pos="10-13">x</li><li data-pos="14-18">y</li></ul>';
    deferLine({ line: 6, snippet: "- y" });
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();

    expect(scrolled).toEqual(["y"]);
    expect(takeDeferredLine()).toBeNull();
    expect(container.querySelector(".preview-target")?.textContent).toBe("y");
    // The place line stays until the next action (spec/02 §5, D102 (32)):
    // not through a lone modifier, gone with the next key.
    fireEvent.keyDown(window, { key: "Shift" });
    expect(container.querySelector(".preview-target")?.textContent).toBe("y");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(container.querySelector(".preview-target")).toBeNull();

    goToPreviewLine(3);
    goToPreviewLine(4); // a blank line: the block after it, the list as a whole
    goToPreviewLine(40); // past the text: nothing
    expect(scrolled).toEqual(["y", "two", "xy"]);
  });
  // ADR-0051 #40, D102 (32), spec/03 §5.2, §5.3: the core's footnotes become
  // sebaro's digit and list in the preview only; the core's markup is the
  // CLI's and stays as pulldown-cmark writes it.
  const footnotes =
    '<p data-pos="0-20">One<sup class="footnote-reference"><a href="#a">1</a></sup> two' +
    '<sup class="footnote-reference"><a href="#b">2</a></sup><sup class="footnote-reference"><a href="#a">1</a></sup>.</p>\n' +
    '<div class="footnote-definition" id="a"><sup class="footnote-definition-label">1</sup>\n' +
    '<p data-pos="21-30">Note A</p>\n</div>\n' +
    '<p data-pos="31-35">More</p>\n' +
    '<div class="footnote-definition" id="b"><sup class="footnote-definition-label">2</sup>\n' +
    '<p data-pos="36-45">Note B</p>\n</div>\n' +
    '<div class="footnote-definition" id="c"><sup class="footnote-definition-label">3</sup>\n' +
    '<p data-pos="46-55">Note C</p>\n</div>\n';

  it("turns footnotes into sebaro's digits and the notes list at the end", async () => {
    doc("n.md", "x");
    fragment = footnotes;
    const { container } = render(<Preview path="n.md" onFollowLink={vi.fn()} />);
    await flush();
    const body = container.querySelector(".preview-body")!;

    expect(body.querySelector("sup, .footnote-definition")).toBeNull();
    const refs = [...body.querySelectorAll<HTMLAnchorElement>("a.sb-note-ref")];
    expect(refs.map((ref) => ref.textContent)).toEqual(["1", "2", "1"]);
    expect(refs.map((ref) => ref.getAttribute("aria-label"))).toEqual([
      "preview.footnoteRef:1",
      "preview.footnoteRef:2",
      "preview.footnoteRef:1",
    ]);
    expect(refs.every((ref) => ref.getAttribute("role") === "doc-noteref")).toBe(true);
    // Digits side by side stand in one group, which puts the comma between.
    expect(refs[1]!.parentElement?.matches("span.sb-note-refs")).toBe(true);
    expect(refs[2]!.parentElement).toBe(refs[1]!.parentElement);
    expect(refs[0]!.parentElement?.matches("p[data-pos]")).toBe(true);

    // The list stands last, after the text that followed a definition.
    const section = body.lastElementChild as HTMLElement;
    expect(section.matches("section.sb-notes[role=doc-endnotes]")).toBe(true);
    expect(section.previousElementSibling?.textContent).toBe("More");
    const title = section.querySelector("h2.sb-notes__title")!;
    expect(title.textContent).toBe("preview.footnotes");
    expect(section.getAttribute("aria-labelledby")).toBe(title.id);
    const notes = [...section.querySelectorAll<HTMLLIElement>("ol.sb-notes__list > li.sb-note")];
    expect(notes.map((note) => note.querySelector(".sb-note__body")?.textContent?.trim())).toEqual([
      "Note A",
      "Note B",
      "Note C",
    ]);
    // Each digit points at its note; each citation has its own way back
    // (spec/03 §5.3, D108 NV-X3): a note cited twice holds „1“ and „1b“ one
    // under the other, the second named with its place.
    expect(refs.map((ref) => ref.getAttribute("href"))).toEqual([
      `#${notes[0]!.id}`,
      `#${notes[1]!.id}`,
      `#${notes[0]!.id}`,
    ]);
    const backs = notes[0]!.firstElementChild!;
    expect(backs.matches("span.sb-note__backs")).toBe(true);
    const twice = [...backs.children];
    expect(twice.every((back) => back.matches("a.sb-note__back[role=doc-backlink]"))).toBe(true);
    expect(twice.map((back) => back.textContent)).toEqual(["1", "1b"]);
    expect(twice.map((back) => back.getAttribute("aria-label"))).toEqual([
      "preview.footnoteBack:1",
      "preview.footnoteBackMore:1/2",
    ]);
    expect(twice.map((back) => back.getAttribute("href"))).toEqual([`#${refs[0]!.id}`, `#${refs[2]!.id}`]);
    const once = notes[1]!.firstElementChild!;
    expect(once.matches("a.sb-note__back[role=doc-backlink]")).toBe(true);
    expect(once.textContent).toBe("2");
    expect(once.getAttribute("href")).toBe(`#${refs[1]!.id}`);
    // A note no digit points at keeps its number, as no link (NV-X5).
    expect(notes[2]!.firstElementChild?.matches("span.sb-note__back:not([href])")).toBe(true);
    expect(notes[2]!.firstElementChild?.textContent).toBe("3");
    // The note's text keeps its source span, so ⌘B works in it.
    expect(notes[0]!.querySelector("p[data-pos='21-30']")).toBeTruthy();
  });

  it("gives every footnote id once in the document, never the note's label", async () => {
    doc("a.md", "x");
    useEditorSave.setState({
      docs: { "a.md": { path: "a.md", text: "x" } as never, "b.md": { path: "b.md", text: "y" } as never },
    });
    fragment = footnotes;
    render(<Preview path="a.md" onFollowLink={vi.fn()} />);
    render(<Preview path="b.md" onFollowLink={vi.fn()} />);
    await flush();
    const ids = [...document.querySelectorAll(".preview-body [id]")].map((element) => element.id);
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("a");
    expect(document.getElementById("a")).toBeNull();
  });

  // Keyboard and screen reader: a digit lands on its note — focus there, so
  // it is read and Tab goes on to its ways back; each leads to its own
  // digit, whose block wears the place line until the next key (D108 NV-X4).
  it("jumps from a digit to its note and back to that digit, focus along", async () => {
    doc("n.md", "x");
    fragment = footnotes;
    const onFollowLink = vi.fn();
    const { container } = render(<Preview path="n.md" onFollowLink={onFollowLink} />);
    await flush();
    const refs = [...container.querySelectorAll<HTMLAnchorElement>("a.sb-note-ref")];
    const note = container.querySelector<HTMLLIElement>("li.sb-note")!;

    fireEvent.click(refs[2]!);
    expect(document.activeElement).toBe(note);
    expect(note.tabIndex).toBe(-1);
    expect(note.classList.contains("is-active")).toBe(true);
    const back = note.querySelectorAll<HTMLAnchorElement>("a.sb-note__back")[1]!;
    expect(back.getAttribute("href")).toBe(`#${refs[2]!.id}`);

    // Enter on the link: the key ends the note's edge, the click jumps.
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.click(back);
    expect(document.activeElement).toBe(refs[2]);
    expect(note.classList.contains("is-active")).toBe(false);
    expect(container.querySelector(".preview-target")).toBe(refs[2]!.closest("p"));
    fireEvent.keyDown(window, { key: "Tab" });
    expect(container.querySelector(".preview-target")).toBeNull();
    expect(onFollowLink).not.toHaveBeenCalled();
  });
});
