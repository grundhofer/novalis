import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { extensionForMime, saveAttachment } from "../lib/attachments";
import { isNote } from "../lib/paths";
import { report } from "../stores/ui";

/**
 * Paste and drop of images into a note (ADR-0017). The bytes never enter the
 * buffer: they go to `attachments/` next to the note through
 * `lib/attachments.ts`, and the note gets the link once the file is written.
 *
 * Both handlers answer synchronously — `true` after `preventDefault()`, so
 * neither CodeMirror's own drop handler (which would read the file as text)
 * nor the WebView (which would navigate to it) sees the event — and the
 * write goes on behind them. Anything not an image is left to the default
 * handling, so text still pastes and drops as before.
 */

/**
 * Put `text` into the buffer: over the main selection, or at `at` when the
 * drop point is known. Clamped, because the write took a moment and the
 * buffer may have shrunk since; skipped when the view was torn down meanwhile
 * (the tab closed, or the watcher rebuilt the editor).
 */
function insert(view: EditorView, text: string, at?: number): void {
  if (!view.dom.isConnected) return;
  const main = view.state.selection.main;
  const from = at === undefined ? main.from : Math.min(at, view.state.doc.length);
  const to = at === undefined ? main.to : from;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
}

async function bytesOf(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function attachments(notePath: string): Extension {
  if (!isNote(notePath)) return [];
  return EditorView.domEventHandlers({
    paste(event, view) {
      // A read-only buffer (not UTF-8) takes no edits, so no file either.
      if (view.state.readOnly) return false;
      const item = [...(event.clipboardData?.items ?? [])].find(
        (i) => i.type.startsWith("image/") && extensionForMime(i.type) !== null,
      );
      const file = item?.getAsFile();
      if (!item || !file) return false;
      event.preventDefault();
      void (async () => {
        const link = await saveAttachment(notePath, await bytesOf(file), item.type);
        insert(view, link);
      })().catch(report);
      return true;
    },

    drop(event, view) {
      if (view.state.readOnly) return false;
      const files = [...(event.dataTransfer?.files ?? [])].filter((f) => extensionForMime(f.type) !== null);
      if (files.length === 0) return false;
      event.preventDefault();
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      void (async () => {
        const links: string[] = [];
        try {
          for (const file of files) {
            links.push(await saveAttachment(notePath, await bytesOf(file), file.type));
          }
        } finally {
          // What was written is linked even when a later file failed: a file
          // on disk with no link in the note is invisible.
          if (links.length > 0) insert(view, links.join("\n"), at);
        }
      })().catch(report);
      return true;
    },
  });
}
