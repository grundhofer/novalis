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

  it("shows a PDF in a frame and frees the URL when it goes", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce({ path: "a.pdf", base64: btoa("%PDF-1.4"), size: "8" });
    const { unmount } = render(<Viewer path="a.pdf" kind="pdf" />);
    expect(screen.getByText("editor.loading")).toBeTruthy();
    await flush();

    const frame = screen.getByTitle("a") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.src).toContain("blob:0");

    unmount();
    expect(revoked).toEqual(["blob:0"]);
  });

  it("shows an image as an image", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce({ path: "p.png", base64: btoa("png"), size: "3" });
    render(<Viewer path="p.png" kind="image" />);
    await flush();

    expect((screen.getByAltText("p") as HTMLImageElement).src).toContain("blob:0");
  });

  it("reports a file that cannot be read as a toast", async () => {
    vi.mocked(unwrap).mockRejectedValueOnce(new Error("EACCES"));
    render(<Viewer path="a.pdf" kind="pdf" />);
    await flush();

    expect(useUi.getState().toast?.key).toBe("errors.internal");
    expect(created).toEqual([]);
  });
});
