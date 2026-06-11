import { useState } from "react";

import { SquareSplitHorizontal, SquareSplitVertical, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatChord } from "../lib/keybindings";
import { noteTitleFromPath } from "../lib/taskDisplay";
import { MAX_PANES, type Pane } from "../lib/workspacePrefs";
import { useKeymap } from "../stores/keymapStore";
import { useUi } from "../stores/uiStore";
import { useVault } from "../stores/vaultStore";

/** Scrollable row of one pane's open note tabs, with split/close-pane actions
 *  pinned at the right edge. One live editor backs the active tab; the rest
 *  are inert {path} descriptors. Hidden when empty. */
export function TabStrip({ pane }: { pane: Pane }) {
  const { t } = useTranslation("editor");
  const setActiveTab = useUi((s) => s.setActiveTab);
  const closeTab = useUi((s) => s.closeTab);
  const splitPane = useUi((s) => s.splitPane);
  const closePane = useUi((s) => s.closePane);
  const paneFocused = useUi((s) => s.workspace.focusedPaneId === pane.id);
  const paneCount = useUi((s) => s.workspace.panes.length);
  const direction = useUi((s) => s.workspace.direction);
  const keymap = useKeymap((s) => s.keymap);
  // Split/close are async (flush-first); the buttons stay disabled until the
  // action lands. Otherwise a second click inside the flush window still sees
  // the pre-split layout — e.g. "Split right" firing after "Split down" fixed
  // the axis would silently split on the wrong axis.
  const [busy, setBusy] = useState(false);

  if (pane.tabs.length === 0) return null;

  const run = (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };

  // Only actionable buttons render: splits need a free pane slot, and once
  // the first split fixed the workspace axis only same-axis splits exist.
  const canSplit = paneCount < MAX_PANES && pane.activeTab !== null;
  const showSplitRight = canSplit && (paneCount === 1 || direction === "row");
  const showSplitDown = canSplit && (paneCount === 1 || direction === "column");
  // The keyboard chord splits the FOCUSED pane, so only that pane's buttons
  // advertise it — in the visual tooltip only, never in the accessible name
  // (a screen reader would read the modifier glyphs as noise).
  const chord = (action: "split-right" | "split-down"): string | undefined =>
    paneFocused ? formatChord(keymap[action]) : undefined;

  return (
    <div className="flex shrink-0 items-stretch border-b border-border bg-surface">
      <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto px-1 pt-1">
        {pane.tabs.map((path) => (
          <TabItem
            key={path}
            path={path}
            active={path === pane.activeTab}
            paneFocused={paneFocused}
            onSelect={(p) => setActiveTab(p, pane.id)}
            onClose={(p) => void closeTab(p, pane.id)}
            closeLabel={t("closeTab")}
          />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 px-1">
        {showSplitRight && (
          <PaneAction
            label={t("splitRight")}
            shortcut={chord("split-right")}
            disabled={busy}
            onClick={() => run(() => splitPane(pane.id, "row"))}
          >
            <SquareSplitHorizontal size={14} />
          </PaneAction>
        )}
        {showSplitDown && (
          <PaneAction
            label={t("splitDown")}
            shortcut={chord("split-down")}
            disabled={busy}
            onClick={() => run(() => splitPane(pane.id, "column"))}
          >
            <SquareSplitVertical size={14} />
          </PaneAction>
        )}
        {paneCount > 1 && (
          <PaneAction
            label={t("closePane")}
            disabled={busy}
            onClick={() => run(() => closePane(pane.id))}
          >
            <X size={14} />
          </PaneAction>
        )}
      </div>
    </div>
  );
}

function PaneAction({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string;
  /** Formatted chord shown in the tooltip only (never in the accessible name). */
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-fg-faint transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function TabItem({
  path,
  active,
  paneFocused,
  onSelect,
  onClose,
  closeLabel,
}: {
  path: string;
  active: boolean;
  paneFocused: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  closeLabel: string;
}) {
  const state = useVault((s) => s.saveStates.get(path) ?? "idle");
  // The active tab can show the live note's (frontmatter) title; background tabs
  // fall back to the basename (the app-wide path→label convention).
  const liveTitle = useVault((s) => (active ? (s.openNotes.get(path)?.title ?? null) : null));
  const label = liveTitle || noteTitleFromPath(path);
  const unsaved = state === "dirty" || state === "saving" || state === "error";

  return (
    <div
      role="tab"
      aria-selected={active}
      title={label}
      onClick={() => onSelect(path)}
      onAuxClick={(e) => {
        // Middle-click closes (browser-tab convention).
        if (e.button === 1) {
          e.preventDefault();
          onClose(path);
        }
      }}
      className={`group flex max-w-[12rem] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-3 py-1.5 text-xs transition-colors ${
        active
          ? // The focused pane's active tab carries the accent; an unfocused
            // pane's active tab is marked but muted, so the pane receiving
            // keyboard shortcuts is always identifiable.
            paneFocused
            ? "border-accent bg-surface-2 text-fg"
            : "border-border-strong bg-surface-2 text-fg-muted"
          : "border-transparent text-fg-muted hover:bg-hover"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        {unsaved && (
          <span
            className={`size-1.5 rounded-full group-hover:opacity-0 ${
              state === "error" ? "bg-danger" : "bg-accent"
            }`}
          />
        )}
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={(e) => {
            e.stopPropagation();
            onClose(path);
          }}
          className="absolute inset-0 flex items-center justify-center rounded opacity-0 transition-opacity hover:bg-hover hover:text-fg group-hover:opacity-100"
        >
          <X size={12} />
        </button>
      </span>
    </div>
  );
}
