import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commands, type SettingsDto, type SettingsPatchDto } from "../ipc/client";
import { chordOf, commandForChord } from "../lib/keymap";
import { openSettingsView } from "../lib/settingsView";
import { useUi } from "../stores/ui";
import SettingsView from "./SettingsView";

// The key, with a `{{size}}` appended so the font sizes tell apart.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { size?: number }) => (values?.size !== undefined ? `${key}:${values.size}` : key),
  }),
}));
// The shell answers `settings_set` with the settings it wrote: the patch on
// top of the current ones, the font size clamped as dto.rs does.
vi.mock("../ipc/client", () => ({
  commands: { settingsSet: vi.fn() },
  unwrap: vi.fn(async (value: unknown) => value),
  NovalisError: class extends Error {},
  errorKey: () => "errors.io",
  errorValues: () => ({}),
}));
vi.mock("../i18n", () => ({ setLocale: vi.fn().mockResolvedValue(undefined) }));

const SETTINGS: SettingsDto = {
  version: 1,
  language: "system",
  appearance: "system",
  tone: "cool",
  editor: { fontSize: 16 },
  spellcheck: true,
  reduceMotion: false,
  lastVault: null,
} as SettingsDto;

const settingsSet = vi.mocked(commands.settingsSet);

beforeEach(() => {
  settingsSet.mockReset();
  settingsSet.mockImplementation(async (patch: SettingsPatchDto) => {
    const now = useUi.getState().settings ?? SETTINGS;
    return {
      ...now,
      language: patch.language ?? now.language,
      appearance: patch.appearance ?? now.appearance,
      tone: patch.tone ?? now.tone,
      editor: { fontSize: patch.fontSize === null ? now.editor.fontSize : Math.min(32, Math.max(9, patch.fontSize)) },
      spellcheck: patch.spellcheck ?? now.spellcheck,
      reduceMotion: patch.reduceMotion ?? now.reduceMotion,
    } as never;
  });
  useUi.setState({ settings: SETTINGS, settingsView: true, overlay: { kind: "none" }, prompt: null });
  delete document.documentElement.dataset.sbTone;
  delete document.documentElement.dataset.sbMotion;
});

