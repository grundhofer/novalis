import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { errorKey, errorValues, NovalisError } from "../ipc/client";
import { report, useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import ErrorDetails, { detailsOf } from "./ErrorDetails";
import { withFileNames } from "./FileName";
import Icon from "./Icon";
import { inVaultValues } from "./StatusBar";

/** How long `submit` may run before the button says so (spec/02 §1.7, spec/07 §4.5). */
export const WAIT_MS = 1000;

/**
 * The errors that are about the typed name, said at the field (EIN-02): it
 * is taken, or it is no name a file can have. Each has its own sentence that
 * says what to do (spec/07 §4.1) and names no path: the core puts the
 * absolute one into some of them.
 */
const NAME_ERRORS = new Map([
  ["already_exists", "app.nameTaken"],
  ["invalid_path", "app.nameInvalid"],
]);
/**
 * Why the core refuses a path (`PathReason`, sent as `detail`) when the typed
 * name is the cause, the ones `app.nameInvalid` names. A symlink on the way
 * or a missing `.md` is not the name's fault: its sentence stays above the
 * actions.
 */
const NAME_REASONS = new Set(["absolute", "parent_dir", "empty", "hidden"]);
const nameErrorKey = (error: unknown) => {
  if (!(error instanceof NovalisError)) return undefined;
  if (error.code === "invalid_path" && !NAME_REASONS.has(error.ipc.detail ?? "")) return undefined;
  return NAME_ERRORS.get(error.code);
};

/**
 * The app's one dialog, sebaro's `.sb-dialog` (spec/02 §4.6, spec/03 §7,
 * EBE-03; ADR-0051 #13): a native `<dialog>` opened with `showModal()` over
 * the scrim, a title, then a field or the question's consequence, and the
 * actions at the end, „Abbrechen“ first. Focus moves in when it opens and
 * back to where it came from when it closes; Escape and a press on the scrim
 * cancel.
 *
 * An input dialog has a visible label (EIN-01) and its hint under the
 * field. Its submit names what happens („Anlegen“, „Umbenennen“, „Sichern“;
 * AKT-04) and is a secondary action, because a dialog has no primary action
 * (EBE-03, AKT-01). Work that takes longer than a second shows the waiting
 * state (spec/02 §1.7): the turning `loader`, the word of what runs
 * („Wird angelegt …“) and `aria-busy`. A failure stays in the dialog (D83
 * (2)): a name that is taken or no file name at the field (`.sb-field__error`,
 * EIN-02), until the name is changed, the verb staying; anything else as a
 * sentence with the error sign above the actions (`.sb-dialog__message`,
 * spec/02 §4.6), with the system's own text under its closed „Details“
 * (`ErrorDetails`, §3.28), the verb becoming „Noch mal versuchen“. No toast, no
 * action zone.
 *
 * A confirmation guards a destructive action (stores/ui.ts): the title is
 * the question, the text ends with what can be undone (AKT-08), „Abbrechen“
 * has the initial focus, and the verb is the danger action with the cut
 * (AKT-07). It closes at once and its failure goes to the action zone.
 */
export default function Prompt() {
  const { t } = useTranslation();
  const request = useUi((s) => s.prompt);
  const root = useVault((s) => s.vault)?.root;
  const [value, setValue] = useState(request?.initial ?? "");
  const dialog = useRef<HTMLDialogElement | null>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);
  // A press that began on the scrim (spec/02 §4.6, NV-L8).
  const scrimPress = useRef(false);
  // `submit` runs; a ref, so a second Enter in the same tick sees it too.
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const id = useId();
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
    setPending(false);
    setWaiting(false);
    setFailure(null);
  }

  // Open as a modal over the scrim, focus in; on close, focus back to where
  // it was, unless something else has taken it meanwhile.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!request || !element) return undefined;
    running.current = false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    if (request.confirm) cancel.current?.focus();
    else {
      input.current?.focus();
      input.current?.select();
    }
    return () => {
      const active = document.activeElement;
      if (element.open) element.close();
      const lost = !active || active === document.body || element.contains(active);
      if (lost && opener?.isConnected) opener.focus();
    };
  }, [request]);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => setWaiting(true), WAIT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  if (!request) return null;

  const confirm = request.confirm;
  const close = () => {
    // Only this question's to close: another one may have replaced it.
    if (useUi.getState().prompt === request) useUi.getState().closePrompt();
  };
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
    if (running.current) return;
    // An emptied textarea is an answer — it is how a description is cleared —
    // where an empty line is a slip.
    if (!trimmed && !request.multiline) {
      close();
      return;
    }
    running.current = true;
    setPending(true);
    setWaiting(false);
    setFailure(null);
    // Closed meanwhile, or another question asked: the state is the next
    // question's now, and this one leaves it alone.
    const stale = () => useUi.getState().prompt !== request;
    Promise.resolve(request.submit(trimmed))
      .then(() => {
        if (stale()) return;
        running.current = false;
        setPending(false);
        setWaiting(false);
        close();
      })
      .catch((error: unknown) => {
        if (stale()) return report(error);
        running.current = false;
        setPending(false);
        setWaiting(false);
        setFailure(error);
        // A name to fix: back to the field, whose description now says why.
        if (nameErrorKey(error)) input.current?.focus();
      });
  };

  // A press on the scrim cancels (EBE-03) as sebaro's dialog does (spec/02
  // §4.6, NV-L8): only a press that begins and ends on the scrim, so a
  // selection dragged out of the field does not close it, and not once the
  // field has changed since the dialog opened, so typed text is not lost;
  // Escape and „Abbrechen“ still cancel. The scrim is the dialog's
  // `::backdrop`, so the press lands on the dialog itself, outside its box.
  const onScrim = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return false;
    const box = event.currentTarget.getBoundingClientRect();
    return !(
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
    );
  };
  const changed = !confirm && value !== (request.initial ?? "");

  const titleId = `${id}-title`;
  const textId = `${id}-text`;
  const fieldId = `${id}-field`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  // A path in the vault is said vault-relative, as the action zone says it.
  const sentence = (error: unknown) =>
    withFileNames((key, values) => t(key, values), errorKey(error), inVaultValues(errorValues(error), root));
  const fieldError = nameErrorKey(failure);
  const failureDetails = failure === null ? null : detailsOf(errorKey(failure), errorValues(failure));
  const described = [request.hint && !confirm ? helpId : null, fieldError ? errorId : null].filter(Boolean).join(" ");
  const fieldProps = {
    id: fieldId,
    ref: attach,
    value,
    "aria-invalid": fieldError ? ("true" as const) : undefined,
    "aria-describedby": described || undefined,
    onChange: (event: { target: { value: string } }) => {
      setValue(event.target.value);
      // A changed name is a new one: the error about the old goes.
      if (fieldError) setFailure(null);
    },
  };

  return (
    <dialog
      className="sb-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={confirm ? textId : undefined}
      onMouseDown={(event) => {
        scrimPress.current = onScrim(event);
      }}
      onClick={(event) => {
        const began = scrimPress.current;
        scrimPress.current = false;
        if (began && onScrim(event) && !changed) close();
      }}
      onCancel={(event) => {
        // Escape: the store closes the dialog, not the browser.
        event.preventDefault();
        close();
      }}
      // Closed by the browser some other way: the store follows.
      onClose={() => {
        if (!dialog.current?.open) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
        // The dialog has the keyboard; the window's shortcuts do not see it.
        event.stopPropagation();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 className="sb-dialog__title" id={titleId}>
          {withFileNames((key, values) => t(key, values), request.titleKey, request.titleValues ?? {})}
        </h2>
        {confirm ? (
          <p className="sb-dialog__text" id={textId}>
            {withFileNames((key, values) => t(key, values), confirm.bodyKey, confirm.values ?? {})}
          </p>
        ) : (
          <div className="sb-field">
            {request.labelKey && (
              <label className="sb-field__label" htmlFor={fieldId}>
                {t(request.labelKey)}
                {/* Emptied, the description is cleared: the one field that may stay empty. */}
                {request.multiline && (
                  <>
                    {" "}
                    <span className="sb-optional">{t("app.optional")}</span>
                  </>
                )}
              </label>
            )}
            <div className="sb-field__control">
              {request.multiline ? (
                <textarea
                  {...fieldProps}
                  rows={6}
                  onKeyDown={(event) => {
                    // Enter is a line break here; the chord is what submits.
                    if (event.key === "Enter" && event.metaKey) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                />
              ) : (
                <input
                  {...fieldProps}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      // The form would submit too; one submit per Enter.
                      event.preventDefault();
                      submit();
                    }
                  }}
                />
              )}
            </div>
            {request.hint && (
              <p className="sb-field__help" id={helpId}>
                {t(request.hint.key, request.hint.values ?? {})}
              </p>
            )}
            {fieldError && (
              <p className="sb-field__error" id={errorId}>
                <Icon name="error--filled" />
                <span>{t(fieldError)}</span>
              </p>
            )}
          </div>
        )}
        {/* The live region is there before the failure and starts empty,
            collapsed by sebaro.css's `:empty` (spec/02 §4.6, CHECKS §36): a
            reader announces what is written into it, not a region that
            arrives already filled. */}
        {!confirm && (
          <div className="sb-dialog__message" role="alert">
            {failure !== null && !fieldError && (
              <>
                <Icon name="error" />
                <span>{sentence(failure)}</span>
                {failureDetails && <ErrorDetails text={failureDetails} />}
              </>
            )}
          </div>
        )}
        <div className="sb-dialog__actions">
          <button className="sb-secondary-action" type="button" ref={cancel} onClick={close}>
            {t("app.cancel")}
          </button>
          {/* Every confirmation guards a destructive action (stores/ui.ts):
              its button is the danger one with the 45-degree cut (AKT-07),
              the verb without the trash, which is the trigger's (spec/02
              §1.4, §4.6, sebaro D108 NV-Y8). An input dialog's verb is a
              secondary action (EBE-03, AKT-01). */}
          {confirm ? (
            <button className="sb-danger-action sb-danger-action--outlined" type="submit">
              {t(confirm.confirmKey)}
            </button>
          ) : (
            <button className="sb-secondary-action" type="submit" aria-busy={waiting || undefined}>
              {waiting && <Icon name="loader" size={20} className="sb-spinner" />}
              {t(
                waiting
                  ? (request.busyKey ?? "app.saving")
                  : failure !== null && !fieldError
                    ? "app.retry"
                    : (request.submitKey ?? "app.save"),
              )}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
