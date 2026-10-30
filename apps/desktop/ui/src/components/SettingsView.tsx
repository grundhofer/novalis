import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { AppearanceDto, LanguageDto, ToneDto } from "../ipc/client";
import { dispatchCommand } from "../lib/commands";
import { leaveSettingsView } from "../lib/settingsView";
import { DEFAULT_FONT_SIZE, FONT_SIZE, report, useUi } from "../stores/ui";
import Icon from "./Icon";

/**
 * The settings view (DSK-02, spec/02 §4.24 F10a and the slim form of D102
 * (7), ADR-0051 #1): exactly the six settings of docs/SETTINGS.md in the
 * content area of the main window, never a second window. Six are few, so it
 * is sebaro's slim form: the path „Einstellungen“, one group „Allgemein“
 * (`sb-window__settings-group`, a `<form>` named by its heading), no area
 * sidebar and no action zone, since every choice applies at once (D74).
 *
 * „Hell oder Dunkel“ and „Farbton“ are choice rows (`sb-choice-row`, spec/02
 * §2.5, DSK-05, FAR-15), „Sprache“ and „Schriftgröße“ selects (`sb-select`,
 * §2.3), „Rechtschreibung prüfen“ and „Bewegung immer reduzieren“ switches
 * (`sb-switch-row`, §2.6). Each has its one help sentence
 * (`sb-field__help`, by `aria-describedby`). A choice goes through the
 * command id the menu and the palette send, so all three apply it the same
 * way and live (`settings_set`); the font size, which the menu only steps,
 * through the store. The view reads the store, so a change from the menu or
 * the palette shows here at once.
 *
 * It takes the focus when it opens; Escape anywhere in it (not in a text
 * field, a menu or a dialog) leaves it for the place before, as „Zurück zu
 * <Ort>“ in the title bar and ⌘W do (lib/settingsView.ts).
 */

const APPEARANCES: readonly AppearanceDto[] = ["system", "light", "dark"];
const TONES: readonly ToneDto[] = ["cool", "warm"];
const LANGUAGES: readonly LanguageDto[] = ["system", "de", "en"];
/** Every size the shell keeps (`FONT_SIZE`): the ones ⌘+ and ⌘− reach. */
const FONT_SIZES = Array.from({ length: FONT_SIZE.max - FONT_SIZE.min + 1 }, (_, i) => FONT_SIZE.min + i);

/** Escape there belongs to the control: a text field, a menu, a dialog. */
const OWN_ESCAPE = "input:not([type='radio']):not([type='checkbox']), textarea, [contenteditable='true'], [role='menu'], dialog";

