import { create } from "zustand";

import { setLocale } from "../i18n";
import {
  commands,
  errorKey,
  errorValues,
  unwrap,
  type AppearanceDto,
  type LanguageDto,
  type SettingsDto,
  type SettingsPatchDto,
  type TreeSortDto,
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
  | { kind: "settings" }
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
  /**
   * Input dialogs only: a textarea instead of the one-line field (the card
   * description, ADR-0013). `Cmd+Enter` submits, `Enter` is a newline, and an
   * empty value is submitted rather than swallowed, because emptying the
   * field is how the text is cleared.
   */
  multiline?: boolean;
  /** Input dialogs only: one muted line under the field. */
  hint?: { key: string; values?: Record<string, string | number> };
  confirm?: {
    bodyKey: string;
    /** Interpolation values. Numbers matter: i18next selects plurals on them. */
    values?: Record<string, string | number>;
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
  /** The tree's file order (ADR-0012); folders ignore it. `state.json` state. */
  treeSort: TreeSortDto;
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
  /** Hide the board pane so the editor shows; a no-op when it is hidden. */
  hideBoard: () => void;
  setActiveBoard: (slug: string | null) => void;
  setTreeSort: (sort: TreeSortDto) => void;
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
  treeSort: "name",
  overlay: { kind: "none" },
  prompt: null,
  toast: null,

  hydrate: (settings, state, locale) => {
    applyAppearance(settings.appearance);
    applyFontSize(settings.editor.fontSize);
    void setLocale(locale).catch(report);
    set({
      settings,
      sidebarVisible: state.sidebarVisible ?? true,
      sidebarWidth: state.sidebarWidth ?? 256,
      boardVisible: state.boardVisible ?? false,
      activeBoard: state.activeBoard ?? null,
      treeSort: state.treeSort ?? "name",
    });
  },

  setOverlay: (overlay) => set({ overlay }),
  ask: (request) => set({ prompt: request }),
  closePrompt: () => set({ prompt: null }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.round(width) }),
  toggleBoard: () => set((s) => ({ boardVisible: !s.boardVisible })),
  hideBoard: () => set((s) => (s.boardVisible ? { boardVisible: false } : s)),
  setActiveBoard: (slug) => set({ activeBoard: slug, boardVisible: slug !== null }),
  setTreeSort: (treeSort) => set({ treeSort }),

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

/**
 * Errors are reported once, as a toast keyed by the core's error code.
 *
 * This is the handler for every promise the UI fires without awaiting it:
 * `void store.x().catch(report)`. The dialog's `submit` runs after the promise
 * `dispatchCommand` catches has resolved; a click on a tab or a tree row, an
 * autosave timer and a watcher batch have no caller to throw to at all.
 * Without it a rejection reaches `unhandledrejection` in `main.tsx`, which
 * paints the fatal overlay over a working window. The lint rule
 * `no-floating-promises` (eslint.config.js) refuses a fire-and-forget without
 * a handler, so the convention cannot erode one call site at a time. It lives
 * here rather than in `lib/commands.ts` because the stores need it too, and
 * `commands.ts` imports every store.
 */
export function report(error: unknown): void {
  useUi.getState().showToast(errorKey(error), errorValues(error));
}

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