/** The text an element's `aria-describedby` points at. */
function description(element: Element): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// DSK-02, spec/02 §4.24 (the slim form of D102 (7)), ADR-0051 #1, #27.20.
describe("SettingsView", () => {
  it("is the content area, named by its heading, with one group named by its own", () => {
    render(<SettingsView />);
    const main = screen.getByRole("main", { name: "sidebar.settings" });
    expect(main.className).toBe("main sb-window__content");
    expect(main.querySelector("h2.sb-window__heading")?.textContent).toBe("sidebar.settings");
    expect(main.querySelector("p.sb-window__meta")?.textContent).toBe("settingsView.meta");
    // One group, a form named by its heading (spec/02 §4.24); no action zone,
    // no area sidebar, no submit.
    const forms = main.querySelectorAll("form.sb-window__settings-group");
    expect(forms).toHaveLength(1);
    expect(screen.getByRole("form", { name: "settingsView.general" })).toBe(forms[0]);
    expect(main.querySelector("nav, .sb-bottom-block, [type='submit']")).toBeNull();
  });

  it("holds exactly the six settings, each labelled and with its help sentence", () => {
    render(<SettingsView />);

    const appearance = screen.getByRole("group", { name: "menu.view.appearance" });
    expect(appearance.className).toBe("sb-choice-row");
    expect(description(appearance)).toBe("settingsView.help.appearance");
    const modes = [...appearance.querySelectorAll<HTMLInputElement>("label.sb-radio > input[type=radio]")];
    expect(modes.map((radio) => radio.dataset.sbThemeChoice)).toEqual(["system", "light", "dark"]);
    expect(screen.getByRole("radio", { name: "settings.appearance.system" })).toHaveProperty("checked", true);

    const tone = screen.getByRole("group", { name: "menu.view.tone" });
    expect(tone.className).toBe("sb-choice-row");
    expect(tone.hasAttribute("data-sb-tone-choice")).toBe(true);
    expect(tone.hasAttribute("hidden")).toBe(false);
    expect(description(tone)).toBe("settingsView.help.tone");
    expect(screen.getByRole("radio", { name: "settings.tone.cool" })).toHaveProperty("checked", true);

    const language = screen.getByRole("combobox", { name: "menu.view.language" });
    expect(language.closest(".sb-field__control")?.className).toBe("sb-field__control sb-select");
    expect(language.parentElement?.querySelector("use")?.getAttribute("href")).toBe("#chevron-down");
    expect(description(language)).toBe("settingsView.help.language");
    expect([...(language as HTMLSelectElement).options].map((o) => [o.value, o.lang])).toEqual([
      ["system", ""],
      ["de", "de"],
      ["en", "en"],
    ]);

    const font = screen.getByRole("combobox", { name: "settingsView.fontSize" }) as HTMLSelectElement;
    expect(description(font)).toBe("settingsView.help.fontSize");
    // Every size the shell keeps, 9–32 px.
    expect([...font.options].map((o) => Number(o.value))).toEqual(Array.from({ length: 24 }, (_, i) => 9 + i));
    expect(font.value).toBe("16");
    expect(font.selectedOptions[0]?.textContent).toBe("settingsView.fontSizeValue:16");

    const spelling = screen.getByRole("switch", { name: "settingsView.spellcheck" });
    expect(spelling.className).toBe("sb-switch");
    expect(spelling.closest(".sb-switch-row")).toBeTruthy();
    // Row and help sentence as sebaro's switch field (spec/02 §2.6, D108).
    const field = spelling.closest(".sb-switch-row")!.parentElement!;
    expect(field.className).toBe("sb-switch-field");
    expect(field.lastElementChild?.matches("p.sb-field__help")).toBe(true);
    expect(spelling.getAttribute("aria-checked")).toBe("true");
    expect(description(spelling)).toBe("settingsView.help.spellcheck");

    const motion = screen.getByRole("switch", { name: "menu.view.reduceMotion" });
    expect(motion.getAttribute("aria-checked")).toBe("false");
    expect(motion.hasAttribute("data-sb-motion-setting")).toBe(true);
    expect(description(motion)).toBe("settingsView.help.reduceMotion");

    // Six controls and nothing else to change.
    const form = screen.getByRole("form");
    expect(form.querySelectorAll("fieldset, select, [role=switch]")).toHaveLength(6);
    expect(form.querySelectorAll(".sb-field__help")).toHaveLength(6);
  });

  it("applies every choice at once through settings_set, as the menu does", async () => {
    render(<SettingsView />);
    const root = document.documentElement;

    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "settings.appearance.dark" })));
    expect(settingsSet).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: "dark", tone: null }));
    expect(root.dataset.theme).toBe("dark");
    expect(screen.getByRole("radio", { name: "settings.appearance.dark" })).toHaveProperty("checked", true);

    await act(async () => fireEvent.click(screen.getByRole("radio", { name: "settings.tone.warm" })));
    expect(settingsSet).toHaveBeenLastCalledWith(expect.objectContaining({ tone: "warm" }));
    expect(root.dataset.sbTone).toBe("warm");

    await act(async () =>
      fireEvent.change(screen.getByRole("combobox", { name: "menu.view.language" }), { target: { value: "de" } }),
    );
    expect(settingsSet).toHaveBeenLastCalledWith(expect.objectContaining({ language: "de" }));
    expect(useUi.getState().settings?.language).toBe("de");

    await act(async () =>
      fireEvent.change(screen.getByRole("combobox", { name: "settingsView.fontSize" }), { target: { value: "20" } }),
    );
    expect(settingsSet).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 20 }));
    expect(root.style.getPropertyValue("--sb-x-sebaro-editor-size")).toBe("1.25rem");
    expect((screen.getByRole("combobox", { name: "settingsView.fontSize" }) as HTMLSelectElement).value).toBe("20");

    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "settingsView.spellcheck" })));
    expect(settingsSet).toHaveBeenLastCalledWith(expect.objectContaining({ spellcheck: false }));
    expect(screen.getByRole("switch", { name: "settingsView.spellcheck" }).getAttribute("aria-checked")).toBe("false");

    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "menu.view.reduceMotion" })));
    expect(settingsSet).toHaveBeenLastCalledWith(expect.objectContaining({ reduceMotion: true }));
    expect(root.dataset.sbMotion).toBe("reduce");
    expect(screen.getByRole("switch", { name: "menu.view.reduceMotion" }).getAttribute("aria-checked")).toBe("true");
  });

  it("shows a change made in the menu or the palette at once", () => {
    render(<SettingsView />);
    act(() => useUi.setState({ settings: { ...SETTINGS, appearance: "light", tone: "warm", spellcheck: false } }));
    expect(screen.getByRole("radio", { name: "settings.appearance.light" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "settings.tone.warm" })).toHaveProperty("checked", true);
    expect(screen.getByRole("switch", { name: "settingsView.spellcheck" }).getAttribute("aria-checked")).toBe("false");
  });

  it("says a failed change in the action zone, not in silence", async () => {
    settingsSet.mockRejectedValueOnce(new Error("EACCES"));
    useUi.setState({ message: null });
    render(<SettingsView />);
    await act(async () => fireEvent.click(screen.getByRole("switch", { name: "menu.view.reduceMotion" })));
    expect(useUi.getState().message?.key).toBe("errors.io");
  });
});

