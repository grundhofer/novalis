import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { dispatchCommand } from "../lib/commands";
import { previewKind } from "../lib/fileTypes";
import { providerOf } from "../lib/paths";
import { useCursor } from "../stores/cursor";
import { useEditorSave } from "../stores/editorSave";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { cloudCounts, useVault } from "../stores/vault";
import ErrorDetails, { detailsOf } from "./ErrorDetails";
import { withFileNames } from "./FileName";
import Icon from "./Icon";

/** Keys that only change another key; pressing one alone is no action. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);

/** The word count of the mirror; never split in plain mode (ADR-0022 F7). */
export function countWords(text: string | undefined, plainMode: boolean): number {
  if (text === undefined || plainMode) return 0;
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * A failure's path as the sentence names it: relative to the vault when it
 * lies in it, as the tree and the tabs name it (spec/07), so no absolute
 * path takes the zone's room; a file outside the vault keeps its own.
 */
export function inVaultValues(
  values: Record<string, string | number>,
  root: string | undefined,
): Record<string, string | number> {
  const { path } = values;
  if (!root || typeof path !== "string" || !path.startsWith(`${root}/`)) return values;
  return { ...values, path: path.slice(root.length + 1) };
}

/**
 * sebaro's action zone over the whole window (spec/02 §4.17, spec/03 §12,
 * EBE-08, AKT-02; ADR-0048, ADR-0051 #14, #15): the bar inside
 * `.sb-bottom-block`, which `App` lays under the body with the toast at its
 * top. In reading order:
 *
 * - the grey counter line (`__counts`, spec/02 §4.17, D102 (1)) on a row of
 *   its own — words, characters, line and column, and the selection and
 *   the cursors only when there are some (ADR-0051 #15). The position is the editor's main
 *   cursor, so it shows only while the editor shows the tab; while the
 *   board or an SVG's picture shows there is nothing to count (a picture is
 *   no text), and while the board shows no note state. The line keeps its
 *   place then, so the zone does not jump (sebaro D108 (5)): it holds the
 *   last document's parts hidden (`data-sb-held`, neither seen nor read),
 *   or before any document one empty line; without a vault there is none;
 * - why the last command failed (`__message`, spec/03 §12, §16, D83 (2)):
 *   the `error--16` glyph in danger and the sentence in text colour, in a
 *   live region. sebaro.css hides it while it is empty (`:empty`), which
 *   takes it out of the accessibility tree, so it fills in two steps as the
 *   toast does: the glyph first, which shows the region, and the sentence
 *   two frames later, a change a screen reader announces
 *   (docs/sebaro-luecken.md J). The sentence wraps anywhere a long word or
 *   address would leave its line; file and note names in it break after
 *   `- . _ /` (FileName), and a path in the vault is said vault-relative.
 *   The system's own text of a failure (an OS message, a code) is no part
 *   of the sentence: it follows it as sebaro's closed „Details“
 *   (`ErrorDetails`, spec/02 §3.28, TXT-07), which is why the message is a
 *   `div` (a `details` cannot stand in a `p`). The next key or pointer press anywhere in the window — Escape among them,
 *   Tab and a press inside the sentence not — or a menu item (`App.tsx`)
 *   ends it; a failure no action caused (autosave, watcher) not before
 *   10 s (`data-sb-message`, spec/02 §4.17, D102 (11)). While it shows, sebaro.css hides
 *   the state sentence it replaces; the counters stay, they are no state;
 * - the state sentence (`__status`, STA-07, D72): the one total of what is
 *   open, said once in the window — the note's own state, where the vault
 *   lives, what is online only, the conflict copies with the warning glyph
 *   (STA-08). sebaro's sentence of several parts (spec/02 §4.17, D104 (35)):
 *   one span, the parts joined by „ · “ with a no-break space before the
 *   dot, the document's state first, then the counts, a glyph only before
 *   a part that warns (an inline `sb-status--warning`), the period after
 *   the last part. Where the vault lives is no open state; D104 (35) puts
 *   it in an inspector or under „Über“, which novalis does not have, so it
 *   stays here until the owner decides (docs/sebaro-luecken.md F). The
 *   sidebar has no second total;
 * - the one lime primary action, last (AKT-01, D74, D83 (5)): „Neue Notiz“
 *   with the plus, or „Vault öffnen …“ while no vault is open, since a note
 *   needs a place first.
 *
 * The zone grows with its text (ZUG-09): sebaro's bar wraps, the button's
 * 56 px are a floor.
 *
 * The settings view has no action zone (spec/02 §4.24, D74): `App` shows
 * the zone there only while a failure or a toast has something to say, and
 * the bar then holds the failure alone (docs/sebaro-luecken.md T).
 *
 * The counts follow the mirror, which the autosave tick refreshes — not the
 * keystroke (ADR-0022 F7): splitting a 5 MB buffer into words on every key
 * was most of what a keystroke cost. In plain mode (≥ 5 MB) words are not
 * counted at all; characters are the string's length, free.
 */
export default function StatusBar() {
  const { t } = useTranslation();
  const translate = (key: string, values: Record<string, string | number>) => t(key, values);
  const active = useTabs((s) => s.active);
  // While the board shows, no note is on screen: nothing is said about the
  // one behind it, neither its counts nor its state.
  const boardVisible = useUi((s) => s.boardVisible);
  const settingsView = useUi((s) => s.settingsView);
  const doc = useEditorSave((s) => (active && !boardVisible && !settingsView ? s.docs[active] : undefined));
  const vault = useVault((s) => s.vault);
  const children = useVault((s) => s.children);
  const counts = useMemo(() => cloudCounts(children), [children]);

  const text = doc?.text;
  const plainMode = doc?.plainMode ?? false;
  const words = useMemo(() => countWords(text, plainMode), [text, plainMode]);

  const copy = active ? useEditorSave.getState().conflictCopyPath(active) : null;
  // The editor's, so only while the editor shows this tab — not the preview.
  const previewing = useUi((s) => (active ? !!s.previewing[active] : false));
  const cursor = useCursor((s) => (s.cursor?.path === active && !previewing ? s.cursor : null));
  const picture = previewing && !!active && previewKind(active) === "svg";
  const message = useUi((s) => s.message);
  const details = message ? detailsOf(message.key, message.values) : null;
  // What the live region says: the message once its glyph has shown it.
  const [said, setSaid] = useState<typeof message>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  /** The last counter parts a document showed, held in place while none shows (D108 (5)). */
  const [held, setHeld] = useState<string[]>([]);

  useLayoutEffect(() => {
    if (!message) return undefined;
    // `said` still holds the last message, so a new one starts with the
    // glyph alone.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setSaid(message));
    });
    return () => cancelAnimationFrame(id);
  }, [message]);

  // Listening only while a reason shows: the press that made the command
  // fail is over by the time this runs, so it cannot end its own reason.
  // Tab and a press inside the sentence keep it (spec/02 §4.17); a failure
  // without a trigger stays at least `BACKGROUND_MESSAGE_MS`, which
  // `clearMessage` itself enforces (D102 (11)).
  useEffect(() => {
    if (!message) return undefined;
    const end = (event: Event) => {
      if (event instanceof KeyboardEvent && (MODIFIERS.has(event.key) || event.key === "Tab")) return;
      if (event.target instanceof Node && messageRef.current?.contains(event.target)) return;
      useUi.getState().clearMessage();
    };
    window.addEventListener("keydown", end, true);
    window.addEventListener("pointerdown", end, true);
    return () => {
      window.removeEventListener("keydown", end, true);
      window.removeEventListener("pointerdown", end, true);
    };
  }, [message]);

  // The state sentence's parts, in the order the old bar showed them: the
  // note's state, then the vault's.
  const states: ReactNode[] = [];
  if (doc?.readOnly) states.push(t("status.readOnly"));
  if (doc?.plainMode) states.push(t("status.plainMode"));
  if (doc && copy) {
    states.push(
      <span className="sb-status sb-status--warning">
        <Icon name="warning" />
        <span>{withFileNames(translate, "status.conflictCopyActive", { path: copy })}</span>
      </span>,
    );
  }
  if (vault?.kind === "fileProvider") {
    states.push(t("status.cloud.fileProvider", { provider: providerOf(vault.root) ?? vault.name }));
  }
  if (vault?.kind === "mirrored") states.push(t("status.cloud.mirrored"));
  if (counts.cloudOnly > 0) states.push(t("status.cloud.cloudOnly", { count: counts.cloudOnly }));
  if (counts.conflicts > 0) {
    states.push(
      <span className="sb-status sb-status--warning">
        <Icon name="warning" />
        {t("status.cloud.conflicts", { count: counts.conflicts })}
      </span>,
    );
  }

  // The grey counter line's parts.
  const countParts: string[] = [];
  if (doc) {
    if (!doc.plainMode) countParts.push(t("status.words", { count: words }));
    countParts.push(t("status.characters", { count: doc.text.length }));
    if (cursor) countParts.push(t("status.position", { line: cursor.line, column: cursor.column }));
    // Only when they say something (the owner: fewer infos).
    if (cursor && cursor.selected > 0) countParts.push(t("status.selected", { count: cursor.selected }));
    if (cursor && cursor.cursors > 1) countParts.push(t("status.cursors", { count: cursor.cursors }));
  }
  const counting = !!doc && !picture;
  // Kept as the render goes (React's „storing information from previous
  // renders“), so the line holds the parts of the last document shown.
  if (counting && held.join("\u0000") !== countParts.join("\u0000")) setHeld(countParts);
  const shownParts = counting ? countParts : held;

  return (
    <div className="sb-primary-action-bar">
      {(counting || vault) && !settingsView && (
        <p className="sb-primary-action-bar__counts" data-sb-held={counting || held.length === 0 ? undefined : ""}>
          {shownParts.map((part, index) => (
            <Fragment key={index}>
              {/* The gap is CSS only; the text keeps the parts apart. */}
              {index > 0 && <span className="sb-visually-hidden"> · </span>}
              <span>{part}</span>
            </Fragment>
          ))}
        </p>
      )}
      <div
        className="sb-primary-action-bar__message"
        role="status"
        ref={messageRef}
        data-sb-message={message ? (message.background ? "background" : "command") : undefined}
      >
        {message && (
          <>
            <Icon name="error" />
            {said === message && <span>{withFileNames(translate, message.key, inVaultValues(message.values, vault?.root))}</span>}
            {said === message && details && <ErrorDetails text={details} />}
          </>
        )}
      </div>
      {!settingsView && (
        <p className="sb-primary-action-bar__status" role="status">
          {states.length > 0 && (
            <span>
              {states.map((state, index) => (
                <Fragment key={index}>
                  {index > 0 && "\u00a0· "}
                  {state}
                </Fragment>
              ))}
              {"."}
            </span>
          )}
        </p>
      )}
      {settingsView ? null : vault ? (
        // The primary action announces sebaro's fixed ⌘N; without a vault it
        // opens one and announces ⌘O (spec/02 §4.19).
        <button
          className="sb-primary-action"
          type="button"
          aria-keyshortcuts="Meta+N"
          onClick={() => dispatchCommand("file.newNote")}
        >
          <Icon name="plus" size={24} />
          <span className="sb-primary-action__label">{t("menu.file.newNote")}</span>
          <i className="sb-primary-action__bar" aria-hidden="true" />
        </button>
      ) : (
        <button
          className="sb-primary-action"
          type="button"
          aria-keyshortcuts="Meta+O"
          onClick={() => dispatchCommand("vault.open")}
        >
          <span className="sb-primary-action__label">{t("app.openVault.button")}</span>
          <i className="sb-primary-action__bar" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
