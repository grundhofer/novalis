import { create } from "zustand";

import { setLocale } from "../i18n";
import {
  commands,
  unwrap,
  type AppearanceDto,
  type LanguageDto,
  type SettingsDto,
  type SettingsPatchDto,
  type UiStateDto,
} from "../ipc/client";

/**
 * Settings (the four of PLAN.md §4.1) plus the disposable window state.
 *
 * The settings live in `settings.json` and are written through `settings_set`,
 * which also rebuilds the native menu. Everything else — sidebar, board,
 * overlays — is `state.json` state and is saved debounced; it is deliberately
 * absent from `docs/SETTINGS.md`.
 */

export type Overlay =
  | { kind: "none" }
  | { kind: "quickOpen" }
  | { kind: "palette" }
  | { kind: "search" };

/**
 * A one-line question. The app has no preferences window and no modal stack:
 * this is the single dialog shape (new note, new folder, rename, board and
 * column names), always titled and placeheld from the catalog.
 *
 * With `confirm` set it asks instead of collecting: the input is replaced by a
 * line of explanation and `submit` is called with the empty string. That is
 * the same dialog rather than a second one, because a destructive action needs
 * a question, not a new modal stack.
 */
export interface PromptRequest {
  titleKey: string;
  /** Input dialogs only. */
  placeholderKey?: string;
  /** Input dialogs only. */
  initial?: string;
  confirm?: {
    bodyKey: string;
    values?: Record<string, string>;
    /** Catalog key for the confirming button, which names the action. */
    confirmKey: string;
  };
  submit: (value: string) => void | Promise<void>;
}

interface UiState {
  settings: SettingsDto | null;
  sidebarVisible: boolean;
  sidebarWidth: number;
  boardVisible: boolean;
  activeBoard: string | null;
  overlay: Overlay;
  prompt: PromptRequest | null;
  toast: { key: string; values: Record<string, string> } | null;

  hydrate: (settings: SettingsDto, state: UiStateDto, locale: string) => void;
  setOverlay: (overlay: Overlay) => void;
  ask: (request: PromptRequest) => void;
  closePrompt: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleBoard: () => void;
  setActiveBoard: (slug: string | null) => void;
  setAppearance: (appearance: AppearanceDto) => Promise<void>;
  setLanguage: (language: LanguageDto) => Promise<void>;
  setSpellcheck: (on: boolean) => Promise<void>;
  changeFontSize: (delta: number | "reset") => Promise<void>;
  showToast: (key: string, values?: Record<string, string>) => void;
  clearToast: () => void;
}

/** The default `editor.fontSize` (docs/SETTINGS.md). */
const DEFAULT_FONT_SIZE = 16;

/** The two locales the app has (PLAN.md §5.8); anything else falls back to en. */
function systemLocale(): string {
  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

/**
 * A settings patch with every field present. The Rust side takes
 * `Option<T>` per field, which the bindings spell `T | null` rather than
 * optional, so a partial change still names the three fields it leaves alone.
 */
function patch(change: Partial<Record<keyof SettingsPatchDto, never>> | SettingsPatchDto): SettingsPatchDto {
  return { language: null, appearance: null, fontSize: null, spellcheck: null, ...change };
}

function applyAppearance(appearance: AppearanceDto): void {
  const dark =
    appearance === "dark" ||
    (appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try {
    localStorage.setItem("novalis.appearance", appearance);
  } catch {
    // Private mode or a cleared store: the shell re-sends the setting at boot,
    // so the only cost is one frame in the wrong theme.
  }
}

function applyFontSize(size: number): void {
  document.documentElement.style.setProperty("--ds-font-size-editor", `${size}px`);
}

export const useUi = create<UiState>((set, get) => ({
  settings: null,
  sidebarVisible: true,
  sidebarWidth: 256,
  boardVisible: false,
  activeBoard: null,
  overlay: { kind: "none" },
  prompt: null,
  toast: null,

  hydrate: (settings, state, locale) => {
    applyAppearance(settings.appearance);
    applyFontSize(settings.editor.fontSize);
    void setLocale(locale);
    set({
      settings,
      sidebarVisible: state.sidebarVisible ?? true,
      sidebarWidth: state.sidebarWidth ?? 256,
      boardVisible: state.boardVisible ?? false,
      activeBoard: state.activeBoard ?? null,
    });
  },

  setOverlay: (overlay) => set({ overlay }),
  ask: (request) => set({ prompt: request }),
  closePrompt: () => set({ prompt: null }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.round(width) }),
  toggleBoard: () => set((s) => ({ boardVisible: !s.boardVisible })),
  setActiveBoard: (slug) => set({ activeBoard: slug, boardVisible: slug !== null }),

  setAppearance: async (appearance) => {
    applyAppearance(appearance);
    set({ settings: await unwrap(commands.settingsSet(patch({ appearance } as SettingsPatchDto))) });
  },

  setLanguage: async (language) => {
    const settings = await unwrap(commands.settingsSet(patch({ language } as SettingsPatchDto)));
    set({ settings });
    // `system` follows the OS, which the webview reports as `navigator.language`
    // — the same setting `sys_locale` reads for the native menu. Resolving it
    // here rather than calling `bootstrap()` again matters: bootstrap re-opens
    // the vault and restarts its watcher.
    await setLocale(language === "system" ? systemLocale() : language);
  },

  setSpellcheck: async (spellcheck) => {
    set({ settings: await unwrap(commands.settingsSet(patch({ spellcheck } as SettingsPatchDto))) });
  },

  changeFontSize: async (delta) => {
    const current = get().settings?.editor.fontSize ?? DEFAULT_FONT_SIZE;
    const next = delta === "reset" ? DEFAULT_FONT_SIZE : current + delta;
    applyFontSize(next);
    set({ settings: await unwrap(commands.settingsSet(patch({ fontSize: next } as SettingsPatchDto))) });
  },

  showToast: (key, values = {}) => set({ toast: { key, values } }),
  clearToast: () => set({ toast: null }),
}));

/** Follow the system theme while `appearance` is `system`. */
export function watchSystemAppearance(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    const appearance = useUi.getState().settings?.appearance ?? "system";
    if (appearance === "system") applyAppearance("system");
  };
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
