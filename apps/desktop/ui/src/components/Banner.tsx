import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { folderOf, isExternal } from "../lib/paths";
import { useEditorSave } from "../stores/editorSave";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { report } from "../stores/ui";
import { useVault } from "../stores/vault";
import ErrorDetails from "./ErrorDetails";
import { withFileNames } from "./FileName";
import Icon from "./Icon";

/** The 20 px status glyph of each callout (STA-05, spec/02 §3.11). */
const CALLOUT_ICONS = {
  warning: "warning--filled",
  note: "info--filled",
  error: "error--filled",
} as const;

/** What Tab can reach, for the focus „Ausblenden“ hands on (spec/02 §3.11). */
const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** The next control after `own` in the page, else the one before it. */
function neighbourOf(own: Element): HTMLElement | null {
  const controls = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (control) => !own.contains(control) && !control.closest("[hidden], [inert]"),
  );
  const after = controls.find((control) => own.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (after) return after;
  const before = controls.filter((control) => own.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING);
  return before.at(-1) ?? null;
}

/**
 * A hint above the editor in sebaro's callout (STA-05, spec/02 §3.11;
 * ADR-0051 #27.7): the 20 px status glyph, the title in body-strong, the
 * text in `text`, a hairline frame, no fill and no coloured edge; the text
 * wraps (ZUG-09). A callout of one sentence without a title starts with its
 * kind's word, „Hinweis:“, „Achtung:“, „Fehler:“ (`sb-callout__kind`,
 * NV-I10). Its actions are secondary actions, never the lime one (AKT-01),
 * in `sb-callout__actions`, „Ausblenden“ (`sb-callout__hide`, `close--16`)
 * last (D102 (39)); a press on it with the focus inside hands the focus to
 * the next control after the callout, else the one before (spec/02 §3.11),
 * instead of dropping it on `body`. A warning that a change on disk raised, which asks for a
 * decision, is `role="alert"`, so it is announced when it appears; the
 * others are sebaro's `role="note"` inside a polite `role="status"`, which
 * announces them as the hints' old status did (NV-I11). A viewer's refusal
 * (a book that is protected or unreadable, a document too large) is the
 * same callout without actions, `--error` when the file could not be read.
 * A failed start is the `--error` callout with „Details“ under its text
 * (`App`).
 */
