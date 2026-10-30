import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { report, useUi } from "../stores/ui";
import Toast, { TOAST_MS } from "./Toast";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values && Object.keys(values).length > 0 ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));
vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  errorKey: () => "errors.io",
  errorValues: () => ({ detail: "EACCES" }),
}));

const toastBox = () => document.querySelector<HTMLElement>(".sb-toast")!;

/** The two frames after which the shown toast's sentence is written. */
const frames = () =>
  act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });

// ADR-0051 #14 (EBE-05, D78, spec/02 §4.8): the toast is left for reversible
// results — a card added, a move the hidden tree cannot show — and
// „In die Zwischenablage kopiert: …“; a failure never reaches it.
describe("Toast", () => {
  beforeEach(() => {
    useUi.setState({ toast: null, message: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is sebaro's toast: a status that stays in the page, hidden until shown, with no action", async () => {
    render(<Toast />);
    const box = toastBox();
    expect(box.getAttribute("role")).toBe("status");
    expect(box.hidden).toBe(true);
    expect(box.textContent).toBe("");

    act(() => useUi.getState().showToast("board.cardAdded", { board: "Plan" }));
    expect(toastBox()).toBe(box);
    expect(box.hidden).toBe(false);
    await frames();
    expect(box.querySelector("p")?.textContent).toBe("board.cardAdded:Plan");
    expect(box.classList.contains("sb-enter")).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    // No „Schließen“: sebaro allows only „Rückgängig“, and only a move has it.
    expect(box.querySelector("button")).toBeNull();

    act(() => useUi.getState().showToast("palette.copied", { text: "[[a]]" }));
    await frames();
    expect(box.textContent).toBe("palette.copied:[[a]]");
  });

  // EBE-05, spec/02 §4.8: a live region that enters the accessibility tree
  // already filled may go unread, so the box is shown first and the sentence
  // written a frame later — for a toast that replaces a shown one, too.
  it("is shown empty before its sentence arrives", () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useUi.getState().showToast("board.cardAdded", { board: "A" }));
    expect(toastBox().hidden).toBe(false);
    expect(toastBox().querySelector("p")?.textContent).toBe("");
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(toastBox().querySelector("p")?.textContent).toBe("");
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(toastBox().querySelector("p")?.textContent).toBe("board.cardAdded:A");

    act(() => useUi.getState().showToast("board.cardAdded", { board: "A" }));
    expect(toastBox().querySelector("p")?.textContent).toBe("");
    act(() => {
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
    });
    expect(toastBox().querySelector("p")?.textContent).toBe("board.cardAdded:A");
  });

  // ADR-0051 #39, spec/02 §4.8: the one action, „Rückgängig“ after Move
  // To…, is `sb-toast__action`; pressing it closes the toast, focus goes
  // back where it came from, and the action runs.
  it("offers its one action, which closes the toast, gives focus back and runs", async () => {
    render(<Toast />);
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.focus();
    const run = vi.fn().mockResolvedValue(undefined);
    act(() => useUi.getState().showToast("tree.movedTo", { folder: "Archiv" }, { labelKey: "app.undo", run }));
    await frames();
    const button = toastBox().querySelector<HTMLButtonElement>("button.sb-toast__action")!;
    expect(button.type).toBe("button");
    expect(button.textContent).toBe("app.undo");
    expect(toastBox().querySelector("p")?.textContent).toBe("tree.movedTo:Archiv");

    button.focus();
    act(() => button.click());
    expect(run).toHaveBeenCalledTimes(1);
    expect(useUi.getState().toast).toBeNull();
    expect(document.activeElement).toBe(editor);
    editor.remove();
  });

  it("says a failed action in the action zone, never in a toast", async () => {
    render(<Toast />);
    const run = vi.fn().mockRejectedValue(new Error("EACCES"));
    act(() => useUi.getState().showToast("tree.movedTo", { folder: "Archiv" }, { labelKey: "app.undo", run }));
    await act(async () => {
      toastBox().querySelector<HTMLButtonElement>("button.sb-toast__action")!.click();
      await Promise.resolve();
    });
    expect(useUi.getState().toast).toBeNull();
    expect(useUi.getState().message?.key).toBe("errors.io");
  });

  it("gives focus back when Escape closes it from its action", () => {
    render(<Toast />);
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.focus();
    act(() =>
      useUi.getState().showToast("tree.movedTo", { folder: "Archiv" }, { labelKey: "app.undo", run: vi.fn() }),
    );
    const button = toastBox().querySelector<HTMLButtonElement>("button.sb-toast__action")!;
    button.focus();
    act(() => {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(useUi.getState().toast).toBeNull();
    expect(document.activeElement).toBe(editor);
    editor.remove();
  });

  it("shows nothing for a failure", () => {
    render(<Toast />);
    act(() => report(new Error("EACCES")));
    expect(toastBox().hidden).toBe(true);
    expect(useUi.getState().message?.key).toBe("errors.io");
  });

  // D100 (6): a path breaks only after - . _ /, without a character of its own.
  it("lets a copied path break after its separators", async () => {
    render(<Toast />);
    act(() => useUi.getState().showToast("palette.copied", { text: "/Users/a/my-notes/to_do.md" }));
    await frames();
    const name = toastBox().querySelector(".sb-file-name")!;
    expect(name.textContent).toBe("/Users/a/my-notes/to_do.md");
    // None after the leading „/“: the path would read as a relative one.
    expect(name.querySelectorAll("wbr")).toHaveLength(6);
  });

  it("stands 6 s, held while pointed at, and runs on with the time left", () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useUi.getState().showToast("tree.movedTo", { folder: "Archiv" }));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 2000);
    });
    fireEvent.pointerEnter(toastBox());
    act(() => {
      vi.advanceTimersByTime(TOAST_MS * 2);
    });
    expect(useUi.getState().toast).not.toBeNull();

    fireEvent.pointerLeave(toastBox());
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(useUi.getState().toast).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(useUi.getState().toast).toBeNull();
    expect(toastBox().hidden).toBe(true);
  });

  // A second Copy Path from the palette while the pointer rests on the
  // first toast: no new `pointerenter` comes, so the hold carries over.
  it("keeps the pointer's hold when a new toast replaces a shown one", () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useUi.getState().showToast("palette.copied", { text: "a.md" }));
    fireEvent.pointerEnter(toastBox());
    act(() => useUi.getState().showToast("palette.copied", { text: "b.md" }));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS * 2);
    });
    expect(useUi.getState().toast?.values).toEqual({ text: "b.md" });

    fireEvent.pointerLeave(toastBox());
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(useUi.getState().toast).toBeNull();
  });

  // A hidden box gets no `pointerleave`: the next toast starts unheld.
  it("drops the hold once the toast is gone", () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useUi.getState().showToast("board.cardAdded", { board: "A" }));
    fireEvent.pointerEnter(toastBox());
    act(() => useUi.getState().clearToast());
    act(() => useUi.getState().showToast("board.cardAdded", { board: "B" }));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(useUi.getState().toast).toBeNull();
  });

  it("is held while focus is inside it", () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useUi.getState().showToast("board.cardAdded", { board: "Plan" }));
    fireEvent.focus(toastBox());
    act(() => {
      vi.advanceTimersByTime(TOAST_MS * 2);
    });
    expect(useUi.getState().toast).not.toBeNull();
    fireEvent.blur(toastBox());
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(useUi.getState().toast).toBeNull();
  });

  it("starts a new 6 s for the next toast", () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useUi.getState().showToast("board.cardAdded", { board: "A" }));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 1000);
    });
    act(() => useUi.getState().showToast("board.cardAdded", { board: "B" }));
    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 1);
    });
    expect(useUi.getState().toast?.values).toEqual({ board: "B" });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(useUi.getState().toast).toBeNull();
  });

  it("closes with Escape, and leaves the key to whoever else wants it", () => {
    render(<Toast />);
    act(() => useUi.getState().showToast("board.cardAdded", { board: "Plan" }));
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(escape);
    });
    expect(useUi.getState().toast).toBeNull();
    expect(escape.defaultPrevented).toBe(false);
    expect(toastBox().hidden).toBe(true);
  });

  // The palette, the search and a dialog stop their Escape from bubbling:
  // the toast still closes, and the overlay still gets the key.
  it("closes with an Escape that an overlay stops from bubbling", () => {
    render(<Toast />);
    act(() => useUi.getState().showToast("board.cardAdded", { board: "Plan" }));
    const overlay = document.createElement("div");
    const heard = vi.fn();
    overlay.addEventListener("keydown", (event) => {
      heard();
      event.stopPropagation();
    });
    document.body.append(overlay);
    act(() => {
      overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(useUi.getState().toast).toBeNull();
    overlay.remove();
  });

  // ADR-0051 #56, spec/02 §4.8: an Escape that an open dialog, the palette
  // or a menu owns is theirs; the toast and its „Rückgängig“ stay. From
  // inside the toast it still closes it.
  it("stays for an Escape that an open dialog or menu owns", () => {
    render(<Toast />);
    act(() =>
      useUi.getState().showToast("tree.movedTo", { folder: "Archiv" }, { labelKey: "app.undo", run: vi.fn() }),
    );
    // The palette and the dialogs open modal (`showModal`), which jsdom
    // lacks: the page answers for the modal dialog it would have.
    const dialog = document.createElement("dialog");
    const field = document.createElement("input");
    dialog.append(field);
    document.body.append(dialog);
    const query = document.querySelector.bind(document);
    const spy = vi
      .spyOn(document, "querySelector")
      .mockImplementation((selector: string) =>
        selector === "dialog:modal, :popover-open" ? dialog : query(selector),
      );
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(useUi.getState().toast?.action?.labelKey).toBe("app.undo");

    const button = toastBox().querySelector<HTMLButtonElement>("button.sb-toast__action")!;
    act(() => {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(useUi.getState().toast).toBeNull();
    spy.mockRestore();
    dialog.remove();
  });

  // sebaro D108 (NV-X1), spec/02 §4.8: focus whose origin is gone goes to
  // the main content of the toast's area, never to the page's body.
  it("gives focus to the shown document panel when its origin is gone", async () => {
    const frame = document.createElement("div");
    frame.className = "sb-window";
    frame.innerHTML =
      '<main class="sb-window__content"><div class="sb-doc-tabs__panel" hidden></div>' +
      '<div class="sb-doc-tabs__panel" id="shown"></div></main><div class="sb-bottom-block"></div>';
    document.body.append(frame);
    render(<Toast />, { container: frame.querySelector<HTMLElement>(".sb-bottom-block")! });
    const row = document.createElement("button");
    frame.querySelector("main")!.append(row);
    row.focus();
    const run = vi.fn().mockResolvedValue(undefined);
    act(() => useUi.getState().showToast("tree.movedTo", { folder: "Archiv" }, { labelKey: "app.undo", run }));
    await frames();
    const button = toastBox().querySelector<HTMLButtonElement>("button.sb-toast__action")!;
    button.focus();
    row.remove();
    act(() => button.click());
    const shown = document.getElementById("shown")!;
    expect(document.activeElement).toBe(shown);
    expect(shown.getAttribute("tabindex")).toBe("-1");
    frame.remove();
  });
});

