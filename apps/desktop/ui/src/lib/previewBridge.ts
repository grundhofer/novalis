/**
 * The seam between the command registry and the lazily-loaded preview
 * (ADR-0020, amended 2026-09-16): the chords that are the editor's while a
 * note is edited act on the rendered note while it is previewed — find,
 * find next and previous, and bold/italic on the selected text, written
 * back into the source. `Preview.tsx` registers itself here while it is
 * mounted; with no preview on screen every call is a no-op, as with the
 * editor bridge.
 */

export type PreviewMark = "bold" | "italic";

export interface PreviewBridge {
  find: () => void;
  findNext: () => void;
  findPrevious: () => void;
  /** True when the selection was found in the source and wrapped there. */
  mark: (mark: PreviewMark) => boolean;
}

let bridge: PreviewBridge | null = null;

export function setPreviewBridge(next: PreviewBridge | null): void {
  bridge = next;
}

export function previewMounted(): boolean {
  return bridge !== null;
}

/**
 * Run an editor command id against the preview. Returns `true` when the
 * preview took it (the caller is done), `false` when the preview is not on
 * screen or the id is not one of its four — or when a mark could not be
 * placed, so the caller may fall back to the editor.
 */
export function runPreviewCommand(id: string): boolean {
  if (!bridge) return false;
  switch (id) {
    case "find.open":
      bridge.find();
      return true;
    case "find.next":
      bridge.findNext();
      return true;
    case "find.previous":
      bridge.findPrevious();
      return true;
    case "markdown.bold":
      return bridge.mark("bold");
    case "markdown.italic":
      return bridge.mark("italic");
    default:
      return false;
  }
}

/** The editor-scoped ids the preview answers to at all. */
export function isPreviewCommand(id: string): boolean {
  return ["find.open", "find.next", "find.previous", "markdown.bold", "markdown.italic"].includes(id);
}
