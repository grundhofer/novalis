import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { commands, NovalisError } from "../ipc/client";
import BootError, { describeBootError } from "./BootError";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ipc/client", async (importActual) => {
  const actual = await importActual<typeof import("../ipc/client")>();
  return { ...actual, commands: { openVaultDialog: vi.fn(), openVault: vi.fn() } };
});

const failure = new NovalisError({
  code: "io",
  path: "/Volumes/Daten/Notizen",
  detail: "Permission denied",
  name: null,
  candidates: [],
});

const ok = <T,>(data: T) => ({ status: "ok" as const, data });

const reload = vi.fn();
const location = window.location;

function stubReload() {
  Object.defineProperty(window, "location", { configurable: true, value: { ...location, reload } });
}

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: location });
  vi.clearAllMocks();
});

// STA-05, TXT-07, STR-01: a failed start is an error callout with words,
// the code under „Details“ and the way on as a secondary action.
describe("BootError", () => {
  it("is sebaro's error callout with title, sentence, details and an action", () => {
    const { container } = render(<BootError error={failure} />);
    const callout = screen.getByRole("alert");
    // sebaro's failed start without the window frame (spec/09 §13.1, D108);
    // the window's density is <html>'s (index.html).
    expect(container.querySelector(".boot-error > .sb-start-error > .sb-callout")).toBe(callout);
    expect(callout.classList.contains("sb-callout--error")).toBe(true);
    expect(callout.querySelector(":scope > svg use")?.getAttribute("href")).toBe("#error--filled");
    const title = callout.querySelector(":scope > p.sb-callout__title")!;
    expect(title.textContent).toBe("errors.title");
    expect(callout.getAttribute("aria-labelledby")).toBe(title.id);
    expect(callout.querySelector(":scope > p.sb-callout__text")?.textContent).toBe("errors.bootText");

    // The code is no part of the sentence: it is under a closed „Details“.
    const details = callout.querySelector(":scope > details.sb-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("samp.sb-details__text")?.textContent).toBe(
      "io (/Volumes/Daten/Notizen): Permission denied",
    );
    expect(details.compareDocumentPosition(callout.querySelector(".sb-callout__actions")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    const open = screen.getByRole("button", { name: "app.openVault.button" });
    expect(open.className).toBe("sb-secondary-action sb-secondary-action--compact");
    expect(open.closest(".sb-callout__actions")).toBeTruthy();
  });

  it("opens the picked vault and starts the page again", async () => {
    stubReload();
    vi.mocked(commands.openVaultDialog).mockResolvedValue(ok("/Notizen"));
    vi.mocked(commands.openVault).mockResolvedValue(ok({}) as never);
    render(<BootError error={failure} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "app.openVault.button" }));
    });
    expect(commands.openVault).toHaveBeenCalledWith("/Notizen");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no folder is picked", async () => {
    stubReload();
    vi.mocked(commands.openVaultDialog).mockResolvedValue(ok(null));
    render(<BootError error={failure} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "app.openVault.button" }));
    });
    expect(commands.openVault).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").querySelector(".sb-callout__text")?.textContent).toBe("errors.bootText");
  });

  it("says in the callout why the vault did not open", async () => {
    stubReload();
    vi.mocked(commands.openVaultDialog).mockResolvedValue(ok("/Notizen"));
    vi.mocked(commands.openVault).mockResolvedValue({
      status: "error",
      error: { code: "io", path: "/Notizen", detail: "Operation not permitted", name: null, candidates: [] },
    });
    render(<BootError error={failure} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "app.openVault.button" }));
    });
    expect(reload).not.toHaveBeenCalled();
    const callout = screen.getByRole("alert");
    expect(callout.querySelector(".sb-callout__text")?.textContent).toBe("errors.io");
    expect(callout.querySelector("samp.sb-details__text")?.textContent).toBe("Operation not permitted");
  });

  it("describes any thrown value", () => {
    expect(describeBootError(new TypeError("x is undefined"))).toBe("TypeError: x is undefined");
    expect(describeBootError("plain")).toBe("plain");
  });
});
