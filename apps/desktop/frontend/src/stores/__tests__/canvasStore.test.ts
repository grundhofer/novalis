// Canvas actions must never fail silently: creating a canvas routes a backend
// rejection into vaultStore's global error surface (the App.tsx toast), and the
// quit-time drain (`flushPending`) awaits the open editor's pending write so a
// debounced save can't be lost on close. The ipc module is mocked, so no Tauri
// runtime is needed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCanvases: vi.fn(),
  createCanvas: vi.fn(),
}));

vi.mock("../../ipc/api", () => ({
  api: { ...mocks },
}));

import { useCanvas } from "../canvasStore";
import { useVault } from "../vaultStore";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCanvas.setState({ activeCanvas: null });
  useCanvas.getState().setFlushHandler(null);
  useVault.setState({ error: null });
});

describe("canvasStore.createAndOpen", () => {
  it("surfaces a create failure globally and does not switch to the new canvas", async () => {
    mocks.listCanvases.mockResolvedValue([]);
    mocks.createCanvas.mockRejectedValue(new Error("backend rejected the write"));

    await useCanvas.getState().createAndOpen();

    expect(useVault.getState().error).toContain("backend rejected the write");
    expect(useCanvas.getState().activeCanvas).toBeNull();
  });
});

describe("canvasStore.flushPending", () => {
  it("awaits the open editor's pending write before resolving", async () => {
    const write = deferred<void>();
    let drained = false;
    useCanvas.getState().setFlushHandler(async () => {
      await write.promise;
      drained = true;
    });

    const pending = useCanvas.getState().flushPending();
    // Still in flight until the registered write resolves.
    expect(drained).toBe(false);

    write.resolve();
    await pending;
    expect(drained).toBe(true);
  });

  it("resolves immediately with no canvas open (no handler registered)", async () => {
    await expect(useCanvas.getState().flushPending()).resolves.toBeUndefined();
    expect(useVault.getState().error).toBeNull();
  });

  it("routes a drain failure into the global error surface", async () => {
    useCanvas.getState().setFlushHandler(async () => {
      throw new Error("disk full");
    });

    await useCanvas.getState().flushPending();

    expect(useVault.getState().error).toContain("disk full");
  });
});
