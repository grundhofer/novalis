import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unwrap } from "../ipc/client";
import { useUi } from "../stores/ui";
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
  default: ({ bytes }: { bytes: Uint8Array }) => <div data-testid="pdf">{bytes.length}</div>,
}));
vi.mock("./EpubViewer", () => ({
  default: ({ path }: { path: string }) => <div data-testid="epub">{path}</div>,
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
    useUi.setState({ toast: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands a PDF's bytes to pdf.js", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce({ path: "a.pdf", base64: btoa("%PDF-1.4"), size: "8" });
    render(<Viewer path="a.pdf" kind="pdf" />);
    expect(screen.getByText("editor.loading")).toBeTruthy();
    await flush();
    await flush();

    expect((await screen.findByTestId("pdf")).textContent).toBe("8");
    expect(created).toEqual([]);
  });

  it("shows an image from a URL it frees when the tab goes", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce({ path: "p.png", base64: btoa("png"), size: "3" });
    const { unmount } = render(<Viewer path="p.png" kind="image" />);
    await flush();

    expect((screen.getByAltText("p") as HTMLImageElement).src).toContain("blob:0");
    unmount();
    expect(revoked).toEqual(["blob:0"]);
  });

  // A book is a container, not a file to show: the reader reads inside it
  // (ADR-0023), so nothing goes through `read_blob` here.
  it("hands a book to the reader without reading it whole", async () => {
    render(<Viewer path="books/moon.epub" kind="epub" />);
    await flush();

    expect((await screen.findByTestId("epub")).textContent).toBe("books/moon.epub");
    expect(vi.mocked(unwrap)).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("reports a file that cannot be read as a toast", async () => {
    vi.mocked(unwrap).mockRejectedValueOnce(new Error("EACCES"));
    render(<Viewer path="a.pdf" kind="pdf" />);
    await flush();

    expect(useUi.getState().toast?.key).toBe("errors.internal");
    expect(created).toEqual([]);
  });
});
