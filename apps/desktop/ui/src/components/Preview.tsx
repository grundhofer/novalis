import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { Mermaid } from "mermaid";

import { commands, unwrap } from "../ipc/client";
import { mimeOf } from "../lib/fileTypes";
import { resolveDestination } from "../lib/links";
import { setPreviewBridge } from "../lib/previewBridge";
import { parseBlockSpan, toggleMarkInSource } from "../lib/previewEdit";
import { useEditorSave } from "../stores/editorSave";
import { report, useUi } from "../stores/ui";
import "../styles/preview.css";

/**
 * The read-only preview of a note (`Cmd+E`, ADR-0020; PLAN.md §4.4).
 *
 * The fragment is the core's (`notes/render.rs`), which turns raw HTML in a
 * note into text: what lands in `innerHTML` here is only markup
 * pulldown-cmark wrote, never anything the note carried. It is rendered from
 * the buffer, not the disk, so an unsaved edit shows. Images arrive the
 * viewer's way (`read_blob`, a `blob:` URL for as long as the fragment
 * stands); a link goes through the app's `followLink` like a `Cmd`-click in
 * the editor; a ```mermaid fence becomes a diagram (owner yes 2026-09-15).
 * mermaid is its own chunk, fetched on the first diagram and never before.
 *
 * The editor's chords work here too (owner, 2026-09-16): `Cmd+F` opens a
 * find bar over the rendered text, `Cmd+B` and `Cmd+I` put a mark around the
 * selection into the source (`lib/previewEdit`), and the pane re-renders
 * from the buffer like after any edit. Both reach the pane through
 * `lib/previewBridge`, registered while the pane is mounted.
 */

/** A text change re-renders after this pause: a sync burst is one render. */
const RENDER_DEBOUNCE_MS = 150;

/** `https:`, `mailto:` and the like — the test `lib/links.ts` uses. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The same lines as Viewer.tsx: base64 from `read_blob` to bytes. */
function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A percent-encoded destination as written; a stray `%` is not an escape. */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

let mermaidModule: Promise<Mermaid> | null = null;
let mermaidTheme: "dark" | "default" | null = null;
/** Diagram ids must differ within the document; one counter for the session. */
let diagramSerial = 0;

/**
 * mermaid, loaded once and configured for the current appearance. `strict`
 * has it sanitise its own SVG through DOMPurify and drop click bindings.
 * `initialize` replaces the whole configuration, so it runs again only when
 * the theme changed under a note that is open.
 */
async function mermaidFor(theme: "dark" | "default"): Promise<Mermaid> {
  mermaidModule ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidModule;
  if (mermaidTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });
    mermaidTheme = theme;
  }
  return mermaid;
}

type Rendered = { path: string; html: string };

// ---- find -------------------------------------------------------------------
// The hits are DOM, not state: they are `<mark>`s inside the fragment the
// layout effect owns, and they have to be made again every time that
// fragment is written. So the count is written the same way — read off the
// marks after each pass, into a span React leaves alone — rather than through
// state an effect would have to set.

/** The marks in the fragment and which of them is current. */
interface Hits {
  marks: HTMLElement[];
  current: number;
  /** The query the marks were made for. */
  query: string;
}

/** What the count needs of `t`; the rest of `useTranslation` stays out. */
type Translate = (key: string, values?: Record<string, unknown>) => string;

/** Every occurrence of `query` in the fragment's text wrapped in a `<mark>`. */
function markHits(host: HTMLElement, query: string): HTMLElement[] {
  if (!query) return [];
  // A substring, not a pattern: the editor's find is one too until the user
  // asks for regex, and the preview has no such switch.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  // Collected first: splitting a node while walking would visit its
  // remainder again.
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // A `<mark>` is HTML; inside a diagram's SVG it would show nothing.
    if (!node.parentElement?.closest(".preview-diagram")) nodes.push(node as Text);
  }
  const marks: HTMLElement[] = [];
  for (const node of nodes) {
    let rest = node;
    for (let match = pattern.exec(rest.data); match; match = pattern.exec(rest.data)) {
      const hit = rest.splitText(match.index);
      rest = hit.splitText(match[0].length);
      const mark = document.createElement("mark");
      mark.className = "preview-hit";
      hit.replaceWith(mark);
      mark.append(hit);
      marks.push(mark);
    }
  }
  return marks;
}

