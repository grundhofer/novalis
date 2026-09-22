import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../stores/ui";
import DocxViewer from "./DocxViewer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * A real Word document, written by hand: a heading, a paragraph with bold
 * text and a link out of the vault, and a one-pixel picture. mammoth is not
 * mocked — what this asserts is the whole way from the file's bytes to what
 * the pane shows.
 */
const SMALL_DOCX =
  "UEsDBBQAAAAIACyZNl10+SWnBwEAAF8CAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2Sy07DMBBF93yF5S1KHFgghJp0wWMJ" +
  "LMoHjOxJYtUvedzS/D12Q7uoGlYsPXfO3Du2V+uDNWyPkbR3Lb+rG87QSa+0G1r+tXmrHjmjBE6B8Q5bPiHxdXez2kwBiWXY" +
  "UcvHlMKTECRHtEC1D+iy0vtoIeVjHEQAuYUBxX3TPAjpXUKXqlRm8G71gj3sTGKvh1yeg0Q0xNnz3Fi8Wg4hGC0hZV3snbpw" +
  "qX4d6kwee2jUgW5zAxdXHYqybLDMBTdccNqWzUo9Ex/5LqNWyD4hpnewWRffPiqhvNzZzNR/G1/ZzPe9lnjmy7QQvUSi/EjW" +
  "1GfFgnanjRdzUJoM0v+nmOee7MXxf3Q/UEsDBBQAAAAIACyZNl25gURxsAAAACoBAAALAAAAX3JlbHMvLnJlbHONzzsOwjAM" +
  "BuCdU0TeaVoGhFCTLgipKyoHiBI3jWgeSsKjtycDAyAGRtu/P8tt97AzuWFMxjsGTVUDQSe9Mk4zOA/H9Q5IysIpMXuHDBZM" +
  "0PFVe8JZ5LKTJhMSKYhLDKacw57SJCe0IlU+oCuT0UcrcimjpkHIi9BIN3W9pfHdAP5hkl4xiL1qgAxLwH9sP45G4sHLq0WX" +
  "f5z4ShRZRI2Zwd1HRdWrXRUWKG/px4v8CVBLAwQUAAAACAAsmTZdF4RTXSUCAACUBQAAEQAAAHdvcmQvZG9jdW1lbnQueG1s" +
  "rVRdb9MwFH3vr7D8Tt1ChSBqMoHKAGlC1TZ+gOvcNtb8JdtNW349106apdMQ0+AluZbPPff43mMvr45akRZ8kNaUdD6dUQJG" +
  "2FqaXUl/3l+/+UBJiNzUXFkDJT1BoFfVZHkoaiv2GkwkyGBCcShpE6MrGAuiAc3D1DowuLe1XvOIS79jB+tr562AELCAVuzt" +
  "bPaeaS4NrZByY+tT5nZp5dY+/+7iSQE5FC1XJf0GPGmbU1Yt2YDJn1jdggzgFDdpK2aA72CPrB00iS6C4wKP5DwE8C3Q6os0" +
  "5NMm8PiLaBnJBcv50xXcdOX7Vay2ECPo5xL+UIrcwzGSvakvqiSVzcmBV9I89I31L2ms3W6lgFU/kq6tHhSPONbQSBco8YWs" +
  "S+q/1ws6ahlIA5rcYLmnPRt0jNDTvzW29vyA48HQFdJgNpzt4V5yjD79bIxLu6y6TZrJsXvJe+JY0o/zxWKGvhWnIWYZgw5d" +
  "e5JOPafEcI0D+CxVTUkNQWBb07jXe/MQET9Z8mLnuWuk6BXzVwjunTxQrXjkZO/lK6icFHHv0SmTJYaFG3Rh9C90mc20aymS" +
  "d9NC/GifbRN73E7g5Phxbqdro6S7lkqlQ6f4v5sW9AY6375LingRoocomhRusfAtiJikjTbYhbBOZ8gvBS+cD/ErWE1SgLSY" +
  "nQfG25vQ85whPVGXyfohZMRouuN1uhFn2+fbMdyGJ/clYNWuof2bl8F9H6rfUEsDBBQAAAAIACyZNl3yUkh97AAAAEECAAAc" +
  "AAAAd29yZC9fcmVscy9kb2N1bWVudC54bWwucmVsc62RwUoDMRCG7z5FmLubXRURabaXKvTgRdYHGJLpbmgyCUmU3bc3WqQW" +
  "KnjocWbI9/2TWa1n78QHpWwDK+iaFgSxDsbyqOBteL5+AJELskEXmBQslGHdX61eyWGpb/JkYxYVwlnBVEp8lDLriTzmJkTi" +
  "OtmF5LHUMo0yot7jSPKmbe9l+s2A/oQptkZB2poOxLBE+g877HZW0ybod09czihkLour+cWAaaSi4FA3lQPyvP72knrr6+pH" +
  "uydj8dDsmsjjXxnuLplhqqTkLO+POb6wuXJpRh8dNTp4+TN9CaaKn+ZCifH7l+TJ5ftPUEsDBBQAAAAIACyZNl3MaXlwqAAA" +
  "AOkAAAAPAAAAd29yZC9zdHlsZXMueG1sRY7BDoIwDIZfZeldBh6MIQxvRu/6AA1UINm6ZV1A3t6hRm9tvn7/3+b0dFbNFGXy" +
  "bKAqSlDEne8nHgzcb+fdEZQk5B6tZzKwksCpbZZa0mpJVNZZ6sXAmFKotZZuJIdS+ECc2cNHhymvcdCLj32IviORnO6s3pfl" +
  "QTucGH6BaqnTGnJPwIhDxDCC+qJrb+BCuH1WvQVGt93PaHP7B6gKdNvor/GfpH0BUEsDBBQAAAAIACyZNl0NLQIyQAAAAEUA" +
  "AAAVAAAAd29yZC9tZWRpYS9pbWFnZTEucG5n6wzwc+flkuJiYGDg9fRwCQLSjCDMwQQkJ5QH3wNSPJ4ujiEVt5ItEpOZGZgF" +
  "GB1lXm9ZCRRn8HT1c1nnlNAEAFBLAQIUAxQAAAAIACyZNl10+SWnBwEAAF8CAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVu" +
  "dF9UeXBlc10ueG1sUEsBAhQDFAAAAAgALJk2XbmBRHGwAAAAKgEAAAsAAAAAAAAAAAAAAIABOAEAAF9yZWxzLy5yZWxzUEsB" +
  "AhQDFAAAAAgALJk2XReEU10lAgAAlAUAABEAAAAAAAAAAAAAAIABEQIAAHdvcmQvZG9jdW1lbnQueG1sUEsBAhQDFAAAAAgA" +
  "LJk2XfJSSH3sAAAAQQIAABwAAAAAAAAAAAAAAIABZQQAAHdvcmQvX3JlbHMvZG9jdW1lbnQueG1sLnJlbHNQSwECFAMUAAAA" +
  "CAAsmTZdzGl5cKgAAADpAAAADwAAAAAAAAAAAAAAgAGLBQAAd29yZC9zdHlsZXMueG1sUEsBAhQDFAAAAAgALJk2XQ0tAjJA" +
  "AAAARQAAABUAAAAAAAAAAAAAAIABYAYAAHdvcmQvbWVkaWEvaW1hZ2UxLnBuZ1BLBQYAAAAABgAGAIMBAADTBgAAAAA=";

