import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands } from "../ipc/client";
import { useFiles } from "./files";

vi.mock("../ipc/client", () => ({
  commands: { listFiles: vi.fn() },
  unwrap: async (call: Promise<{ data: unknown }>) => (await call).data,
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

describe("useFiles", () => {
  beforeEach(() => useFiles.getState().clear());

  // The shell hands over every regular file (ADR-0022 point 5); the table
  // decides what is listed, and the notes among them feed `[[`.
  it("keeps what the tree lists, and the notes among them", async () => {
    vi.mocked(commands.listFiles).mockResolvedValue({
      status: "ok",
      data: ["a.md", "b/c.md", "d.txt", "e.m", "f.pdf", "node_modules/g.js", "README", "h.wav"],
    });

    await useFiles.getState().refresh();

    expect(useFiles.getState().files).toEqual(["a.md", "b/c.md", "d.txt", "f.pdf", "node_modules/g.js", "README"]);
    expect(useFiles.getState().notes).toEqual(["a.md", "b/c.md"]);
    expect(useFiles.getState().loaded).toBe(true);
  });
});