/** The fragment as it was before `markHits`, its text nodes rejoined. */
function unwrapHits(host: HTMLElement): void {
  for (const mark of host.querySelectorAll("mark.preview-hit")) mark.replaceWith(...mark.childNodes);
  // Rejoined, so the next pass sees "Welt" and not "We" beside "lt".
  host.normalize();
}

/** Make hit `index` the current one — clamped, scrolled to — and say where we are. */
function showHit(hits: Hits, index: number, count: HTMLElement | null, t: Translate): void {
  const n = hits.marks.length;
  hits.marks[hits.current]?.classList.remove("current");
  hits.current = n === 0 ? 0 : Math.max(0, Math.min(index, n - 1));
  const mark = hits.marks[hits.current];
  if (mark) {
    mark.classList.add("current");
    // jsdom has no layout, and no `scrollIntoView` (ADR-0011).
    if (typeof mark.scrollIntoView === "function") mark.scrollIntoView({ block: "center" });
  }
  if (!count) return;
  count.textContent =
    n > 0
      ? t("editor.find.matchCount", { current: hits.current + 1, count: n })
      : hits.query
        ? t("editor.find.noMatches")
        : "";
}

/** The block a selection end lies in: the innermost element with a source span. */
function blockOf(node: Node | null): Element | null {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest("[data-pos]") ?? null;
}

