import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { report } from "../stores/ui";
import { deferLine, goToEditorLine, resolveLine, type LineTarget } from "./editorBridge";
import { goToPreviewLine, previewMounted } from "./previewBridge";

/**
 * Open `path` with an indexed line in view — a backlink's, a search hit's.
 * The note that is already open keeps its pane, so the jump is immediate —
 * in the preview when that is what shows it; any other note gets its pane
 * built after the tab switch, so the target waits in the bridge for it.
 * Either way the line is settled against the text the pane shows, not the
 * one the cache indexed.
 */
export function openAt(path: string, target: LineTarget): void {
  if (useTabs.getState().active === path) {
    const line = resolveLine(useEditorSave.getState().flush(path) ?? "", target);
    if (previewMounted()) goToPreviewLine(line);
    else goToEditorLine(line);
    return;
  }
  deferLine(target);
  void useTabs
    .getState()
    .open(path)
    .catch((e: unknown) => {
      deferLine(null);
      report(e);
    });
}
