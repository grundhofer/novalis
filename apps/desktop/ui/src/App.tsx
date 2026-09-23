import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";

import Banner from "./components/Banner";
import CloudHint from "./components/CloudHint";
import LegacyHint from "./components/LegacyHint";
import Prompt from "./components/Prompt";
import Sidebar from "./components/Sidebar";
import SidebarResize from "./components/SidebarResize";
import StatusBar from "./components/StatusBar";
import TabStrip from "./components/TabStrip";
import TitleBar from "./components/TitleBar";
import Toast from "./components/Toast";
import { initI18n } from "./i18n";
import { commands, events, NovalisError, unwrap, type FsBatch } from "./ipc/client";
import { dispatchCommand, newNote } from "./lib/commands";
import { folderOf } from "./lib/paths";
import { isSupported, previewKind, viewKind } from "./lib/fileTypes";
import { chordOf, commandForChord, glyphsOf } from "./lib/keymap";
import { resolveDestination, resolveWikiTarget } from "./lib/links";
import { openAt } from "./lib/openAt";
import { uiStateNow } from "./lib/uiState";
import { windowTitle } from "./lib/windowTitle";
import { useBoard } from "./stores/board";
import { useEditorSave } from "./stores/editorSave";
import { useFiles } from "./stores/files";
import { useTabs } from "./stores/tabs";
import { report, useUi, watchSystemAppearance } from "./stores/ui";
import { useVault } from "./stores/vault";

// Everything expensive is behind a dynamic import so it never lands in the
// eager payload the bundle-budget gate measures (PLAN.md §11.3).
const Editor = lazy(() => import("./editor/Editor"));
const Palette = lazy(() => import("./components/Palette"));
const SearchPanel = lazy(() => import("./components/SearchPanel"));
const BoardPane = lazy(() => import("./components/BoardPane"));
const Viewer = lazy(() => import("./components/Viewer"));
const Preview = lazy(() => import("./components/Preview"));
const TablePreview = lazy(() => import("./components/TablePreview"));
const SvgPreview = lazy(() => import("./components/SvgPreview"));
const Backlinks = lazy(() => import("./components/Backlinks"));

/** `state.json` is written at most this often while the user moves things. */
const STATE_SAVE_MS = 400;
/**
 * A menu accelerator and the webview can, on some platforms, both deliver the
 * same chord. Running a command twice within this window is always the same
 * event arriving twice.
 */
const DEDUPE_MS = 60;

/**
 * A board's `board.json`, the board folder, or `boards/` itself: what a board
 * arriving by sync or the CLI touches, and what trashing or renaming the
 * folder does. The list of boards is otherwise read once, when the vault
 * opens, so it never learned of them.
 */
function touchesBoardList(path: string): boolean {
  return path === "boards" || /^boards\/[^/]+(\/board\.json)?$/.test(path);
}

/**
 * What a failed boot shows. Deliberately the raw code and message rather than a
 * catalog sentence: this is diagnostic data, and it has to survive a failure of
 * anything the catalog depends on.
 */
