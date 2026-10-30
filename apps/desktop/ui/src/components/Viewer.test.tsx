import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unwrap } from "../ipc/client";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import Viewer from "./Viewer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../ipc/client", () => ({
  commands: { readBlob: vi.fn() },
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));
// pdf.js is its own chunk and its own test; here only the hand-over counts.
vi.mock("./PdfViewer", () => ({
  default: ({ bytes, name }: { bytes: Uint8Array; name: string }) => (
    <div data-testid="pdf" aria-label={name}>
      {bytes.length}
    </div>
  ),
}));
vi.mock("./EpubViewer", () => ({
  default: ({ path }: { path: string }) => <div data-testid="epub">{path}</div>,
}));
vi.mock("./CbzViewer", () => ({
  default: ({ path }: { path: string }) => <div data-testid="cbz">{path}</div>,
}));
// mammoth is its own chunk and its own test; here only the hand-over counts.
vi.mock("./DocxViewer", () => ({
  default: ({ bytes }: { bytes: Uint8Array }) => <div data-testid="docx">{bytes.length}</div>,
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Viewer", () => {
  // jsdom has no object URLs; the viewer only needs them to exist.
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
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands a PDF's bytes and name to pdf.js", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce({ path: "a.pdf", base64: btoa("%PDF-1.4"), size: "8" });
    const { container } = render(<Viewer path="a.pdf" kind="pdf" />);
    // Reading a local file is silent: an empty, busy pane (STA-06).
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.textContent).toBe("");
    await flush();
    await flush();

    const pdf = await screen.findByTestId("pdf");
    expect(pdf.textContent).toBe("8");
    expect(pdf.getAttribute("aria-label")).toBe("a");
    expect(created).toEqual([]);
  });

  // read_blob downloads a cloud-only file before it returns: that wait is
  // named after a second (STA-06, ADR-0051 #27.8).
  it("names a cloud-only file's wait after a second", () => {
    vi.useFakeTimers();
    try {
      useVault.setState({
        children: { "": [{ path: "cloud.pdf", name: "cloud.pdf", dir: false, cloudOnly: true } as never] },
      });
      vi.mocked(unwrap).mockReturnValueOnce(new Promise(() => {}));
      const { container } = render(<Viewer path="cloud.pdf" kind="pdf" />);
      act(() => {
        vi.advanceTimersByTime(999);
      });
      expect(container.textContent).toBe("");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(container.querySelector('.sb-view__content[aria-busy="true"]')?.textContent).toBe("editor.loading");
    } finally {
      vi.useRealTimers();
      useVault.setState({ children: {} });
    }
  });

  // A large local file can take longer than a second to read: still silent.
  it("keeps a slow local read silent", () => {
    vi.useFakeTimers();
    try {
      useVault.setState({
        children: { "": [{ path: "scan.pdf", name: "scan.pdf", dir: false, cloudOnly: false } as never] },
      });
      vi.mocked(unwrap).mockReturnValueOnce(new Promise(() => {}));
      const { container } = render(<Viewer path="scan.pdf" kind="pdf" />);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(container.querySelector('.sb-view__content[aria-busy="true"]')).toBeTruthy();
      expect(container.textContent).toBe("");
    } finally {
      vi.useRealTimers();
      useVault.setState({ children: {} });
    }
  });

  // Opened from quick open, a link, search or the restored session, a file
  // can be shown before the tree lists its folder; `reveal` lists it a
  // moment later, and that row still names the wait.
  it("names the wait of a cloud-only file whose row arrives later", () => {
    vi.useFakeTimers();
    try {
      vi.mocked(unwrap).mockReturnValueOnce(new Promise(() => {}));
      const { container } = render(<Viewer path="scans/cloud.pdf" kind="pdf" />);
      act(() => {
        useVault.setState({
          children: { scans: [{ path: "scans/cloud.pdf", name: "cloud.pdf", dir: false, cloudOnly: true } as never] },
        });
      });
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(container.querySelector('.sb-view__content[aria-busy="true"]')?.textContent).toBe("editor.loading");
    } finally {
      vi.useRealTimers();
      useVault.setState({ children: {}, loading: {} });
    }
  });

  it("shows an image from a URL it frees when the tab goes", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce({ path: "p.png", base64: btoa("png"), size: "3" });
    const { unmount } = render(<Viewer path="p.png" kind="image" />);
    await flush();

    expect((screen.getByAltText("p") as HTMLImageElement).src).toContain("blob:0");
    unmount();
    expect(revoked).toEqual(["blob:0"]);
  });

  // A book and a comic are containers, not files to show: their readers read
  // inside them (ADR-0023), so nothing goes through `read_blob` here.
  it("hands a book to the reader without reading it whole", async () => {
    render(<Viewer path="books/moon.epub" kind="epub" />);
    await flush();

    expect((await screen.findByTestId("epub")).textContent).toBe("books/moon.epub");
    expect(vi.mocked(unwrap)).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("hands a comic to the reader without reading it whole", async () => {
    render(<Viewer path="comics/moon.cbz" kind="cbz" />);
    await flush();

    expect((await screen.findByTestId("cbz")).textContent).toBe("comics/moon.cbz");
    expect(vi.mocked(unwrap)).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("hands a Word document's bytes to the reader", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce({ path: "a.docx", base64: btoa("PK\u0003\u0004"), size: "4" });
    render(<Viewer path="a.docx" kind="docx" />);
    await flush();

    expect((await screen.findByTestId("docx")).textContent).toBe("4");
    expect(created).toEqual([]);
  });

  it("reports a file that cannot be read in the action zone", async () => {
    vi.mocked(unwrap).mockRejectedValueOnce(new Error("EACCES"));
    render(<Viewer path="a.pdf" kind="pdf" />);
    await flush();

    expect(useUi.getState().message?.key).toBe("errors.internal");
    expect(created).toEqual([]);
  });
});
