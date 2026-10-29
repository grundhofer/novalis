import { describe, expect, it, vi } from "vitest";

import { commands, unwrap, type SettingsDto, type UiStateDto } from "../ipc/client";
import tokens from "../sebaro/tokens.css?raw";
import { clampSidebarWidth, report, SIDEBAR_WIDTH, sidebarShown, useUi, watchSystemAppearance } from "./ui";

vi.mock("../ipc/client", () => ({
  commands: {},
  unwrap: vi.fn(),
  errorKey: () => "errors.io",
  errorValues: () => ({ detail: "EACCES" }),
}));
vi.mock("../i18n", () => ({ setLocale: vi.fn().mockResolvedValue(undefined) }));

const settings = {
  language: "en",
  appearance: "light",
  tone: "cool",
  editor: { fontSize: 16 },
  spellcheck: true,
  reduceMotion: false,
} as unknown as SettingsDto;

// sebaro D100 (ADR-0051): 240 px to start, 200–360 px. A width saved under
// the old 180–480 px range comes back inside the new one.
describe("the sidebar's width", () => {
  it("is clamped to 200–360 px in whole px", () => {
    expect(clampSidebarWidth(180)).toBe(200);
    expect(clampSidebarWidth(480)).toBe(360);
    expect(clampSidebarWidth(263.6)).toBe(264);
    useUi.getState().setSidebarWidth(999);
    expect(useUi.getState().sidebarWidth).toBe(360);
  });

  it("starts at 240 px and brings an old saved width into range", () => {
    useUi.getState().hydrate(settings, {} as UiStateDto, "en");
    expect(useUi.getState().sidebarWidth).toBe(240);
    useUi.getState().hydrate(settings, { sidebarWidth: 480 } as UiStateDto, "en");
    expect(useUi.getState().sidebarWidth).toBe(360);
    useUi.getState().hydrate(settings, { sidebarWidth: 256 } as UiStateDto, "en");
    expect(useUi.getState().sidebarWidth).toBe(256);
  });

  // The numbers are sebaro's pane tokens (spec/02 §4.23), kept once in TS.
  it("is sebaro's pane tokens", () => {
    const token = (name: string) => tokens.match(new RegExp(`--sb-x-sebaro-pane-${name}: (\\d+)px;`))?.[1];
    expect(SIDEBAR_WIDTH).toEqual({
      min: Number(token("sidebar-min")),
      start: Number(token("sidebar")),
      max: Number(token("sidebar-max")),
    });
  });
});

// spec/02 §4.17, DSK-04: in a window too narrow for it the sidebar is an
// overlay over the content, closed by every narrowing; the choice beside
// the content (state.json) is kept for when there is room again.
describe("the sidebar over a narrow window", () => {
  it("toggles its overlay there and the choice beside the content elsewhere", () => {
    useUi.setState({ sidebarVisible: true, sidebarOverlay: false, sidebarOverlayOpen: false });
    useUi.getState().setSidebarOverlay(true);
    expect(sidebarShown(useUi.getState())).toBe(false);
    useUi.getState().toggleSidebar();
    expect(useUi.getState()).toMatchObject({ sidebarVisible: true, sidebarOverlayOpen: true });
    expect(sidebarShown(useUi.getState())).toBe(true);
    // Wide enough again: the overlay is gone, the choice shows.
    useUi.getState().setSidebarOverlay(false);
    expect(useUi.getState().sidebarOverlayOpen).toBe(false);
    expect(sidebarShown(useUi.getState())).toBe(true);
    useUi.getState().toggleSidebar();
    expect(useUi.getState()).toMatchObject({ sidebarVisible: false, sidebarOverlayOpen: false });
    // Opening an overlay needs one: beside the content there is none.
    useUi.getState().setSidebarOverlayOpen(true);
    expect(useUi.getState().sidebarOverlayOpen).toBe(false);
    useUi.setState({ sidebarVisible: true });
  });
});

// sebaro's „Farbton“ (FAR-15, ADR-0051): warm stamps `data-sb-tone`, cool
// removes it, and the choice goes to settings.json alone.
describe("the tone", () => {
  const root = document.documentElement;

  it("stamps data-sb-tone only when warm", () => {
    useUi.getState().hydrate({ ...settings, tone: "warm" }, {} as UiStateDto, "en");
    expect(root.getAttribute("data-sb-tone")).toBe("warm");
    useUi.getState().hydrate(settings, {} as UiStateDto, "en");
    expect(root.hasAttribute("data-sb-tone")).toBe(false);
  });

  it("is set through settings_set with only the tone in the patch", async () => {
    const settingsSet = vi.fn().mockReturnValue("pending");
    Object.assign(commands, { settingsSet });
    vi.mocked(unwrap).mockResolvedValueOnce({ ...settings, tone: "warm" } as never);
    await useUi.getState().setTone("warm");
    expect(settingsSet).toHaveBeenCalledWith({
      language: null,
      appearance: null,
      tone: "warm",
      fontSize: null,
      spellcheck: null,
      reduceMotion: null,
    });
    expect(root.getAttribute("data-sb-tone")).toBe("warm");
    expect(useUi.getState().settings?.tone).toBe("warm");

    vi.mocked(unwrap).mockResolvedValueOnce(settings as never);
    await useUi.getState().setTone("cool");
    expect(root.hasAttribute("data-sb-tone")).toBe(false);
  });
});