export default function SettingsView() {
  const { t } = useTranslation();
  const settings = useUi((s) => s.settings);
  const main = useRef<HTMLElement | null>(null);
  const id = useId();

  useEffect(() => {
    main.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const ui = useUi.getState();
      if (ui.overlay.kind !== "none" || ui.prompt) return;
      if (event.target instanceof Element && event.target.closest(OWN_ESCAPE)) return;
      event.preventDefault();
      leaveSettingsView();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const appearance = settings?.appearance ?? "system";
  const tone = settings?.tone ?? "cool";
  const language = settings?.language ?? "system";
  const fontSize = settings?.editor.fontSize ?? DEFAULT_FONT_SIZE;
  const spellcheck = settings?.spellcheck ?? true;
  const reduceMotion = settings?.reduceMotion ?? false;

  const setFontSize = (size: number) => {
    void useUi
      .getState()
      .changeFontSize(size - fontSize)
      .catch(report);
  };

  return (
    <main className="main sb-window__content" tabIndex={-1} ref={main} aria-labelledby={`${id}-title`}>
      <h2 className="sb-window__heading" id={`${id}-title`}>
        {t("sidebar.settings")}
      </h2>
      <p className="sb-window__meta">{t("settingsView.meta")}</p>
      <form
        className="sb-window__settings-group"
        aria-labelledby={`${id}-general`}
        onSubmit={(event) => event.preventDefault()}
      >
        <h3 id={`${id}-general`}>{t("settingsView.general")}</h3>

        <ChoiceRow
          id={`${id}-appearance`}
          legend={t("menu.view.appearance")}
          help={t("settingsView.help.appearance")}
        >
          {APPEARANCES.map((value) => (
            <label className="sb-radio" key={value}>
              <input
                type="radio"
                name={`${id}-appearance`}
                value={value}
                data-sb-theme-choice={value}
                checked={appearance === value}
                onChange={() => dispatchCommand(`settings.appearance.${value}`)}
              />
              <span>{t(`settings.appearance.${value}`)}</span>
            </label>
          ))}
        </ChoiceRow>

        <ChoiceRow id={`${id}-tone`} legend={t("menu.view.tone")} help={t("settingsView.help.tone")} tone>
          {TONES.map((value) => (
            <label className="sb-radio" key={value}>
              <input
                type="radio"
                name={`${id}-tone`}
                value={value}
                checked={tone === value}
                onChange={() => dispatchCommand(`settings.tone.${value}`)}
              />
              <span>{t(`settings.tone.${value}`)}</span>
            </label>
          ))}
        </ChoiceRow>

        <SelectField id={`${id}-language`} label={t("menu.view.language")} help={t("settingsView.help.language")}>
          <select
            id={`${id}-language`}
            value={language}
            aria-describedby={`${id}-language-help`}
            onChange={(event) => dispatchCommand(`settings.language.${event.target.value}`)}
          >
            {LANGUAGES.map((value) => (
              // The language's own name is said in that language.
              <option key={value} value={value} lang={value === "system" ? undefined : value}>
                {t(`settings.language.${value}`)}
              </option>
            ))}
          </select>
        </SelectField>

        <SelectField id={`${id}-font`} label={t("settingsView.fontSize")} help={t("settingsView.help.fontSize")}>
          <select
            id={`${id}-font`}
            value={fontSize}
            aria-describedby={`${id}-font-help`}
            onChange={(event) => setFontSize(Number(event.target.value))}
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {t("settingsView.fontSizeValue", { size })}
              </option>
            ))}
          </select>
        </SelectField>

        <SwitchRow
          id={`${id}-spellcheck`}
          label={t("settingsView.spellcheck")}
          help={t("settingsView.help.spellcheck")}
          on={spellcheck}
          onToggle={() => dispatchCommand("settings.spellcheck")}
        />

        <SwitchRow
          id={`${id}-motion`}
          label={t("menu.view.reduceMotion")}
          help={t("settingsView.help.reduceMotion")}
          on={reduceMotion}
          motion
          onToggle={() => dispatchCommand("settings.reduceMotion")}
        />
      </form>
    </main>
  );
}

/** A choice row (spec/02 §2.5): the legend, the radios in one wrapping row, the help. */
function ChoiceRow({
  id,
  legend,
  help,
  tone = false,
  children,
}: {
  id: string;
  legend: string;
  help: string;
  /** sebaro's mark of the tone choice (FAR-15, `data-sb-tone-choice`). */
  tone?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="sb-choice-row" aria-describedby={`${id}-help`} data-sb-tone-choice={tone ? "" : undefined}>
      <legend>{legend}</legend>
      <div className="sb-choice-row__options">{children}</div>
      <p className="sb-field__help" id={`${id}-help`}>
        {help}
      </p>
    </fieldset>
  );
}

/** A select (spec/02 §2.3, EIN-01, EIN-05): the label above, the native list with the chevron, the help. */
function SelectField({ id, label, help, children }: { id: string; label: string; help: string; children: ReactNode }) {
  return (
    <div className="sb-field">
      <label className="sb-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="sb-field__control sb-select">
        {children}
        <Icon name="chevron-down" size={24} />
      </div>
      <p className="sb-field__help" id={`${id}-help`}>
        {help}
      </p>
    </div>
  );
}

/** A switch row (spec/02 §2.6, EIN-03): the label, the switch, then the help. */
function SwitchRow({
  id,
  label,
  help,
  on,
  motion = false,
  onToggle,
}: {
  id: string;
  label: string;
  help: string;
  on: boolean;
  /** sebaro's mark of the motion setting (BEW-04, `data-sb-motion-setting`). */
  motion?: boolean;
  onToggle: () => void;
}) {
  // The row and its help sentence as one `sb-switch-field`: the sentence
  // 4 px under the row, inside its hairlines (spec/02 §2.6, sebaro D108).
  return (
    <div className="sb-switch-field">
      <div className="sb-switch-row">
        <span id={`${id}-label`}>{label}</span>
        <button
          className="sb-switch"
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help`}
          data-sb-motion-setting={motion ? "" : undefined}
          onClick={onToggle}
        >
          <span className="sb-switch__track" />
          <span className="sb-switch__thumb">
            <Icon name="check" />
          </span>
        </button>
      </div>
      <p className="sb-field__help" id={`${id}-help`}>
        {help}
      </p>
    </div>
  );
}
