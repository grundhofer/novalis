import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useUi } from "../stores/ui";

/** The app's one dialog: a title, a line of text, OK and Cancel. */
export default function Prompt() {
  const { t } = useTranslation();
  const request = useUi((s) => s.prompt);
  const [value, setValue] = useState(request?.initial ?? "");
  const input = useRef<HTMLInputElement | null>(null);

  // A new question resets the field during render rather than in an effect.
  const [lastRequest, setLastRequest] = useState(request);
  if (lastRequest !== request) {
    setLastRequest(request);
    setValue(request?.initial ?? "");
  }

  useEffect(() => {
    if (!request) return undefined;
    // The dialog is mounted in the same frame; select after the paint.
    const id = requestAnimationFrame(() => input.current?.select());
    return () => cancelAnimationFrame(id);
  }, [request]);

  if (!request) return null;

  const close = () => useUi.getState().closePrompt();
  const submit = () => {
    const trimmed = value.trim();
    close();
    if (trimmed) void request.submit(trimmed);
  };

  return (
    <div className="scrim" onMouseDown={close}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{t(request.titleKey)}</h2>
        <input
          className="dialog-input"
          ref={input}
          value={value}
          placeholder={t(request.placeholderKey)}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
            if (event.key === "Escape") close();
            event.stopPropagation();
          }}
        />
        <div className="dialog-actions">
          <button className="btn ghost" type="button" onClick={close}>
            {t("app.cancel")}
          </button>
          <button className="btn primary" type="button" onClick={submit}>
            {t("app.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
