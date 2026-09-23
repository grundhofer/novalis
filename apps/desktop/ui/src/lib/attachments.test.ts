import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// CI runs in UTC, where a `toISOString()` regression of the local stamp would
// be invisible; east of UTC, 00:30 local is still the day before in UTC.
vi.stubEnv("TZ", "Europe/Berlin");

import { commands, NovalisError, unwrap } from "../ipc/client";
import { useVault } from "../stores/vault";
import {
  attachmentLink,
  attachmentName,
  extensionForMime,
  saveAttachment,
  toBase64,
} from "./attachments";

// The write reaches the shell through `../ipc/client`; a lib test has no
// Tauri to talk to, so the boundary is mocked and only the naming, the retry
// and the tree refresh run (ADR-0011).
vi.mock("../ipc/client", () => {
  class NovalisError extends Error {
    ipc: { code: string };
    constructor(ipc: { code: string }) {
      super(ipc.code);
      this.ipc = ipc;
    }
    get code(): string {
      return this.ipc.code;
    }
  }
  return {
    commands: { writeBlob: vi.fn(), listDir: vi.fn() },
    unwrap: vi.fn(),
    NovalisError,
    errorKey: (error: unknown) => (error instanceof NovalisError ? `errors.${error.code}` : "errors.internal"),
    errorValues: () => ({}),
  };
});

const entry = (path: string, dir: boolean) => ({
  path,
  name: path,
  dir,
  size: "0",
  mtimeNs: "0",
  cloudOnly: false,
  boardSlug: null,
  conflictCopyOf: null,
});

const failure = (code: string) =>
  new NovalisError({ code, path: null, detail: null, name: null, candidates: [] });

const bytes = new Uint8Array([1, 2, 3]);

describe("attachmentName", () => {
  it("stamps the note's stem with the local date and time", () => {
    // Local 00:30 on the 14th: `toISOString()` would say the 13th here.
    const now = new Date(2026, 8, 14, 0, 30, 5);
    expect(attachmentName("notes/My Note.md", now, "png")).toBe("My Note-20260914-003005.png");
    expect(attachmentName("x.md", now, "jpg")).toBe("x-20260914-003005.jpg");
  });

  it("numbers the retries before the extension", () => {
    const now = new Date(2026, 8, 14, 0, 30, 5);
    expect(attachmentName("x.md", now, "png", 1)).toBe("x-20260914-003005-2.png");
    expect(attachmentName("x.md", now, "png", 2)).toBe("x-20260914-003005-3.png");
  });
});

describe("extensionForMime", () => {
  it("knows the four §7.3 image types and nothing else", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/gif")).toBe("gif");
    expect(extensionForMime("image/webp")).toBe("webp");
    expect(extensionForMime("image/svg+xml")).toBeNull();
    expect(extensionForMime("image/bmp")).toBeNull();
    expect(extensionForMime("text/plain")).toBeNull();
  });
});

describe("attachmentLink", () => {
  it("links relative to the note and escapes what the parser cannot hold", () => {
    expect(attachmentLink("x-20260914-003005.png")).toBe("![](attachments/x-20260914-003005.png)");
    expect(attachmentLink("My Note (1)-20260914-003005.png")).toBe(
      "![](attachments/My%20Note%20%281%29-20260914-003005.png)",
    );
  });
});

describe("toBase64", () => {
  it("round-trips three bytes", () => {
    expect(toBase64(bytes)).toBe("AQID");
    expect(toBase64(new Uint8Array(0))).toBe("");
  });

  it("matches the naive encoding across the chunk boundary", () => {
    const big = new Uint8Array(20_000);
    for (let i = 0; i < big.length; i += 1) big[i] = i % 256;
    let binary = "";
    for (const byte of big) binary += String.fromCharCode(byte);
    expect(toBase64(big)).toBe(btoa(binary));
  });
});

