import { useEffect, useRef } from "react";
import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, type Editor, useEditor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { WikiLink } from "./WikiLink";

export interface NovalisEditorProps {
  /** Initial markdown content. Remount (via a React `key`) to load another note. */
  value: string;
  /** Called with the full markdown on every edit. */
  onChange?: (markdown: string) => void;
  editable?: boolean;
  placeholder?: string;
  /** Persist a pasted/dropped image; returns the markdown-relative path (or null). */
  onUploadImage?: (file: File) => Promise<string | null>;
  /** Map a stored (relative) image src to a displayable URL. */
  resolveImageSrc?: (src: string) => string;
  /** Called when the user clicks a `[[wikilink]]`. Host resolves+opens. */
  onWikiLinkClick?: (title: string) => void;
}

function getMarkdown(editor: Editor): string {
  return (editor.storage.markdown as { getMarkdown(): string }).getMarkdown();
}

export function NovalisEditor({
  value,
  onChange,
  editable = true,
  placeholder,
  onUploadImage,
  resolveImageSrc,
  onWikiLinkClick,
}: NovalisEditorProps) {
  // Latest onChange, without re-creating the editor when it changes.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Debounce full-document markdown serialization. `getMarkdown` walks and
  // serializes the entire document; doing it on every keystroke is the main
  // typing lag on large notes. Serialize at most every ~200ms and flush on
  // blur/unmount so the host still gets the latest content before it saves.
  const serializeTimer = useRef<number | null>(null);

  // Image node that stores the relative `src` (for markdown round-trip) but
  // renders a resolved URL so the webview can display vault images.
  const VaultImage = Image.extend({
    renderHTML({ HTMLAttributes }) {
      const attrs = { ...HTMLAttributes };
      if (typeof attrs.src === "string" && resolveImageSrc) {
        attrs.src = resolveImageSrc(attrs.src);
      }
      return ["img", mergeAttributes(attrs)];
    },
  });

  const insertUploaded = (view: EditorView, file: File) => {
    if (!onUploadImage) return;
    void onUploadImage(file).then((rel) => {
      if (!rel) return;
      const node = view.state.schema.nodes.image.create({ src: rel });
      view.dispatch(view.state.tr.replaceSelectionWith(node));
    });
  };

  const firstImage = (files: FileList | undefined | null) =>
    Array.from(files ?? []).find((f) => f.type.startsWith("image/"));

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        linkify: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      VaultImage,
      Placeholder.configure({ placeholder: placeholder ?? "Start writing…" }),
      WikiLink.configure({ onClick: onWikiLinkClick }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      if (!onChangeRef.current) return;
      if (serializeTimer.current) window.clearTimeout(serializeTimer.current);
      serializeTimer.current = window.setTimeout(() => {
        serializeTimer.current = null;
        onChangeRef.current?.(getMarkdown(editor));
      }, 200);
    },
    editorProps: {
      handlePaste(view, event) {
        const file = firstImage(event.clipboardData?.files);
        if (!file || !onUploadImage) return false;
        event.preventDefault();
        insertUploaded(view, file);
        return true;
      },
      handleDrop(view, event) {
        const file = firstImage(event.dataTransfer?.files);
        if (!file || !onUploadImage) return false;
        event.preventDefault();
        insertUploaded(view, file);
        return true;
      },
    },
  });

  // Flush any pending serialization on blur and on unmount (e.g. switching
  // notes) so the latest edits reach the host before it persists them.
  useEffect(() => {
    if (!editor) return;
    const flush = () => {
      if (serializeTimer.current === null) return;
      window.clearTimeout(serializeTimer.current);
      serializeTimer.current = null;
      onChangeRef.current?.(getMarkdown(editor));
    };
    editor.on("blur", flush);
    return () => {
      editor.off("blur", flush);
      flush();
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="nv-editor">
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="nv-editor-content" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const Btn = ({
    label,
    onClick,
    active = false,
  }: {
    label: string;
    onClick: () => void;
    active?: boolean;
  }) => (
    <button
      type="button"
      className={`nv-tb-btn${active ? " is-active" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="nv-toolbar">
      <Btn label="B" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} />
      <Btn label="I" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} />
      <Btn label="H1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} />
      <Btn label="H2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} />
      <Btn label="List" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} />
      <Btn label="Tasks" onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")} />
      <Btn label="Code" onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} />
      <Btn label="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} />
    </div>
  );
}
