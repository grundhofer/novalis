import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";

import Banner from "./components/Banner";
import BootError from "./components/BootError";
import CloudHint from "./components/CloudHint";
import LegacyHint from "./components/LegacyHint";
import NoVault from "./components/NoVault";
import Prompt from "./components/Prompt";
import Sidebar from "./components/Sidebar";
import SidebarResize from "./components/SidebarResize";
import StatusBar from "./components/StatusBar";
import TabStrip, { DocPanel } from "./components/TabStrip";
import TitleBar from "./components/TitleBar";
import Toast from "./components/Toast";
import Waiting from "./components/Waiting";
import { initI18n } from "./i18n";
import { commands, events, unwrap, type FsBatch } from "./ipc/client";
import { trackAreaFocus } from "./lib/areas";
import { createDispatch, menuTargetsNow, newNote } from "./lib/commands";
import { openExternal, SCHEME } from "./lib/external";
import { watchFullscreen } from "./lib/fullscreen";
import { handleOpenRequests } from "./lib/opening";
import { folderOf, isExternal } from "./lib/paths";
import { isSupported, previewKind, viewKind } from "./lib/fileTypes";
import { chordOf, commandForChord, fieldKeeps } from "./lib/keymap";
import { resolveDestination, resolveWikiTarget } from "./lib/links";
import { openAt } from "./lib/openAt";
import { failStart, releaseStart } from "./lib/start";
import { uiStateNow } from "./lib/uiState";
import { watchWindowActive } from "./lib/windowActive";
import { watchSidebarFit } from "./lib/windowFit";
import { windowPlaces, windowTitle } from "./lib/windowTitle";
import { useBoard } from "./stores/board";
import { useEditorSave } from "./stores/editorSave";
import { useFiles } from "./stores/files";
import { useTabs } from "./stores/tabs";
import { report, reportBackground, useUi, watchSystemAppearance } from "./stores/ui";
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
const SettingsView = lazy(() => import("./components/SettingsView"));

/** `state.json` is written at most this often while the user moves things. */
const STATE_SAVE_MS = 400;
/**
 * A board's `board.json`, the board folder, or `boards/` itself: what a board
 * arriving by sync or the CLI touches, and what trashing or renaming the
 * folder does. The list of boards is otherwise read once, when the vault
 * opens, so it never learned of them.
 */
function touchesBoardList(path: string): boolean {
  return path === "boards" || /^boards\/[^/]+(\/board\.json)?$/.test(path);
}

