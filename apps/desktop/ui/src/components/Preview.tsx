import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Mermaid } from "mermaid";

import { commands, unwrap } from "../ipc/client";
import { mimeOf } from "../lib/fileTypes";
import { resolveDestination } from "../lib/links";
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
    <section className="preview">
      <div className="preview-body" ref={body} onClick={onClick} />
    </section>
  );
}
