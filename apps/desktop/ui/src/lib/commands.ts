import { isEditorCommand, runEditorCommand } from "./editorBridge";
import { commands, NovalisError, unwrap } from "../ipc/client";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useNotes } from "../stores/notes";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { CREATABLE_EXTENSIONS } from "./fileTypes";
import { fileNameOf, folderOf, joinRel } from "./paths";

/**
 * One dispatcher for every command id in `docs/KEYMAP.md`, plus the menu-only
 * ids. A chord the webview sees and a native menu item both end up here, so
 * there is exactly one implementation per command.
 *
 * Everything is reached through the stores' `getState()`: a command is not a
 * React hook and must work when it arrives from a `menu-action` event, with no
 * component in the call stack.
 */

export type CommandResult = void | Promise<void>;

async function newNote(folder: string): Promise<void> {
  useUi.getState().ask({
    titleKey: "menu.file.newNote",
    placeholderKey: "tree.renamePlaceholder",
    initial: "",
    // What a typed extension does (ADR-0014), and which ones count.
    hint: {
      key: "tree.newNoteHint",
      values: { extensions: [...CREATABLE_EXTENSIONS].sort().map((e) => `.${e}`).join(" ") },
    },
    submit: async (name) => {
      const entry = await unwrap(commands.createNote(folder, name));
      await useVault.getState().reload(folder);
      await useNotes.getState().refresh();
      await useTabs.getState().open(entry.path);
    },
  });
}

async function newFolder(folder: string): Promise<void> {
  useUi.getState().ask({
    titleKey: "menu.file.newFolder",
    placeholderKey: "tree.renamePlaceholder",
    initial: "",
    submit: async (name) => {
      await unwrap(commands.createFolder(folder, name));
      await useVault.getState().reload(folder);
    },
  });
}

/**
 * Hard-coded like the PLAN.md §4.2 defaults (ADR-0012): the demo vault and
 * the mockups use this folder and `YYYY-MM-DD.md` names.
 */
const JOURNAL_FOLDER = "journal";

/**
 * Today as `YYYY-MM-DD` in local time, never `toISOString()`: that is UTC,
 * and a note written at 23:30 belongs to that day.
 */
function localIsoDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function todayNote(): Promise<void> {
  const stem = localIsoDay();
  const path = joinRel(JOURNAL_FOLDER, `${stem}.md`);
  try {
    await unwrap(commands.createNote(JOURNAL_FOLDER, stem));
    // `create_atomic` made the folder along with the first note, and the root
    // listing does not know it yet.
    const vault = useVault.getState();
    if (!vault.children[""]?.some((e) => e.path === JOURNAL_FOLDER)) await vault.reload("");
    await vault.reload(JOURNAL_FOLDER);
    await useNotes.getState().refresh();
  } catch (error) {
    // `create_atomic` is mkdir -p plus RENAME_EXCL, so `already_exists` is
    // exact — the note is there — and there is no pre-check to race with.
    if (!(error instanceof NovalisError && error.code === "already_exists")) throw error;
  }
  await useTabs.getState().open(path);
}

async function renamePath(path: string): Promise<void> {
  useUi.getState().ask({
    titleKey: "menu.file.rename",
    placeholderKey: "tree.renamePlaceholder",
    initial: fileNameOf(path),
    submit: async (name) => {
      const folder = folderOf(path);
      const target = joinRel(folder, name);
      if (target === path) return;
      await useEditorSave.getState().save(path);
      await unwrap(commands.rename(path, target));
      useEditorSave.getState().rename(path, target);
      useTabs.getState().rename(path, target);
      await useVault.getState().reload(folder);
      await useNotes.getState().refresh();
    },
  });
}

async function trashPath(path: string): Promise<void> {
  // Cmd-Delete reaches here from anywhere focus is not inside the editor, so
  // the one destructive command in the app asks first.
  useUi.getState().ask({
    titleKey: "app.confirmTrash.title",
    confirm: {
      bodyKey: "app.confirmTrash.body",
      values: { name: fileNameOf(path) },
      confirmKey: "menu.file.moveToTrash",
    },
    submit: async () => {
      await unwrap(commands.trash(path));
      const tabs = useTabs.getState();
      if (tabs.tabs.includes(path)) await tabs.close(path);
      await useVault.getState().reload(folderOf(path));
      await useNotes.getState().refresh();
    },
  });
}

