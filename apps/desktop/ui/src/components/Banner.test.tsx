import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Banner as BannerKind, useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { useVault } from "../stores/vault";
import Banner from "./Banner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { path?: string }) => (values?.path !== undefined ? `${key}:${values.path}` : key),
  }),
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  NovalisError: class extends Error {},
  errorKey: () => "errors.internal",
  errorValues: (error: unknown) => ({ detail: String(error) }),
}));

function doc(banner: BannerKind) {
  return {
    path: "a.md",
    text: "x",
    savedText: "x",
    writePath: "a.md",
    precondition: null,
    lastWriteHash: null,
    dirty: false,
    saving: false,
    readOnly: false,
    plainMode: false,
    banner,
    revision: 0,
  };
}

const reloadFromDisk = vi.fn(async () => undefined);
const keepMine = vi.fn(async () => undefined);
const keepBoth = vi.fn(async () => "Notes/a (conflict).md");
const dismissBanner = vi.fn();

function show(banner: BannerKind, copy: string | null = null) {
  useEditorSave.setState({
    docs: { "a.md": doc(banner) },
    conflictCopyPath: () => copy,
    reloadFromDisk,
    keepMine,
    keepBoth,
    dismissBanner,
  } as never);
  return render(<Banner />);
}

const actions = (container: HTMLElement) =>
  [...container.querySelectorAll(".sb-callout__actions > button")].map((button) => [
    button.className,
    button.textContent,
  ]);

const SECONDARY = "sb-secondary-action sb-secondary-action--compact";

// STA-05, AKT-01, ZUG-09 (ADR-0051 #27.7): the banners above the editor are
// sebaro's callouts — glyph, title, text, no fill — with secondary actions
// only, and a path in them breaks as a file name.
describe("Banner", () => {
  beforeEach(() => {
    useTabs.setState({ tabs: ["a.md"], active: "a.md" });
    useVault.setState({ vault: { root: "/v", name: "v", kind: "local", boards: [] } as never });
    vi.clearAllMocks();
  });

  it("is a warning callout with the conflict copy's name and three secondary actions", () => {
    const { container } = show({ kind: "changedOnDisk" }, "Notes/a (conflict).md");
    const callout = container.firstElementChild!;
    expect(callout.className).toBe("sb-callout sb-callout--warning nv-callout");
    expect(callout.getAttribute("role")).toBe("alert");
    expect(callout.querySelector(":scope > svg.sb-icon--20 use")?.getAttribute("href")).toBe("#warning--filled");
    const title = callout.querySelector(".sb-callout__title")!;
    expect(title.textContent).toBe("banner.changedOnDisk.title");
    expect(callout.getAttribute("aria-labelledby")).toBe(title.id);
    const text = callout.querySelector(".sb-callout__text")!;
    expect(text.textContent).toBe("banner.changedOnDisk.body:Notes/a (conflict).md");
    expect(text.querySelector(".sb-file-name")?.querySelectorAll("wbr")).toHaveLength(2);
    expect(actions(container)).toEqual([
      [SECONDARY, "banner.changedOnDisk.reload"],
      [SECONDARY, "banner.changedOnDisk.keepMine"],
      [SECONDARY, "banner.changedOnDisk.saveConflictCopy"],
    ]);
    expect(container.querySelector(".btn, .sb-primary-action, .banner")).toBeNull();

    fireEvent.click(screen.getByText("banner.changedOnDisk.reload"));
    expect(reloadFromDisk).toHaveBeenCalledWith("a.md");
    fireEvent.click(screen.getByText("banner.changedOnDisk.keepMine"));
    expect(keepMine).toHaveBeenCalledWith("a.md", "local");
    fireEvent.click(screen.getByText("banner.changedOnDisk.saveConflictCopy"));
    expect(keepBoth).toHaveBeenCalledWith("a.md");
  });

  it("asks after a sync replaced or a file vanished in the same callout, no lime among the actions", () => {
    const sync = show({ kind: "replacedBySync" });
    expect(sync.container.querySelector(".sb-callout--warning")?.getAttribute("role")).toBe("alert");
    expect(sync.container.querySelector(".sb-callout__text")).toBeNull();
    expect(actions(sync.container)).toEqual([
      [SECONDARY, "banner.replacedBySync.reload"],
      [SECONDARY, "banner.replacedBySync.restoreMine"],
    ]);
    sync.unmount();

    const gone = show({ kind: "deletedOnDisk" });
    expect(gone.container.querySelector(".sb-callout__title")?.textContent).toBe("banner.deletedOnDisk.title");
    expect(actions(gone.container)).toEqual([
      [SECONDARY, "banner.deletedOnDisk.close"],
      [SECONDARY, "banner.deletedOnDisk.keepMine"],
    ]);
  });

  it("says what a file opens as in a note callout that can be put away", () => {
    const { container } = show({ kind: "binary" });
    // A polite live region around it announces it when it appears.
    expect(container.firstElementChild?.getAttribute("role")).toBe("status");
    const callout = container.querySelector(".sb-callout")!;
    expect(callout.className).toBe("sb-callout sb-callout--note nv-callout");
    expect(callout.getAttribute("role")).toBe("note");
    expect(callout.hasAttribute("aria-labelledby")).toBe(false);
    expect(callout.querySelector(":scope > svg use")?.getAttribute("href")).toBe("#info--filled");
    // One sentence without a title starts with its kind's word (NV-I10).
    expect(callout.querySelector(".sb-callout__text > strong.sb-callout__kind")?.textContent).toBe("callout.note");
    expect(callout.querySelector(".sb-callout__text")?.textContent).toBe("callout.note banner.binary");
    // „Ausblenden“ is the callout's hide action, last, with close--16 (D102 (39)).
    expect(actions(container)).toEqual([["sb-text-action sb-text-action--compact sb-callout__hide", "banner.dismiss"]]);
    expect(screen.getByText("banner.dismiss").querySelector("use")?.getAttribute("href")).toBe("#close--16");
    fireEvent.click(screen.getByText("banner.dismiss"));
    expect(dismissBanner).toHaveBeenCalledWith("a.md");
  });

  // spec/02 §3.11: after „Ausblenden“ the focus goes to the next control
  // after the callout, else to the one before, never to body.
  it("hands the focus on when „Ausblenden“ is pressed from the keyboard", () => {
    const before = document.createElement("button");
    const after = document.createElement("button");
    document.body.append(before);
    const { container } = show({ kind: "binary" });
    document.body.append(after);
    try {
      const hide = screen.getByText("banner.dismiss");
      hide.focus();
      fireEvent.click(hide);
      expect(document.activeElement).toBe(after);

      after.remove();
      container.querySelector<HTMLButtonElement>(".sb-callout__hide")!.focus();
      fireEvent.click(screen.getByText("banner.dismiss"));
      expect(document.activeElement).toBe(before);
    } finally {
      before.remove();
      after.remove();
    }
  });
});
