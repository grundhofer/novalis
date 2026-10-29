import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commands, NovalisError } from "../ipc/client";
import { DOCUMENT_CSS } from "../lib/documentCss";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import EpubViewer from "./EpubViewer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));

// `unwrap` is mocked as it really is — the envelope in, the payload out, a
// `NovalisError` thrown — because the reader tells one code from another.
vi.mock("../ipc/client", () => {
  class MockError extends Error {
    readonly code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  type Envelope<T> = { status: "ok"; data: T } | { status: "error"; error: { code: string } };
  return {
    commands: { readPacked: vi.fn() },
    unwrap: async <T,>(call: Promise<Envelope<T>>): Promise<T> => {
      const result = await call;
      if (result.status === "error") throw new MockError(result.error.code);
      return result.data;
    },
    NovalisError: MockError,
    errorKey: () => "errors.internal",
    errorValues: (error: unknown) => ({ detail: String(error) }),
  };
});

/** The mocked `NovalisError`, which the reader checks with `instanceof`. */
const FakeError = NovalisError as unknown as new (code: string) => Error;

/** The book every test reads unless it replaces an entry. */
const BOOK: Record<string, string> = {
  "META-INF/container.xml": `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles><rootfile full-path="OEBPS/content.opf"
      media-type="application/oebps-package+xml"/></rootfiles></container>`,
  "OEBPS/content.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Moon</dc:title></metadata>
    <manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
      <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    </manifest>
    <spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  "OEBPS/nav.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>
      <li><a href="text/ch1.xhtml">The first night</a></li>
      <li><a href="text/ch2.xhtml">The second night</a></li>
    </ol></nav></body></html>`,
  "OEBPS/text/ch1.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body>
      <h1>The first night</h1>
      <p>It was quiet.</p>
      <script>window.stolen = true;</script>
      <img src="../images/moon.png" alt="The moon"/>
      <p><a href="ch2.xhtml">Read on</a> or <a href="https://example.com">leave</a>.</p>
    </body></html>`,
  "OEBPS/text/ch2.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title/>
      <link rel="stylesheet" href="epub.css"/></head><body>
      <h1>The second night</h1><p>It rained.</p></body></html>`,
  "OEBPS/images/moon.png": "PNG-BYTES",
};

/** What `read_packed` answers for a book whose entries are `book`. */
function reply(book: Record<string, string>) {
  return (path: string, entries: string[]) =>
    Promise.resolve({
      status: "ok" as const,
      data: {
        path,
        entries: [],
        parts: entries
          .filter((name) => name in book)
          .map((name) => ({ name, base64: btoa(book[name] ?? "") })),
      },
    });
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** The chapter lives in a shadow root, which queries do not reach. */
function chapter(container: HTMLElement): ShadowRoot {
  const host = container.querySelector(".epub-host");
  if (!host?.shadowRoot) throw new Error("no chapter is shown");
  return host.shadowRoot;
}

describe("EpubViewer", () => {
  const created: string[] = [];
  const revoked: string[] = [];

  beforeEach(() => {
    created.length = 0;
    revoked.length = 0;
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:${created.length}`;
      created.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
    useUi.setState({ message: null });
    vi.mocked(commands.readPacked).mockImplementation(reply(BOOK));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the first chapter and the book's title", async () => {
    const { container } = render(<EpubViewer path="books/moon.epub" />);
    // Opening a local book is silent: an empty, busy pane (STA-06).
    expect(container.querySelector('.sb-view__content[aria-busy="true"]')).toBeTruthy();
    expect(container.textContent).toBe("");
    await flush();

    expect(container.querySelector("[aria-busy]")).toBeNull();
    // The title wraps in the bar, no „…“ (ADR-0051 #24).
    expect(screen.getByText("The Moon").className).toBe("viewer-bar__title");
    expect(screen.getByText("viewer.epub.chapterOf:1,2").className).toBe("sb-doc-bar__count");
    expect(chapter(container).textContent).toContain("It was quiet.");
  });

  // spec/02 §4.18, NAV-10, ICO-06: sebaro's tools and a word, no glyphs.
  it("builds its bar from sebaro's tools and a word", async () => {
    const { container } = render(<EpubViewer path="books/moon.epub" />);
    await flush();

    const bar = container.querySelector(".viewer-head > .sb-doc-bar")!;
    // The bar is a named group of tools (NAV-10).
    expect(screen.getByRole("group", { name: "viewer.tools" })).toBe(bar);
    expect(bar.textContent).not.toMatch(/[‹›]/);
    const previous = screen.getByRole("button", { name: "viewer.epub.previousChapter" }) as HTMLButtonElement;
    const next = screen.getByRole("button", { name: "viewer.epub.nextChapter" });
    expect(previous.className).toBe("sb-icon-button sb-icon-button--compact");
    expect(previous.querySelector("use")?.getAttribute("href")).toBe("#chevron-left");
    expect(next.querySelector("use")?.getAttribute("href")).toBe("#chevron-right");
    expect(document.getElementById(previous.getAttribute("aria-describedby") ?? "")?.getAttribute("role")).toBe(
      "tooltip",
    );
    // A book takes no viewer keys (ADR-0025), so its tools name none.
    expect(previous.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(previous.getAttribute("aria-disabled")).toBe("true");

    const toggle = screen.getByRole("button", { name: "viewer.epub.contents" });
    expect(toggle.className).toBe("sb-secondary-action sb-secondary-action--compact");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "The first night" }).getAttribute("aria-current")).toBe("location");
    expect(screen.getByRole("link", { name: "The second night" }).hasAttribute("aria-current")).toBe(false);
  });

  it("shows nothing the book wanted to run", async () => {
    const { container } = render(<EpubViewer path="books/moon.epub" />);
    await flush();

    const shown = chapter(container);
    expect(shown.querySelector("script")).toBeNull();
    expect(shown.textContent).not.toContain("window.stolen");
    expect((window as unknown as { stolen?: boolean }).stolen).toBeUndefined();
  });

  it("resolves an image inside the book to a blob URL and frees it with the tab", async () => {
    const { container, unmount } = render(<EpubViewer path="books/moon.epub" />);
    await flush();

    const img = chapter(container).querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:0");
    expect(img?.getAttribute("alt")).toBe("The moon");
    expect(img?.hasAttribute("data-src")).toBe(false);
    unmount();
    expect(revoked).toEqual(["blob:0"]);
  });

  it("asks for a chapter and everything it references in two calls, not twenty-one", async () => {
    render(<EpubViewer path="books/moon.epub" />);
    await flush();

    // Three to open the book, then the chapter and its images.
    const asked = vi.mocked(commands.readPacked).mock.calls.map(([, entries]) => entries);
    expect(asked).toEqual([
      ["META-INF/container.xml"],
      ["OEBPS/content.opf"],
      ["OEBPS/nav.xhtml"],
      ["OEBPS/text/ch1.xhtml"],
      ["OEBPS/images/moon.png"],
    ]);
  });

  it("walks the book from its table of contents", async () => {
    const { container } = render(<EpubViewer path="books/moon.epub" />);
    await flush();

    fireEvent.click(screen.getByText("viewer.epub.contents"));
    screen.getByText("The second night").focus();
    fireEvent.click(screen.getByText("The second night"));
    await flush();

    expect(chapter(container).textContent).toContain("It rained.");
    expect(screen.getByText("viewer.epub.chapterOf:2,2")).toBeTruthy();
    // The popover closes behind the choice, and the focus returns to the
    // toggle instead of falling to the page (spec/02 §4.10).
    expect(screen.queryByText("The second night")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "viewer.epub.contents" }));
  });

  it("closes the contents on Escape and on a click somewhere else", async () => {
    render(<EpubViewer path="books/moon.epub" />);
    await flush();

    fireEvent.click(screen.getByText("viewer.epub.contents"));
    expect(screen.queryByText("The second night")).toBeTruthy();
    // Escape from a row hands the focus back to the toggle (spec/02 §4.10).
    screen.getByRole("link", { name: "The second night" }).focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("The second night")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "viewer.epub.contents" }));

    fireEvent.click(screen.getByText("viewer.epub.contents"));
    expect(screen.queryByText("The second night")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("The second night")).toBeNull();
  });

  it("numbers the chapters when the book has no table of contents", async () => {
    const withoutToc = { ...BOOK };
    delete withoutToc["OEBPS/nav.xhtml"];
    vi.mocked(commands.readPacked).mockImplementation(reply(withoutToc));
    render(<EpubViewer path="books/moon.epub" />);
    await flush();

    fireEvent.click(screen.getByText("viewer.epub.contents"));
    expect(screen.getByText("viewer.epub.chapterNumber:1")).toBeTruthy();
    expect(screen.getByText("viewer.epub.chapterNumber:2")).toBeTruthy();
  });

  it("follows a link inside the book and refuses one that leaves it", async () => {
    const { container } = render(<EpubViewer path="books/moon.epub" />);
    await flush();

    const links = chapter(container).querySelectorAll("a");
    fireEvent.click(links[0]!);
    await flush();
    expect(chapter(container).textContent).toContain("It rained.");

    // Back to the chapter that carries the outward link.
    fireEvent.click(screen.getByLabelText("viewer.epub.previousChapter"));
    await flush();
    fireEvent.click(chapter(container).querySelectorAll("a")[1]!);
    expect(useUi.getState().message?.key).toBe("editor.previewExternalLink");
  });

  // An HTML parser reads a self-closing `<title/>` as unclosed RAWTEXT and
  // swallows the whole chapter into it; the second chapter is written that
  // way, as real EPUB tools write it.
  it("reads a chapter as the XHTML it is", async () => {
    const { container } = render(<EpubViewer path="books/moon.epub" />);
    await flush();
    fireEvent.click(screen.getByLabelText("viewer.epub.nextChapter"));
    await flush();

    expect(chapter(container).textContent).toContain("It rained.");
  });

  // The XML parser puts no tbody around a table's rows, as the HTML parser
  // does, so the dress names rows directly under table as well: a row
  // header, and any th of a table without a thead, is body-strong over the
  // row's hairline in a chapter too, and only a thead's th is a column head
  // (DAT-05, `.sb-table tbody th`).
  it("dresses a th in a chapter's table without a tbody as a row header", async () => {
    const tables = {
      ...BOOK,
      "OEBPS/text/ch1.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body>
        <table><tr><th>Year</th><th>Sales</th></tr>
          <tr><th scope="row">2020</th><td>3</td></tr></table>
        <table><thead><tr><th>Head</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>
      </body></html>`,
    };
    vi.mocked(commands.readPacked).mockImplementation(reply(tables));
    const { container } = render(<EpubViewer path="books/moon.epub" />);
    await flush();

    const rowHeader = DOCUMENT_CSS.match(/\n([^\n{]*) \{\n {2}font-size: 1em;/)?.[1];
    expect(rowHeader).toBeTruthy();
    const [first, second] = [...chapter(container).querySelectorAll("table")];
    expect(first?.querySelector("tbody")).toBeNull();
    const ths = [...(first?.querySelectorAll("th") ?? [])];
    expect(ths.map((th) => th.textContent)).toEqual(["Year", "Sales", "2020"]);
    for (const th of ths) expect(th.matches(rowHeader ?? ""), th.textContent ?? "").toBe(true);
    expect(second?.querySelector("th")?.matches(rowHeader ?? "")).toBe(false);
  });

  it("still shows the text of a chapter that is not well formed", async () => {
    const broken = {
      ...BOOK,
      "OEBPS/text/ch1.xhtml": "<html><body><p>Unclosed<br>and <b>bold</p></body></html>",
    };
    vi.mocked(commands.readPacked).mockImplementation(reply(broken));
    const { container } = render(<EpubViewer path="books/moon.epub" />);
    await flush();

    expect(chapter(container).textContent).toContain("Unclosed");
    expect(chapter(container).textContent).toContain("bold");
  });

  it("says that a copy-protected book cannot be opened, without a message", async () =>{
    vi.mocked(commands.readPacked).mockRejectedValue(new FakeError("protected"));
    render(<EpubViewer path="books/drm.epub" />);
    await flush();

    // sebaro's callout (STA-05): a warning, no fill, no actions.
    const callout = screen.getByText("viewer.epub.protected").closest(".sb-callout");
    expect(callout?.className).toContain("sb-callout--warning");
    expect(callout?.querySelector("use")?.getAttribute("href")).toBe("#warning--filled");
    expect(callout?.querySelector(".sb-callout__actions")).toBeNull();
    expect(useUi.getState().message).toBeNull();
  });

  it("says that a file which is no book cannot be read", async () => {
    vi.mocked(commands.readPacked).mockImplementation(reply({ "mimetype": "text/plain" }));
    render(<EpubViewer path="books/broken.epub" />);
    await flush();

    const callout = screen.getByText("viewer.epub.unreadable").closest(".sb-callout");
    expect(callout?.className).toContain("sb-callout--error");
    expect(callout?.querySelector("use")?.getAttribute("href")).toBe("#error--filled");
  });

  // read_packed downloads a cloud-only book first: named after a second,
  // a local one stays silent however long it takes (STA-06, ADR-0051 #27.8).
  it("names the wait only for a cloud-only book", () => {
    vi.useFakeTimers();
    try {
      vi.mocked(commands.readPacked).mockReturnValue(new Promise(() => {}));
      useVault.setState({
        children: { books: [{ path: "books/moon.epub", name: "moon.epub", dir: false, cloudOnly: false } as never] },
      });
      const local = render(<EpubViewer path="books/moon.epub" />);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(local.container.textContent).toBe("");
      local.unmount();

      useVault.setState({
        children: { books: [{ path: "books/moon.epub", name: "moon.epub", dir: false, cloudOnly: true } as never] },
      });
      const cloud = render(<EpubViewer path="books/moon.epub" />);
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(cloud.container.textContent).toBe("");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(cloud.container.querySelector('.sb-view__content[aria-busy="true"]')?.textContent).toBe("editor.loading");
    } finally {
      vi.useRealTimers();
      useVault.setState({ children: {} });
    }
  });
});
