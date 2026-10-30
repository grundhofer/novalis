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
  type ToneDto,
  type TreeSortDto,
  type UiStateDto,
} from "../ipc/client";

/**
 * Settings (the four of PLAN.md §4.1, `reduceMotion` from ADR-0049 and
 * `tone` from ADR-0051) plus the disposable window state.
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
  /**
   * `tag` presets the search's tag filter (a tag chosen in the palette or
   * ⌘-clicked in a note), `query` its text (the selection, ADR-0037).
   */
  | { kind: "search"; tag?: string; query?: string }
  /** Go to Heading… (ADR-0037): the palette on the open note's headings. */
  | { kind: "headings" }
  /**
   * The note picker (ADR-0030): quick-open over the notes minus `exclude`,
   * the active note first; the chosen path goes to `onPick`.
   */
  | { kind: "pickNote"; exclude: readonly string[]; onPick: (path: string) => Promise<void> }
  /**
   * The folder picker behind Move To… (DSK-11, ADR-0051 #5): quick-open over
   * `folders`, `""` being the vault root, with the moved file's `name` in
   * the input; the chosen folder goes to `onPick`.
   */
  | { kind: "pickFolder"; name: string; folders: readonly string[]; onPick: (folder: string) => Promise<void> };

/**
 * A one-line question. The app has no modal stack:
 * this is the single dialog shape (new note, new folder, rename, board and
 * column names), always titled and its field labelled from the catalog.
 *
 * With `confirm` set it asks instead of collecting: the input is replaced by a
 * line of explanation and `submit` is called with the empty string. That is
 * the same dialog rather than a second one, because a destructive action needs
 * a question, not a new modal stack.
 */
export interface PromptRequest {
  titleKey: string;
  /** Interpolation values for the title, e.g. the name a rename is for. */
  titleValues?: Record<string, string | number>;
  /** Input dialogs only: the field's visible label (EIN-01). */
  labelKey?: string;
  /** Input dialogs only. */
  initial?: string;
  /**
   * Input dialogs only: a textarea instead of the one-line field (the card
   * description, ADR-0013). `Cmd+Enter` submits, `Enter` is a newline, and an
   * empty value is submitted rather than swallowed, because emptying the
   * field is how the text is cleared; its label says „(optional)“ (D99 (3)).
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
  /**
   * Input dialogs only: the verb on the submit button (AKT-04, ADR-0051),
   * e.g. `app.create`; `app.save` when not given.
   */
  submitKey?: string;
  /**
   * Input dialogs only: what the submit button says once `submit` has run
   * for a second (spec/02 §1.7, spec/07 §4.5), e.g. `app.creating`;
   * `app.saving` when not given.
   */
  busyKey?: string;
  submit: (value: string) => void | Promise<void>;
}

/**
 * A toast's one action (spec/02 §4.8): its word from the catalog and what it
 * does; the toast closes as it runs, and a failure goes to the action zone.
 */
export interface ToastAction {
  labelKey: string;
  run: () => Promise<void>;
}