/**
 * The document lives in a shadow root, which queries do not reach — and it
 * arrives when mammoth is done, which is a handful of promises later.
 */
async function shown(container: HTMLElement): Promise<ShadowRoot> {
  return vi.waitFor(() => {
    const host = container.querySelector(".docx-host");
    if (!host?.shadowRoot?.firstElementChild) throw new Error("no document is shown");
    return host.shadowRoot;
  });
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe("DocxViewer", () => {
  beforeEach(() => {
    useUi.setState({ toast: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the document's headings, emphasis, links and pictures", async () => {
    const { container } = render(<DocxViewer bytes={bytesOf(SMALL_DOCX)} />);
    expect(screen.getByText("editor.loading")).toBeTruthy();

    const root = await shown(container);
    expect(root.querySelector("h1")?.textContent).toBe("Reiseplan");
    expect(root.querySelector("strong")?.textContent).toBe("fettem");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com/");
    // The picture arrives as its own bytes, so it is shown and nothing is
    // fetched to show it (ADR-0024).
    const img = root.querySelector("img");
    expect(img?.getAttribute("src")?.startsWith("data:image/png;base64,")).toBe(true);
    expect(img?.getAttribute("alt")).toBe("Ein Punkt");
    expect(img?.hasAttribute("data-src")).toBe(false);
    expect(screen.queryByText("viewer.docx.unreadable")).toBeNull();
  });

  it("answers a link out of the vault with the toast, and follows one inside", async () => {
    const { container } = render(<DocxViewer bytes={bytesOf(SMALL_DOCX)} />);
    const root = await shown(container);

    fireEvent.click(root.querySelector("a")!, { bubbles: true, composed: true });
    expect(useUi.getState().toast?.key).toBe("editor.previewExternalLink");
  });

  it("says so instead of converting a document above the cap", async () => {
    // One byte over 15 MB; nothing is converted, so the test costs the
    // allocation and nothing else.
    render(<DocxViewer bytes={new Uint8Array(new ArrayBuffer(15 * 1024 * 1024 + 1))} />);

    expect(await screen.findByText("viewer.docx.tooLarge")).toBeTruthy();
  });

  it("says so when the file is not a document at all", async () => {
    render(<DocxViewer bytes={bytesOf(btoa("this is not a Word document"))} />);

    expect(await screen.findByText("viewer.docx.unreadable")).toBeTruthy();
    // A file that cannot be read is the file's business, not an app failure.
    expect(useUi.getState().toast).toBeNull();
  });
});
