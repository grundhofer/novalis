import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../stores/ui";
import { afterDialog, moveArea, trackAreaFocus } from "./areas";

vi.mock("../ipc/client", () => ({ commands: {}, unwrap: vi.fn() }));

// F6 / ⇧F6 (sebaro spec/02 §4.20, DSK-09, ADR-0051): title bar, sidebar,
// content, backlinks and action zone, round; each area gives back its last
// focus.
describe("moving through the areas", () => {
  let untrack: () => void;

  beforeEach(() => {
    // jsdom focuses a contenteditable only with a tabindex; `-1` keeps it out
    // of the controls by that attribute, so it counts as the editor's text.
    document.body.innerHTML = `
      <div class="sb-window">
        <header class="sb-window__titlebar"><span>Vault</span></header>
        <div class="body">
          <nav class="sb-side-nav sb-window__sidebar" id="sidebar"><button id="new-note">New</button><div id="tree" role="tree" tabindex="0"></div></nav>
          <main class="main"><button id="preview" disabled>Preview</button><div id="text" contenteditable="true" tabindex="-1"></div></main>
        </div>
        <div class="sb-bottom-block"><div class="sb-primary-action-bar"><button id="primary">New Note</button></div></div>
      </div>
      <input id="outside" />`;
    useUi.setState({ overlay: { kind: "none" }, prompt: null });
    untrack = trackAreaFocus();
  });

  afterEach(() => {
    untrack();
    document.body.innerHTML = "";
  });

  const focused = () => document.activeElement;
  const byId = (id: string) => document.getElementById(id)!;

  it("goes round the four areas forward and back, first control first", () => {
    byId("outside").focus();
    moveArea(false);
    // This title bar has nothing to press: it takes focus itself.
    const titlebar = document.querySelector("header.sb-window__titlebar")!;
    expect(focused()).toBe(titlebar);
    expect(titlebar.getAttribute("tabindex")).toBe("-1");
    moveArea(false);
    expect(focused()).toBe(byId("new-note"));
    moveArea(false);
    // A disabled button is no control; the editor's text is one.
    expect(focused()).toBe(byId("text"));
    moveArea(false);
    expect(focused()).toBe(byId("primary"));
    moveArea(false);
    expect(focused()).toBe(titlebar);
    moveArea(true);
    expect(focused()).toBe(byId("primary"));
    moveArea(true);
    expect(focused()).toBe(byId("text"));
  });

  // ADR-0051 #1: the settings view is the content area while it shows; the
  // content it covers and the action zone, hidden then, are skipped.
  it("takes the settings view as the content area", () => {
    const doc = document.querySelector("main.main")!;
    doc.setAttribute("hidden", "");
    doc.insertAdjacentHTML(
      "beforebegin",
      `<main class="main sb-window__content" tabindex="-1"><input type="radio" id="mode" /></main>`,
    );
    document.querySelector(".sb-bottom-block")!.setAttribute("hidden", "");
    byId("new-note").focus();
    moveArea(false);
    expect(focused()).toBe(byId("mode"));
    moveArea(false);
    expect(focused()).toBe(document.querySelector("header.sb-window__titlebar"));
    moveArea(true);
    expect(focused()).toBe(byId("mode"));
  });

  // The backlinks under the editor stand where the inspector would
  // (ADR-0051 #8): a named region inside the content, an area of its own
  // between the content and the action zone.
  it("takes the backlinks as an area of their own after the content", () => {
    document.querySelector("main.main")!.insertAdjacentHTML(
      "beforeend",
      `<section class="backlinks" aria-label="Backlinks"><ul><li><button id="link">a</button></li></ul></section>`,
    );
    byId("new-note").focus();
    moveArea(false);
    expect(focused()).toBe(byId("text"));
    moveArea(false);
    expect(focused()).toBe(byId("link"));
    moveArea(false);
    expect(focused()).toBe(byId("primary"));
    moveArea(true);
    expect(focused()).toBe(byId("link"));
    // Focus in the backlinks is theirs, not the content's: the content gives
    // back its own last focus.
    moveArea(true);
    expect(focused()).toBe(byId("text"));
  });

  it("enters backlinks with no row to press on the region itself", () => {
    document.querySelector("main.main")!.innerHTML = `
      <div id="text" contenteditable="true" tabindex="-1"></div>
      <section class="backlinks" aria-label="Backlinks"><p>None</p></section>`;
    byId("text").focus();
    moveArea(false);
    const region = document.querySelector("section.backlinks")!;
    expect(focused()).toBe(region);
    expect(region.getAttribute("tabindex")).toBe("-1");
  });

  // Each kind of content is the one content area: its first control, or the
  // current tab of the strip above it.
  it.each([
    ["the board", `<div class="sb-board"><button id="first">Mehr</button></div>`],
    ["a viewer", `<div class="viewer-bar"><button id="first">Inhalt</button></div><div class="viewer-body"></div>`],
    ["a preview", `<div class="preview" tabindex="0" id="first"></div>`],
  ])("takes %s as the content", (_, html) => {
    document.querySelector("main.main")!.innerHTML = html;
    byId("new-note").focus();
    moveArea(false);
    expect(focused()).toBe(byId("first"));
    moveArea(false);
    expect(focused()).toBe(byId("primary"));
  });

  // spec/02 §4.17, §4.20: the sidebar's overlay over a narrow window is the
  // sidebar area while it is open; closed, it is skipped.
  it("takes the open overlay as the sidebar, and skips it closed", () => {
    const sidebar = byId("sidebar");
    sidebar.style.position = "absolute";
    sidebar.hidden = true;
    byId("text").focus();
    moveArea(true);
    expect(focused()).toBe(document.querySelector("header.sb-window__titlebar"));
    sidebar.hidden = false;
    moveArea(false);
    expect(focused()).toBe(byId("new-note"));
  });

  it("gives the title bar's focus to its sidebar tool, as the real bar has one", () => {
    document.querySelector("header.sb-window__titlebar")!.innerHTML = `
      <p class="sb-window__name">novalis</p>
      <div class="sb-window__tools" role="group">
        <button id="tool" class="sb-icon-button sb-icon-button--compact" type="button">Sidebar</button>
      </div>`;
    byId("primary").focus();
    moveArea(false);
    expect(focused()).toBe(byId("tool"));
    moveArea(true);
    expect(focused()).toBe(byId("primary"));
  });

  it("gives each area back the element that had focus there last", () => {
    byId("tree").focus();
    moveArea(false);
    expect(focused()).toBe(byId("text"));
    moveArea(true);
    expect(focused()).toBe(byId("tree"));
  });

  it("skips the sidebar while it is hidden", () => {
    byId("sidebar").remove();
    byId("primary").focus();
    moveArea(false);
    moveArea(false);
    expect(focused()).toBe(byId("text"));
    moveArea(true);
    moveArea(true);
    expect(focused()).toBe(byId("primary"));
  });

  it("starts from the area focus was in before, from outside every area", () => {
    // The palette's input is in no area; it has closed when its command runs.
    byId("text").focus();
    byId("outside").focus();
    moveArea(false);
    expect(focused()).toBe(byId("primary"));
  });

  // The document tabs are one tab stop (spec/02 §4.21): the content is
  // entered on the current tab, not on the first one.
  it("enters the content on the current tab of a tab list", () => {
    document.querySelector("main.main")!.innerHTML = `
      <div class="sb-doc-tabs" role="tablist">
        <span class="sb-doc-tabs__item" role="presentation"><button id="tab-1" role="tab" tabindex="-1">a</button></span>
        <span class="sb-doc-tabs__item" role="presentation"><button id="tab-2" role="tab" tabindex="0">b</button></span>
      </div>
      <div id="text" contenteditable="true" tabindex="-1"></div>`;
    byId("new-note").focus();
    moveArea(false);
    expect(focused()).toBe(byId("tab-2"));
  });

  it("does nothing while an overlay or a dialog has the keyboard", () => {
    byId("text").focus();
    useUi.setState({ overlay: { kind: "palette" } });
    moveArea(false);
    expect(focused()).toBe(byId("text"));
    useUi.setState({ overlay: { kind: "none" }, prompt: { titleKey: "x", submit: () => undefined } });
    moveArea(false);
    expect(focused()).toBe(byId("text"));
  });
});

// spec/02 §4.6, ZUG-06: the modal dialog makes the page inert, so a focus
// request made while it is open waits for its `close`.
describe("focus asked for while a dialog is open", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is taken at once without a dialog", () => {
    const take = vi.fn();
    afterDialog(take);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("waits for the dialog to close, and again for a question asked meanwhile", () => {
    document.body.innerHTML = `<dialog class="sb-dialog" open></dialog>`;
    const dialog = document.querySelector("dialog")!;
    const take = vi.fn();
    afterDialog(take);
    expect(take).not.toHaveBeenCalled();

    // Closed and opened again for the next question before `close` arrived.
    dialog.dispatchEvent(new Event("close"));
    expect(take).not.toHaveBeenCalled();

    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
    expect(take).toHaveBeenCalledTimes(1);
  });
});
