import { syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { commands, unwrap } from "../ipc/client";
import { goToEditorLine, resolveLine, takeDeferredLine } from "../lib/editorBridge";
import { keepPosition, keptPosition, type KeptSelection } from "../lib/positions";
import { useCursor } from "../stores/cursor";
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

/**
 * WebKit leaves the first editable of a launch unchecked in the built app:
 * the underlines (PLAN.md §7.5) came for every editor built later, never for
 * the one the session restore builds first, whatever the defaults key says.
 * Setting the element's `spellcheck` again makes WebKit look at it anew; it
 * is done once per session, at the first key typed — by then WebKit knows
 * its spelling state (measured 2026-09-22 in `just app`; `just dev`, slower
 * to load, never showed it).
 */
let spellingNudged = false;
function nudgeSpelling(content: HTMLElement): void {
  if (spellingNudged || content.getAttribute("spellcheck") !== "true") return;
  content.addEventListener(
    "keydown",
    () => {
      if (spellingNudged) return;
      spellingNudged = true;
      content.setAttribute("spellcheck", "false");
      requestAnimationFrame(() => content.setAttribute("spellcheck", "true"));
    },
    { once: true },
  );
}

/** The status bar's `Ln, Col` and what is selected (`stores/cursor.ts`). */
function reportCursor(path: string, state: EditorState): void {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  useCursor.getState().set({
    path,
    line: line.number,
    column: head - line.from + 1,
    selected: state.selection.ranges.reduce((sum, range) => sum + (range.to - range.from), 0),
    cursors: state.selection.ranges.length,
  });
}

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
        text: doc.text,
        readOnly: doc.readOnly,
        plainMode: doc.plainMode,
        spellcheck,
      });
      if (cancelled) return;
      let state = EditorState.create({
        doc: useEditorSave.getState().docs[path]?.text ?? doc.text,
        extensions: [
          editorTheme,
          syntaxHighlighting(markdownHighlight),
          ...extensions,
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) reportCursor(path, update.state);
          }),
        ],
      });
      // Back where the reader left it (`lib/positions.ts`): the selection is
      // set before the view exists, so nothing scrolls to it; the text may
      // have shrunk since (a reload), so every end is clamped to it.
      const position = keptPosition(path);
      if (position?.selection) {
        const length = state.doc.length;
        const clamp = (at: number) => Math.min(Math.max(0, at), length);
        const ranges = position.selection.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head)));
        if (ranges.length > 0) {
          state = state.update({
            selection: EditorSelection.create(ranges, Math.min(position.selection.main, ranges.length - 1)),
          }).state;
        }
      }
      const created = new EditorView({ parent: element, state });
      nudgeSpelling(created.contentDOM);
      reportCursor(path, created.state);
      // The scroll is recorded as it happens, as the first line in view:
      // when the pane goes because the preview takes its place, React has
      // detached it before the cleanup below runs, and a detached scroller
      // reads 0 (and may say so in one last scroll event).
      created.scrollDOM.addEventListener("scroll", () => {
        if (!created.dom.isConnected) return;
        const height = created.scrollDOM.getBoundingClientRect().top - created.documentTop;
        keepPosition(path, { editorTop: created.lineBlockAtHeight(Math.max(0, height)).from });
      });
      view = created;
      // `sliceDoc()`, not `doc.toString()`: it joins with the file's own line
      // break (`editor/lineBreak.ts`), which `toString()` always makes `\n`.
      read = () => created.state.sliceDoc();
      useEditorSave.getState().attach(path, read);
      setActiveView(view);
      view.focus();
      const target = takeDeferredLine();
      // A jump (a search hit, a backlink) wins over the kept place.
      if (target) goToEditorLine(resolveLine(view.state.doc.toString(), target));
      else if (position?.editorTop !== undefined) {
        const top = Math.min(position.editorTop, created.state.doc.length);
        created.dispatch({ effects: EditorView.scrollIntoView(top, { y: "start" }) });
      }
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
        keepPosition(path, {
          selection: view.state.selection.toJSON() as KeptSelection,
          line: view.state.doc.lineAt(view.state.selection.main.head).number,
          last: "editor",
        });
        setActiveView(null);
        useCursor.getState().clear(path);
        view.destroy();
      }
    };
  }, [path, revision, spellcheck, onFollowLink, notePaths]);

  return <div className="editor" ref={host} />;
}
