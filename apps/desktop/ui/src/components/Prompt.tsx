import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorKey, errorValues } from "../ipc/client";
import { report, useUi } from "../stores/ui";
import Icon from "./Icon";

/**
 * The app's one dialog: a title, a line of text or a question, OK and Cancel.
 *
 * OK is the dialog's lime primary and shows its own progress (sebaro D48):
 * while `submit` runs it says what runs and an ink bar sweeps inside it;
 * a failure stays in the dialog as a sentence in danger above the buttons,
 * and OK becomes "Try Again". No toast for it.
 */
export default function Prompt() {
  const { t } = useTranslation();
  const request = useUi((s) => s.prompt);
  const [value, setValue] = useState(request?.initial ?? "");
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const accept = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  // One ref for either field. An object ref is typed for one element, so the
  // union is attached by hand; `select()` is on both.
  const attach = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
    input.current = element;
  };

  // A new question resets the field during render rather than in an effect.
  const [lastRequest, setLastRequest] = useState(request);
  if (lastRequest !== request) {
    setLastRequest(request);
    setValue(request?.initial ?? "");
    setBusy(false);
    setFailure(null);
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
    // `submit` does the real work and can fail — an existing name, a read-only
    // vault, a sync collision. Without a catch the dialog just closed and
    // nothing happened, silently.
    if (confirm) {
      close();
      void Promise.resolve(request.submit("")).catch(report);
      return;
    }
    // An emptied textarea is an answer — it is how a description is cleared —
    // where an empty line is a slip.
    if (busy) return;
    if (!trimmed && !request.multiline) {
      close();
      return;
    }
    setBusy(true);
    setFailure(null);
    Promise.resolve(request.submit(trimmed))
      .then(() => {
        // Closed meanwhile, or another question asked: not this dialog's to close.
        if (useUi.getState().prompt === request) close();
      })
      .catch((error: unknown) => {
        if (useUi.getState().prompt !== request) return report(error);
        setBusy(false);
        setFailure(error);
      });
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
        ) : request.multiline ? (
          <textarea
            className="dialog-input dialog-textarea"
            ref={attach}
            rows={6}
            value={value}
            placeholder={request.placeholderKey ? t(request.placeholderKey) : undefined}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              // Enter is a line break here; the chord is what submits.
              if (event.key === "Enter" && event.metaKey) submit();
              if (event.key === "Escape") close();
              event.stopPropagation();
            }}
          />
        ) : (
          <input
            className="dialog-input"
            ref={attach}
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
        {!confirm && request.hint && (
          <p className="dialog-hint">{t(request.hint.key, request.hint.values ?? {})}</p>
        )}
        {failure !== null && (
          <p className="dialog-error" role="alert">
            {t(errorKey(failure), errorValues(failure))}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn ghost" type="button" onClick={close}>
            {t("app.cancel")}
          </button>
          {/* Every confirmation guards a destructive action (stores/ui.ts):
              its button is the danger one with the 45-degree cut, never the
              lime primary (sebaro D46, D56; ADR-0048). */}
          {confirm ? (
            <button className="btn danger" type="button" ref={accept} onClick={submit}>
              <Icon name="trash" />
              {t(confirm.confirmKey)}
            </button>
          ) : (
            <button className="btn primary" type="button" ref={accept} aria-busy={busy} onClick={submit}>
              {t(busy ? (request.busyKey ?? "app.saving") : failure !== null ? "app.retry" : "app.ok")}
              <i className="btn-bar" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
