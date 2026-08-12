// A minimal, self-managed popover for @tiptap/suggestion-driven menus (slash
// commands, #tag autocomplete). Mirrors the inline renderer in
// WikiLinkSuggestion but generic over the item type, so the two newer
// suggestion extensions share one implementation. Attached to `.nv-editor` so it
// inherits the editor theme; styled by the `.nv-suggest*` rules in editor.css.

import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";

export interface SuggestRendererOptions<T> {
  /** Visible text for an item. */
  getLabel: (item: T) => string;
  /** Extra class(es) for an item's button (e.g. to flag a "create" row). */
  getClass?: (item: T) => string | undefined;
  /** Escape handler: mark the session dismissed (see withDismissal) so the
   *  Suggestion plugin genuinely exits it — not just hides the popup. */
  onDismiss: (range: { from: number }) => void;
}

/** Build the suggestion lifecycle managing a small DOM popover, generic over the
 *  item type. Returns the `{ onStart, onUpdate, onKeyDown, onExit }` object
 *  `@tiptap/suggestion`'s `render` expects. */
export function createSuggestRenderer<T>({
  getLabel,
  getClass,
  onDismiss,
}: SuggestRendererOptions<T>) {
  let popup: HTMLDivElement | null = null;
  let items: T[] = [];
  let selected = 0;
  let loading = false;
  let command: ((item: T) => void) | null = null;

  const draw = () => {
    if (!popup) return;
    popup.innerHTML = "";
    if (items.length === 0) {
      popup.style.display = "none";
      return;
    }
    popup.style.display = "block";
    items.forEach((item, i) => {
      const el = document.createElement("button");
      el.type = "button";
      const extra = getClass?.(item);
      el.className = `nv-suggest-item${i === selected ? " is-selected" : ""}${extra ? ` ${extra}` : ""}`;
      el.textContent = getLabel(item);
      // mousedown (not click) so the editor doesn't lose selection first.
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        command?.(item);
      });
      el.addEventListener("mouseenter", () => {
        selected = i;
        draw();
      });
      popup?.appendChild(el);
    });
  };

  const place = (rect: DOMRect | null | undefined) => {
    if (!popup || !rect) return;
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 4}px`;
  };

  return {
    onStart(props: SuggestionProps<T, T>) {
      items = props.items;
      selected = 0;
      // v3 opens the session before items() resolves, so this can be [].
      loading = props.loading;
      command = props.command;
      popup = document.createElement("div");
      popup.className = "nv-suggest";
      const root =
        (props.editor.view.dom.closest(".nv-editor") as HTMLElement | null) ?? document.body;
      root.appendChild(popup);
      place(props.clientRect?.());
      draw();
    },
    onUpdate(props: SuggestionProps<T, T>) {
      // v3's suggestion view fires an interim update with `items: []` and
      // `loading: true` before it awaits items(), then a second one with the
      // results. v2 only ever called this once, already resolved. Treating the
      // interim list as "no matches" clears the highlight (so Enter takes the
      // wrong row), blanks the popup once per keystroke, and — because
      // `items[selected]` is then undefined — lets Enter fall through to
      // ProseMirror and split the paragraph. Keep what is on screen for that
      // window; only `command` has to be refreshed, since it carries the range.
      command = props.command;
      loading = props.loading;
      if (loading && props.items.length === 0) {
        place(props.clientRect?.());
        return;
      }
      items = props.items;
      if (selected >= items.length) selected = 0;
      place(props.clientRect?.());
      draw();
    },
    onKeyDown(props: SuggestionKeyDownProps): boolean {
      const { key } = props.event;
      if (key === "ArrowDown") {
        if (items.length) selected = (selected + 1) % items.length;
        draw();
        return true;
      }
      if (key === "ArrowUp") {
        if (items.length) selected = (selected - 1 + items.length) % items.length;
        draw();
        return true;
      }
      if (key === "Enter" || key === "Tab") {
        if (items[selected]) {
          command?.(items[selected]);
          return true;
        }
        // Results still in flight (a real IPC round-trip for the index-backed
        // popovers). Swallow the key rather than let it split the paragraph or
        // move focus out of the editor — "not known yet" is not "no matches".
        if (loading) return true;
      }
      if (key === "Escape") {
        // End the session, don't just hide the popup: mark the token dismissed
        // and dispatch an (empty) transaction so the Suggestion plugin
        // re-evaluates now — it exits synchronously (onExit removes the popup)
        // and a following Enter inserts a plain newline again.
        onDismiss(props.range);
        props.view.dispatch(props.view.state.tr);
        return true;
      }
      return false;
    },
    onExit() {
      popup?.remove();
      popup = null;
      items = [];
      selected = 0;
      command = null;
    },
  };
}