export default function App() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<unknown>(null);
  const booted = useRef(false);
  // The vault the failed boot left in the store, if it got that far.
  const failedVault = useRef<unknown>(null);

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
  const settingsView = useUi((s) => s.settingsView);
  // The settings view has no action zone (spec/02 §4.24, D74); a failure or
  // a toast still needs its place, so the zone shows for them alone
  // (docs/sebaro-luecken.md T).
  const zoneSays = useUi((s) => s.message !== null || s.toast !== null);
  const spellcheck = useUi((s) => s.settings?.spellcheck ?? true);
  const invisibles = useUi((s) => s.invisibles);

  const dispatch = useMemo(() => createDispatch(), []);

  // ---- files and links macOS hands over while running (ADR-0045) ----------
  // Subscribed before the boot below asks for the queue, so a request that
  // arrives between the two is not lost.
  useEffect(() => {
    const unlisten = events.openRequested.listen((event) => handleOpenRequests(event.payload.items));
    return () => void unlisten.then((stop) => stop()).catch(report);
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
        void useFiles.getState().refresh().catch(reportBackground);
        const { boardVisible: boardWasVisible, activeBoard } = boot.lastOpen;
        useTabs.setState({ recent: boot.lastOpen.recentFiles ?? [] });
        await useTabs.getState().reopen(boot.lastOpen.openTabs ?? [], boot.lastOpen.activeTab ?? null);
        // Making the tab current hid the board (stores/tabs.ts); one that was
        // showing when the app quit comes back over it.
        if (boardWasVisible && activeBoard) useUi.getState().setActiveBoard(activeBoard);
        // A board that is gone since last time (deleted elsewhere, or a
        // different vault) is said in the action zone, not a red overlay
        // over a working window; `load` itself forgets the board so the
        // next start does not try again.
        if (activeBoard) {
          void useBoard.getState().load(activeBoard, true).catch(reportBackground);
        }
      }
      // What macOS handed over before the page was up — a launch by Open
      // With, a Dock drop, a `novalis://` link (ADR-0045): once the file list
      // is known, since that is what decides whether a file is the vault's.
      if (boot.pendingOpen.length > 0) {
        if (boot.vault) await useFiles.getState().refresh().catch(reportBackground);
        handleOpenRequests(boot.pendingOpen);
      }
      // Anything thrown before `ready` would otherwise leave an empty window
      // with no way to find out why (Rule 5: fail loud).
    })().catch((error: unknown) => {
      failedVault.current = useVault.getState().vault;
      setBootError(error);
    });
  }, []);

  // ---- watcher batches ---------------------------------------------------
  useEffect(() => {
    const unlisten = events.fsBatch.listen((event) => {
      const batch: FsBatch = event.payload;
      useVault.getState().applyBatch(batch);

      const openDocs = useEditorSave.getState().docs;
      for (const entry of batch.modified) {
        if (openDocs[entry.path]) void useEditorSave.getState().externalChange(entry.path).catch(reportBackground);
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
            .catch(reportBackground);
        } else if (useTabs.getState().tabs.includes(path) && viewKind(path)) {
          void useTabs.getState().close(path).catch(reportBackground);
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
      // A file from outside the vault going (ADR-0047) is no change to the
      // vault's list.
      if (
        batch.added.some((e) => isSupported(e.path)) ||
        batch.removed.some((p) => isSupported(p) && !isExternal(p))
      ) {
        void useFiles.getState().refresh().catch(reportBackground);
      }
      const board = useBoard.getState().slug;
      if (board && [...batch.added, ...batch.modified].some((e) => e.path.startsWith(`boards/${board}/`))) {
        void useBoard.getState().refresh().catch(reportBackground);
      }
      if (
        [...batch.added, ...batch.modified].some((e) => touchesBoardList(e.path)) ||
        batch.removed.some(touchesBoardList) ||
        batch.renamed.some((r) => touchesBoardList(r.from) || touchesBoardList(r.to))
      ) {
        void useBoard.getState().refreshList().catch(reportBackground);
      }
    });
    return () => void unlisten.then((stop) => stop()).catch(report);
  }, []);

  // ---- native menu -------------------------------------------------------
  useEffect(() => {
    const unlisten = events.menuAction.listen((event) => dispatch(event.payload.id, "menu"));
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
      // ⌘← / ⌘→ stay a text field's line start and end, the editor's too;
      // there ⌃⌘← / ⌃⌘→ go back and forward (ADR-0051 #36).
      if (fieldKeeps(chord, event.target)) return;
      event.preventDefault();
      dispatch(binding.command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  // ---- the macOS window title (lib/windowTitle.ts) -------------------------
  // The current place of the title bar's path (spec/02 §4.17).
  const vaultName = vault?.name ?? null;
  const titleBoard = useUi((s) => (s.boardVisible ? s.activeBoard : null));
  const shownBoard = useBoard((s) =>
    titleBoard === null ? null : (s.boards.find((b) => b.slug === titleBoard)?.name ?? titleBoard),
  );
  const title = windowTitle(
    settingsView ? [t("sidebar.settings")] : windowPlaces(vaultName, active, shownBoard),
    t("app.openVault.title"),
    t("app.name"),
  );
  useEffect(() => {
    // Not before the boot knows whether a vault opens: the empty state's
    // heading would name a state the window may never show.
    if (!ready) return;
    // A title that cannot be set costs nothing but the title: never a toast.
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => undefined);
  }, [title, ready]);

  // ---- full screen gives the traffic lights' room back (lib/fullscreen.ts) -
  useEffect(() => watchFullscreen(getCurrentWindow()), []);
  // ---- a window not in front lets the path recede (lib/windowActive.ts) ---
  useEffect(() => watchWindowActive(getCurrentWindow()), []);

  // ---- the start ends with the first view, or with a failed boot ----------
  // (lib/start.ts; main.tsx holds it from before React mounts.)
  useEffect(() => {
    if (bootError) failStart();
    else if (ready) releaseStart();
  }, [ready, bootError]);
  // A vault opened from the native menu after a failed boot: `open_vault`
  // wrote it as `lastVault`, so the page starts again with it, as the
  // callout's own button does (BootError). Only a vault opened since the
  // failure, never the one the boot itself had set.
  useEffect(() => {
    if (bootError && vault && vault !== failedVault.current) window.location.reload();
  }, [bootError, vault]);

  // ---- system appearance, F6's memory, autosave flush --------------------
  useEffect(() => watchSystemAppearance(), []);
  useEffect(() => trackAreaFocus(), []);
  // ---- the sidebar over the content of a narrow window (lib/windowFit.ts) -
  // Once the window is drawn: before, there is no sidebar to read.
  useEffect(() => (ready ? watchSidebarFit() : undefined), [ready]);

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

  // ---- what the native menu's items act on (sebaro D102 (9)) ------------
  // Changed only when a flag flips, so the save below runs then, at once,
  // and the shell switches the items on or off; a move from row to row
  // changes nothing.
  const [menuTargets, setMenuTargets] = useState(menuTargetsNow);
  const sentTargets = useRef(menuTargets);
  useEffect(() => {
    const update = () =>
      setMenuTargets((last) => {
        const next = menuTargetsNow();
        return JSON.stringify(next) === JSON.stringify(last) ? last : next;
      });
    const stops = [useTabs, useUi, useVault, useFiles].map((store) => store.subscribe(update));
    update();
    return () => stops.forEach((stop) => stop());
  }, []);

  // ---- persist the disposable half of the state --------------------------
  const tabs = useTabs((s) => s.tabs);
  const recent = useTabs((s) => s.recent);
  const activeBoard = useUi((s) => s.activeBoard);
  const treeSort = useUi((s) => s.treeSort);
  useEffect(() => {
    if (!ready) return undefined;
    // A menu item whose target came or went must not wait for the debounce:
    // a chord its stale state swallowed would be lost.
    const delay = sentTargets.current === menuTargets ? STATE_SAVE_MS : 0;
    const timer = setTimeout(() => {
      sentTargets.current = menuTargets;
      // The values are the stores' (`lib/uiState.ts`); the dependencies
      // below are what makes a change of any of them save.
      void unwrap(commands.stateSave({ ...uiStateNow(), menuTargets })).catch(() => {
        // Losing the window layout is not worth a message; the next save wins.
      });
    }, delay);
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
    menuTargets,
  ]);

  const followLink = useCallback((target: string) => {
    // A web or mail link leaves the vault through macOS (ADR-0044).
    if (SCHEME.test(target.trim().replace(/^<|>$/g, ""))) {
      openExternal(target.trim().replace(/^<|>$/g, ""));
      return;
    }
    // A file from outside the vault (ADR-0047) has no vault to link into:
    // beyond a web or mail link, only its own headings are followed.
    const active = useTabs.getState().active;
    const outside = active !== null && isExternal(active);
    // A Markdown destination is a path relative to the note (PLAN.md §7.2):
    // a `.md` opens in the editor, an image or PDF in the viewer (ADR-0017).
    const destination = outside ? null : resolveDestination(active, target);
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
    const hit = name === "" ? active : outside ? null : resolveWikiTarget(name, useFiles.getState().notes);
    if (!hit) {
      // A link to no note offers to make it, beside the note it is written
      // in, the name filled in (ADR-0038); nothing is written until Create.
      if (name && !outside) newNote(folderOf(active ?? ""), name);
      return;
    }
    // `[[note#heading]]` lands on the heading (§7.2); the pane settles it
    // against the text it shows, like a backlink's line.
    if (heading) openAt(hit, { line: 1, snippet: "", heading });
    else void useTabs.getState().open(hit).catch(report);
  }, []);

  const notePaths = useCallback(() => useFiles.getState().notes, []);

  if (bootError) return <BootError error={bootError} />;
  if (!ready) return <div className="boot" />;

  return (
    // sebaro's window (spec/02 §4.12, §4.17, DSK-01): the title bar, the body,
    // the action zone over the whole width; window density gives its rows
    // 32 px. The body and the action zone enter from below when the start
    // ends (STR-01, `data-sb-start-enter`).
    <div className="sb-window sb-window--fill" data-sb-density="window">
      <TitleBar />
      {/* sebaro's body (spec/02 §4.17, DSK-04): sidebar, divider and content
          in its grid, the content at least 480 px. Down to 722 px the
          sidebar gives way to its smallest width, below it lies over the
          content's edge, closed until its tool opens it (lib/windowFit.ts). */}
      <div className="sb-window__body" data-sb-start-enter="">
        {/* sebaro's sidebar and divider side by side (spec/02 §4.23); the
            divider stays while the sidebar is hidden, at the window's edge:
            Enter or a drag brings the sidebar back. The hidden sidebar stays
            in the page with `hidden` (spec/02 §4.17), so the tool and the
            divider always name it. */}
        <Sidebar />
        <SidebarResize />
        {/* The settings view stands in the content area while it shows
            (spec/02 §4.24, ADR-0051 #1): what it covers stays mounted and
            hidden, so it comes back as it was and the focus can return. */}
        {settingsView && (
          <Suspense fallback={null}>
            <SettingsView />
          </Suspense>
        )}
        <main className="main sb-window__content sb-window__content--flush" hidden={settingsView}>
          {!vault && !active && !boardVisible ? (
            // Without a vault and without an open file no tab can exist: no
            // strip and no panel, the empty state alone in the content,
            // which sebaro centres there (spec/02 §3.14, NV-E18).
            <NoVault />
          ) : (
            <>
              {(vault || active) && <TabStrip />}
              {/* The one panel of the document tabs (spec/02 §4.21). */}
              <DocPanel>
                <CloudHint />
                <LegacyHint />
                <Banner />
                {boardVisible ? (
                  // The board's chunk is local work: an empty pane while it
                  // loads, no „Wird geladen …“ (STA-06, ADR-0051 #27.8).
                  <Suspense fallback={<div className="sb-view__content" aria-busy="true" />}>
                    <BoardPane />
                  </Suspense>
                ) : active && view ? (
                  // The viewer's chunk is local work: an empty pane while it
                  // loads, no „Wird geladen …“ (STA-06, ADR-0051 #27.8).
                  <Suspense fallback={<div className="sb-view__content" aria-busy="true" />}>
                    <Viewer path={active} kind={view} />
                  </Suspense>
                ) : active && !doc ? (
                  // A note on its way: read, or downloaded from the cloud (§2.3
                  // rule 7); `tabs.open` removes the tab again if that fails.
                  // Silent while local, named only for a cloud file after 1 s
                  // (STA-06, ADR-0051 #27.8).
                  <Waiting key={active} path={active} />
                ) : active && doc && second ? (
                  // The preview's chunk is local work: an empty pane while it
                  // loads, no „Wird geladen …“ (STA-06, ADR-0051 #27.8).
                  <Suspense fallback={<div className="sb-view__content" aria-busy="true" />}>
                    {second === "markdown" ? (
                      <Preview path={active} onFollowLink={followLink} />
                    ) : second === "svg" ? (
                      <SvgPreview path={active} />
                    ) : (
                      <TablePreview path={active} kind={second} />
                    )}
                  </Suspense>
                ) : active && doc ? (
                  // The editor's chunk is local work: an empty pane while it
                  // loads, no „Wird geladen …“ (STA-06, ADR-0051 #27.8).
                  <Suspense fallback={<div className="sb-view__content" aria-busy="true" />}>
                    <Editor
                      path={active}
                      revision={doc.revision}
                      spellcheck={spellcheck}
                      invisibles={invisibles}
                      onFollowLink={followLink}
                      notePaths={notePaths}
                    />
                  </Suspense>
                ) : // Nothing open: the tab strip says how to open a note
                // (`sb-doc-tabs__none`, DSK-10).
                null}
                {/* Under the editor, never beside the board: the board owns the whole
                    pane, and a backlinks list about a note is meaningless there. A
                    file from outside the vault has none (ADR-0047). */}
                {backlinksVisible && !boardVisible && active && !isExternal(active) && (
                  <Suspense fallback={null}>
                    <Backlinks />
                  </Suspense>
                )}
              </DocPanel>
            </>
          )}
        </main>
      </div>
      {/* sebaro's action zone over the whole width (spec/02 §4.17, EBE-08):
          the toast at its top, then the bar (StatusBar). */}
      <div className="sb-bottom-block" data-sb-start-enter="" hidden={settingsView && !zoneSays}>
        <Toast />
        <StatusBar />
      </div>

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
      {overlay.kind === "pickFolder" && (
        <Suspense fallback={null}>
          <Palette mode="pickFolder" pickFolder={overlay} />
        </Suspense>
      )}
      {overlay.kind === "search" && (
        <Suspense fallback={null}>
          <SearchPanel />
        </Suspense>
      )}
      <Prompt />
    </div>
  );
}
