import { menuCardNow, runCardMenuAction } from "./cardActions";
import {
  editorSelection,
  editorSelectionOrLine,
  isEditorCommand,
  runEditorCommand,
} from "./editorBridge";
import { isPreviewCommand, previewMounted, runPreviewCommand } from "./previewBridge";
import { commands, NovalisError, unwrap, type CardDto } from "../ipc/client";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { previewKind } from "./fileTypes";
import { localIsoDay } from "./localTime";
import { fileNameOf, folderOf, isNote, joinRel } from "./paths";
import { uiStateNow } from "./uiState";

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
    // What a typed extension does (ADR-0014): the table is too long to list.
    hint: { key: "tree.newNoteHint" },
    submit: async (name) => {
      const entry = await unwrap(commands.createNote(folder, name));
      await useVault.getState().reload(folder);
      await useFiles.getState().refresh();
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

/** A day note: `journal/YYYY-MM-DD.md`, the day captured (ADR-0012). */
const DAY_NOTE = /^journal\/(\d{4}-\d{2}-\d{2})\.md$/;

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
    await useFiles.getState().refresh();
  } catch (error) {
    // `create_atomic` is mkdir -p plus RENAME_EXCL, so `already_exists` is
    // exact — the note is there — and there is no pre-check to race with.
    if (!(error instanceof NovalisError && error.code === "already_exists")) throw error;
  }
  await useTabs.getState().open(path);
}

/**
 * Previous / next day (ADR-0026): the neighbour among the day notes that
 * exist, seen from the active tab's day — or from today when the active tab
 * is not a day note. Going forward never skips today: past the last earlier
 * day lies today, created like the Today row. Nothing to go to is no error.
 */
async function stepDay(direction: -1 | 1): Promise<void> {
  const today = localIsoDay();
  const active = useTabs.getState().active;
  const from = (active ? DAY_NOTE.exec(active)?.[1] : undefined) ?? today;
  const days = useFiles
    .getState()
    .notes.flatMap((path) => DAY_NOTE.exec(path)?.[1] ?? [])
    .sort();
  let day: string | undefined;
  if (direction < 0) {
    day = days.filter((d) => d < from).pop();
  } else {
    day = days.find((d) => d > from);
    if (from < today && (!day || day > today)) return todayNote();
  }
  if (day) await useTabs.getState().open(joinRel(JOURNAL_FOLDER, `${day}.md`));
}

/**
 * The one rename behind the dialog and the tree's drag and drop: the buffer
 * is saved first so the shell moves what the user sees, then the docs and
 * tabs are re-keyed and every folder whose listing changed is relisted.
 */
async function renameTo(from: string, target: string): Promise<void> {
  if (target === from) return;
  await useEditorSave.getState().save(from);
  await unwrap(commands.rename(from, target));
  useEditorSave.getState().rename(from, target);
  useTabs.getState().rename(from, target);
  const vault = useVault.getState();
  const fromFolder = folderOf(from);
  const toFolder = folderOf(target);
  await vault.reload(fromFolder);
  if (toFolder !== fromFolder) await vault.reload(toFolder);
  await useFiles.getState().refresh();
}

async function renamePath(path: string): Promise<void> {
  useUi.getState().ask({
    titleKey: "menu.file.rename",
    placeholderKey: "tree.renamePlaceholder",
    initial: fileNameOf(path),
    submit: (name) => renameTo(path, joinRel(folderOf(path), name)),
  });
}

/**
 * Move a file into `toFolder`, keeping its name (ADR-0018). Files only: the
 * core relinks the notes that point at a moved note, but not the relative
 * links inside a moved folder's notes nor the cards' `notes[]` under it, so a
 * folder — or anything the tree does not list — stays where it is.
 */
export async function moveEntry(from: string, toFolder: string): Promise<void> {
  if (folderOf(from) === toFolder) return;
  const entry = useVault.getState().children[folderOf(from)]?.find((e) => e.path === from);
  if (!entry || entry.dir) return;
  await renameTo(from, joinRel(toFolder, fileNameOf(from)));
}

/**
 * Delete a board (ADR-0034): its folder goes to the Trash — board.json, the
 * cards, `conflicts/` — after a confirmation that says what a board is; the
 * notes its cards link to stay. The Trash is the undo. One path for the
 * board pane's button and for Move to Trash on the board's tree row.
 */
export function deleteBoard(slug: string): void {
  const name = useBoard.getState().boards.find((b) => b.slug === slug)?.name ?? slug;
  useUi.getState().ask({
    titleKey: "board.deleteBoard",
    confirm: {
      bodyKey: "board.deleteBoardBody",
      values: { name },
      confirmKey: "board.deleteBoard",
    },
    submit: async () => {
      await unwrap(commands.trash(`boards/${slug}`));
      useBoard.getState().forget(slug);
      if (useUi.getState().activeBoard === slug) useUi.getState().setActiveBoard(null);
      await useVault.getState().reload("boards");
    },
  });
}

