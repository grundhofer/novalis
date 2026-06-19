// Platform-appropriate label for the "reveal a note in the OS file manager"
// action, shared by the sidebar context menu, the editor header, and the
// command palette. Uses the i18n singleton so it works in both hook and
// non-hook call sites (e.g. Sidebar's `buildMenu`, which is not a component).
//
// Each branch calls `i18n.t(...)` with a literal key so i18next-parser can
// extract all three keys statically (a ternary argument would not extract).

import i18n from "./i18n";
import { platformKind } from "./keybindings";

export function revealLabel(): string {
  switch (platformKind()) {
    case "mac":
      return i18n.t("common:revealInFinder");
    case "windows":
      return i18n.t("common:showInExplorer");
    default:
      return i18n.t("common:showInFileManager");
  }
}
