import { useEffect, useMemo, useRef, useState } from "react";

import { NovalisEditor } from "@novalis/editor";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronDown, FileText, Loader2, Trash2 } from "lucide-react";

import { api } from "../ipc/api";
import { useVault } from "../stores/vaultStore";

// Split a note into its YAML frontmatter block and body. The editor edits the
// body only; on save we re-attach the original frontmatter (the backend
// refreshes `modified`).
const FRONTMATTER = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/;
function splitFrontmatter(raw: string): { fm: string; body: string } {
  const m = raw.match(FRONTMATTER);
  return m ? { fm: m[1], body: m[2] } : { fm: "", body: raw };
}

export function EditorPane() {
  const activeNote = useVault((s) => s.activeNote);
  const activePath = useVault((s) => s.activePath);
  const vaultPath = useVault((s) => s.vaultPath);
  const saveNote = useVault((s) => s.saveNote);
  const openNote = useVault((s) => s.openNote);
  const refreshTree = useVault((s) => s.refreshTree);
  const deleteActive = useVault((s) => s.deleteActive);
  const timer = useRef<number | null>(null);
  const pendingBody = useRef<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const split = useMemo(
    () => (activeNote ? splitFrontmatter(activeNote.content) : null),
    [activeNote],
  );

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [activePath],
  );

  if (!activePath) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-neutral-600">
        <FileText size={40} strokeWidth={1.25} className="text-neutral-700" />
        <div>
          <p className="text-sm font-medium text-neutral-400">No note open</p>
          <p className="mt-1 text-xs text-neutral-600">
            Select a note from the sidebar, or create a new one.
          </p>
        </div>
      </section>
    );
  }

  // Active note selected but its content isn't loaded yet (e.g. a OneDrive
  // online-only file still hydrating). Show a loader instead of the previous
  // note's stale content — never block on the read.
  if (!activeNote || activeNote.path !== activePath || !split) {
    const name = activePath.split("/").pop()?.replace(/\.md$/, "") ?? activePath;
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-neutral-800 px-5 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-neutral-100">{name}</h2>
            <p className="truncate text-xs text-neutral-600">{activePath}</p>
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center gap-2 text-neutral-600">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </section>
    );
  }

  const onChange = (body: string) => {
    pendingBody.current = body;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      pendingBody.current = null;
      void saveNote(activePath, split.fm + body);
    }, 600);
  };

  const onUploadImage = async (file: File): Promise<string | null> => {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const ext = (file.name.split(".").pop() || file.type.split("/")[1] || "png").toLowerCase();
    try {
      return await api.savePastedImage(bytes, ext);
    } catch {
      return null;
    }
  };

  const resolveImageSrc = (src: string): string => {
    if (/^(https?:|data:|blob:|asset:|tauri:)/.test(src)) return src;
    if (!vaultPath) return src;
    const clean = src.replace(/^\.?\//, "");
    return convertFileSrc(`${vaultPath}/${clean}`);
  };

  const onWikiLinkClick = async (title: string) => {
    // Flush any pending debounced save so unsaved edits aren't lost when the
    // active note swaps.
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (pendingBody.current !== null) {
      const body = pendingBody.current;
      pendingBody.current = null;
      await saveNote(activePath, split.fm + body);
    }
    try {
      const path = await api.resolveOrCreateWikiLink(title);
      await openNote(path);
      await refreshTree();
    } catch (e) {
      // Surfaced via vaultStore.error in the host; nothing to do here.
      void e;
    }
  };

  const doExport = (format: "html" | "docx") => {
    setExportOpen(false);
    void api.exportNote(activePath, format).catch(() => {});
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 px-5 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-neutral-100">{activeNote.title}</h2>
          <p className="truncate text-xs text-neutral-600">{activePath}</p>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
            >
              Export
              <ChevronDown size={13} />
            </button>
            {exportOpen && (
              <div className="absolute right-0 z-10 mt-1 w-32 overflow-hidden rounded-lg border border-neutral-700/80 bg-neutral-900 p-1 shadow-xl">
                <button
                  onClick={() => doExport("html")}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-neutral-200 transition-colors hover:bg-white/5"
                >
                  HTML
                </button>
                <button
                  onClick={() => doExport("docx")}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-xs text-neutral-200 transition-colors hover:bg-white/5"
                >
                  Word (.docx)
                </button>
              </div>
            )}
          </div>
          <button
            title="Delete note"
            onClick={() => void deleteActive()}
            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>
      <NovalisEditor
        key={activePath}
        value={split.body}
        onChange={onChange}
        onUploadImage={onUploadImage}
        resolveImageSrc={resolveImageSrc}
        onWikiLinkClick={onWikiLinkClick}
      />
    </section>
  );
}