async function trashPath(path: string): Promise<void> {
  // A board row in the tree is `boards/<slug>`: it gets the board's own
  // confirmation and clean-up, not the file's (ADR-0034).
  const board = useBoard.getState().boards.find((b) => `boards/${b.slug}` === path);
  if (board) return deleteBoard(board.slug);
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
      await useFiles.getState().refresh();
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
  // The recent files were the previous vault's (ADR-0037).
  useTabs.setState({ recent: [] });
  await useFiles.getState().refresh();
}

/**
 * The board a card command acts on (ADR-0030): the one the pane last showed,
 * or the only board there is.
 */
function cardBoard(): string | null {
  const boards = useBoard.getState().boards;
  return useUi.getState().activeBoard ?? (boards.length === 1 ? (boards[0]?.slug ?? null) : null);
}

/**
 * New Card from the palette (ADR-0030): the column button's dialog, the card
 * last in the first column, the pane left as it is. A board without columns
 * is shown instead, since it has nowhere to put a card.
 */
async function newCard(): Promise<void> {
  const slug = cardBoard();
  if (!slug) return;
  const board = useBoard.getState();
  if (board.slug !== slug || !board.board) await board.load(slug);
  const column = useBoard.getState().board?.columns[0];
  if (!column) {
    useUi.getState().setActiveBoard(slug);
    return;
  }
  useUi.getState().ask({
    titleKey: "board.newCard",
    placeholderKey: "board.cardTitlePlaceholder",
    initial: "",
    submit: async (title) => {
      await useBoard.getState().apply({
        kind: "add",
        title,
        column: column.id,
        notes: [],
        position: { kind: "last" },
      });
    },
  });
}

/**
 * A card's title as a note name (ADR-0035): the separators a path or macOS
 * would read go, and a leading dot, which would hide the file.
 */
export function noteNameOfTitle(title: string): string {
  return title
    .replace(/[/\\:]+/g, "-")
    .replace(/^[.\s]+/, "")
    .trim();
}

/**
 * Create Note from Card (ADR-0035): an empty note named by the card's title
 * — its title is its name (D22) — linked to the card and opened. It lands
 * where `Cmd+N` would put it, except never among the boards; a note of that
 * name already there is linked instead of a second one being made.
 */
async function createNoteFromCard(card: CardDto): Promise<void> {
  const name = noteNameOfTitle(card.title);
  if (!name) return;
  const target = targetFolder();
  const folder = target === "boards" || target.startsWith("boards/") ? "" : target;
  let path = joinRel(folder, `${name}.md`);
  try {
    path = (await unwrap(commands.createNote(folder, name))).path;
    await useVault.getState().reload(folder);
    await useFiles.getState().refresh();
  } catch (error) {
    if (!(error instanceof NovalisError && error.code === "already_exists")) throw error;
  }
  if (!card.notes.includes(path)) {
    await useBoard.getState().apply({ kind: "linkNote", id: card.id, path });
  }
  await useTabs.getState().open(path);
}

/**
 * The first line of a text as a card title (ADR-0035): a list marker, a task
 * box or a heading's hashes are Markdown, not the title.
 */
export function cardTitleOfLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .trim();
}

/**
 * New Card from Selection (ADR-0035): the selected text's first line — or the
 * cursor's line — as a card on the active board, linked to the note it came
 * from; last in the first column. A one-time copy: the note is not written,
 * and nothing ties the text to the card afterwards (§2.3 rule 10, D18).
 */
async function cardFromSelection(): Promise<void> {
  const note = useTabs.getState().active;
  const slug = cardBoard();
  if (!note || !isNote(note) || !slug) return;
  // The rendered note has no editor; its selection is the document's.
  const text = previewMounted() ? (window.getSelection()?.toString() ?? "") : editorSelectionOrLine();
  const title = cardTitleOfLine(text ?? "");
  if (!title) return;
  const board = useBoard.getState();
  if (board.slug !== slug || !board.board) await board.load(slug);
  const loaded = useBoard.getState().board;
  const column = loaded?.columns[0];
  if (!loaded || !column) {
    useUi.getState().setActiveBoard(slug);
    return;
  }
  await useBoard.getState().apply({
    kind: "add",
    title,
    column: column.id,
    notes: [note],
    position: { kind: "last" },
  });
  useUi.getState().showToast("board.cardAdded", { board: loaded.name });
}

/**
 * What ⇧⌘F starts with (ADR-0037): the selection — the editor's, or the
 * rendered note's — when it is one line of at most 100 characters; else
 * nothing, as before.
 */
