import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commands, NovalisError } from "../ipc/client";
import { useUi } from "../stores/ui";
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
  "OEBPS/text/ch2.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body>
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
    useUi.setState({ toast: null });
    vi.mocked(commands.readPacked).mockImplementation(reply(BOOK));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the first chapter and the book's title", async () => {
    const { container } = render(<EpubViewer path="books/moon.epub" />);
    expect(screen.getByText("editor.loading")).toBeTruthy();
    await flush();

    expect(screen.getByText("The Moon")).toBeTruthy();
    expect(screen.getByText("viewer.epub.chapterOf:1,2")).toBeTruthy();
    expect(chapter(container).textContent).toContain("It was quiet.");
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
    fireEvent.click(screen.getByText("The second night"));
    await flush();

    expect(chapter(container).textContent).toContain("It rained.");
    expect(screen.getByText("viewer.epub.chapterOf:2,2")).toBeTruthy();
    // The popover closes behind the choice.
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
    expect(useUi.getState().toast?.key).toBe("editor.previewExternalLink");
  });

  it("says that a copy-protected book cannot be opened, without a toast", async () => {
    vi.mocked(commands.readPacked).mockRejectedValue(new FakeError("protected"));
    render(<EpubViewer path="books/drm.epub" />);
    await flush();

    expect(screen.getByText("viewer.epub.protected")).toBeTruthy();
    expect(useUi.getState().toast).toBeNull();
  });

  it("says that a file which is no book cannot be read", async () => {
    vi.mocked(commands.readPacked).mockImplementation(reply({ "mimetype": "text/plain" }));
    render(<EpubViewer path="books/broken.epub" />);
    await flush();

    expect(screen.getByText("viewer.epub.unreadable")).toBeTruthy();
  });
});
