import { currentArea, moveArea } from "./areas";
import { menuCardNow, runCardMenuAction } from "./cardActions";
import {
  editorSelection,
  editorSelectionOrLine,
  isEditorCommand,
  runEditorCommand,
} from "./editorBridge";
import { isPreviewCommand, previewMounted, runPreviewCommand } from "./previewBridge";
import { commands, NovalisError, unwrap, type CardDto, type MenuTargetsDto } from "../ipc/client";
import { useBoard } from "../stores/board";
import { useEditorSave } from "../stores/editorSave";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { report, SIDEBAR_WIDTH, sidebarShown, useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { previewKind, viewKind } from "./fileTypes";
import { localIsoDay } from "./localTime";
import { resolveWikiTarget, wikiLinkFor } from "./links";
import { ancestorsOf, fileNameOf, folderOf, isExternal, isNote, joinRel } from "./paths";
import { leaveSettingsView, openSettingsView } from "./settingsView";
import { uiStateNow } from "./uiState";
import { toggleSidebar } from "./windowFit";

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
 * Where a command came from, when that changes what it does: `"menu"` is the
 * native menu (`events.menuAction`), `"tool"` a tool in the window and
 * `"palette"` the command palette. Only a tool and the palette move focus
 * into the overlay they open; a menu command and a chord do not (DSK-04,
 * D95 (b), ADR-0051 #48).
 */
export type CommandOrigin = "menu" | "tool" | "palette";

/**
 * The New Note dialog, into `folder`. `initial` fills the name — the target
 * of a `[[link]]` that resolves to nothing (ADR-0038); nothing is written
 * until „Anlegen“.
 */
export function newNote(folder: string, initial = ""): void {
  useUi.getState().ask({
    titleKey: "menu.file.newNote",
    submitKey: "app.create",
    busyKey: "app.creating",
    labelKey: "tree.nameLabel",
    initial,
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

/**
 * "Create …" in quick-open (ADR-0038): the typed name as a note where
 * `Cmd+N` would put it, opened; a typed extension makes that file
 * (ADR-0014). Already there — typed in another case, or made meanwhile —
 * it is opened instead.
 */
export async function createNoteNamed(name: string): Promise<void> {
  const folder = targetFolder();
  try {
    const entry = await unwrap(commands.createNote(folder, name));
    await useVault.getState().reload(folder);
    await useFiles.getState().refresh();
    await useTabs.getState().open(entry.path);
  } catch (error) {
    if (!(error instanceof NovalisError && error.code === "already_exists")) throw error;
    const existing = resolveWikiTarget(name, useFiles.getState().notes);
    if (existing) await useTabs.getState().open(existing);
  }
}

async function newFolder(folder: string): Promise<void> {
  useUi.getState().ask({
    titleKey: "menu.file.newFolder",
    submitKey: "app.create",
    busyKey: "app.creating",
    labelKey: "tree.nameLabel",
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
  const result = await unwrap(commands.rename(from, target));
  useEditorSave.getState().rename(from, target);
  useTabs.getState().rename(from, target);
  // The tree's chosen row and the keys' row go along, or the next tree
  // command would act on a path that is gone.
  useVault.setState((s) => ({
    selected: s.selected === from ? target : s.selected,
    focused: s.focused === from ? target : s.focused,
  }));
  // The shell rewrote links in these files — the moved note's own relative
  // ones among them (ADR-0042). An open buffer with nothing unsaved takes
  // the new text now; left alone, the watcher would take the shell's write
  // for someone else's and raise the sync banner.
  for (const path of result?.rewritten ?? []) {
    const doc = useEditorSave.getState().docs[path];
    if (doc && !doc.dirty) await useEditorSave.getState().reloadFromDisk(path);
  }
  const vault = useVault.getState();
  const fromFolder = folderOf(from);
  const toFolder = folderOf(target);
  await vault.reload(fromFolder);
  if (toFolder !== fromFolder) await vault.reload(toFolder);
  await useFiles.getState().refresh();
}

async function renamePath(path: string): Promise<void> {
  useUi.getState().ask({
    titleKey: "tree.renameTitle",
    titleValues: { name: fileNameOf(path) },
    submitKey: "app.rename",
    busyKey: "app.renaming",
    labelKey: "tree.newNameLabel",
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
 * The file Move To… acts on (DSK-11): the tree's row, else the active tab —
 * a file the vault lists, never a folder (they do not move, ADR-0018), a
 * board or a file from outside the vault.
 */
function movablePath(): string | null {
  const path = targetPath();
  return path && !isExternal(path) && useFiles.getState().files.includes(path) ? path : null;
}

/**
 * The folders a file can go to: the vault root, every folder a listed file
 * lies in and every folder the tree has listed (so an empty one it shows),
 * in path order. A board's directory is no folder (ADR-0012), and the
 * file's own folder is left out, since moving there does nothing.
 */
function moveTargets(path: string): string[] {
  const boardDirs = useBoard.getState().boards.map((b) => `boards/${b.slug}`);
  const isBoardDir = (folder: string) => boardDirs.some((dir) => folder === dir || folder.startsWith(`${dir}/`));
  const folders = new Set<string>([""]);
  for (const file of useFiles.getState().files) for (const folder of ancestorsOf(file)) folders.add(folder);
  for (const entries of Object.values(useVault.getState().children)) {
    for (const entry of entries) if (entry.dir && !entry.boardSlug) folders.add(entry.path);
  }
  folders.delete(folderOf(path));
  return [...folders].filter((folder) => !isBoardDir(folder)).sort((a, b) => a.localeCompare(b));
}

/**
 * Move To… (DSK-11, spec/02 §4.22, ADR-0051 #5): the way to move a file
 * without dragging — the folder chosen in the picker, which names the file,
 * the move the drop's own (`renameTo`, so links are rebased, ADR-0042).
 * Afterwards the file's row is the tree's tab stop and scrolled into view,
 * so the move is seen where it went and needs no toast (spec/07 §4.3); it
 * takes focus only when the command came from the tree, so writing in the
 * editor goes on there (ZUG-06). A hidden tree shows nothing, so a toast
 * says where the file went and offers „Rückgängig“ (`moveBack`, D102 (16),
 * ADR-0051 #39) — the one undo novalis has for a move; a drop shows its row.
 */
function moveTo(): void {
  const path = movablePath();
  if (!path) return;
  const fromTree = currentArea()?.id === "sidebar";
  useUi.getState().setOverlay({
    kind: "pickFolder",
    name: fileNameOf(path),
    folders: moveTargets(path),
    onPick: async (folder) => {
      const target = joinRel(folder, fileNameOf(path));
      await renameTo(path, target);
      await useVault.getState().reveal(target);
      if (sidebarShown(useUi.getState())) {
        useVault.getState().focus(target, fromTree, true);
        return;
      }
      useVault.getState().focus(target);
      useUi
        .getState()
        .showToast(
          "tree.movedTo",
          { folder: folderLabel(folder) },
          { labelKey: "app.undo", run: () => moveBack(target, path) },
        );
    },
  });
}

/** A folder as a sentence names it: the vault's name for its root. */
function folderLabel(folder: string): string {
  return folder === "" ? (useVault.getState().vault?.name ?? "") : folder;
}

/**
 * „Rückgängig“ in the toast after Move To… (ADR-0051 #39, D102 (16)): the
 * file at `path` goes back to `back`, where it was, through the same rename
 * as the move (`renameTo`, so links are rebased again; no IPC command of its
 * own). The core never overwrites: when a file has taken the old place since,
 * a sentence in the action zone says so and the file stays where it went.
 * Any other failure (the file moved on, say) is the core's sentence.
 */
async function moveBack(path: string, back: string): Promise<void> {
  try {
    await renameTo(path, back);
  } catch (error) {
    if (!(error instanceof NovalisError && error.code === "already_exists")) throw error;
    useUi
      .getState()
      .showMessage("tree.moveBackTaken", { name: fileNameOf(back), folder: folderLabel(folderOf(back)) });
    return;
  }
  await useVault.getState().reveal(back);
  useVault.getState().focus(back);
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
    // To the Trash, so worded as a file to the Trash (AKT-08).
    titleKey: "board.deleteBoardTitle",
    titleValues: { name },
    confirm: {
      bodyKey: "board.deleteBoardBody",
      values: { name },
      confirmKey: "app.confirmTrash.confirm",
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
  // The text says what lands in the Trash (AKT-08): a folder goes with
  // everything in it.
  const dir = useVault.getState().children[folderOf(path)]?.find((e) => e.path === path)?.dir;
  useUi.getState().ask({
    titleKey: "app.confirmTrash.title",
    titleValues: { name: fileNameOf(path) },
    confirm: {
      bodyKey: dir ? "app.confirmTrash.bodyFolder" : "app.confirmTrash.body",
      confirmKey: "app.confirmTrash.confirm",
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
 * or the only board there is. A board hidden by the board tool loses its
 * tab (ADR-0051 #35) but stays loaded, and stays the one.
 */
function cardBoard(): string | null {
  const { boards, slug } = useBoard.getState();
  return useUi.getState().activeBoard ?? slug ?? (boards.length === 1 ? (boards[0]?.slug ?? null) : null);
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
    submitKey: "app.create",
    busyKey: "app.creating",
    labelKey: "board.cardTitleLabel",
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
export async function createNoteFromCard(card: CardDto): Promise<void> {
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
  // A card links vault notes; a file from outside it is none (ADR-0047).
  if (!note || !isNote(note) || isExternal(note) || !slug) return;
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

/** A board's tree row (`boards/<slug>`), which is no file to hand anywhere. */
function isBoardPath(path: string): boolean {
  return useBoard.getState().boards.some((b) => `boards/${b.slug}` === path);
}

/**
 * Copy Path / Copy Link to Note (ADR-0043), from the palette, whose Enter
 * or click is the user's gesture the clipboard needs. What was copied is
 * said, since nothing else shows it.
 */
async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  useUi.getState().showToast("palette.copied", { text });
}

/** The selected row's, else the active tab's, absolute path. */
function copyPath(): Promise<void> | void {
  const path = targetPath();
  if (path && isExternal(path)) return copyText(path);
  const root = useVault.getState().vault?.root;
  if (!path || !root || isBoardPath(path)) return;
  return copyText(`${root}/${path}`);
}

/** The `[[…]]` a note is linked by — the form a drop inserts (ADR-0040). */
function copyLink(): Promise<void> | void {
  const path = targetPath();
  if (!path || !isNote(path) || isExternal(path)) return;
  return copyText(wikiLinkFor(path, useFiles.getState().notes));
}

async function newBoard(): Promise<void> {
  useUi.getState().ask({
    titleKey: "board.newBoard",
    submitKey: "app.create",
    busyKey: "app.creating",
    labelKey: "board.boardNameLabel",
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

/**
 * The tree's context menu (ADR-0021): the row is selected first, so the
 * entries — File and Edit menu ids the shell pops as a native menu — act on
 * it the way `Cmd+Backspace` would. A board row gets "Show in Finder" only, a
 * folder no Move To….
 */
export function openTreeContextMenu(path: string, board: boolean, folder: boolean): Promise<void> {
  useVault.getState().select(path);
  return unwrap(commands.contextMenu({ kind: "tree", board, folder })).then(() => undefined);
}

/**
 * What a tree command acts on: the row the tree's keys are on (NAV-11:
 * focus moves without choosing), else the chosen row, else the active tab.
 * The keys' row is the chosen one again once focus is in another area
 * (Sidebar), so a command never acts on a row nobody sees.
 */
function targetPath(): string | null {
  const vault = useVault.getState();
  return vault.focused ?? vault.selected ?? useTabs.getState().active;
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
  // Nothing is created beside a file from outside the vault (ADR-0047).
  if (!path || isExternal(path)) return "";
  const entry = useVault.getState().children[folderOf(path)]?.find((e) => e.path === path);
  return entry?.dir && !entry.boardSlug ? path : folderOf(path);
}

/**
 * View ▸ Sidebar Width ▸ Narrow · Normal · Wide, and the palette's three
 * rows (spec/02 §4.23, DSK-07, ADR-0051): the way to a width without
 * dragging. The choice is the width from now on, stored like a drag, and a
 * hidden sidebar opens with it; focus stays where it was (D95 (b)). In a
 * window too narrow for it, where it lies over the content (lib/windowFit.ts),
 * the choice only keeps the width: the overlay stays as it is (DSK-07).
 */
function sidebarWidth(width: number): void {
  useUi.getState().setSidebarWidth(width);
  if (!useUi.getState().sidebarOverlay) useUi.getState().setSidebarVisible(true);
}

/**
 * Window ▸ Reiter nach vorn / nach hinten and the palette's two rows (spec/02
 * §4.21, D102 (5), WCAG 2.5.7): the way to reorder the tabs without
 * dragging. The current tab moves one place, as a drop there would
 * (ADR-0028); the board's tab is no note tab and stays first (ADR-0050).
 * Focus stays where it was.
 */
function moveTab(step: -1 | 1): void {
  const { tabs, active } = useTabs.getState();
  const index = active && !useUi.getState().boardVisible ? tabs.indexOf(active) : -1;
  if (active && index >= 0) useTabs.getState().move(active, index + step);
}

/**
 * What the native menu's commands have to act on now (sebaro D102 (9),
 * spec/02 §4.24): the shell switches an item without a target off
 * (`menu::has_target`). Each flag is its command's own condition here, so an
 * item is off exactly when the command would do nothing.
 */
export function menuTargetsNow(): MenuTargetsDto {
  const { tabs, active, closed, history, historyIndex } = useTabs.getState();
  const { boardVisible, settingsView, sidebarOverlay, sidebarOverlayOpen, previewing } = useUi.getState();
  const path = targetPath();
  const text = active !== null && !viewKind(active);
  const index = active && !boardVisible ? tabs.indexOf(active) : -1;
  // The current tab's preview, as the tab strip's switch has it; the board
  // and the settings view are current over it.
  const preview = active !== null && !boardVisible && !settingsView && !!previewKind(active);
  return {
    vault: useVault.getState().vault !== null,
    // ⌘W leaves the settings view (ADR-0051 #1), also with nothing behind it;
    // the board's pinned tab it does not close (ADR-0051 #35).
    close: settingsView || (!boardVisible && active !== null),
    save: text,
    // The settings view covers the editor as the board does.
    editor: text && !boardVisible && !settingsView,
    path: path !== null,
    vaultPath: path !== null && !isExternal(path),
    movable: movablePath() !== null,
    back: historyIndex > 0,
    forward: historyIndex < history.length - 1,
    reopen: closed.length > 0,
    cycle: tabs.length > 1 || (boardVisible && tabs.length > 0),
    earlier: index > 0,
    later: index >= 0 && index < tabs.length - 1,
    // View ▸ Sidebar checks what shows: over the content, the overlay.
    sidebarOverlay,
    sidebarOverlayOpen: sidebarOverlay && sidebarOverlayOpen,
    // View ▸ Preview (ADR-0051 #43): on with a preview, checked while it shows.
    preview,
    previewing: preview && active !== null && !!previewing[active],
  };
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

const REGISTRY: Record<string, (from?: CommandOrigin) => CommandResult> = {
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
  // The open board is a pinned tab (ADR-0050, ADR-0051 #35, D102 (5)):
  // while it shows, Cmd-W closes nothing, not the note behind it either; the
  // board tool and View ▸ Board hide it. Over both, the settings view goes
  // first: Cmd-W leaves it for the place before (DSK-02, ADR-0051 #1).
  "tab.close": () =>
    useUi.getState().settingsView
      ? leaveSettingsView()
      : useUi.getState().boardVisible
        ? undefined
        : useTabs.getState().closeActive(),
  "tab.reopenClosed": () => useTabs.getState().reopenClosed(),
  "tab.closeOthers": () => useTabs.getState().closeOthers(),
  // The board's pinned tab stays (ADR-0051 #35).
  "tab.closeAll": () => useTabs.getState().closeAll(),
  "tab.next": () => useTabs.getState().next(),
  "tab.previous": () => useTabs.getState().previous(),
  "tab.moveEarlier": () => moveTab(-1),
  "tab.moveLater": () => moveTab(1),
  "nav.back": () => useTabs.getState().back(),
  "nav.forward": () => useTabs.getState().forward(),
  "quickOpen.open": () => useUi.getState().setOverlay({ kind: "quickOpen" }),
  // ⌘K pressed again closes the palette (spec/02 §4.16).
  "palette.open": () =>
    useUi.getState().setOverlay(useUi.getState().overlay.kind === "palette" ? { kind: "none" } : { kind: "palette" }),
  // The settings view in the content area (DSK-02, ADR-0051 #1).
  "settings.open": () => openSettingsView(),
  "search.vault": () => useUi.getState().setOverlay({ kind: "search", query: searchSeed() }),
  "palette.gotoHeading": () => useUi.getState().setOverlay({ kind: "headings" }),
  "sidebar.toggle": (from) => toggleSidebar(from),
  "sidebar.width.min": () => sidebarWidth(SIDEBAR_WIDTH.min),
  "sidebar.width.start": () => sidebarWidth(SIDEBAR_WIDTH.start),
  "sidebar.width.max": () => sidebarWidth(SIDEBAR_WIDTH.max),
  "area.next": () => moveArea(false),
  "area.previous": () => moveArea(true),
  "backlinks.toggle": () => useUi.getState().toggleBacklinks(),
  "view.toggleInvisibles": () => useUi.getState().toggleInvisibles(),
  "board.toggle": () => useUi.getState().toggleBoard(useBoard.getState().slug),
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
  // Renaming and trashing are the vault's; a file from outside it is the
  // Finder's (ADR-0047).
  "tree.rename": () => {
    const path = targetPath();
    if (path && !isExternal(path)) return renamePath(path);
  },
  "tree.trash": () => {
    const path = targetPath();
    if (path && !isExternal(path)) return trashPath(path);
  },
  "tree.moveTo": () => moveTo(),
  "tree.reveal": () => {
    const path = targetPath();
    if (path) return unwrap(commands.systemOpen({ kind: "reveal", path })).then(() => undefined);
  },
  // Open in Default App (ADR-0043): the file, in the app macOS picks.
  "tree.openDefault": () => {
    const path = targetPath();
    if (path && !isBoardPath(path)) {
      return unwrap(commands.systemOpen({ kind: "default", path })).then(() => undefined);
    }
  },
  "file.copyPath": () => copyPath(),
  "file.copyLink": () => copyLink(),
  "settings.appearance.system": () => useUi.getState().setAppearance("system"),
  "settings.appearance.light": () => useUi.getState().setAppearance("light"),
  "settings.appearance.dark": () => useUi.getState().setAppearance("dark"),
  "settings.tone.cool": () => useUi.getState().setTone("cool"),
  "settings.tone.warm": () => useUi.getState().setTone("warm"),
  "settings.language.system": () => useUi.getState().setLanguage("system"),
  "settings.language.de": () => useUi.getState().setLanguage("de"),
  "settings.language.en": () => useUi.getState().setLanguage("en"),
  "settings.spellcheck": () =>
    useUi.getState().setSpellcheck(!(useUi.getState().settings?.spellcheck ?? true)),
  "settings.reduceMotion": () =>
    useUi.getState().setReduceMotion(!(useUi.getState().settings?.reduceMotion ?? false)),
};

for (let n = 1; n <= 9; n += 1) {
  REGISTRY[`tab.goto.${n}`] = () => useTabs.getState().goto(n);
}

/** Run a command by id. Unknown ids are ignored, not thrown. */
export function dispatchCommand(id: string, from?: CommandOrigin): void {
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
      const result = command(from);
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
 * A menu accelerator and the webview can, on some platforms, both deliver the
 * same chord. Running a command twice within this window is always the same
 * event arriving twice.
 */
export const DEDUPE_MS = 60;

/** The app's dispatcher for menu items and chords: `dispatchCommand`, deduplicated. */
export function createDispatch(now: () => number = Date.now): (id: string, from?: CommandOrigin) => void {
  let last = { id: "", at: 0 };
  return (id, from) => {
    const at = now();
    if (last.id === id && at - last.at < DEDUPE_MS) return;
    last = { id, at };
    // A native menu item is a user action the page sees no key or pointer
    // for: it ends a failure reason in the action zone (ADR-0051). After the
    // check above, so the second delivery of one chord keeps the first's.
    // A failure without a trigger outlives it for its first 10 s, which
    // `clearMessage` enforces (D102 (11)).
    useUi.getState().clearMessage();
    dispatchCommand(id, from);
  };
}

/**
 * Command ids the palette offers, in the order it shows them. `valueKey`
 * fills the label's `{{value}}`. The entries marked `settings` are the
 * settings' values (docs/SETTINGS.md), grouped under „Einstellungen“; the
 * settings view (ADR-0051 #1) shows the same six, and the palette stays a
 * second way to them (DSK-05).
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
  { id: "quickOpen.open", labelKey: "menu.file.quickOpen" },
  { id: "search.vault", labelKey: "menu.edit.findInVault" },
  // „…“: a dialog asks for the name first (D102 (22)).
  { id: "file.newNote", labelKey: "menu.file.newNoteItem" },
  { id: "file.todayNote", labelKey: "tree.todayNote" },
  { id: "journal.previousDay", labelKey: "palette.cmd.previousDay" },
  { id: "journal.nextDay", labelKey: "palette.cmd.nextDay" },
  { id: "tree.newFolder", labelKey: "menu.file.newFolderItem" },
  { id: "board.new", labelKey: "menu.file.newBoardItem" },
  // Only where there is a board to put the card on (ADR-0030).
  ...(cardBoard() ? [{ id: "board.newCard", labelKey: "board.newCard" }] : []),
  // From the note being read, onto the active board (ADR-0035).
  ...(cardBoard() && isNote(useTabs.getState().active ?? "") && !isExternal(useTabs.getState().active ?? "")
    ? [{ id: "board.cardFromSelection", labelKey: "palette.cmd.cardFromSelection" }]
    : []),
  { id: "settings.open", labelKey: "palette.cmd.settings" },
  { id: "vault.open", labelKey: "menu.file.openVault" },
  { id: "file.save", labelKey: "menu.file.save" },
  { id: "tab.closeOthers", labelKey: "palette.cmd.closeOtherTabs" },
  { id: "tab.closeAll", labelKey: "palette.cmd.closeAllTabs" },
  { id: "tree.rename", labelKey: "menu.file.rename" },
  // Only for a file that can move (DSK-11).
  ...(movablePath() ? [{ id: "tree.moveTo", labelKey: "menu.edit.moveTo" }] : []),
  { id: "tree.trash", labelKey: "menu.edit.moveToTrash" },
  { id: "tree.reveal", labelKey: "menu.file.revealInFinder" },
  { id: "tree.openDefault", labelKey: "menu.file.openInDefaultApp" },
  { id: "file.copyPath", labelKey: "palette.cmd.copyPath" },
  { id: "file.copyLink", labelKey: "palette.cmd.copyLink" },
  { id: "sidebar.toggle", labelKey: "palette.cmd.toggleSidebar" },
  { id: "sidebar.width.min", labelKey: "palette.cmd.sidebarWidth", valueKey: "sidebar.width.narrow" },
  { id: "sidebar.width.start", labelKey: "palette.cmd.sidebarWidth", valueKey: "sidebar.width.normal" },
  { id: "sidebar.width.max", labelKey: "palette.cmd.sidebarWidth", valueKey: "sidebar.width.wide" },
  // F6 / ⇧F6 also here: Mac keyboards often need fn for F6 (spec/02 §4.20).
  { id: "area.next", labelKey: "menu.window.nextArea" },
  { id: "area.previous", labelKey: "menu.window.previousArea" },
  // The way to reorder the tabs without dragging (spec/02 §4.21), where the
  // current tab can move that way.
  ...(menuTargetsNow().earlier ? [{ id: "tab.moveEarlier", labelKey: "menu.window.moveTabEarlier" }] : []),
  ...(menuTargetsNow().later ? [{ id: "tab.moveLater", labelKey: "menu.window.moveTabLater" }] : []),
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
  { id: "settings.tone.cool", labelKey: "palette.cmd.tone", valueKey: "settings.tone.cool", settings: true },
  { id: "settings.tone.warm", labelKey: "palette.cmd.tone", valueKey: "settings.tone.warm", settings: true },
  { id: "settings.language.system", labelKey: "palette.cmd.language", valueKey: "settings.language.system", settings: true },
  { id: "settings.language.de", labelKey: "palette.cmd.language", valueKey: "settings.language.de", settings: true },
  { id: "settings.language.en", labelKey: "palette.cmd.language", valueKey: "settings.language.en", settings: true },
  { id: "settings.spellcheck", labelKey: "menu.edit.checkSpellingWhileTyping", settings: true },
  { id: "settings.reduceMotion", labelKey: "menu.view.reduceMotion", settings: true },
  ];
}