function searchSeed(): string | undefined {
  const text = (previewMounted() ? window.getSelection()?.toString() : editorSelection()) ?? "";
  const seed = text.trim();
  return seed && !/[\r\n]/.test(seed) && seed.length <= 100 ? seed : undefined;
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
/**
 * The tree's context menu (ADR-0021): the row is selected first, so the
 * entries — File menu ids the shell pops as a native menu — act on it the
 * way `Cmd+Delete` or Enter would. A board row gets "Show in Finder" only.
 */
export function openTreeContextMenu(path: string, board: boolean): Promise<void> {
  useVault.getState().select(path);
  return unwrap(commands.contextMenu({ kind: "tree", board })).then(() => undefined);
}

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

/** How long quitting waits for the open buffers (D19: quitting never blocks). */
export const QUIT_FLUSH_MS = 2000;

/**
 * ⌘Q, Quit in the menu and the window's close button (D19): every open
 * buffer is written, for two seconds at most, then the state goes out with
 * `quit` and the shell exits on it. A save that fails is reported like any
 * other and does not keep the app open — the conflict copy is already on
 * disk by then (PLAN.md §5.3).
 */
async function quit(): Promise<void> {
  await Promise.race([
    useEditorSave.getState().flushAll().catch(report),
    new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_MS)),
  ]);
  await unwrap(commands.stateSave({ ...uiStateNow(), quit: true }));
}

