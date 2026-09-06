import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { report } from "../lib/commands";
import { useUi } from "../stores/ui";

/** The app's one dialog: a title, a line of text or a question, OK and Cancel. */
export default function Prompt() {
  const { t } = useTranslation();
  const request = useUi((s) => s.prompt);
  const [value, setValue] = useState(request?.initial ?? "");
  const input = useRef<HTMLInputElement | null>(null);
  const accept = useRef<HTMLButtonElement | null>(null);

  // A new question resets the field during render rather than in an effect.
  const [lastRequest, setLastRequest] = useState(request);
  if (lastRequest !== request) {
    setLastRequest(request);
    setValue(request?.initial ?? "");
  }

  useEffect(() => {
    if (!request) return undefined;
    // The dialog is mounted in the same frame; take focus after the paint. A
    // confirmation has no input, so the button takes it and the dialog stays
    // keyboard-operable.
    const id = requestAnimationFrame(() => {
      if (request.confirm) accept.current?.focus();
      else input.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [request]);

  if (!request) return null;

  const confirm = request.confirm;
  const close = () => useUi.getState().closePrompt();
  const submit = () => {
    const trimmed = value.trim();
    close();
    // `submit` does the real work and can fail — an existing name, a read-only
    // vault, a sync collision. Without this catch the dialog just closed and
    // nothing happened, silently.
    if (confirm) void Promise.resolve(request.submit("")).catch(report);
    else if (trimmed) void Promise.resolve(request.submit(trimmed)).catch(report);
  };

  return (
    <div className="scrim" onMouseDown={close}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // The input handles its own keys; a confirmation has none, so the
          // dialog answers for it.
          if (!confirm) return;
          if (event.key === "Escape") close();
          event.stopPropagation();
        }}
      >
        <h2 className="dialog-title">{t(request.titleKey)}</h2>
        {confirm ? (
          <p className="dialog-body">{t(confirm.bodyKey, confirm.values ?? {})}</p>
        ) : (
          <input
            className="dialog-input"
            ref={input}
            value={value}
            placeholder={request.placeholderKey ? t(request.placeholderKey) : undefined}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
              if (event.key === "Escape") close();
              event.stopPropagation();
            }}
          />
        )}
        <div className="dialog-actions">
          <button className="btn ghost" type="button" onClick={close}>
            {t("app.cancel")}
          </button>
          <button className="btn primary" type="button" ref={accept} onClick={submit}>
            {t(confirm ? confirm.confirmKey : "app.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
