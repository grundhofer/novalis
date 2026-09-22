import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commands, NovalisError } from "../ipc/client";
import { useUi } from "../stores/ui";
import CbzViewer, { comicPages } from "./CbzViewer";

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

/** The comic every test reads: three pages, and what is not a page. */
const COMIC: Record<string, string> = {
  "moon/page-10.jpg": "TEN",
  "moon/page-2.jpg": "TWO",
  "moon/page-1.jpg": "ONE",
  "moon/ComicInfo.xml": "<ComicInfo/>",
  "__MACOSX/moon/._page-1.jpg": "FORK",
};

/** What `read_packed` answers for an archive whose entries are `comic`. */
function reply(comic: Record<string, string>) {
  return (path: string, entries: string[]) =>
    Promise.resolve({
      status: "ok" as const,
      data: {
        path,
        entries:
          entries.length === 0
            ? Object.entries(comic).map(([name, body]) => ({ name, size: String(body.length) }))
            : [],
        parts: entries
          .filter((name) => name in comic)
          .map((name) => ({ name, base64: btoa(comic[name] ?? "") })),
      },
    });
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** The entries `read_packed` was asked for, listing call excluded. */
const asked = () =>
  vi
    .mocked(commands.readPacked)
    .mock.calls.map(([, entries]) => entries)
    .filter((entries) => entries.length > 0);

describe("comicPages", () => {
  it("takes the images in natural order and leaves the rest", () => {
    expect(
      comicPages([
        { name: "page-10.jpg" },
        { name: "page-2.JPG" },
        { name: "page-1.png" },
        { name: "cover.webp" },
        { name: "ComicInfo.xml" },
        { name: "notes/read.me" },
        { name: "__MACOSX/._page-1.png" },
        { name: "chapter/._page-3.gif" },
      ]),
    ).toEqual(["cover.webp", "page-1.png", "page-2.JPG", "page-10.jpg"]);
  });
});

describe("CbzViewer", () => {
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
    vi.mocked(commands.readPacked).mockImplementation(reply(COMIC));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the first page and counts the pages the archive carries", async () => {
    render(<CbzViewer path="comics/moon.cbz" />);
    expect(screen.getByText("editor.loading")).toBeTruthy();
    await flush();

    expect(screen.getByText("viewer.cbz.pageOf:1,3")).toBeTruthy();
    // The listing, then the page shown and the one after it, in one read.
    expect(asked()).toEqual([["moon/page-1.jpg", "moon/page-2.jpg"]]);
    expect(screen.getByRole("img").getAttribute("src")).toBe("blob:0");
  });

  it("turns to a page it already holds and fetches only the next one", async () => {
    render(<CbzViewer path="comics/moon.cbz" />);
    await flush();
    fireEvent.click(screen.getByLabelText("viewer.nextPage"));
    await flush();

    expect(screen.getByText("viewer.cbz.pageOf:2,3")).toBeTruthy();
    // Page 2 was in hand; only page 10 is read, and page 1 is freed.
    expect(asked()).toEqual([["moon/page-1.jpg", "moon/page-2.jpg"], ["moon/page-10.jpg"]]);
    expect(screen.getByRole("img").getAttribute("src")).toBe("blob:1");
    expect(revoked).toEqual(["blob:0"]);
  });

  it("stops at the last page and frees both pages with the tab", async () => {
    const { unmount } = render(<CbzViewer path="comics/moon.cbz" />);
    await flush();
    fireEvent.click(screen.getByLabelText("viewer.nextPage"));
    await flush();
    fireEvent.click(screen.getByLabelText("viewer.nextPage"));
    await flush();

    expect(screen.getByText("viewer.cbz.pageOf:3,3")).toBeTruthy();
    expect((screen.getByLabelText("viewer.nextPage") as HTMLButtonElement).disabled).toBe(true);
    unmount();
    expect(revoked.length).toBe(created.length);
  });

  it("says so when the archive carries no page at all", async () => {
    vi.mocked(commands.readPacked).mockImplementation(reply({ "read.me": "nothing to see" }));
    render(<CbzViewer path="comics/empty.cbz" />);
    await flush();

    expect(screen.getByText("viewer.cbz.empty")).toBeTruthy();
    expect(asked()).toEqual([]);
  });

  it("names a protected archive as protected and anything else as unreadable", async () => {
    vi.mocked(commands.readPacked).mockRejectedValue(new FakeError("protected"));
    const { unmount } = render(<CbzViewer path="comics/drm.cbz" />);
    await flush();
    expect(screen.getByText("viewer.cbz.protected")).toBeTruthy();
    expect(useUi.getState().toast).toBeNull();
    unmount();

    vi.mocked(commands.readPacked).mockRejectedValue(new FakeError("io"));
    render(<CbzViewer path="comics/torn.cbz" />);
    await flush();
    expect(screen.getByText("viewer.cbz.unreadable")).toBeTruthy();
    expect(useUi.getState().toast?.key).toBe("errors.internal");
  });
});