interface UiState {
  settings: SettingsDto | null;
  /**
   * Whether the sidebar shows beside the content: the user's choice, kept in
   * `state.json`. A window too narrow for it (`sidebarOverlay`) keeps the
   * choice for when there is room again (spec/02 §4.17); what shows is
   * `sidebarShown`.
   */
  sidebarVisible: boolean;
  sidebarWidth: number;
  /**
   * The window has no room for the sidebar beside the content's 480 px: below
   * 722 px sebaro.css lays it over the content's edge (spec/02 §4.17, DSK-04).
   * Read from that CSS by lib/windowFit.ts. Session state, never saved.
   */
  sidebarOverlay: boolean;
  /** The overlay is open: never at first, closed again by every narrowing. */
  sidebarOverlayOpen: boolean;
  /**
   * The widest the docked sidebar may be beside the content's 480 px, up to
   * `SIDEBAR_WIDTH.max`; `null` before the window is measured. sebaro.css
   * caps the sidebar at it (`100cqi − 482px`), so it gives way without its
   * width being overwritten (spec/02 §4.23); the divider names and moves
   * what shows. Set by lib/windowFit.ts. Session state.
   */
  sidebarRoom: number | null;
  boardVisible: boolean;
  backlinksVisible: boolean;
  /** PLAN.md §5.6 step 1: the cloud hint is shown once, then never again. */
  cloudHintShown: boolean;
  activeBoard: string | null;
  /** The tree's file order (ADR-0012); folders ignore it. `state.json` state. */
  treeSort: TreeSortDto;
  /**
   * Notes shown as the read-only preview instead of the editor (ADR-0020),
   * by path. Session state: a restart opens every note in the editor.
   */
  previewing: Record<string, true>;
  /**
   * Vault search over every listed file, not only notes (ADR-0022). Session
   * state like `previewing`: it outlives the panel, not the app.
   */
  searchAllFiles: boolean;
  /**
   * Spaces, tabs and trailing whitespace drawn in the editor (ADR-0029).
   * Session state: a restart shows the text plain again.
   */
  invisibles: boolean;
  /**
   * The settings view (DSK-02, spec/02 §4.24, ADR-0051 #1) stands in the
   * content area instead of the note, board or empty state while it is
   * true; what it covers stays as it was. Session state, never saved: a
   * restart opens where the user was. `lib/settingsView.ts` opens and leaves
   * it with the focus.
   */
  settingsView: boolean;
  overlay: Overlay;
  prompt: PromptRequest | null;
  /**
   * A reversible result only (EBE-05, ADR-0051): „Karte hinzugefügt“, a move
   * the hidden tree cannot show, and „In die Zwischenablage kopiert: …“
   * (spec/07 §4.3 case 4). Numbers matter in
   * `values`, as in a prompt's: i18next selects plurals on them. `action` is
   * the one `sb-toast__action` (spec/02 §4.8), „Rückgängig“ after Move To…
   * only (ADR-0051 #39).
   */
  toast: { key: string; values: Record<string, string | number>; action?: ToastAction } | null;
  /**
   * Why the last command failed, said in the action zone in place of the
   * state sentence until the next user action or Escape (spec/03 §12, §16,
   * ADR-0051). Never a toast. A failure no action of the user caused (the
   * autosave, a watcher batch) is `background`: it stays at least
   * `BACKGROUND_MESSAGE_MS` from `since` (spec/02 §4.17, D102 (11)).
   */
  message:
    | { key: string; values: Record<string, string | number>; background?: undefined }
    | { key: string; values: Record<string, string | number>; background: true; since: number }
    | null;

  hydrate: (settings: SettingsDto, state: UiStateDto, locale: string) => void;
  setOverlay: (overlay: Overlay) => void;
  setSettingsView: (open: boolean) => void;
  ask: (request: PromptRequest) => void;
  closePrompt: () => void;
  /** Over the content's edge the overlay opens or closes; else the choice flips. */
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  /** The window became too narrow for the sidebar, or wide enough again: the overlay closes. */
  setSidebarOverlay: (overlay: boolean) => void;
  setSidebarOverlayOpen: (open: boolean) => void;
  setSidebarRoom: (room: number | null) => void;
  /** Clamped to `SIDEBAR_WIDTH`; the width is kept while the sidebar is hidden. */
  setSidebarWidth: (width: number) => void;
  /**
   * Show or hide the board pane. `loaded` is the board store's board: shown
   * while none is chosen, it becomes the chosen one, so its pinned tab stays.
   */
  toggleBoard: (loaded?: string | null) => void;
  /** Hide the board pane so the editor shows; a no-op when it is hidden. */
  hideBoard: () => void;
  toggleBacklinks: () => void;
  dismissCloudHint: () => void;
  setActiveBoard: (slug: string | null) => void;
  setTreeSort: (sort: TreeSortDto) => void;
  togglePreview: (path: string) => void;
  endPreview: (path: string) => void;
  toggleSearchAllFiles: () => void;
  toggleInvisibles: () => void;
  setAppearance: (appearance: AppearanceDto) => Promise<void>;
  setTone: (tone: ToneDto) => Promise<void>;
  setLanguage: (language: LanguageDto) => Promise<void>;
  setSpellcheck: (on: boolean) => Promise<void>;
  setReduceMotion: (on: boolean) => Promise<void>;
  changeFontSize: (delta: number | "reset") => Promise<void>;
  showToast: (key: string, values?: Record<string, string | number>, action?: ToastAction) => void;
  clearToast: () => void;
  showMessage: (key: string, values?: Record<string, string | number>, background?: boolean) => void;
  /**
   * Ends the reason, unless it is a failure without a trigger younger than
   * `BACKGROUND_MESSAGE_MS`: every path that ends it (the action zone's key
   * and press, a menu item, an app chord) goes through here, so the hold
   * holds for all of them (spec/02 §4.17, D102 (11)).
   */
  clearMessage: (now?: number) => void;
}

