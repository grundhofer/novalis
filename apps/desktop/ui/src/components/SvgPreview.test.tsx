import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorSave } from "../stores/editorSave";
import SvgPreview from "./SvgPreview";

function doc(path: string, text: string) {
  useEditorSave.setState({ docs: { [path]: { path, text } as never } });
}

describe("SvgPreview", () => {
  // jsdom has no object URLs; the pane only needs them to exist.
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  beforeEach(() => {
    blobs.length = 0;
    revoked.length = 0;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return `blob:${blobs.length - 1}`;
    });
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  });

  it("draws the buffer as an image, anew when it changes, and frees each URL", async () => {
    doc("icon.svg", "<svg/>");
    const { unmount } = render(<SvgPreview path="icon.svg" />);
    const img = screen.getByAltText("icon") as HTMLImageElement;

    expect(img.src).toBe("blob:0");
    expect(blobs[0]?.type).toBe("image/svg+xml");
    expect(await blobs[0]?.text()).toBe("<svg/>");

    act(() => doc("icon.svg", '<svg width="2"/>'));
    expect(img.src).toBe("blob:1");
    expect(revoked).toEqual(["blob:0"]);

    unmount();
    expect(revoked).toEqual(["blob:0", "blob:1"]);
  });
});