// ZUG-06, DSK-02: the view takes the focus, and Escape, ⌘W or „Zurück zu
// <Ort>“ give it back to where it was.
describe("the way in and out", () => {
  function Window() {
    const open = useUi((s) => s.settingsView);
    return (
      <>
        <button type="button">opener</button>
        {open && <SettingsView />}
      </>
    );
  }

  it("opens on ⌘,", () => {
    const chord = chordOf(new KeyboardEvent("keydown", { code: "Comma", key: ",", metaKey: true }));
    expect(chord).toBe("Cmd+,");
    expect(commandForChord(chord!)).toEqual({ chord: "Cmd+,", command: "settings.open", scope: "global" });
  });

  it("takes the focus, and Escape leaves for the place before with the focus back", async () => {
    useUi.setState({ settingsView: false });
    render(<Window />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    act(() => openSettingsView());
    const main = screen.getByRole("main");
    expect(document.activeElement).toBe(main);
    expect(main.tabIndex).toBe(-1);

    // Escape on a radio is the view's, not the radio's.
    const radio = screen.getByRole("radio", { name: "settings.tone.cool" });
    radio.focus();
    act(() => {
      fireEvent.keyDown(radio, { key: "Escape" });
    });
    expect(useUi.getState().settingsView).toBe(false);
    expect(screen.queryByRole("main")).toBeNull();
    await act(frame);
    expect(document.activeElement).toBe(opener);
  });

  it("leaves Escape to an overlay or a dialog over it", () => {
    render(<SettingsView />);
    act(() => useUi.setState({ overlay: { kind: "palette" } }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUi.getState().settingsView).toBe(true);

    act(() => useUi.setState({ overlay: { kind: "none" }, prompt: { titleKey: "x", submit: () => undefined } }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUi.getState().settingsView).toBe(true);

    act(() => useUi.setState({ prompt: null }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUi.getState().settingsView).toBe(false);
  });

  it("gives way to a board that comes into view, without taking the focus back", () => {
    render(<SettingsView />);
    act(() => useUi.getState().toggleBoard());
    expect(useUi.getState()).toMatchObject({ settingsView: false, boardVisible: true });
    act(() => useUi.setState({ settingsView: true, boardVisible: false }));
    act(() => useUi.getState().setActiveBoard("plan"));
    expect(useUi.getState()).toMatchObject({ settingsView: false, boardVisible: true, activeBoard: "plan" });
  });
});
