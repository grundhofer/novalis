import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Banner from "./components/Banner";
import Prompt from "./components/Prompt";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import TabStrip from "./components/TabStrip";
import TitleBar from "./components/TitleBar";
import Toast from "./components/Toast";
import { initI18n } from "./i18n";
import { commands, events, NovalisError, unwrap, type FsBatch } from "./ipc/client";
import { dispatchCommand } from "./lib/commands";
import { chordOf, commandForChord, glyphsOf } from "./lib/keymap";
import { isNote } from "./lib/paths";
import { useBoard } from "./stores/board";
import { useEditorSave } from "./stores/editorSave";
import { useNotes } from "./stores/notes";
import { useTabs } from "./stores/tabs";
import { useUi, watchSystemAppearance } from "./stores/ui";
import { useVault } from "./stores/vault";

// Everything expensive is behind a dynamic import so it never lands in the
// eager payload the bundle-budget gate measures (PLAN.md §11.3).
const Editor = lazy(() => import("./editor/Editor"));
const Palette = lazy(() => import("./components/Palette"));
const SearchPanel = lazy(() => import("./components/SearchPanel"));
const BoardPane = lazy(() => import("./components/BoardPane"));

/** `state.json` is written at most this often while the user moves things. */
const STATE_SAVE_MS = 400;
/**
 * A menu accelerator and the webview can, on some platforms, both deliver the
 * same chord. Running a command twice within this window is always the same
 * event arriving twice.
 */
const DEDUPE_MS = 60;

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

  const vault = useVault((s) => s.vault);
  const active = useTabs((s) => s.active);
  const doc = useEditorSave((s) => (active ? s.docs[active] : undefined));
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const boardVisible = useUi((s) => s.boardVisible);
  const overlay = useUi((s) => s.overlay);
  const spellcheck = useUi((s) => s.settings?.spellcheck ?? true);

  const dispatch = useCallback((id: string) => {
    const now = Date.now();
    if (lastCommand.current.id === id && now - lastCommand.current.at < DEDUPE_MS) return;
    lastCommand.current = { id, at: now };
    dispatchCommand(id);
  }, []);

  // ---- boot: one call, then paint (PLAN.md §2.3 rules 1 and 8) ------------
  useEffect(() => {
    void (async () => {
      try {
        // i18n first and without IPC: a boot that fails must still be able to
        // say so in the user's language (fail loud, never a blank window).
        await initI18n(navigator.language.startsWith("de") ? "de" : "en");
        const boot = await unwrap(commands.bootstrap());
        await initI18n(boot.locale);
        useUi.getState().hydrate(boot.settings, boot.lastOpen, boot.locale);
        if (boot.vault) {
          useVault.getState().setVault(boot.vault, boot.tree);
          useBoard.getState().setBoards(boot.vault.boards);
        }
        setReady(true);

        // After the tree is interactive: the note list and the last session's
        // tabs. Never before (rule 12). A failure here is not fatal — the
        // window is already usable — so it only reports itself.
        if (boot.vault) {
          void useNotes.getState().refresh();
          for (const path of boot.lastOpen.openTabs ?? []) {
            await useTabs.getState().open(path, { background: true });
          }
          if (boot.lastOpen.activeTab) await useTabs.getState().activate(boot.lastOpen.activeTab);
          if (boot.lastOpen.activeBoard) void useBoard.getState().load(boot.lastOpen.activeBoard);
        }
      } catch (error) {
        // Anything thrown before `ready` would otherwise leave an empty window
        // with no way to find out why (Rule 5: fail loud).
        setBootError(error);
      }
    })();
  }, []);

  // ---- watcher batches ---------------------------------------------------
  useEffect(() => {
    const unlisten = events.fsBatch.listen((event) => {
      const batch: FsBatch = event.payload;
      useVault.getState().applyBatch(batch);

      const openDocs = useEditorSave.getState().docs;
      for (const entry of batch.modified) {
        if (openDocs[entry.path]) void useEditorSave.getState().externalChange(entry.path);
      }
      for (const rename of batch.renamed) {
        if (openDocs[rename.from]) useTabs.getState().rename(rename.from, rename.to);
      }
      if (batch.added.some((e) => isNote(e.path)) || batch.removed.some(isNote)) {
        void useNotes.getState().refresh();
      }
      const board = useBoard.getState().slug;
      if (board && [...batch.added, ...batch.modified].some((e) => e.path.startsWith(`boards/${board}/`))) {
        void useBoard.getState().refresh();
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  // ---- native menu -------------------------------------------------------
  useEffect(() => {
    const unlisten = events.menuAction.listen((event) => dispatch(event.payload.id));
    return () => void unlisten.then((stop) => stop());
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
      // focus; only the global ones are intercepted here.
      if (binding.scope !== "global" && document.activeElement?.closest(".cm-editor")) return;
      event.preventDefault();
      dispatch(binding.command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  // ---- system appearance, autosave flush ---------------------------------
  useEffect(() => watchSystemAppearance(), []);

  useEffect(() => {
    const flush = () => void useEditorSave.getState().flushAll();
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
  const activeBoard = useUi((s) => s.activeBoard);
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => {
      void unwrap(
        commands.stateSave({
          openTabs: tabs,
          activeTab: active,
          sidebarVisible,
          sidebarWidth,
          boardVisible,
          activeBoard,
        }),
      ).catch(() => {
        // Losing the window layout is not worth a message; the next save wins.
      });
    }, STATE_SAVE_MS);
    return () => clearTimeout(timer);
  }, [ready, tabs, active, sidebarVisible, sidebarWidth, boardVisible, activeBoard]);

  const followLink = useCallback((target: string) => {
    const clean = target
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .split("|")[0]!
      .split("#")[0]!
      .trim();
    const paths = useNotes.getState().paths;
    const wanted = clean.toLowerCase().replace(/\.md$/, "");
    const hit =
      paths.find((path) => path.toLowerCase().replace(/\.md$/, "") === wanted) ??
      paths.find((path) => path.toLowerCase().replace(/\.md$/, "").endsWith(`/${wanted}`));
    if (hit) void useTabs.getState().open(hit);
  }, []);

  const notePaths = useCallback(() => useNotes.getState().paths, []);

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
          </div>
        )}
        <main className="main">
          <TabStrip />
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
          ) : active && doc ? (
            <Suspense fallback={<div className="pane-loading">{t("editor.loading")}</div>}>
              <Editor
                path={active}
                revision={doc.revision}
                spellcheck={spellcheck}
                onFollowLink={followLink}
                notePaths={notePaths}
              />
            </Suspense>
          ) : (
            <div className="empty-state">
              <p className="empty-body">{t("editor.emptyState", { chord: glyphsOf("Cmd+P") })}</p>
            </div>
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
