import type { UiStateDto } from "../ipc/client";
import { isExternal } from "./paths";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";

/**
 * The disposable half of the state as `state.json` keeps it (PLAN.md §4.1),
 * read from the stores now. One list for the save after every change and
 * the last save before quitting: `state.json` keeps a field only while it is
 * sent, so one left out here is reset at the next launch.
 */
export function uiStateNow(): UiStateDto {
  const { tabs, active } = useTabs.getState();
  const ui = useUi.getState();
  // A file from outside the vault is not kept (ADR-0047): the shell's grant
  // for it ends with the app, so the next launch could not read it again.
  const kept = (path: string) => !isExternal(path);
  return {
    openTabs: tabs.filter(kept),
    activeTab: active && kept(active) ? active : null,
    sidebarVisible: ui.sidebarVisible,
    sidebarWidth: ui.sidebarWidth,
    boardVisible: ui.boardVisible,
    backlinksVisible: ui.backlinksVisible,
    cloudHintShown: ui.cloudHintShown,
    activeBoard: ui.activeBoard,
    treeSort: ui.treeSort,
    recentFiles: useTabs.getState().recent.filter(kept),
  };
}
