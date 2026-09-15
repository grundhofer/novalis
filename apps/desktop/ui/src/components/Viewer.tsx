import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, unwrap } from "../ipc/client";
import { mimeOf, type ViewKind } from "../lib/fileTypes";
import { stemOf } from "../lib/paths";
import { report } from "../stores/ui";
import "../styles/viewer.css";

/**
 * The read-only pane for a PDF or an image (ADR-0015). The file comes through
 * `read_blob` as base64 and is shown from a `blob:` URL the WebView renders
 * itself — WebKit's own PDF view, an `<img>` — so nothing is parsed here and
 * nothing is bundled for it. The URL lives exactly as long as the tab shows
 * the file.
 */

function toBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export default function Viewer({ path, kind }: { path: string; kind: ViewKind }) {
  const { t } = useTranslation();
  // Keyed by path, so switching tabs shows "loading" rather than the previous
  // file until the new one arrives.
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);

  useEffect(() => {
    let current: string | null = null;
    let cancelled = false;
    unwrap(commands.readBlob(path))
      .then((blob) => {
        if (cancelled) return;
        current = toBlobUrl(blob.base64, mimeOf(path));
        setLoaded({ path, url: current });
      })
      .catch(report);
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [path]);

  const url = loaded?.path === path ? loaded.url : null;
  if (!url) return <div className="pane-loading">{t("editor.loading")}</div>;
  return (
    <section className="viewer">
      {kind === "pdf" ? (
        <iframe className="viewer-frame" src={url} title={stemOf(path)} />
      ) : (
        <img className="viewer-image" src={url} alt={stemOf(path)} />
      )}
    </section>
  );
}
