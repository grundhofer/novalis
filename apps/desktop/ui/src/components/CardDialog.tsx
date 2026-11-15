import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { errorKey, errorValues, type CardOpDto, type PriorityDto } from "../ipc/client";
import { useBoard } from "../stores/board";
import { report, useUi } from "../stores/ui";
import ErrorDetails, { detailsOf } from "./ErrorDetails";
import Icon from "./Icon";
import { WAIT_MS } from "./Prompt";
import "../styles/board.css";

/** The steps of a priority in the field's order (ADR-0054). */
const PRIORITIES: readonly PriorityDto[] = ["high", "medium", "low"];
const PRIORITY_KEYS: Record<PriorityDto, string> = {
  high: "board.priorityHigh",
  medium: "board.priorityMedium",
  low: "board.priorityLow",
};
/** sebaro's six category tones (`--sb-category-1…6`, spec/01 §1.9) by name. */
const TONE_KEYS = ["board.tone1", "board.tone2", "board.tone3", "board.tone4", "board.tone5", "board.tone6"];

/** The labels typed in the field: split at commas, trimmed, each once regardless of case. */
export function labelsOf(text: string): string[] {
  const kept: string[] = [];
  for (const label of text.split(",").map((part) => part.trim().normalize("NFC"))) {
    if (label && !kept.some((k) => k.toLocaleLowerCase() === label.toLocaleLowerCase())) kept.push(label);
  }
  return kept;
}

/**
 * „Karte bearbeiten“ (ADR-0054): the card's title, its description and the
 * fields of part 3 — labels with their tone on this board, the due day, the
 * priority, who it is with — in one dialog, opened from the card's „Mehr“,
 * its context menu, or a click on a card without a note.
 *
 * It is the app's dialog as `Prompt` draws it (`.sb-dialog`, spec/02 §4.6,
 * EBE-03): a native `<dialog>` over the scrim, the title field focused, the
 * actions last with „Abbrechen“ first and „Sichern“ as the secondary action.
 * Escape cancels; a press on the scrim only while nothing was changed. Only
 * the fields that changed are written, each its own field change (§2.3 rule
 * 10), so an edit on another device to a field left alone here survives. A
 * failure stays in the dialog as a sentence above the actions, the verb
 * becoming „Noch mal versuchen“.
 */
