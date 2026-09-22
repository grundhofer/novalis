import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap } from "../ipc/client";
import { mimeOf, type ViewKind } from "../lib/fileTypes";
import { stemOf } from "../lib/paths";
import { report } from "../stores/ui";
import "../styles/viewer.css";

/**
 * The read-only pane for a PDF, an image, a book, a comic or a Word
 * document (ADR-0015, ADR-0023, ADR-0024).
 *
 * A PDF, an image and a document come through `read_blob` as base64: the
 * image is shown from a `blob:` URL that lives as long as the tab shows the
 * file, the PDF goes to pdf.js (ADR-0016) and the document to mammoth. A
 * book and a comic are not one file but a container, so they never pass
 * here at all — their readers open them part by part through `read_packed`.
 * All five viewers are their own chunk and none of them loads before a file
 * of its kind is opened.
 */

const PdfViewer = lazy(() => import("./PdfViewer"));
const EpubViewer = lazy(() => import("./EpubViewer"));
const CbzViewer = lazy(() => import("./CbzViewer"));
const DocxViewer = lazy(() => import("./DocxViewer"));

/** Whether the file is a container the viewer reads inside, not one blob. */
function packed(kind: ViewKind): boolean {
  return kind === "epub" || kind === "cbz";
}

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type Loaded = { path: string; bytes: Uint8Array<ArrayBuffer>; url: string | null };

export default function Viewer({ path, kind }: { path: string; kind: ViewKind }) {
  const { t } = useTranslation();
  // Keyed by path, so switching tabs shows "loading" rather than the previous
  // file until the new one arrives.
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    // A container is read inside, not whole: its reader does its own reads.
    if (packed(kind)) return undefined;
    let url: string | null = null;
    let cancelled = false;
    unwrap(commands.readBlob(path))
      .then((blob) => {
        if (cancelled) return;
        const bytes = decode(blob.base64);
        if (kind === "image") url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
        setLoaded({ path, bytes, url });
      })
      .catch(report);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, kind]);

  if (packed(kind)) {
    return (
      <section className="viewer">
        <Suspense fallback={<div className="pane-loading">{t("editor.loading")}</div>}>
          {/* Keyed by path: another container is another reader, with no
              state of the last one — the same rule the other two follow
              through `loaded.path`. */}
          {kind === "epub" ? <EpubViewer key={path} path={path} /> : <CbzViewer key={path} path={path} />}
        </Suspense>
      </section>
    );
  }
  if (loaded?.path !== path) return <div className="pane-loading">{t("editor.loading")}</div>;
  return (
    <section className="viewer">
      {kind === "pdf" || kind === "docx" ? (
        <Suspense fallback={<div className="pane-loading">{t("editor.loading")}</div>}>
          {kind === "pdf" ? (
            <PdfViewer bytes={loaded.bytes} />
          ) : (
            <DocxViewer bytes={loaded.bytes} />
          )}
        </Suspense>
      ) : (
        <img className="viewer-image" src={loaded.url ?? undefined} alt={stemOf(path)} />
      )}
    </section>
  );
}