async function openVault(): Promise<void> {
  const picked = await unwrap(commands.openVaultDialog());
  if (!picked) return;
  const open = await unwrap(commands.openVault(picked));
  useVault.getState().setVault(open.vault, open.tree);
  useBoard.getState().setBoards(open.vault.boards);
  // The board pane closes with the tabs: `activeBoard` named a board of the
  // previous vault, and left alone it was saved to `state.json` and loaded
  // at the next start against a vault that may not have it.
  useUi.getState().setActiveBoard(null);
  useTabs.getState().restore([], null);
  await useNotes.getState().refresh();
}

async function newBoard(): Promise<void> {
  useUi.getState().ask({
    titleKey: "board.newBoard",
    placeholderKey: "board.boardNamePlaceholder",
    initial: "",
    submit: async (name) => {
      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "");
      if (!slug) return;
      await useBoard.getState().createBoard(slug, name.trim());
      useUi.getState().setActiveBoard(slug);
      await useVault.getState().reload("boards");
    },
  });
}

/** The selection a tree command acts on: the tree row, else the active tab. */
function targetPath(): string | null {
  return useVault.getState().selected ?? useTabs.getState().active;
}

/**
 * Where a new note or folder goes: inside the selected folder, beside the
 * selected file, in the vault root when nothing is selected — the same rule
 * for both commands, as in Finder. `Cmd+N` used to create beside a selected
 * folder while `Shift+Cmd+N` created inside it, and the latter told a `.wav`
 * from a folder by its extension, so it tried to create under the file.
 *
 * A board item counts as a file, and so does an entry the tree has not
 * loaded (the active tab of a folder nobody expanded): only a listed folder
 * is created into.
 */
function targetFolder(): string {
  const path = targetPath();
  if (!path) return "";
  const entry = useVault.getState().children[folderOf(path)]?.find((e) => e.path === path);
  return entry?.dir && !entry.boardSlug ? path : folderOf(path);
}

const REGISTRY: Record<string, () => CommandResult> = {
  "file.save": () => {
    const active = useTabs.getState().active;
    if (active) return useEditorSave.getState().save(active);
  },
  "file.newNote": () => newNote(targetFolder()),
  "file.todayNote": () => todayNote(),
  "vault.open": () => openVault(),
  "tab.close": () => useTabs.getState().closeActive(),
  "tab.reopenClosed": () => useTabs.getState().reopenClosed(),
  "tab.next": () => useTabs.getState().next(),
  "tab.previous": () => useTabs.getState().previous(),
  "nav.back": () => useTabs.getState().back(),
  "nav.forward": () => useTabs.getState().forward(),
  "quickOpen.open": () => useUi.getState().setOverlay({ kind: "quickOpen" }),
  "palette.open": () => useUi.getState().setOverlay({ kind: "palette" }),
  "settings.open": () => useUi.getState().setOverlay({ kind: "settings" }),
  "search.vault": () => useUi.getState().setOverlay({ kind: "search" }),
  "sidebar.toggle": () => useUi.getState().toggleSidebar(),
  "board.toggle": () => useUi.getState().toggleBoard(),
  "board.new": () => newBoard(),
  "view.fontLarger": () => useUi.getState().changeFontSize(1),
  "view.fontSmaller": () => useUi.getState().changeFontSize(-1),
  "view.fontReset": () => useUi.getState().changeFontSize("reset"),
  "tree.newFolder": () => newFolder(targetFolder()),
  "tree.rename": () => {
    const path = targetPath();
    if (path) return renamePath(path);
  },
  "tree.trash": () => {
    const path = targetPath();
    if (path) return trashPath(path);
  },
  "settings.appearance.system": () => useUi.getState().setAppearance("system"),
  "settings.appearance.light": () => useUi.getState().setAppearance("light"),
  "settings.appearance.dark": () => useUi.getState().setAppearance("dark"),
  "settings.language.system": () => useUi.getState().setLanguage("system"),
  "settings.language.de": () => useUi.getState().setLanguage("de"),
  "settings.language.en": () => useUi.getState().setLanguage("en"),
  "settings.spellcheck": () =>
    useUi.getState().setSpellcheck(!(useUi.getState().settings?.spellcheck ?? true)),
};

