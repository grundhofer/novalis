import type { UiStateDto } from "../ipc/client";
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
  return {
    openTabs: tabs,
    activeTab: active,
    sidebarVisible: ui.sidebarVisible,
    sidebarWidth: ui.sidebarWidth,
    boardVisible: ui.boardVisible,
    backlinksVisible: ui.backlinksVisible,
    cloudHintShown: ui.cloudHintShown,
    activeBoard: ui.activeBoard,
    treeSort: ui.treeSort,
    recentFiles: useTabs.getState().recent,
  };
}