describe("saveAttachment", () => {
  let reload: Mock<(folder: string) => Promise<void>>;

  beforeEach(() => {
    reload = vi.fn<(folder: string) => Promise<void>>().mockResolvedValue(undefined);
    useVault.setState({ reload, children: {} });
    vi.setSystemTime(new Date(2026, 8, 14, 0, 30, 5));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes into the note folder's attachments/ and returns the link", async () => {
    vi.mocked(unwrap).mockResolvedValueOnce(entry("notes/attachments/x-20260914-003005.png", false));

    const link = await saveAttachment("notes/x.md", bytes, "image/png");

    expect(commands.writeBlob).toHaveBeenCalledWith("notes/attachments", "x-20260914-003005.png", "AQID");
    expect(link).toBe("![](attachments/x-20260914-003005.png)");
  });

  it("takes the next name when the first is already there", async () => {
    vi.mocked(unwrap)
      .mockRejectedValueOnce(failure("already_exists"))
      .mockResolvedValueOnce(entry("notes/attachments/x-20260914-003005-2.png", false));

    const link = await saveAttachment("notes/x.md", bytes, "image/png");

    expect(vi.mocked(commands.writeBlob).mock.calls.map((c) => c[1])).toEqual([
      "x-20260914-003005.png",
      "x-20260914-003005-2.png",
    ]);
    expect(link).toBe("![](attachments/x-20260914-003005-2.png)");
  });

  it("gives up after five taken names", async () => {
    vi.mocked(unwrap).mockRejectedValue(failure("already_exists"));

    await expect(saveAttachment("notes/x.md", bytes, "image/png")).rejects.toMatchObject({
      code: "already_exists",
    });
    expect(commands.writeBlob).toHaveBeenCalledTimes(5);
    expect(reload).not.toHaveBeenCalled();
  });

  it("propagates any other failure without retrying", async () => {
    vi.mocked(unwrap).mockRejectedValueOnce(failure("io"));

    await expect(saveAttachment("notes/x.md", bytes, "image/png")).rejects.toMatchObject({ code: "io" });
    expect(commands.writeBlob).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("refuses a type the shell would refuse, before writing", async () => {
    await expect(saveAttachment("notes/x.md", bytes, "image/bmp")).rejects.toMatchObject({
      code: "bad_request",
    });
    expect(commands.writeBlob).not.toHaveBeenCalled();
  });

  it("lists the note's folder again when it did not show attachments/ yet", async () => {
    useVault.setState({ children: { notes: [entry("notes/x.md", false)] } });
    vi.mocked(unwrap).mockResolvedValueOnce(entry("notes/attachments/x-20260914-003005.png", false));

    await saveAttachment("notes/x.md", bytes, "image/png");

    expect(reload.mock.calls).toEqual([["notes"]]);
  });

  it("leaves the tree alone when attachments/ is listed, or the folder is not", async () => {
    useVault.setState({ children: { notes: [entry("notes/attachments", true), entry("notes/x.md", false)] } });
    vi.mocked(unwrap).mockResolvedValue(entry("notes/attachments/x-20260914-003005.png", false));

    await saveAttachment("notes/x.md", bytes, "image/png");
    // A note at the root: `""` is the root listing, which is not loaded here.
    await saveAttachment("y.md", bytes, "image/png");

    expect(reload).not.toHaveBeenCalled();
  });
});

// ADR-0041: a PDF is an attachment too — linked, not embedded — and a file
// from the Finder is copied under its own name, never over another.
describe("PDF attachments and Finder copies", () => {
  it("links a PDF and embeds an image", () => {
    expect(extensionForMime("application/pdf")).toBe("pdf");
    expect(attachmentLink("Spec-20260914-003005.pdf")).toBe(
      "[Spec-20260914-003005.pdf](attachments/Spec-20260914-003005.pdf)",
    );
    expect(attachmentLink("a.png")).toBe("![](attachments/a.png)");
  });

  it("copies a dropped file under its name, then ' 2', and refuses another type", async () => {
    const { copyIntoFolder } = await import("./attachments");
    (unwrap as Mock)
      .mockRejectedValueOnce(failure("already_exists"))
      .mockResolvedValueOnce(entry("docs/Scan 2.pdf", false));
    const file = new File([bytes], "Scan.pdf", { type: "application/pdf" });
    expect(await copyIntoFolder("docs", file)).toBe("docs/Scan 2.pdf");
    const names = (commands.writeBlob as Mock).mock.calls.map((call) => call[1]);
    expect(names.slice(-2)).toEqual(["Scan.pdf", "Scan 2.pdf"]);

    const text = new File([bytes], "notes.txt", { type: "text/plain" });
    expect(await copyIntoFolder("docs", text)).toBeNull();
  });
});
