import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap } from "../ipc/client";
import { mimeOf, type ViewKind } from "../lib/fileTypes";
import { stemOf } from "../lib/paths";
import { report } from "../stores/ui";
import "../styles/viewer.css";

/**
 * The read-only pane for a PDF or an image (ADR-0015). The file comes through
 * `read_blob` as base64. An image is shown from a `blob:` URL that lives as
 * long as the tab shows the file; a PDF goes to pdf.js (ADR-0016), which is
 * its own chunk and only ever loads when a PDF is opened.
 */

const PdfViewer = lazy(() => import("./PdfViewer"));

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

  if (loaded?.path !== path) return <div className="pane-loading">{t("editor.loading")}</div>;
  return (
    <section className="viewer">
      {kind === "pdf" ? (
        <Suspense fallback={<div className="pane-loading">{t("editor.loading")}</div>}>
          <PdfViewer bytes={loaded.bytes} />
        </Suspense>
      ) : (
        <img className="viewer-image" src={loaded.url ?? undefined} alt={stemOf(path)} />
      )}
    </section>
  );
}