// ADR-0051 #22: settings.json is the one store for the look. The UI keeps
// `data-theme` resolved because the preview's diagrams redraw only when
// that attribute changes (sebaro's tokens follow the media query
// themselves) and stamps sebaro's motion
// attribute; it keeps no copy of its own in localStorage.
describe("the appearance and motion attributes", () => {
  const root = document.documentElement;

  it("stamps data-theme from the setting, system through the media query", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    useUi.getState().hydrate({ ...settings, appearance: "dark" }, {} as UiStateDto, "en");
    expect(root.getAttribute("data-theme")).toBe("dark");
    useUi.getState().hydrate({ ...settings, appearance: "light" }, {} as UiStateDto, "en");
    expect(root.getAttribute("data-theme")).toBe("light");
    useUi.getState().hydrate({ ...settings, appearance: "system" }, {} as UiStateDto, "en");
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(root.getAttribute("data-theme")).toBe("dark");
    expect(setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // The shell sets the window's own mode, which the media query follows: a
  // light Mac set to Dark still reports dark until settings_set answers.
  it("reads the system mode again once the shell has answered", async () => {
    const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(media));
    const unwatch = watchSystemAppearance();
    useUi.getState().hydrate({ ...settings, appearance: "dark" }, {} as UiStateDto, "en");
    let answer: (value: SettingsDto) => void = () => undefined;
    Object.assign(commands, { settingsSet: vi.fn().mockReturnValue("pending") });
    vi.mocked(unwrap).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)) as never);

    const switching = useUi.getState().setAppearance("system");
    expect(root.getAttribute("data-theme")).toBe("dark");
    // The window is no longer forced dark: the media query flips before the
    // answer arrives, while the store still holds `dark`.
    media.matches = false;
    const onChange = media.addEventListener.mock.calls[0]![1] as () => void;
    onChange();
    expect(root.getAttribute("data-theme")).toBe("dark");
    answer({ ...settings, appearance: "system" });
    await switching;
    expect(root.getAttribute("data-theme")).toBe("light");

    unwatch();
    vi.unstubAllGlobals();
  });

  it("stamps data-sb-motion=reduce, never the old data-motion", async () => {
    useUi.getState().hydrate({ ...settings, reduceMotion: true }, {} as UiStateDto, "en");
    expect(root.getAttribute("data-sb-motion")).toBe("reduce");
    expect(root.hasAttribute("data-motion")).toBe(false);

    const settingsSet = vi.fn().mockReturnValue("pending");
    Object.assign(commands, { settingsSet });
    vi.mocked(unwrap).mockResolvedValueOnce(settings as never);
    await useUi.getState().setReduceMotion(false);
    expect(root.hasAttribute("data-sb-motion")).toBe(false);
    expect(settingsSet).toHaveBeenCalledWith({
      language: null,
      appearance: null,
      tone: null,
      fontSize: null,
      spellcheck: null,
      reduceMotion: false,
    });
  });
});

// spec/01 §1.8.2, spec/09 §17, D99 (1): the setting is stored in px and
// written as sebaro's rem step, so the writing area grows with the root size.
describe("the editor's text size", () => {
  it("writes editor.fontSize as rem", () => {
    useUi.getState().hydrate({ ...settings, editor: { fontSize: 18 } } as SettingsDto, {} as UiStateDto, "en");
    expect(document.documentElement.style.getPropertyValue("--sb-x-sebaro-editor-size")).toBe("1.125rem");
    useUi.getState().hydrate(settings, {} as UiStateDto, "en");
    expect(document.documentElement.style.getPropertyValue("--sb-x-sebaro-editor-size")).toBe("1rem");
  });
});

// ADR-0051 (EBE-05, D78): a failure is never a toast; it goes to the action
// zone, and the toast is left for reversible results.
describe("report", () => {
  it("puts the failure in the action zone, not in a toast", () => {
    useUi.setState({ toast: null, message: null });
    report(new Error("EACCES"));
    expect(useUi.getState().message).toEqual({ key: "errors.io", values: { detail: "EACCES" } });
    expect(useUi.getState().toast).toBeNull();
  });

  it("leaves a toast that shows alone, and is ended by clearMessage", () => {
    useUi.setState({ toast: null, message: null });
    useUi.getState().showToast("board.cardAdded", { board: "Plan" });
    report(new Error("EACCES"));
    expect(useUi.getState().toast).toEqual({ key: "board.cardAdded", values: { board: "Plan" } });
    useUi.getState().clearMessage();
    expect(useUi.getState().message).toBeNull();
    expect(useUi.getState().toast).not.toBeNull();
  });
});
