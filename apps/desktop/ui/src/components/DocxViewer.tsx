import mammoth from "mammoth";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { DOCUMENT_CSS } from "../lib/documentCss";
import { sanitizeInto } from "../lib/sanitize";
import { useUi } from "../stores/ui";

/**
 * The Word reader (ADR-0024): `mammoth` turns `word/document.xml` into
 * simple HTML — headings, lists, tables, emphasis, links and pictures — and
 * the app shows that HTML the way it shows an EPUB chapter, copied through
 * the allow-list of `lib/sanitize` into a Shadow-DOM host.
 *
 * It is a reader, not Word: no page layout, no comments or tracked changes,
 * no editing, no printing, and nothing is fetched. The document's pictures
 * arrive from mammoth as `data:` URIs, which the CSP allows and which fetch
 * nothing; everything else the document points at stays a dead link with
 * the preview's toast behind it.
 *
 * mammoth needs no `eval`: it was run once against the real CSP in a built
 * app (the ADR's condition), where `Function()` is refused and the
 * conversion still succeeds.
 *
 * The 15 MB cap is on what mammoth is asked to convert, where the cost is:
 * its HTML and the DOM built from it are several times the file. The shell
 * refuses anything above 50 MB before that (`read_blob`).
 */

/** What the reader will convert; above this the tab says so instead. */
const MAX_BYTES = 15 * 1024 * 1024;

/** `https:`, `mailto:` and the like — the same test the sanitizer runs. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

type State = "loading" | "ready" | "unreadable";

export default function DocxViewer({ bytes }: { bytes: Uint8Array<ArrayBuffer> }) {
  const { t } = useTranslation();
  // What the file is is not state: it is the size it arrived with.
  const tooLarge = bytes.length > MAX_BYTES;
  const [state, setState] = useState<State>("loading");
  const host = useRef<HTMLDivElement>(null);

  // The shadow root is the effect's alone: React renders no children into the
  // host, so every run starts from an empty root.
  useEffect(() => {
    const element = host.current;
    if (!element || tooLarge) return undefined;
    let cancelled = false;

    void (async () => {
      // mammoth reads the zip itself; it takes the buffer, not a copy.
      const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
      if (cancelled) return;
      // Parsed inert: no script runs in this document and no resource of it
      // loads, and only the allow-list copy of it reaches the page.
      const parsed = new DOMParser().parseFromString(value, "text/html");
      const body = document.createElement("div");
      body.className = "body";
      body.append(sanitizeInto(parsed.body, document));
      // A picture is the whole `data:` URI the sanitizer carried over; what
      // an `<img>` shows stays the reader's decision, as in the book reader.
      for (const img of body.querySelectorAll<HTMLImageElement>("img[data-src]")) {
        const src = img.dataset.src ?? "";
        img.removeAttribute("data-src");
        if (src.startsWith("data:image/")) img.src = src;
      }
      const style = document.createElement("style");
      style.textContent = DOCUMENT_CSS;
      const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
      root.replaceChildren(style, body);
      setState("ready");
    })().catch(() => {
      // A document mammoth cannot read is not an app failure to report: the
      // banner says what it is, and there is nothing else to show.
      if (!cancelled) setState("unreadable");
    });

    return () => {
      cancelled = true;
    };
  }, [bytes, tooLarge]);

  // A click inside the shadow root reaches the host retargeted, so the anchor
  // is found on the composed path and not on the event's target.
  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = event.nativeEvent
      .composedPath()
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    if (!anchor) return;
    // Nothing navigates the webview: a link is the document's business or
    // nobody's.
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      const target = host.current?.shadowRoot?.getElementById(href.slice(1));
      if (target && typeof target.scrollIntoView === "function") target.scrollIntoView();
      return;
    }
    // Mode 1 opens nothing outside the vault (docs/PRIVACY.md); the toast
    // says so rather than letting the click look broken.
    if (SCHEME.test(href)) useUi.getState().showToast("editor.previewExternalLink");
  };

  return (
    <div className="docx">
      {tooLarge || state === "unreadable" ? (
        <div className="banner" role="status">
          <span className="banner-body">
            {t(tooLarge ? "viewer.docx.tooLarge" : "viewer.docx.unreadable")}
          </span>
        </div>
      ) : null}
      {!tooLarge && state === "loading" && (
        <div className="pane-loading">{t("editor.loading")}</div>
      )}
      <div className="docx-scroll">
        <div className="docx-host" ref={host} onClick={onClick} />
      </div>
    </div>
  );
}