function describeBootError(error: unknown): string {
  if (error instanceof NovalisError) {
    const where = error.ipc.path ? ` (${error.ipc.path})` : "";
    const detail = error.ipc.detail ? `: ${error.ipc.detail}` : "";
    return `${error.code}${where}${detail}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export default function App() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<unknown>(null);
  const lastCommand = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  const booted = useRef(false);

  const vault = useVault((s) => s.vault);
  const active = useTabs((s) => s.active);
  const doc = useEditorSave((s) => (active ? s.docs[active] : undefined));
  const view = active ? viewKind(active) : null;
  const previewing = useUi((s) => (active ? !!s.previewing[active] : false));
  const second = active && previewing ? previewKind(active) : null;
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const boardVisible = useUi((s) => s.boardVisible);
  const backlinksVisible = useUi((s) => s.backlinksVisible);
  const cloudHintShown = useUi((s) => s.cloudHintShown);
  const overlay = useUi((s) => s.overlay);
  const spellcheck = useUi((s) => s.settings?.spellcheck ?? true);
  const invisibles = useUi((s) => s.invisibles);

  const dispatch = useCallback((id: string) => {
    const now = Date.now();
    if (lastCommand.current.id === id && now - lastCommand.current.at < DEDUPE_MS) return;
    lastCommand.current = { id, at: now };
    dispatchCommand(id);
  }, []);

  // ---- boot: one call, then paint (PLAN.md §2.3 rules 1 and 8) ------------
  useEffect(() => {
    // Development mounts twice (StrictMode) and there is no cancelling a
    // `bootstrap()` already in flight: it would attach the vault and start a
    // watcher a second time, and the two boots' answers would race in the
    // stores. Booting once per mount is the behaviour of the built app.
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      // i18n first and without IPC: a boot that fails must still be able to
      // say so in the user's language (fail loud, never a blank window).
      await initI18n(navigator.language.startsWith("de") ? "de" : "en");
      const boot = await unwrap(commands.bootstrap());
      await initI18n(boot.locale);
      useUi.getState().hydrate(boot.settings, boot.lastOpen, boot.locale);
      // The probe is a dev tool behind an env var: its chunk stays out of the
      // eager bundle.
      if (boot.perf) (await import("./lib/perf")).startKeystrokeProbe(boot.perf);
      if (boot.vault) {
        useVault.getState().setVault(boot.vault, boot.tree);
        useBoard.getState().setBoards(boot.vault.boards);
      }
      setReady(true);

      // After the tree is interactive: the note list and the last session's
      // tabs. Never before (rule 12). A failure here is not fatal — the
      // window is already usable — so it only reports itself.
      if (boot.vault) {
        void useFiles.getState().refresh().catch(report);
        const { boardVisible: boardWasVisible, activeBoard } = boot.lastOpen;
        useTabs.setState({ recent: boot.lastOpen.recentFiles ?? [] });
        await useTabs.getState().reopen(boot.lastOpen.openTabs ?? [], boot.lastOpen.activeTab ?? null);
        // Making the tab current hid the board (stores/tabs.ts); one that was
        // showing when the app quit comes back over it.
        if (boardWasVisible && activeBoard) useUi.getState().setActiveBoard(activeBoard);
        // A board that is gone since last time (deleted elsewhere, or a
        // different vault) is a toast, not a red overlay over a working
        // window; `load` itself forgets the board so the next start does
        // not try again.
        if (activeBoard) {
          void useBoard.getState().load(activeBoard).catch(report);
        }
      }
      // Anything thrown before `ready` would otherwise leave an empty window
      // with no way to find out why (Rule 5: fail loud).
    })().catch(setBootError);
  }, []);

  // ---- watcher batches ---------------------------------------------------
  useEffect(() => {
    const unlisten = events.fsBatch.listen((event) => {
      const batch: FsBatch = event.payload;
      useVault.getState().applyBatch(batch);

      const openDocs = useEditorSave.getState().docs;
      for (const entry of batch.modified) {
        if (openDocs[entry.path]) void useEditorSave.getState().externalChange(entry.path).catch(report);
      }
      // A file gone under an open tab (feature-gaps A17): a clean buffer's tab
      // closes, unsaved text waits under the deleted-on-disk banner. A viewer
      // tab has no buffer; it closes.
      for (const path of batch.removed) {
        if (openDocs[path]) {
          void useEditorSave
            .getState()
            .deletedOnDisk(path)
            .then((outcome) => (outcome === "gone" ? useTabs.getState().close(path) : undefined))
            .catch(report);
        } else if (useTabs.getState().tabs.includes(path) && viewKind(path)) {
          void useTabs.getState().close(path).catch(report);
        }
      }
      for (const rename of batch.renamed) {
        if (openDocs[rename.from]) {
          // The doc map is re-keyed first: the tab rename switches what the
          // pane looks up, and it must not look up a path that is not there.
          useEditorSave.getState().rename(rename.from, rename.to);
          useTabs.getState().rename(rename.from, rename.to);
        }
      }
      if (batch.added.some((e) => isSupported(e.path)) || batch.removed.some(isSupported)) {
        void useFiles.getState().refresh().catch(report);
      }
      const board = useBoard.getState().slug;
      if (board && [...batch.added, ...batch.modified].some((e) => e.path.startsWith(`boards/${board}/`))) {
        void useBoard.getState().refresh().catch(report);
      }
      if (
        [...batch.added, ...batch.modified].some((e) => touchesBoardList(e.path)) ||
        batch.removed.some(touchesBoardList) ||
        batch.renamed.some((r) => touchesBoardList(r.from) || touchesBoardList(r.to))
      ) {
        void useBoard.getState().refreshList().catch(report);
      }
    });
    return () => void unlisten.then((stop) => stop()).catch(report);
  }, []);

  // ---- native menu -------------------------------------------------------
  useEffect(() => {
    const unlisten = events.menuAction.listen((event) => dispatch(event.payload.id));
    return () => void unlisten.then((stop) => stop()).catch(report);
  }, [dispatch]);

  // ---- the keymap (docs/KEYMAP.md) ---------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (useUi.getState().overlay.kind !== "none") {
          useUi.getState().setOverlay({ kind: "none" });
          event.preventDefault();
        }
        return;
      }
      const chord = chordOf(event);
      if (!chord) return;
      const binding = commandForChord(chord);
      if (!binding) return;
      // Editor-scoped chords are CodeMirror's own bindings when the editor has
      // focus; only the global ones are intercepted here. Viewer-scoped ones
      // are the PDF pane's, which takes them itself (ADR-0025).
      if (binding.scope === "viewer") return;
      if (binding.scope !== "global" && document.activeElement?.closest(".cm-editor")) return;
      event.preventDefault();
      dispatch(binding.command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  // ---- the macOS window title (lib/windowTitle.ts) -------------------------
  const vaultName = vault?.name ?? null;
  useEffect(() => {
    // A title that cannot be set costs nothing but the title: never a toast.
    void getCurrentWindow()
      .setTitle(windowTitle(active, vaultName))
      .catch(() => undefined);
  }, [active, vaultName]);

  // ---- system appearance, autosave flush ---------------------------------
  useEffect(() => watchSystemAppearance(), []);

  useEffect(() => {
    const flush = () => void useEditorSave.getState().flushAll().catch(report);
    window.addEventListener("blur", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  // ---- persist the disposable half of the state --------------------------
  const tabs = useTabs((s) => s.tabs);
  const recent = useTabs((s) => s.recent);
  const activeBoard = useUi((s) => s.activeBoard);
  const treeSort = useUi((s) => s.treeSort);
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => {
      // The values are the stores' (`lib/uiState.ts`); the dependencies
      // below are what makes a change of any of them save.
      void unwrap(commands.stateSave(uiStateNow())).catch(() => {
        // Losing the window layout is not worth a message; the next save wins.
      });
    }, STATE_SAVE_MS);
    return () => clearTimeout(timer);
  }, [
    ready,
    tabs,
    active,
    recent,
    sidebarVisible,
    sidebarWidth,
    boardVisible,
    backlinksVisible,
    cloudHintShown,
    activeBoard,
    treeSort,
  ]);

  const followLink = useCallback((target: string) => {
    // A Markdown destination is a path relative to the note (PLAN.md §7.2):
    // a `.md` opens in the editor, an image or PDF in the viewer (ADR-0017).
    const destination = resolveDestination(useTabs.getState().active, target);
    if (destination && isSupported(destination)) {
      void useTabs.getState().open(destination).catch(report);
      return;
    }
    const [name = "", heading] = target
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .split("|")[0]!
      .split("#")
      .map((part) => part.trim());
    // `[[#Heading]]` is a heading of the note it is written in.
    const hit = name === "" ? useTabs.getState().active : resolveWikiTarget(name, useFiles.getState().notes);
    if (!hit) {
      // A link to no note offers to make it, beside the note it is written
      // in, the name filled in (ADR-0038); nothing is written until OK.
      if (name) newNote(folderOf(useTabs.getState().active ?? ""), name);
      return;
    }
    // `[[note#heading]]` lands on the heading (§7.2); the pane settles it
    // against the text it shows, like a backlink's line.
    if (heading) openAt(hit, { line: 1, snippet: "", heading });
    else void useTabs.getState().open(hit).catch(report);
  }, []);

  const notePaths = useCallback(() => useFiles.getState().notes, []);

  if (bootError) {
    return (
      <div className="boot boot-error">
        <div className="boot-error-card" role="alert">
          <h1>{t("errors.title")}</h1>
          <p className="boot-error-detail">{describeBootError(bootError)}</p>
          <button type="button" onClick={() => void dispatchCommand("vault.open")}>
            {t("app.openVault.button")}
          </button>
        </div>
      </div>
    );
  }
  if (!ready) return <div className="boot" />;

  return (
    <div className="win">
      <TitleBar />
      <div className="body">
        {sidebarVisible && (
          <div className="sidebar-host" style={{ width: `${sidebarWidth}px` }}>
            <Sidebar />
            <SidebarResize />
          </div>
        )}
        <main className="main">
          <TabStrip />
          <CloudHint />
          <LegacyHint />
          <Banner />
          {boardVisible ? (
            <Suspense fallback={<div className="pane-loading">{t("editor.loading")}</div>}>
              <BoardPane />
            </Suspense>
          ) : !vault ? (
            <div className="empty-state">
              <h1 className="empty-title">{t("app.openVault.title")}</h1>
              <p className="empty-body">{t("app.openVault.body")}</p>
              <button className="btn primary" type="button" onClick={() => dispatch("vault.open")}>
                {t("app.openVault.button")}
              </button>
            </div>
          ) : active && view ? (
            <Suspense fallback={<div className="pane-loading">{t("editor.loading")}</div>}>
              <Viewer path={active} kind={view} />
            </Suspense>
          ) : active && !doc ? (
            // A note on its way: read, or downloaded from the cloud (§2.3
            // rule 7); `tabs.open` removes the tab again if that fails.
            <div className="pane-loading">{t("editor.loading")}</div>
          ) : active && doc && second ? (
            <Suspense fallback={<div className="pane-loading">{t("editor.loading")}</div>}>
              {second === "markdown" ? (
                <Preview path={active} onFollowLink={followLink} />
              ) : second === "svg" ? (
                <SvgPreview path={active} />
              ) : (
                <TablePreview path={active} kind={second} />
              )}
            </Suspense>
          ) : active && doc ? (
            <Suspense fallback={<div className="pane-loading">{t("editor.loading")}</div>}>
              <Editor
                path={active}
                revision={doc.revision}
                spellcheck={spellcheck}
                invisibles={invisibles}
                onFollowLink={followLink}
                notePaths={notePaths}
              />
            </Suspense>
          ) : (
            <div className="empty-state">
              <p className="empty-body">{t("editor.emptyState", { chord: glyphsOf("Cmd+P") })}</p>
            </div>
          )}
          {/* Under the editor, never beside the board: the board owns the whole
              pane, and a backlinks list about a note is meaningless there. */}
          {backlinksVisible && !boardVisible && active && (
            <Suspense fallback={null}>
              <Backlinks />
            </Suspense>
          )}
        </main>
      </div>
      <StatusBar />

      {overlay.kind === "quickOpen" && (
        <Suspense fallback={null}>
          <Palette mode="quickOpen" />
        </Suspense>
      )}
      {overlay.kind === "palette" && (
        <Suspense fallback={null}>
          <Palette mode="palette" />
        </Suspense>
      )}
      {overlay.kind === "settings" && (
        <Suspense fallback={null}>
          <Palette mode="settings" />
        </Suspense>
      )}
      {overlay.kind === "headings" && (
        <Suspense fallback={null}>
          <Palette mode="headings" />
        </Suspense>
      )}
      {overlay.kind === "pickNote" && (
        <Suspense fallback={null}>
          <Palette mode="pickNote" pick={overlay} />
        </Suspense>
      )}
      {overlay.kind === "search" && (
        <Suspense fallback={null}>
          <SearchPanel />
        </Suspense>
      )}
      <Prompt />
      <Toast />
    </div>
  );
}
