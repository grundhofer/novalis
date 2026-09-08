import { isEditorCommand, runEditorCommand } from "./editorBridge";
import { commands, errorKey, errorValues, unwrap } from "../ipc/client";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useNotes } from "../stores/notes";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { fileNameOf, folderOf, isNote, joinRel } from "./paths";

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

/**
 * Errors here are reported once, as a toast keyed by the core's error code.
 *
 * Exported because the dialog needs it too: `ask` only stores the request, so
 * the promise `dispatchCommand` catches has already resolved by the time the
 * user presses OK, and an error thrown by `submit` would otherwise be lost.
 */
export function report(error: unknown): void {
  useUi.getState().showToast(errorKey(error), errorValues(error));
}

async function newNote(folder: string): Promise<void> {
  useUi.getState().ask({
    titleKey: "menu.file.newNote",
    placeholderKey: "tree.renamePlaceholder",
    initial: "",
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

const REGISTRY: Record<string, () => CommandResult> = {
  "file.save": () => {
    const active = useTabs.getState().active;
    if (active) return useEditorSave.getState().save(active);
  },
  "file.newNote": () => newNote(folderOf(targetPath() ?? "")),
  "vault.open": () => openVault(),
  "tab.close": () => useTabs.getState().closeActive(),
  "tab.reopenClosed": () => useTabs.getState().reopenClosed(),
  "tab.next": () => useTabs.getState().next(),
  "tab.previous": () => useTabs.getState().previous(),
  "nav.back": () => useTabs.getState().back(),
  "nav.forward": () => useTabs.getState().forward(),
  "quickOpen.open": () => useUi.getState().setOverlay({ kind: "quickOpen" }),
  "palette.open": () => useUi.getState().setOverlay({ kind: "palette" }),
  "search.vault": () => useUi.getState().setOverlay({ kind: "search" }),
  "sidebar.toggle": () => useUi.getState().toggleSidebar(),
  "backlinks.toggle": () => useUi.getState().toggleBacklinks(),
  "board.toggle": () => useUi.getState().toggleBoard(),
  "board.new": () => newBoard(),
  "view.fontLarger": () => useUi.getState().changeFontSize(1),
  "view.fontSmaller": () => useUi.getState().changeFontSize(-1),
  "view.fontReset": () => useUi.getState().changeFontSize("reset"),
  "tree.newFolder": () => {
    // Next to the tree selection when it is a folder, otherwise beside the
    // selected file, otherwise in the vault root (docs/KEYMAP.md "Not listed").
    const path = targetPath();
    return newFolder(path && !isNote(path) ? path : folderOf(path ?? ""));
  },
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
 * Command ids the palette offers, in the order it shows them.
 *
 * A function, not a constant, because one entry names its own state: the
 * catalog gives backlinks a `showBacklinks`/`hideBacklinks` pair rather than
 * the single "Toggle" label the sidebar and board use.
 */
export function paletteCommands(): readonly { id: string; labelKey: string }[] {
  return [
  { id: "quickOpen.open", labelKey: "menu.go.quickOpen" },
  { id: "search.vault", labelKey: "menu.edit.findInVault" },
  { id: "file.newNote", labelKey: "menu.file.newNote" },
  { id: "tree.newFolder", labelKey: "menu.file.newFolder" },
  { id: "board.new", labelKey: "menu.file.newBoard" },
  { id: "vault.open", labelKey: "menu.file.openVault" },
  { id: "file.save", labelKey: "menu.file.save" },
  { id: "tree.rename", labelKey: "menu.file.rename" },
  { id: "tree.trash", labelKey: "menu.file.moveToTrash" },
  { id: "sidebar.toggle", labelKey: "palette.cmd.toggleSidebar" },
  { id: "board.toggle", labelKey: "palette.cmd.toggleBoard" },
  {
    id: "backlinks.toggle",
    labelKey: useUi.getState().backlinksVisible
      ? "palette.cmd.hideBacklinks"
      : "palette.cmd.showBacklinks",
  },
  { id: "editor.gotoLine", labelKey: "menu.edit.gotoLine" },
  { id: "find.open", labelKey: "menu.edit.find" },
  { id: "find.replace", labelKey: "menu.edit.findAndReplace" },
  { id: "markdown.bold", labelKey: "menu.edit.bold" },
  { id: "markdown.italic", labelKey: "menu.edit.italic" },
  { id: "markdown.link", labelKey: "menu.edit.insertLink" },
  { id: "markdown.toggleCheckbox", labelKey: "menu.edit.toggleCheckbox" },
  { id: "view.fontLarger", labelKey: "menu.view.fontLarger" },
  { id: "view.fontSmaller", labelKey: "menu.view.fontSmaller" },
  { id: "view.fontReset", labelKey: "menu.view.fontReset" },
  ];
}