export default function Preview({
  path,
  onFollowLink,
}: {
  path: string;
  onFollowLink: (target: string) => void;
}) {
  const { t } = useTranslation();
  const text = useEditorSave((s) => s.docs[path]?.text);
  // Keyed by path like the viewer: switching tabs shows "loading", never the
  // previous note's fragment under the new tab's name.
  const [rendered, setRendered] = useState<Rendered | null>(null);
  /** Which note has a fragment on screen — the first one renders at once. */
  const shown = useRef<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const hits = useRef<Hits>({ marks: [], current: 0, query: "" });
  /** The bridge is registered once; it reads the note it acts on from here. */
  const pathRef = useRef(path);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  // ---- the fragment --------------------------------------------------------
  useEffect(() => {
    if (text === undefined) return undefined;
    let cancelled = false;
    const run = () => {
      unwrap(commands.renderMarkdown(text))
        .then((html) => {
          if (cancelled) return;
          shown.current = path;
          // The same fragment again (an edit outside the body, say) is not
          // a reason to fetch the images anew.
          setRendered((prev) => (prev?.path === path && prev.html === html ? prev : { path, html }));
        })
        .catch(report);
    };
    if (shown.current !== path) {
      run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(run, RENDER_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, text]);

  // ---- what the fragment still needs: image bytes, diagrams ----------------
  // A layout effect, so the fragment is in the DOM before the frame that
  // shows the pane: with `useEffect` the first frame would be an empty body.
  useLayoutEffect(() => {
    const host = body.current;
    if (!host || !rendered) return undefined;
    let cancelled = false;
    const urls: string[] = [];
    // The effect owns this subtree: React never renders children into it, so
    // every run starts from the fragment as the core wrote it.
    host.innerHTML = rendered.html;

    // A relative `src` is a vault path the webview cannot reach; the bytes
    // come through `read_blob` like the viewer's. Until they arrive the alt
    // text shows, not a broken image for a URL nothing could serve.
    for (const img of host.querySelectorAll("img")) {
      const target = resolveDestination(rendered.path, img.getAttribute("src") ?? "");
      if (!target) continue;
      img.removeAttribute("src");
      unwrap(commands.readBlob(target))
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(new Blob([decode(blob.base64)], { type: mimeOf(target) }));
          urls.push(url);
          img.src = url;
        })
        .catch(report);
    }

    const fences = host.querySelectorAll("pre > code.language-mermaid");
    if (fences.length > 0) {
      void (async () => {
        const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "default";
        const mermaid = await mermaidFor(theme);
        for (const code of fences) {
          if (cancelled) return;
          const pre = code.parentElement;
          if (!pre) continue;
          try {
            diagramSerial += 1;
            const { svg } = await mermaid.render(`novalis-mermaid-${diagramSerial}`, code.textContent ?? "");
            if (cancelled) return;
            const diagram = document.createElement("div");
            diagram.className = "preview-diagram";
            diagram.innerHTML = svg;
            pre.replaceWith(diagram);
          } catch (error) {
            // A fence mermaid cannot read stays a code block, and says why.
            report(error);
          }
        }
      })().catch(report);
    }

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [rendered]);

  // ---- the hits ------------------------------------------------------------
  // After the fragment effect, so the marks go into the fragment just
  // written; the cleanup takes them out again before the next one lands and
  // when the bar closes.
  useLayoutEffect(() => {
    const host = body.current;
    if (!findOpen || !host || !rendered) return undefined;
    const state = hits.current;
    // A new query starts at its first hit; the same query over a re-rendered
    // fragment (a live edit) keeps its place.
    const current = state.query === query ? state.current : 0;
    state.marks = markHits(host, query);
    state.query = query;
    showHit(state, current, count.current, t);
    return () => {
      unwrapHits(host);
      state.marks = [];
    };
  }, [findOpen, query, rendered, t]);

  // The bar takes the chord: its text selected, so typing replaces the last
  // query, as in the editor's panel.
  useLayoutEffect(() => {
    if (!findOpen) return;
    input.current?.focus();
    input.current?.select();
  }, [findOpen]);

  const step = useCallback(
    (delta: number) => {
      // `Cmd+G` with the bar closed opens it, as in the editor.
      if (!input.current) {
        setFindOpen(true);
        return;
      }
      const state = hits.current;
      const n = state.marks.length;
      if (n > 0) showHit(state, (state.current + delta + n) % n, count.current, t);
    },
    [t],
  );

  const onFindKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setFindOpen(false);
    }
  };

  // ---- the chords (lib/previewBridge) -------------------------------------
  // Registered once per `step`; everything else the handlers need is read
  // through refs at the keystroke, never from the render that registered them.
  useEffect(() => {
    setPreviewBridge({
      find: () => {
        if (input.current) {
          input.current.focus();
          input.current.select();
        } else {
          setFindOpen(true);
        }
      },
      findNext: () => step(1),
      findPrevious: () => step(-1),
      mark: (kind) => {
        // One block, both ends in it, something between them — or the editor
        // is the honest answer (`lib/previewEdit`).
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) return false;
        const block = blockOf(selection.anchorNode);
        if (!block || block !== blockOf(selection.focusNode) || !body.current?.contains(block)) return false;
        const span = parseBlockSpan(block.getAttribute("data-pos"));
        if (!span) return false;
        const notePath = pathRef.current;
        const source = useEditorSave.getState().docs[notePath]?.text;
        if (source === undefined) return false;
        const next = toggleMarkInSource(source, span, selection.toString(), kind === "bold" ? "**" : "_");
        if (next === null) return false;
        useEditorSave.getState().setText(notePath, next);
        // The fragment is about to be written anew; a selection into the old
        // one would only look like it survived.
        selection.removeAllRanges();
        return true;
      },
    });
    return () => setPreviewBridge(null);
  }, [step]);

  // ---- links ---------------------------------------------------------------
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element | null)?.closest("a[href]");
    if (!anchor) return;
    // Nothing navigates the webview: a link is the app's business or nobody's.
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      // A footnote reference, or the way back from its definition.
      const id = decodeHref(href.slice(1));
      for (const el of body.current?.querySelectorAll("[id]") ?? []) {
        if (el.id === id) {
          el.scrollIntoView();
          break;
        }
      }
      return;
    }
    if (SCHEME.test(href)) {
      // Mode 1 opens nothing outside the vault (docs/PRIVACY.md); the toast
      // says so rather than letting the click look broken.
      useUi.getState().showToast("editor.previewExternalLink");
      return;
    }
    onFollowLink(decodeHref(href));
  };

  if (rendered?.path !== path) return <div className="pane-loading">{t("editor.loading")}</div>;
  return (
    <>
      {findOpen && (
        <div className="preview-find" role="search">
          <input
            className="preview-find-input"
            ref={input}
            value={query}
            placeholder={t("editor.find.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onFindKey}
          />
          <span className="preview-find-count" ref={count} />
          <button
            className="btn ghost tool"
            type="button"
            title={t("editor.find.previous")}
            aria-label={t("editor.find.previous")}
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <button
            className="btn ghost tool"
            type="button"
            title={t("editor.find.next")}
            aria-label={t("editor.find.next")}
            onClick={() => step(1)}
          >
            ›
          </button>
          <button
            className="btn ghost tool"
            type="button"
            title={t("editor.find.close")}
            aria-label={t("editor.find.close")}
            onClick={() => setFindOpen(false)}
          >
            ×
          </button>
        </div>
      )}
      <section className="preview">
        <div className="preview-body" ref={body} onClick={onClick} />
      </section>
    </>
  );
}