export function Callout({
  kind,
  title,
  text,
  alert = false,
  details,
  onHide,
  children,
}: {
  kind: "warning" | "note" | "error";
  title?: string;
  text?: ReactNode;
  alert?: boolean;
  /** An error's technical text, under its sentence as sebaro's „Details“ (spec/02 §3.28). */
  details?: string;
  /** „Ausblenden“, last in the actions. */
  onHide?: () => void;
  /** Its actions; a viewer's refusal has none. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const own = useRef<HTMLDivElement>(null);
  const hide = () => {
    const node = own.current;
    const next = node?.contains(document.activeElement) ? neighbourOf(node) : null;
    onHide?.();
    next?.focus();
  };
  const callout = (
    <div
      ref={own}
      className={`sb-callout sb-callout--${kind} nv-callout`}
      role={alert ? "alert" : "note"}
      aria-labelledby={title ? id : undefined}
    >
      <Icon name={CALLOUT_ICONS[kind]} size={20} />
      {title && (
        <p className="sb-callout__title" id={id}>
          {title}
        </p>
      )}
      {text !== undefined && (
        <p className="sb-callout__text">
          {!title && (
            <>
              <strong className="sb-callout__kind">
                {kind === "warning" ? t("callout.warning") : kind === "error" ? t("callout.error") : t("callout.note")}
              </strong>{" "}
            </>
          )}
          {text}
        </p>
      )}
      {details && <ErrorDetails text={details} />}
      {(children !== undefined || onHide) && (
        <div className="sb-callout__actions">
          {children}
          {onHide && (
            <button className="sb-text-action sb-text-action--compact sb-callout__hide" type="button" onClick={hide}>
              <Icon name="close" />
              {t("banner.dismiss")}
            </button>
          )}
        </div>
      )}
    </div>
  );
  return alert ? (
    callout
  ) : (
    <div className="nv-callout-live" role="status">
      {callout}
    </div>
  );
}

const ACTION = "sb-secondary-action sb-secondary-action--compact";

/**
 * The external-change banner (PLAN.md §5.3 steps 2 and 3).
 *
 * By the time it appears the buffer is already safe: a refused save has
 * written it to a conflict copy, and the banner only asks which version wins.
 * The three actions are exactly the ones in the spec.
 */
export default function Banner() {
  const { t } = useTranslation();
  const active = useTabs((s) => s.active);
  const doc = useEditorSave((s) => (active ? s.docs[active] : undefined));
  const vaultKind = useVault((s) => s.vault?.kind ?? "local");

  if (!active || !doc?.banner) return null;
  // A file from outside the vault has no cloud version history to fall back
  // on that we know of: "keep mine" keeps the disk version as a copy first,
  // as in a local vault (ADR-0047).
  const kind = isExternal(active) ? "local" : vaultKind;
  const store = useEditorSave.getState();
  const copy = store.conflictCopyPath(active);

  if (doc.banner.kind === "replacedBySync") {
    return (
      <Callout kind="warning" alert title={t("banner.replacedBySync.title")}>
        <button
          className={ACTION}
          type="button"
          onClick={() => void store.reloadFromDisk(active).catch(report)}
        >
          {t("banner.replacedBySync.reload")}
        </button>
        <button
          className={ACTION}
          type="button"
          onClick={() => void store.keepMine(active, kind).catch(report)}
        >
          {t("banner.replacedBySync.restoreMine")}
        </button>
      </Callout>
    );
  }

  if (doc.banner.kind === "deletedOnDisk") {
    return (
      <Callout kind="warning" alert title={t("banner.deletedOnDisk.title")}>
        <button
          className={ACTION}
          type="button"
          onClick={() => {
            // The buffer goes with the tab: closing saves first, and the
            // save refuses while this banner stands — the file stays gone.
            void useTabs.getState().close(active).catch(report);
          }}
        >
          {t("banner.deletedOnDisk.close")}
        </button>
        <button
          className={ACTION}
          type="button"
          onClick={() => {
            // The watcher does not report the app's own writes, so the tree
            // and the file list learn of the file again from here.
            void store
              .restoreDeleted(active)
              .then(() =>
                isExternal(active)
                  ? undefined
                  : Promise.all([
                      useVault.getState().reload(folderOf(active)),
                      useFiles.getState().refresh(),
                    ]),
              )
              .catch(report);
          }}
        >
          {t("banner.deletedOnDisk.keepMine")}
        </button>
      </Callout>
    );
  }

  if (doc.banner.kind === "changedOnDisk") {
    return (
      <Callout
        kind="warning"
        alert
        title={t("banner.changedOnDisk.title")}
        text={
          copy
            ? withFileNames((key, values) => t(key, values), "banner.changedOnDisk.body", { path: copy })
            : undefined
        }
      >
        <button
          className={ACTION}
          type="button"
          onClick={() => void store.reloadFromDisk(active).catch(report)}
        >
          {t("banner.changedOnDisk.reload")}
        </button>
        <button
          className={ACTION}
          type="button"
          onClick={() => void store.keepMine(active, kind).catch(report)}
        >
          {t("banner.changedOnDisk.keepMine")}
        </button>
        <button
          className={ACTION}
          type="button"
          onClick={() => {
            void store
              .keepBoth(active)
              .then((path) => useTabs.getState().rename(active, path))
              .catch(report);
          }}
        >
          {t("banner.changedOnDisk.saveConflictCopy")}
        </button>
      </Callout>
    );
  }

  const key =
    doc.banner.kind === "binary"
      ? "banner.binary"
      : doc.banner.kind === "notUtf8"
        ? "banner.notUtf8"
        : doc.banner.kind === "hugeFile"
          ? "banner.hugeFile"
          : "banner.plainMode";

  return <Callout kind="note" text={t(key)} onHide={() => store.dismissBanner(active)} />;
}
