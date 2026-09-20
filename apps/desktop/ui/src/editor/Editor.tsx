import { syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { commands, unwrap } from "../ipc/client";
import { goToEditorLine, resolveLine, takeDeferredLine } from "../lib/editorBridge";
import { useEditorSave } from "../stores/editorSave";
import { report } from "../stores/ui";
import { setActiveView } from "./commands";
import { buildExtensions } from "./setup";
import { editorTheme, markdownHighlight } from "./theme";

/**
 * A note's text for `[[note#` completion: the buffer when the note is open
 * (it is ahead of the file), else one read. A note that cannot be read
 * completes nothing; the reason is not worth a toast mid-keystroke.
 */
async function noteText(path: string): Promise<string | null> {
  const open = useEditorSave.getState().flush(path);
  if (open !== undefined) return open;
  try {
    return (await unwrap(commands.readFile(path))).text;
  } catch {
    return null;
  }
}

/**
 * The React shell around CodeMirror. CM6 owns the editor DOM completely
 * (PLAN.md §5.3): React mounts an empty div, hands over the initial document
 * and never re-renders the contents.
 *
 * The view is rebuilt when the path changes, and when `revision` changes —
 * which is how a silent reload from the watcher replaces the buffer without
 * the editor and the store disagreeing about the text.
 *
 * The store never sees a keystroke's text: the view registers a reader and
 * reports changes with `touch`; `flush` reads the buffer when a save, a
 * count or a completion needs it, and once more here before the view goes
 * (stores/editorSave.ts).
 */

export interface EditorProps {
  path: string;
  revision: number;
  spellcheck: boolean;
  onFollowLink: (target: string) => void;
  notePaths: () => string[];
}

export default function Editor({
  path,
  revision,
  spellcheck,
  onFollowLink,
  notePaths,
}: EditorProps) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let view: EditorView | null = null;
    let read: (() => string) | null = null;
    let cancelled = false;

    const doc = useEditorSave.getState().docs[path];
    if (!doc) return;

    void (async () => {
      const extensions = await buildExtensions(path, {
        onChange: () => useEditorSave.getState().touch(path),
        onFollowLink,
        onSave: () => void useEditorSave.getState().save(path).catch(report),
        notePaths,
        noteText,
        readOnly: doc.readOnly,
        plainMode: doc.plainMode,
        spellcheck,
      });
      if (cancelled) return;
      const created = new EditorView({
        parent: element,
        state: EditorState.create({
          doc: useEditorSave.getState().docs[path]?.text ?? doc.text,
          extensions: [editorTheme, syntaxHighlighting(markdownHighlight), ...extensions],
        }),
      });
      view = created;
      read = () => created.state.doc.toString();
      useEditorSave.getState().attach(path, read);
      setActiveView(view);
      view.focus();
      const target = takeDeferredLine();
      if (target) goToEditorLine(resolveLine(view.state.doc.toString(), target));
    })().catch(report);

    return () => {
      cancelled = true;
      if (view) {
        // The buffer goes with the view: what it holds beyond the mirror is
        // read now, while it still exists. A view being rebuilt after a
        // reload has nothing pending (the store cleared it) unless a key
        // reached it between the store's replace and React's commit — the
        // same one-task window the eager mirror had.
        if (read) {
          useEditorSave.getState().flush(path);
          useEditorSave.getState().detach(path, read);
        }
        setActiveView(null);
        view.destroy();
      }
    };
  }, [path, revision, spellcheck, onFollowLink, notePaths]);

  return <div className="editor" ref={host} />;
}
