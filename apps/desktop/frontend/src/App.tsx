import { useEffect, useState } from "react";

import { CalendarView } from "./components/CalendarView";
import { CommandPalette } from "./components/CommandPalette";
import { EditorPane } from "./components/EditorPane";
import { SearchModal } from "./components/SearchModal";
import { SettingsModal } from "./components/SettingsModal";
import { Sidebar, type MainView } from "./components/Sidebar";
import { TasksView } from "./components/TasksView";
import { VaultGate } from "./components/VaultGate";
import { useNovalisEvents } from "./lib/useNovalisEvents";
import { usePlugins } from "./stores/pluginStore";
import { useVault } from "./stores/vaultStore";

export default function App() {
  const loading = useVault((s) => s.loading);
  const vaultPath = useVault((s) => s.vaultPath);
  const error = useVault((s) => s.error);
  const clearError = useVault((s) => s.clearError);
  const [view, setView] = useState<MainView>("notes");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useNovalisEvents();

  useEffect(() => {
    void useVault.getState().sync();
    usePlugins.getState().setNotify((m) => {
      setNotice(m);
      window.setTimeout(() => setNotice(null), 4000);
    });
  }, []);

  // (Re)load plugins whenever a vault becomes active.
  useEffect(() => {
    if (vaultPath) void usePlugins.getState().reload();
  }, [vaultPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-500">
        Loading…
      </main>
    );
  }

  if (!vaultPath) return <VaultGate />;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <Sidebar
        view={view}
        onViewChange={setView}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {view === "notes" ? <EditorPane /> : view === "tasks" ? <TasksView /> : <CalendarView />}
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {notice && (
        <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-lg border border-neutral-700 bg-neutral-900/90 px-4 py-2 text-sm text-neutral-200 shadow-xl">
          {notice}
        </div>
      )}
      {error && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-red-500/40 bg-red-950/80 px-4 py-2 text-sm text-red-200">
          <span className="min-w-0 break-words">{error}</span>
          <button onClick={clearError} className="text-red-400 hover:text-red-200">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