for (let n = 1; n <= 9; n += 1) {
  REGISTRY[`tab.goto.${n}`] = () => useTabs.getState().goto(n);
}

/** Run a command by id. Unknown ids are ignored, not thrown. */
export function dispatchCommand(id: string): void {
  const command = REGISTRY[id];
  if (command) {
    try {
      const result = command();
      if (result) void result.catch(report);
    } catch (error) {
      report(error);
    }
    return;
  }
  if (isEditorCommand(id)) runEditorCommand(id);
}

/**
 * Command ids the palette offers, in the order it shows them. `valueKey`
 * fills the label's `{{value}}`. The entries marked `settings` are the four
 * settings' values: they have no window, and the settings button (ADR-0012,
 * amended 2026-09-15) opens the palette on exactly this subset.
 */
export const PALETTE_COMMANDS: readonly {
  id: string;
  labelKey: string;
  valueKey?: string;
  settings?: true;
}[] = [
  { id: "quickOpen.open", labelKey: "menu.go.quickOpen" },
  { id: "search.vault", labelKey: "menu.edit.findInVault" },
  { id: "file.newNote", labelKey: "menu.file.newNote" },
  { id: "file.todayNote", labelKey: "tree.todayNote" },
  { id: "tree.newFolder", labelKey: "menu.file.newFolder" },
  { id: "board.new", labelKey: "menu.file.newBoard" },
  { id: "settings.open", labelKey: "palette.cmd.settings" },
  { id: "vault.open", labelKey: "menu.file.openVault" },
  { id: "file.save", labelKey: "menu.file.save" },
  { id: "tree.rename", labelKey: "menu.file.rename" },
  { id: "tree.trash", labelKey: "menu.file.moveToTrash" },
  { id: "sidebar.toggle", labelKey: "palette.cmd.toggleSidebar" },
  { id: "board.toggle", labelKey: "palette.cmd.toggleBoard" },
  { id: "editor.gotoLine", labelKey: "menu.edit.gotoLine" },
  { id: "find.open", labelKey: "menu.edit.find" },
  { id: "find.replace", labelKey: "menu.edit.findAndReplace" },
  { id: "markdown.bold", labelKey: "menu.edit.bold" },
  { id: "markdown.italic", labelKey: "menu.edit.italic" },
  { id: "markdown.link", labelKey: "menu.edit.insertLink" },
  { id: "markdown.toggleCheckbox", labelKey: "menu.edit.toggleCheckbox" },
  { id: "view.fontLarger", labelKey: "menu.view.fontLarger", settings: true },
  { id: "view.fontSmaller", labelKey: "menu.view.fontSmaller", settings: true },
  { id: "view.fontReset", labelKey: "menu.view.fontReset", settings: true },
  { id: "settings.appearance.system", labelKey: "palette.cmd.appearance", valueKey: "settings.appearance.system", settings: true },
  { id: "settings.appearance.light", labelKey: "palette.cmd.appearance", valueKey: "settings.appearance.light", settings: true },
  { id: "settings.appearance.dark", labelKey: "palette.cmd.appearance", valueKey: "settings.appearance.dark", settings: true },
  { id: "settings.language.system", labelKey: "palette.cmd.language", valueKey: "settings.language.system", settings: true },
  { id: "settings.language.de", labelKey: "palette.cmd.language", valueKey: "settings.language.de", settings: true },
  { id: "settings.language.en", labelKey: "palette.cmd.language", valueKey: "settings.language.en", settings: true },
  { id: "settings.spellcheck", labelKey: "menu.edit.checkSpellingWhileTyping", settings: true },
];
