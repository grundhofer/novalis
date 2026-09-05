import { syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { useEditorSave } from "../stores/editorSave";
import { setActiveView } from "./commands";
import { buildExtensions } from "./setup";
import { editorTheme, markdownHighlight } from "./theme";

/**
 * The React shell around CodeMirror. CM6 owns the editor DOM completely
 * (PLAN.md §5.3): React mounts an empty div, hands over the initial document
 * and never re-renders the contents.
 *
 * The view is rebuilt when the path changes, and when `revision` changes —
 * which is how a silent reload from the watcher replaces the buffer without
 * the editor and the store disagreeing about the text.
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
    let cancelled = false;

    const doc = useEditorSave.getState().docs[path];
    if (!doc) return;

    void (async () => {
      const extensions = await buildExtensions(path, {
        onChange: (text) => useEditorSave.getState().setText(path, text),
        onFollowLink,
        onSave: () => void useEditorSave.getState().save(path),
        notePaths,
        readOnly: doc.readOnly,
        plainMode: doc.plainMode,
        spellcheck,
      });
      if (cancelled) return;
      view = new EditorView({
        parent: element,
        state: EditorState.create({
          doc: useEditorSave.getState().docs[path]?.text ?? doc.text,
          extensions: [editorTheme, syntaxHighlighting(markdownHighlight), ...extensions],
        }),
      });
      setActiveView(view);
      view.focus();
    })();

    return () => {
      cancelled = true;
      if (view) {
        setActiveView(null);
        view.destroy();
      }
    };
  }, [path, revision, spellcheck, onFollowLink, notePaths]);

  return <div className="editor" ref={host} />;
}