/** How long a failure without a trigger stays at least (spec/02 §4.17, D102 (11)). */
export const BACKGROUND_MESSAGE_MS = 10_000;

/** The default `editor.fontSize` (docs/SETTINGS.md). */
export const DEFAULT_FONT_SIZE = 16;

/**
 * The sizes `editor.fontSize` takes, in px: the shell clamps every change to
 * them (`SettingsPatchDto` in dto.rs, whose cargo test pins this line), and
 * the settings view offers each one.
 */
export const FONT_SIZE = { min: 9, max: 32 } as const;

/**
 * The sidebar's widths in px (sebaro D100, spec/02 §4.23, ADR-0051): it
 * starts at `start` and is dragged or chosen between `min` and `max`. They
 * are sebaro's pane tokens `--sb-x-sebaro-pane-sidebar`, `-min` and `-max`
 * (tokens.css, since the export of adfdb35), as numbers: the store clamps
 * and saves them, the divider names them in `aria-valuemin` / `-max` and
 * the inline width overrides `.sb-side-nav`'s token. This is the one copy in
 * TS; ui.test.ts pins it to tokens.css, and a cargo test pins the menu's
 * three steps (`menu::SIDEBAR_WIDTHS`) to this line.
 */
export const SIDEBAR_WIDTH = { min: 200, start: 240, max: 360 } as const;

/**
 * Whether the sidebar shows: beside the content as the user left it, or over
 * the content's edge while its overlay is open (spec/02 §4.17).
 */
export function sidebarShown(state: {
  sidebarVisible: boolean;
  sidebarOverlay: boolean;
  sidebarOverlayOpen: boolean;
}): boolean {
  return state.sidebarOverlay ? state.sidebarOverlayOpen : state.sidebarVisible;
}

/**
 * The width the docked sidebar shows: its own, or less while it gives way to
 * a window too narrow for both (spec/02 §4.23), never under its smallest.
 */
export function sidebarShownWidth(state: { sidebarWidth: number; sidebarRoom: number | null }): number {
  return state.sidebarRoom === null
    ? state.sidebarWidth
    : Math.max(SIDEBAR_WIDTH.min, Math.min(state.sidebarWidth, state.sidebarRoom));
}

/** A width within the sidebar's range, in whole px. */
export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));
}

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
  return { language: null, appearance: null, tone: null, fontSize: null, spellcheck: null, reduceMotion: null, ...change };
}

/**
 * The resolved mode as `data-theme`, `system` included, because the
 * preview's diagrams (Preview.tsx) redraw only when that attribute changes,
 * so a change of the system's scheme must change it too; sebaro's tokens
 * follow the media query themselves.
 * settings.json is the one store: the shell's initialisation script
 * (`window.rs`, ADR-0051 #22) brings the choice to the first paint, this
 * keeps it in step at run time.
 */