const REGISTRY: Record<string, () => CommandResult> = {
  "app.quit": () => quit(),
  "file.save": () => {
    const active = useTabs.getState().active;
    if (active) return useEditorSave.getState().save(active);
  },
  "file.newNote": () => newNote(targetFolder()),
  "file.todayNote": () => todayNote(),
  "journal.previousDay": () => stepDay(-1),
  "journal.nextDay": () => stepDay(1),
  "vault.open": () => openVault(),
  "tab.close": () => useTabs.getState().closeActive(),
  "tab.reopenClosed": () => useTabs.getState().reopenClosed(),
  "tab.closeOthers": () => useTabs.getState().closeOthers(),
  "tab.closeAll": () => useTabs.getState().closeAll(),
  "tab.next": () => useTabs.getState().next(),
  "tab.previous": () => useTabs.getState().previous(),
  "nav.back": () => useTabs.getState().back(),
  "nav.forward": () => useTabs.getState().forward(),
  "quickOpen.open": () => useUi.getState().setOverlay({ kind: "quickOpen" }),
  "palette.open": () => useUi.getState().setOverlay({ kind: "palette" }),
  "settings.open": () => useUi.getState().setOverlay({ kind: "settings" }),
  "search.vault": () => useUi.getState().setOverlay({ kind: "search", query: searchSeed() }),
  "palette.gotoHeading": () => useUi.getState().setOverlay({ kind: "headings" }),
  "sidebar.toggle": () => useUi.getState().toggleSidebar(),
  "backlinks.toggle": () => useUi.getState().toggleBacklinks(),
  "view.toggleInvisibles": () => useUi.getState().toggleInvisibles(),
  "board.toggle": () => useUi.getState().toggleBoard(),
  "board.new": () => newBoard(),
  "board.newCard": () => newCard(),
  "board.cardFromSelection": () => cardFromSelection(),
  "note.togglePreview": () => {
    // Markdown renders (ADR-0020; `.markdown` too, ADR-0022 point 6), a
    // CSV or TSV is a table and an SVG its picture (ADR-0025); a PDF or an
    // image is already the viewer, and a `.txt` has nothing else to show.
    const active = useTabs.getState().active;
    if (!active || !previewKind(active)) return;
    // The preview renders the mirror; the editor's buffer may be ahead of it
    // until the editor unmounts, which is after the preview's first render.
    useEditorSave.getState().flush(active);
    useUi.getState().togglePreview(active);
  },
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
  "tree.reveal": () => {
    const path = targetPath();
    if (path) return unwrap(commands.reveal(path)).then(() => undefined);
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
  // A card's context menu (ADR-0032): its ids carry no chord and no palette
  // entry, only a card the menu was opened on.
  if (id === "card.createNote") {
    const card = menuCardNow();
    if (card) void createNoteFromCard(card).catch(report);
    return;
  }
  if (runCardMenuAction(id)) return;
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
  // A previewed note has no editor on screen (ADR-0020): find and the two
  // marks act on the rendered text; a mark that cannot be placed, and every
  // other editor chord (link, checkbox, go to line …), returns to the editor
  // so the chord lands where it applies. The command itself is not replayed
  // there — the editor mounts asynchronously, and the user is now looking at
  // the right place to press it again.
  if (previewMounted()) {
    if (runPreviewCommand(id)) return;
    if (isPreviewCommand(id) || isEditorCommand(id)) {
      const active = useTabs.getState().active;
      if (active) useUi.getState().endPreview(active);
      return;
    }
  }
  // A table or a picture (ADR-0025) takes no editor chord at all: every one
  // returns to the text, like the ones the rendered note cannot place.
  const active = useTabs.getState().active;
  const second = active && useUi.getState().previewing[active] ? previewKind(active) : null;
  if (active && second && second !== "markdown" && (isPreviewCommand(id) || isEditorCommand(id))) {
    useUi.getState().endPreview(active);
    return;
  }
  if (isEditorCommand(id)) runEditorCommand(id);
}

/**
 * Command ids the palette offers, in the order it shows them. `valueKey`
 * fills the label's `{{value}}`. The entries marked `settings` are the four
 * settings' values: they have no window, and the settings button (ADR-0012,
 * amended 2026-09-15) opens the palette on exactly this subset.
 *
 * A function, not a constant, because one entry names its own state: the
 * catalog gives backlinks a `showBacklinks`/`hideBacklinks` pair rather than
 * the single "Toggle" label the sidebar and board use.
 */
export function paletteCommands(): readonly {
  id: string;
  labelKey: string;
  valueKey?: string;
  settings?: true;
}[] {
  return [
  { id: "quickOpen.open", labelKey: "menu.go.quickOpen" },
  { id: "search.vault", labelKey: "menu.edit.findInVault" },
  { id: "file.newNote", labelKey: "menu.file.newNote" },
  { id: "file.todayNote", labelKey: "tree.todayNote" },
  { id: "journal.previousDay", labelKey: "palette.cmd.previousDay" },
  { id: "journal.nextDay", labelKey: "palette.cmd.nextDay" },
  { id: "tree.newFolder", labelKey: "menu.file.newFolder" },
  { id: "board.new", labelKey: "menu.file.newBoard" },
  // Only where there is a board to put the card on (ADR-0030).
  ...(cardBoard() ? [{ id: "board.newCard", labelKey: "board.newCard" }] : []),
  // From the note being read, onto the active board (ADR-0035).
  ...(cardBoard() && isNote(useTabs.getState().active ?? "")
    ? [{ id: "board.cardFromSelection", labelKey: "palette.cmd.cardFromSelection" }]
    : []),
  { id: "settings.open", labelKey: "palette.cmd.settings" },
  { id: "vault.open", labelKey: "menu.file.openVault" },
  { id: "file.save", labelKey: "menu.file.save" },
  { id: "tab.closeOthers", labelKey: "palette.cmd.closeOtherTabs" },
  { id: "tab.closeAll", labelKey: "palette.cmd.closeAllTabs" },
  { id: "tree.rename", labelKey: "menu.file.rename" },
  { id: "tree.trash", labelKey: "menu.file.moveToTrash" },
  { id: "tree.reveal", labelKey: "menu.file.revealInFinder" },
  { id: "sidebar.toggle", labelKey: "palette.cmd.toggleSidebar" },
  { id: "board.toggle", labelKey: "palette.cmd.toggleBoard" },
  { id: "note.togglePreview", labelKey: "menu.view.togglePreview" },
  {
    id: "backlinks.toggle",
    labelKey: useUi.getState().backlinksVisible
      ? "palette.cmd.hideBacklinks"
      : "palette.cmd.showBacklinks",
  },
  {
    id: "view.toggleInvisibles",
    labelKey: useUi.getState().invisibles
      ? "palette.cmd.hideInvisibles"
      : "palette.cmd.showInvisibles",
  },
  { id: "editor.gotoLine", labelKey: "menu.edit.gotoLine" },
  // The open note's headings alone (ADR-0037); `@` in ⌘P does the same.
  ...(previewKind(useTabs.getState().active ?? "") === "markdown"
    ? [{ id: "palette.gotoHeading", labelKey: "palette.cmd.gotoHeading" }]
    : []),
  { id: "find.open", labelKey: "menu.edit.find" },
  { id: "find.replace", labelKey: "menu.edit.findAndReplace" },
  { id: "markdown.bold", labelKey: "menu.edit.bold" },
  { id: "markdown.italic", labelKey: "menu.edit.italic" },
  { id: "markdown.link", labelKey: "menu.edit.insertLink" },
  { id: "markdown.toggleCheckbox", labelKey: "menu.edit.toggleCheckbox" },
  { id: "editor.insertDateTime", labelKey: "palette.cmd.insertDateTime" },
  { id: "editor.sortLines", labelKey: "palette.cmd.sortLines" },
  { id: "editor.joinLines", labelKey: "palette.cmd.joinLines" },
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
}
