import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NovalisError } from "../ipc/client";
import { afterDialog } from "../lib/areas";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import Prompt, { WAIT_MS } from "./Prompt";

// The catalog is not under test; render the key so assertions read plainly,
// and the path a sentence names after it.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values?.path ? `${key} ${String(values.path)}` : key),
  }),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const ipcError = (code: string, path = "Ideas.md", detail: string | null = null) =>
  new NovalisError({ code, path, detail, name: null, candidates: [] });

// jsdom has `<dialog>` but neither `showModal()` nor `close()`: the open
// state is the attribute, as in a browser, and `close` queues its event.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.removeAttribute("open");
    setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  });
});

const dialog = () => document.querySelector("dialog")!;

describe("Prompt", () => {
  beforeEach(() => {
    useUi.setState({ prompt: null, message: null });
    useVault.setState({ vault: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when nothing was asked", () => {
    const { container } = render(<Prompt />);
    expect(container.innerHTML).toBe("");
  });

  // EBE-03, spec/02 §4.6: a native dialog opened as a modal, named by its title.
  it("is sebaro's dialog, opened with showModal and named by its title", () => {
    useUi.setState({ prompt: { titleKey: "menu.file.newNote", labelKey: "tree.nameLabel", submit: vi.fn() } });
    render(<Prompt />);

    const element = dialog();
    expect(element.className).toBe("sb-dialog");
    expect(element.open).toBe(true);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    const title = document.getElementById(element.getAttribute("aria-labelledby")!)!;
    expect(title.tagName).toBe("H2");
    expect(title.className).toBe("sb-dialog__title");
    expect(title.textContent).toBe("menu.file.newNote");
    expect(element.querySelector("form")?.getAttribute("method")).toBe("dialog");
    expect(screen.getByRole("dialog", { name: "menu.file.newNote" })).toBe(element);
  });

  // EIN-01: a visible label, never a placeholder as the only one; the hint
  // hangs on the input.
  it("labels the field visibly and describes it by its hint", () => {
    useUi.setState({
      prompt: {
        titleKey: "menu.file.newNote",
        labelKey: "tree.nameLabel",
        hint: { key: "tree.newNoteHint" },
        submit: vi.fn(),
      },
    });
    render(<Prompt />);

    const input = screen.getByRole("textbox", { name: "tree.nameLabel" });
    expect(input.getAttribute("placeholder")).toBeNull();
    const label = document.querySelector(`label[for="${input.id}"]`)!;
    expect(label.className).toBe("sb-field__label");
    expect(input.parentElement?.className).toBe("sb-field__control");
    expect(input.closest(".sb-field")).toBe(label.parentElement);
    const help = document.getElementById(input.getAttribute("aria-describedby")!)!;
    expect(help.className).toBe("sb-field__help");
    expect(help.textContent).toBe("tree.newNoteHint");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  // ZUG-06: focus moves in on open and back to where it came from on close.
  it("takes focus in and gives it back on close", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    useUi.setState({ prompt: { titleKey: "t", labelKey: "l", initial: "Old", submit: vi.fn() } });
    render(<Prompt />);

    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    fireEvent.click(screen.getByText("app.cancel"));
    expect(useUi.getState().prompt).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  // ZUG-06, ZUG-08: what the action opened — the new note's editor — asks for
  // focus while the modal still makes the page inert; it gets it once the
  // dialog has closed, after the opener's restore, and keeps it.
  it("gives focus asked for during submit to its target once closed", async () => {
    const opener = document.createElement("button");
    const target = document.createElement("button");
    document.body.append(opener, target);
    opener.focus();
    let element: HTMLDialogElement | null = null;
    let openWhenFocused: boolean | null = null;
    useUi.setState({
      prompt: {
        titleKey: "menu.file.newNote",
        labelKey: "tree.nameLabel",
        submitKey: "app.create",
        submit: () => {
          afterDialog(() => {
            openWhenFocused = element?.open ?? null;
            target.focus();
          });
        },
      },
    });
    render(<Prompt />);
    element = dialog();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Ideas" } });
    fireEvent.click(screen.getByText("app.create"));
    await act(flush);
    await act(flush);

    expect(useUi.getState().prompt).toBeNull();
    expect(openWhenFocused).toBe(false);
    expect(document.activeElement).toBe(target);
    opener.remove();
    target.remove();
  });

  it("cancels on Escape, from the field and from the browser's cancel", () => {
    const submit = vi.fn();
    useUi.setState({ prompt: { titleKey: "t", labelKey: "l", submit } });
    const { unmount } = render(<Prompt />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(useUi.getState().prompt).toBeNull();
    unmount();

    useUi.setState({ prompt: { titleKey: "t", labelKey: "l", submit } });
    render(<Prompt />);
    const cancel = new Event("cancel", { cancelable: true });
    act(() => {
      dialog().dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(useUi.getState().prompt).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("follows the browser when it closes the dialog itself", async () => {
    useUi.setState({ prompt: { titleKey: "t", labelKey: "l", submit: vi.fn() } });
    render(<Prompt />);

    act(() => dialog().close());
    await act(flush);
    expect(useUi.getState().prompt).toBeNull();
  });

  // The state belongs to the one Prompt: a submit that outlived its question
  // must not end the next question's waiting nor let it submit twice.
  it("leaves the next question's submit alone when an old one settles", async () => {
    let finishFirst: () => void = () => undefined;
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const second = vi.fn(() => new Promise<void>(() => undefined));
    useUi.setState({ prompt: { titleKey: "first", labelKey: "l", submit: first } });
    render(<Prompt />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.click(screen.getByText("app.cancel"));
    act(() => useUi.setState({ prompt: { titleKey: "second", labelKey: "l", submit: second } }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "B" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await act(async () => {
      finishFirst();
      await flush();
    });

    expect(useUi.getState().prompt?.titleKey).toBe("second");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stays open when another question replaces this one", async () => {
    useUi.setState({ prompt: { titleKey: "first", labelKey: "l", submit: vi.fn() } });
    render(<Prompt />);

    act(() => useUi.setState({ prompt: { titleKey: "second", labelKey: "l", submit: vi.fn() } }));
    await act(flush);
    expect(useUi.getState().prompt?.titleKey).toBe("second");
    expect(dialog().open).toBe(true);
    expect(screen.getByRole("heading").textContent).toBe("second");
  });

  // EBE-03, spec/02 §4.6 (NV-L8): a press that begins and ends on the scrim
  // cancels; a press on the dialog's own padding does not, nor one that
  // began inside the dialog.
  it("cancels on a press on the scrim only", () => {
    useUi.setState({ prompt: { titleKey: "t", labelKey: "l", submit: vi.fn() } });
    render(<Prompt />);
    vi.spyOn(dialog(), "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 400, 200));
    const press = (down: [number, number], up: [number, number]) => {
      fireEvent.mouseDown(dialog(), { clientX: down[0], clientY: down[1] });
      fireEvent.click(dialog(), { clientX: up[0], clientY: up[1] });
    };

    press([120, 110], [120, 110]);
    expect(useUi.getState().prompt).not.toBeNull();
    press([120, 110], [20, 20]);
    expect(useUi.getState().prompt).not.toBeNull();
    press([20, 20], [20, 20]);
    expect(useUi.getState().prompt).toBeNull();
  });

  // spec/02 §4.6 (NV-L8): typed text is not lost to a stray press.
  it("keeps an input dialog open on the scrim once its field has changed", () => {
    useUi.setState({ prompt: { titleKey: "t", labelKey: "l", initial: "a", submit: vi.fn() } });
    render(<Prompt />);
    vi.spyOn(dialog(), "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 400, 200));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ab" } });

    fireEvent.mouseDown(dialog(), { clientX: 20, clientY: 20 });
    fireEvent.click(dialog(), { clientX: 20, clientY: 20 });
    expect(useUi.getState().prompt).not.toBeNull();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(useUi.getState().prompt).toBeNull();
  });

  // AKT-04, EBE-03, AKT-01: the verb names what happens and is a secondary
  // action; a dialog has no lime one.
  it("names the submit verb as a secondary action, never OK and never lime", () => {
    useUi.setState({ prompt: { titleKey: "t", labelKey: "l", submitKey: "app.rename", submit: vi.fn() } });
    const { unmount } = render(<Prompt />);
    const verb = screen.getByRole("button", { name: "app.rename" });
    expect(verb.className).toBe("sb-secondary-action");
    expect(verb.getAttribute("type")).toBe("submit");
    expect(dialog().querySelector(".sb-primary-action, .btn.primary")).toBeNull();
    // „Abbrechen“ first, the verb last (spec/02 §4.6).
    const buttons = [...dialog().querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["app.cancel", "app.rename"]);
    unmount();

    useUi.setState({ prompt: { titleKey: "t", labelKey: "l", submit: vi.fn() } });
    render(<Prompt />);
    expect(screen.getByRole("button", { name: "app.save" })).toBeTruthy();
    expect(screen.queryByText("app.ok")).toBeNull();
  });

  // spec/02 §1.7, spec/07 §4.5: no sign of work under a second; from then on
  // the turning loader, the word of what runs and aria-busy.
  it("shows the waiting state only once submit has run for a second", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    useUi.setState({
      prompt: {
        titleKey: "menu.file.newNote",
        labelKey: "tree.nameLabel",
        submitKey: "app.create",
        busyKey: "app.creating",
        submit: () => new Promise<void>((resolve) => (finish = resolve)),
      },
    });
    render(<Prompt />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Idea" } });
    fireEvent.click(screen.getByText("app.create"));
    const verb = screen.getByRole("button", { name: "app.create" });
    expect(verb.getAttribute("aria-busy")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(WAIT_MS - 1);
    });
    expect(verb.getAttribute("aria-busy")).toBeNull();
    expect(verb.textContent).toBe("app.create");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(verb.getAttribute("aria-busy")).toBe("true");
    expect(verb.textContent).toBe("app.creating");
    const spinner = verb.querySelector("svg")!;
    expect(spinner.getAttribute("class")).toBe("sb-icon sb-icon--20 sb-spinner");
    expect(spinner.querySelector("use")?.getAttribute("href")).toBe("#loader");

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(useUi.getState().prompt).toBeNull();
  });

  it("submits once, however often Enter is pressed while it runs", async () => {
    const submit = vi.fn(() => new Promise<void>(() => undefined));
    useUi.setState({ prompt: { titleKey: "t", labelKey: "l", submit } });
    render(<Prompt />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Idea" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    fireEvent.click(screen.getByText("app.save"));
    await flush();

    expect(submit).toHaveBeenCalledTimes(1);
  });

  // The defect: `ask()` only stores the request, so the promise
  // `dispatchCommand` catches has already resolved by the time the submit
  // button is pressed. Now the failure stays in the dialog (D83 (2)): a
  // sentence in text colour with the error sign, and „Noch mal versuchen“.
  it("keeps a failure in the dialog as a sentence with the error sign", async () => {
    useUi.setState({
      prompt: {
        titleKey: "menu.file.newNote",
        labelKey: "tree.nameLabel",
        submitKey: "app.create",
        submit: () => Promise.reject(new Error("disk full")),
      },
    });
    render(<Prompt />);
    // The live region is there before the failure, empty (spec/02 §4.6).
    const alert = screen.getByRole("alert");
    expect(alert.className).toBe("sb-dialog__message");
    expect(alert.childNodes).toHaveLength(0);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Idea" } });
    fireEvent.click(screen.getByText("app.create"));
    await flush();

    expect(useUi.getState().prompt).not.toBeNull();
    expect(screen.getByRole("alert")).toBe(alert);
    expect(alert.querySelector(":scope > span")?.textContent).toBe("errors.internal");
    expect(alert.querySelector("use")?.getAttribute("href")).toBe("#error--16");
    // The system's own text is no part of the sentence: it follows it under
    // a closed „Details“ (spec/02 §3.28, TXT-07).
    const details = alert.querySelector(":scope > details.sb-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("errors.details");
    expect(details.querySelector("samp.sb-details__text")?.textContent).toBe("Error: disk full");
    // Not a name error: the field stays as it was.
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByRole("button", { name: "app.retry" }).className).toBe("sb-secondary-action");
    expect(useUi.getState().message).toBeNull();
  });

  // EIN-02, spec/02 §2.1: a taken or impossible name is said at the field.
  it("says a name error at the field and goes back to it", async () => {
    useUi.setState({
      prompt: {
        titleKey: "menu.file.newNote",
        labelKey: "tree.nameLabel",
        hint: { key: "tree.newNoteHint" },
        submitKey: "app.create",
        submit: () => Promise.reject(ipcError("already_exists")),
      },
    });
    render(<Prompt />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Ideas" } });
    fireEvent.click(screen.getByText("app.create"));
    await flush();

    expect(input.getAttribute("aria-invalid")).toBe("true");
    const [helpId, errorId] = input.getAttribute("aria-describedby")!.split(" ");
    expect(document.getElementById(helpId!)?.className).toBe("sb-field__help");
    const error = document.getElementById(errorId!)!;
    expect(error.className).toBe("sb-field__error");
    expect(error.textContent).toBe("app.nameTaken");
    expect(error.querySelector("use")?.getAttribute("href")).toBe("#error--filled-16");
    // The dialog's own live region stays empty: the error is the field's.
    expect(screen.getByRole("alert").childNodes).toHaveLength(0);
    expect(document.activeElement).toBe(input);
    // Trying the same name again would fail again: the verb stays (AKT-04).
    expect(screen.getByRole("button", { name: "app.create" })).toBeTruthy();
    expect(screen.queryByText("app.retry")).toBeNull();

    // A changed name is a new one: the error goes.
    fireEvent.change(input, { target: { value: "Ideas 2" } });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBe(helpId);
    expect(document.querySelector(".sb-field__error")).toBeNull();
  });

  // The core puts the absolute path into a taken name's error on New Note
  // and Rename: the field says what to do and names no path at all.
  it("names no path at the field, however the core names it", async () => {
    useUi.setState({
      prompt: {
        titleKey: "tree.renameTitle",
        labelKey: "tree.newNameLabel",
        submitKey: "app.rename",
        submit: () => Promise.reject(ipcError("invalid_path", "/elsewhere/Vault/.Ideas.md", "hidden")),
      },
    });
    render(<Prompt />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: ".Ideas" } });
    fireEvent.click(screen.getByText("app.rename"));
    await flush();

    expect(document.querySelector(".sb-field__error")?.textContent).toBe("app.nameInvalid");
  });

  // EIN-02: the field is blamed only when the name is the cause. A symlink on
  // the way is not the name's fault: its sentence stays above the actions.
  it("says a path refused for a symlink above the actions, not at the field", async () => {
    useUi.setState({
      prompt: {
        titleKey: "menu.file.newNote",
        labelKey: "tree.nameLabel",
        submitKey: "app.create",
        submit: () => Promise.reject(ipcError("invalid_path", "Linked/Ideas.md", "symlink")),
      },
    });
    render(<Prompt />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Linked/Ideas" } });
    fireEvent.click(screen.getByText("app.create"));
    await act(flush);

    expect(document.querySelector(".sb-field__error")).toBeNull();
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("errors.invalidPath Linked/Ideas.md");
  });

  // As the action zone says it: a path in the vault vault-relative, one
  // outside it as it is.
  it("says a failure's path in the vault vault-relative", async () => {
    useVault.setState({ vault: { root: "/v" } as never });
    let fail: (error: unknown) => void = () => undefined;
    useUi.setState({
      prompt: {
        titleKey: "t",
        labelKey: "l",
        submit: () =>
          new Promise<void>((_, reject) => {
            fail = reject;
          }),
      },
    });
    render(<Prompt />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Idea" } });
    fireEvent.click(screen.getByText("app.save"));
    await act(async () => {
      fail(ipcError("io", "/v/Notes/Idea.md"));
      await flush();
    });
    expect(screen.getByRole("alert").querySelector(":scope > span")?.textContent).toBe("errors.io Notes/Idea.md");

    fireEvent.click(screen.getByText("app.retry"));
    await act(async () => {
      fail(ipcError("io", "/elsewhere/Idea.md"));
      await flush();
    });
    expect(screen.getByRole("alert").querySelector(":scope > span")?.textContent).toBe("errors.io /elsewhere/Idea.md");
  });

  it("passes the trimmed value through and closes on success", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    useUi.setState({
      prompt: { titleKey: "t", labelKey: "l", initial: "", submit },
    });
    render(<Prompt />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  name  " } });
    fireEvent.click(screen.getByText("app.save"));
    await flush();

    expect(submit).toHaveBeenCalledWith("name");
    expect(useUi.getState().prompt).toBeNull();
  });

  it("does not submit an empty value", async () => {
    const submit = vi.fn();
    useUi.setState({
      prompt: { titleKey: "t", labelKey: "l", initial: "", submit },
    });
    render(<Prompt />);

    fireEvent.click(screen.getByText("app.save"));
    await flush();

    expect(submit).not.toHaveBeenCalled();
  });

  // The card description (ADR-0013): the same dialog with a textarea, where
  // Enter is a line break, the chord submits, and an emptied field is how
  // the text is cleared rather than a slip to swallow.
  describe("as a textarea", () => {
    const multilineRequest = (submit: (value: string) => void | Promise<void>, initial = "") => ({
      titleKey: "board.editDescription",
      labelKey: "board.cardDescriptionLabel",
      initial,
      multiline: true,
      submit,
    });

    it("renders a textarea in the field, its label marked optional", () => {
      useUi.setState({ prompt: multilineRequest(vi.fn()) });
      render(<Prompt />);

      const field = screen.getByRole("textbox");
      expect(field.tagName).toBe("TEXTAREA");
      expect(field.parentElement?.className).toBe("sb-field__control");
      const label = document.querySelector(`label[for="${field.id}"]`)!;
      expect(label.textContent).toBe("board.cardDescriptionLabel app.optional");
      expect(label.querySelector(".sb-optional")?.textContent).toBe("app.optional");
    });

    it("does not submit on Enter", async () => {
      const submit = vi.fn();
      useUi.setState({ prompt: multilineRequest(submit) });
      render(<Prompt />);

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "line" } });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      await flush();

      expect(submit).not.toHaveBeenCalled();
      expect(useUi.getState().prompt).not.toBeNull();
    });

    it("submits the value on Cmd+Enter", async () => {
      const submit = vi.fn().mockResolvedValue(undefined);
      useUi.setState({ prompt: multilineRequest(submit) });
      render(<Prompt />);

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "one\ntwo " } });
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", metaKey: true });
      await flush();

      expect(submit).toHaveBeenCalledWith("one\ntwo");
      expect(useUi.getState().prompt).toBeNull();
    });

    it("closes on Escape without submitting", async () => {
      const submit = vi.fn();
      useUi.setState({ prompt: multilineRequest(submit) });
      render(<Prompt />);

      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
      await flush();

      expect(submit).not.toHaveBeenCalled();
      expect(useUi.getState().prompt).toBeNull();
    });

    it("submits an emptied field, because that is how the text is cleared", async () => {
      const submit = vi.fn().mockResolvedValue(undefined);
      useUi.setState({ prompt: multilineRequest(submit, "old text") });
      render(<Prompt />);

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
      fireEvent.click(screen.getByText("app.save"));
      await flush();

      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith("");
    });

    it("leaves the one-line dialog closing silently on an empty value", async () => {
      const submit = vi.fn();
      useUi.setState({
        prompt: { titleKey: "t", labelKey: "l", initial: "", submit },
      });
      render(<Prompt />);

      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      await flush();

      expect(submit).not.toHaveBeenCalled();
      expect(useUi.getState().prompt).toBeNull();
    });
  });

  describe("as a confirmation", () => {
    const confirmRequest = (submit: () => void | Promise<void>) => ({
      titleKey: "app.confirmTrash.title",
      titleValues: { name: "Note.md" },
      confirm: {
        bodyKey: "app.confirmTrash.body",
        confirmKey: "app.confirmTrash.confirm",
      },
      submit,
    });

    it("asks with its title, says the consequence and has no field", () => {
      useUi.setState({ prompt: confirmRequest(vi.fn()) });
      render(<Prompt />);

      expect(screen.queryByRole("textbox")).toBeNull();
      const text = document.getElementById(dialog().getAttribute("aria-describedby")!)!;
      expect(text.className).toBe("sb-dialog__text");
      expect(text.textContent).toBe("app.confirmTrash.body");
    });

    // AKT-08, spec/02 §4.6: „Abbrechen“ first and with the initial focus;
    // the verb last as the danger action with the cut (AKT-07), without the
    // trash, which is the trigger's (spec/02 §1.4, sebaro D108 NV-Y8).
    it("puts Cancel first with the focus and the danger verb last", () => {
      useUi.setState({ prompt: confirmRequest(vi.fn()) });
      render(<Prompt />);

      const buttons = [...dialog().querySelectorAll("button")];
      expect(buttons.map((b) => b.textContent)).toEqual(["app.cancel", "app.confirmTrash.confirm"]);
      expect(document.activeElement).toBe(buttons[0]);
      expect(buttons[0]!.className).toBe("sb-secondary-action");
      expect(buttons[1]!.className).toBe("sb-danger-action sb-danger-action--outlined");
      expect(buttons[1]!.querySelector("svg")).toBeNull();
    });

    it("runs the action on confirm", async () => {
      const submit = vi.fn().mockResolvedValue(undefined);
      useUi.setState({ prompt: confirmRequest(submit) });
      render(<Prompt />);

      fireEvent.click(screen.getByText("app.confirmTrash.confirm"));
      await flush();

      expect(submit).toHaveBeenCalledWith("");
      expect(useUi.getState().prompt).toBeNull();
    });

    it("does nothing on cancel or Escape", async () => {
      const submit = vi.fn();
      useUi.setState({ prompt: confirmRequest(submit) });
      const { unmount } = render(<Prompt />);

      fireEvent.click(screen.getByText("app.cancel"));
      await flush();
      expect(useUi.getState().prompt).toBeNull();
      unmount();

      useUi.setState({ prompt: confirmRequest(submit) });
      render(<Prompt />);
      fireEvent.keyDown(screen.getByText("app.cancel"), { key: "Escape" });
      await flush();

      expect(submit).not.toHaveBeenCalled();
      expect(useUi.getState().prompt).toBeNull();
    });

    it("reports a failing confirmation in the action zone", async () => {
      const boom = new Error("read only");
      useUi.setState({ prompt: confirmRequest(() => Promise.reject(boom)) });
      render(<Prompt />);

      fireEvent.click(screen.getByText("app.confirmTrash.confirm"));
      await flush();

      expect(useUi.getState().message).toEqual({
        key: "errors.internal",
        values: { detail: String(boom) },
      });
    });
  });
});