function applyAppearance(appearance: AppearanceDto): void {
  const dark =
    appearance === "dark" ||
    (appearance === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/**
 * sebaro's tone attribute (FAR-15, spec/09 §6.2, ADR-0051): `warm` stamps
 * `data-sb-tone="warm"`, `cool` removes it. The export's tokens.css swaps
 * the grey roles under it, so every view that names `--sb-color-*` follows.
 */
function applyTone(tone: ToneDto): void {
  if (tone === "warm") document.documentElement.dataset.sbTone = "warm";
  else delete document.documentElement.dataset.sbTone;
}

/**
 * sebaro's `html[data-sb-motion="reduce"]` (BEW-04, spec/03 §13.1; ADR-0051
 * #22 amends ADR-0049's `data-motion`): sebaro.css, novalis's own moving
 * rules (styles/app.css) and `sb-start.js` guard their motion with it;
 * sebaro's duration tokens keep their values there (spec/03 §13.1).
 */
function applyMotion(reduce: boolean): void {
  if (reduce) document.documentElement.dataset.sbMotion = "reduce";
  else delete document.documentElement.dataset.sbMotion;
}

/**
 * `editor.fontSize` is stored in CSS px (docs/SETTINGS.md) and written as
 * sebaro's rem step (spec/01 §1.8.2, spec/09 §17, D99 (1)): the same at
 * 100 %, and the writing area grows with a larger root size.
 */
function applyFontSize(size: number): void {
  document.documentElement.style.setProperty("--sb-x-sebaro-editor-size", `${size / 16}rem`);
}

export const useUi = create<UiState>((set, get) => ({
  settings: null,
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_WIDTH.start,
  sidebarOverlay: false,
  sidebarOverlayOpen: false,
  sidebarRoom: null,
  boardVisible: false,
  backlinksVisible: false,
  cloudHintShown: false,
  activeBoard: null,
  treeSort: "name",
  previewing: {},
  searchAllFiles: false,
  invisibles: false,
  settingsView: false,
  overlay: { kind: "none" },
  prompt: null,
  toast: null,
  message: null,

  hydrate: (settings, state, locale) => {
    applyAppearance(settings.appearance);
    applyTone(settings.tone);
    applyFontSize(settings.editor.fontSize);
    applyMotion(settings.reduceMotion);
    void setLocale(locale).catch(report);
    set({
      settings,
      sidebarVisible: state.sidebarVisible ?? true,
      // A width saved under the old 180–480 px range comes back inside the
      // new one (ADR-0051). A saved 256, the old start width, stays: it
      // cannot be told from a width the user chose, and that choice wins.
      sidebarWidth: clampSidebarWidth(state.sidebarWidth ?? SIDEBAR_WIDTH.start),
      boardVisible: state.boardVisible ?? false,
      backlinksVisible: state.backlinksVisible ?? false,
      cloudHintShown: state.cloudHintShown ?? false,
      activeBoard: state.activeBoard ?? null,
      treeSort: state.treeSort ?? "name",
    });
  },

  setOverlay: (overlay) => set({ overlay }),
  setSettingsView: (settingsView) => set((s) => (s.settingsView === settingsView ? s : { settingsView })),
  ask: (request) => set({ prompt: request }),
  closePrompt: () => set({ prompt: null }),
  toggleSidebar: () =>
    set((s) =>
      s.sidebarOverlay ? { sidebarOverlayOpen: !s.sidebarOverlayOpen } : { sidebarVisible: !s.sidebarVisible },
    ),
  setSidebarVisible: (visible) => set((s) => (s.sidebarVisible === visible ? s : { sidebarVisible: visible })),
  setSidebarOverlay: (overlay) =>
    set((s) => (s.sidebarOverlay === overlay ? s : { sidebarOverlay: overlay, sidebarOverlayOpen: false })),
  setSidebarOverlayOpen: (open) =>
    set((s) => (!s.sidebarOverlay || s.sidebarOverlayOpen === open ? s : { sidebarOverlayOpen: open })),
  setSidebarRoom: (room) => set((s) => (s.sidebarRoom === room ? s : { sidebarRoom: room })),
  setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
  // Over the settings view the toggle shows the board, which the view hid,
  // and the view gives way, as it does to a tab made current (stores/tabs.ts).
  // The board's tab is pinned (ADR-0051 #35): the toggle is how it goes, so
  // hiding the board takes its tab too; a note tab made current only hides it.
  // Showing it names the board it shows, or a note tab made current would
  // take a tab that only the loaded board stood for.
  toggleBoard: (loaded = null) =>
    set((s) =>
      s.settingsView
        ? { boardVisible: true, settingsView: false, activeBoard: s.activeBoard ?? loaded }
        : s.boardVisible
          ? { boardVisible: false, activeBoard: null }
          : { boardVisible: true, activeBoard: s.activeBoard ?? loaded },
    ),
  hideBoard: () => set((s) => (s.boardVisible ? { boardVisible: false } : s)),
  toggleBacklinks: () => set((s) => ({ backlinksVisible: !s.backlinksVisible })),
  dismissCloudHint: () => set({ cloudHintShown: true }),
  setActiveBoard: (slug) =>
    set((s) => ({ activeBoard: slug, boardVisible: slug !== null, settingsView: slug === null && s.settingsView })),
  setTreeSort: (treeSort) => set({ treeSort }),
  toggleSearchAllFiles: () => set((s) => ({ searchAllFiles: !s.searchAllFiles })),
  toggleInvisibles: () => set((s) => ({ invisibles: !s.invisibles })),

  togglePreview: (path) =>
    set((s) => {
      const previewing = { ...s.previewing };
      if (previewing[path]) delete previewing[path];
      else previewing[path] = true;
      return { previewing };
    }),
  endPreview: (path) =>
    set((s) => {
      if (!s.previewing[path]) return s;
      const previewing = { ...s.previewing };
      delete previewing[path];
      return { previewing };
    }),

  setAppearance: async (appearance) => {
    // At once, so the change shows; and again once the shell has answered:
    // it sets the window's own mode (DSK-14), which the web view's media
    // query follows, so `system` read before the answer may still see the
    // mode the window was forced to, and a media change that came before
    // the store knew `system` was not followed (watchSystemAppearance).
    applyAppearance(appearance);
    const settings = await unwrap(commands.settingsSet(patch({ appearance } as SettingsPatchDto)));
    set({ settings });
    applyAppearance(settings.appearance);
  },

  setTone: async (tone) => {
    applyTone(tone);
    set({ settings: await unwrap(commands.settingsSet(patch({ tone } as SettingsPatchDto))) });
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

  setReduceMotion: async (reduceMotion) => {
    applyMotion(reduceMotion);
    set({ settings: await unwrap(commands.settingsSet(patch({ reduceMotion } as SettingsPatchDto))) });
  },

  changeFontSize: async (delta) => {
    const current = get().settings?.editor.fontSize ?? DEFAULT_FONT_SIZE;
    const next = delta === "reset" ? DEFAULT_FONT_SIZE : current + delta;
    applyFontSize(next);
    set({ settings: await unwrap(commands.settingsSet(patch({ fontSize: next } as SettingsPatchDto))) });
  },

  showToast: (key, values = {}, action) => set({ toast: action ? { key, values, action } : { key, values } }),
  clearToast: () => set({ toast: null }),
  showMessage: (key, values = {}, background = false) =>
    set({ message: background ? { key, values, background: true, since: Date.now() } : { key, values } }),
  clearMessage: (now = Date.now()) =>
    set((s) => {
      if (!s.message) return s;
      if (s.message.background && now - s.message.since < BACKGROUND_MESSAGE_MS) return s;
      return { message: null };
    }),
}));

/**
 * Errors are reported once, in the action zone, keyed by the core's error
 * code (ADR-0051: never as a toast).
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
  useUi.getState().showMessage(errorKey(error), errorValues(error));
}

/**
 * `report` for work no action of the user started — the autosave, a watcher
 * batch, the boot's follow-ups: the next key or press does not end its
 * sentence before `BACKGROUND_MESSAGE_MS` (spec/02 §4.17, D102 (11)).
 */
export function reportBackground(error: unknown): void {
  useUi.getState().showMessage(errorKey(error), errorValues(error), true);
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
