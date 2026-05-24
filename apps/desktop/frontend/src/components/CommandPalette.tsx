import { useEffect, useRef, useState } from "react";

import { api } from "../ipc/api";
import { usePlugins, type PluginCommand } from "../stores/pluginStore";
import { useVault } from "../stores/vaultStore";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const pluginCommands = usePlugins((s) => s.commands);
  const inputRef = useRef<HTMLInputElement>(null);

  const builtins: PluginCommand[] = [
    {
      id: "builtin:new-note",
      title: "New note",
      pluginId: "builtin",
      run: () => void useVault.getState().newNote(""),
    },
    {
      id: "builtin:reindex",
      title: "Reindex vault",
      pluginId: "builtin",
      run: () => void api.reindexVault(),
    },
  ];

  const all = [...builtins, ...pluginCommands];
  const filtered = query.trim()
    ? all.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    : all;

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const run = (c: PluginCommand) => {
    c.run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-28"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Run a command…"
          className="w-full bg-transparent px-4 py-3 text-neutral-100 outline-none placeholder:text-neutral-600"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && filtered[0]) run(filtered[0]);
          }}
        />
        <ul className="max-h-80 overflow-y-auto border-t border-neutral-800">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-neutral-600">No matching commands.</li>
          )}
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => run(c)}
                className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left hover:bg-white/5"
              >
                <span className="text-sm text-neutral-100">{c.title}</span>
                <span className="text-[10px] uppercase tracking-wide text-neutral-600">
                  {c.pluginId === "builtin" ? "core" : c.pluginId}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