export default function CardDialog() {
  const { t } = useTranslation();
  const target = useUi((s) => s.cardEdit);
  const card = useBoard((s) =>
    target ? s.docs[target.slug]?.cards.find((c) => c.id === target.id) : undefined,
  );
  const board = useBoard((s) => (target ? s.docs[target.slug] : undefined));
  const dialog = useRef<HTMLDialogElement | null>(null);
  const titleField = useRef<HTMLInputElement | null>(null);
  const scrimPress = useRef(false);
  const running = useRef(false);
  const id = useId();

  const initial = {
    title: card?.title ?? "",
    description: card?.description ?? "",
    labels: (card?.labels ?? []).join(", "),
    due: card?.due ?? "",
    priority: card?.priority ?? "",
    assignee: card?.assignee ?? "",
  };
  const [values, setValues] = useState(initial);
  const [tones, setTones] = useState<Record<string, number>>(board?.view.labelTones ?? {});
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  // A new card to edit resets the fields during render, as `Prompt` does.
  const [lastTarget, setLastTarget] = useState(target);
  if (lastTarget !== target) {
    setLastTarget(target);
    setValues(initial);
    setTones(board?.view.labelTones ?? {});
    setPending(false);
    setWaiting(false);
    setFailure(null);
  }

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!target || !element) return undefined;
    running.current = false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal?.();
    titleField.current?.focus();
    titleField.current?.select();
    return () => {
      const active = document.activeElement;
      if (element.open) element.close?.();
      const lost = !active || active === document.body || element.contains(active);
      if (lost && opener?.isConnected) opener.focus();
    };
  }, [target]);

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => setWaiting(true), WAIT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  if (!target || !card || !board) return null;

  const close = () => {
    if (useUi.getState().cardEdit === target) useUi.getState().setCardEdit(null);
  };
  const labels = labelsOf(values.labels);
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((was) => ({ ...was, [key]: event.target.value }));

  /** The field changes to write, only those that differ from the card. */
  const changes = (): CardOpDto[] => {
    const ops: CardOpDto[] = [];
    const title = values.title.trim();
    if (title && title !== card.title) ops.push({ kind: "retitle", id: card.id, title });
    if (values.description !== (card.description ?? ""))
      ops.push({ kind: "setDescription", id: card.id, description: values.description });
    if (labels.join("\n") !== card.labels.join("\n")) ops.push({ kind: "setLabels", id: card.id, labels });
    if (values.due !== (card.due ?? "")) ops.push({ kind: "setDue", id: card.id, due: values.due });
    if (values.priority !== (card.priority ?? ""))
      ops.push({ kind: "setPriority", id: card.id, priority: (values.priority || null) as PriorityDto | null });
    const assignee = values.assignee.trim();
    if (assignee !== (card.assignee ?? "")) ops.push({ kind: "setAssignee", id: card.id, assignee });
    return ops;
  };
  /** The board's tones with this card's labels as chosen here; `null` when nothing changed. */
  const nextTones = (): Record<string, number> | null => {
    const before = board.view.labelTones;
    const next: Record<string, number> = { ...before };
    for (const label of labels) {
      const tone = tones[label];
      if (tone) next[label] = tone;
      else delete next[label];
    }
    const same =
      Object.keys(next).length === Object.keys(before).length && Object.entries(next).every(([k, v]) => before[k] === v);
    return same ? null : next;
  };

  const submit = () => {
    if (running.current) return;
    const ops = changes();
    const toneChange = nextTones();
    if (ops.length === 0 && !toneChange) {
      close();
      return;
    }
    running.current = true;
    setPending(true);
    setWaiting(false);
    setFailure(null);
    const stale = () => useUi.getState().cardEdit !== target;
    void (async () => {
      for (const op of ops) await useBoard.getState().apply(op, target.slug);
      if (toneChange) await useBoard.getState().setView(target.slug, { labelTones: toneChange });
    })()
      .then(() => {
        if (stale()) return;
        running.current = false;
        setPending(false);
        close();
      })
      .catch((error: unknown) => {
        if (stale()) return report(error);
        running.current = false;
        setPending(false);
        setWaiting(false);
        setFailure(error);
      });
  };

  const onScrim = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return false;
    const box = event.currentTarget.getBoundingClientRect();
    return !(
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
    );
  };
  const changed = changes().length > 0 || nextTones() !== null;
  /** The names given on this board, offered in the assignee field. */
  const assignees = [...new Set(board.cards.map((c) => c.assignee).filter((a): a is string => !!a))].sort();
  const failureDetails = failure === null ? null : detailsOf(errorKey(failure), errorValues(failure));
  const field = (suffix: string) => `${id}-${suffix}`;

  return (
    <dialog
      className="sb-dialog card-dialog"
      ref={dialog}
      aria-labelledby={field("title")}
      onMouseDown={(event) => {
        scrimPress.current = onScrim(event);
      }}
      onClick={(event) => {
        const began = scrimPress.current;
        scrimPress.current = false;
        if (began && onScrim(event) && !changed) close();
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={() => {
        if (!dialog.current?.open) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
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
        <h2 className="sb-dialog__title" id={field("title")}>
          {t("board.editCardTitle")}
        </h2>

        <div className="sb-field">
          <label className="sb-field__label" htmlFor={field("name")}>
            {t("board.cardTitleLabel")}
          </label>
          <div className="sb-field__control">
            <input
              id={field("name")}
              ref={titleField}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={values.title}
              onChange={set("title")}
            />
          </div>
        </div>

        <div className="sb-field">
          <label className="sb-field__label" htmlFor={field("description")}>
            {t("board.cardDescriptionLabel")} <span className="sb-optional">{t("app.optional")}</span>
          </label>
          <div className="sb-field__control">
            <textarea
              id={field("description")}
              rows={4}
              value={values.description}
              aria-describedby={field("description-help")}
              onChange={set("description")}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.metaKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </div>
          <p className="sb-field__help" id={field("description-help")}>
            {t("board.cardDescriptionHint")}
          </p>
        </div>

        <div className="sb-field">
          <label className="sb-field__label" htmlFor={field("labels")}>
            {t("board.labelsLabel")} <span className="sb-optional">{t("app.optional")}</span>
          </label>
          <div className="sb-field__control">
            <input
              id={field("labels")}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={values.labels}
              aria-describedby={field("labels-help")}
              onChange={set("labels")}
            />
          </div>
          <p className="sb-field__help" id={field("labels-help")}>
            {t("board.labelsHint")}
          </p>
          {/* Each label's tone on this board (sebaro's category: the tone the
              user chose, a dot beside the word; never a fill). */}
          {labels.length > 0 && (
            <ul className="card-dialog__tones">
              {labels.map((label, index) => {
                const tone = tones[label] ?? 0;
                return (
                  <li key={label}>
                    <span className={tone ? `sb-category sb-category--${tone}` : "sb-category"}>{label}</span>
                    <div className="sb-field__control sb-select">
                      <select
                        id={field(`tone-${index}`)}
                        aria-label={t("board.labelTone", { label })}
                        value={tone}
                        onChange={(event) => setTones((was) => ({ ...was, [label]: Number(event.target.value) }))}
                      >
                        <option value={0}>{t("board.toneNone")}</option>
                        {TONE_KEYS.map((key, i) => (
                          <option key={key} value={i + 1}>
                            {t(key)}
                          </option>
                        ))}
                      </select>
                      <Icon name="chevron-down" size={20} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card-dialog__row">
          <div className="sb-field">
            <label className="sb-field__label" htmlFor={field("due")}>
              {t("board.dueLabel")} <span className="sb-optional">{t("app.optional")}</span>
            </label>
            <div className="sb-field__control">
              <input id={field("due")} type="date" value={values.due} onChange={set("due")} />
            </div>
          </div>
          <div className="sb-field">
            <label className="sb-field__label" htmlFor={field("priority")}>
              {t("board.priorityLabel")}
            </label>
            <div className="sb-field__control sb-select">
              <select id={field("priority")} value={values.priority} onChange={set("priority")}>
                <option value="">{t("board.priorityNone")}</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(PRIORITY_KEYS[p])}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={20} />
            </div>
          </div>
        </div>

        <div className="sb-field">
          <label className="sb-field__label" htmlFor={field("assignee")}>
            {t("board.assigneeLabel")} <span className="sb-optional">{t("app.optional")}</span>
          </label>
          <div className="sb-field__control">
            <input
              id={field("assignee")}
              type="text"
              autoComplete="off"
              spellCheck={false}
              list={field("assignees")}
              value={values.assignee}
              onChange={set("assignee")}
            />
            <datalist id={field("assignees")}>
              {assignees.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="sb-dialog__message" role="alert">
          {failure !== null && (
            <>
              <Icon name="error" />
              <span>{t(errorKey(failure), errorValues(failure))}</span>
              {failureDetails && <ErrorDetails text={failureDetails} />}
            </>
          )}
        </div>
        <div className="sb-dialog__actions">
          <button className="sb-secondary-action" type="button" onClick={close}>
            {t("app.cancel")}
          </button>
          <button className="sb-secondary-action" type="submit" aria-busy={waiting || undefined}>
            {waiting && <Icon name="loader" size={20} className="sb-spinner" />}
            {t(waiting ? "app.saving" : failure !== null ? "app.retry" : "app.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
