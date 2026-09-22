import { useEffect, useRef } from "react";

import { stemOf } from "../lib/paths";
import { useEditorSave } from "../stores/editorSave";
import "../styles/preview.css";

/**
 * An SVG as its picture (`Cmd+E` / the eye glyph, ADR-0025), drawn from the
 * buffer as an `<img>` of a `blob:` URL. SVG as an image is inert by the
 * WebView's own rules — no script runs and nothing outside the file is
 * fetched — so the file needs no sanitizing to be shown. The editor keeps
 * showing it as XML; this is only the second look.
 */
export default function SvgPreview({ path }: { path: string }) {
  const text = useEditorSave((s) => s.docs[path]?.text ?? "");
  const image = useRef<HTMLImageElement | null>(null);

  // The URL lives exactly as long as the text it was made from; it is set
  // on the element, not kept in state, so each text has one.
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [text]);

  return (
    <section className="svg-preview">
      <img className="svg-preview-image" ref={image} alt={stemOf(path)} />
    </section>
  );
}
