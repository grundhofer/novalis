import { useCallback, useEffect, useRef, useState } from "react";

import { CalendarCheck, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getMarkdown } from "@novalis/editor";

import { api } from "../../ipc/api";
import {
  appendUnderActions,
  buildTaskLine,
  frontmatterOf,
  type ProposedTask,
} from "../../lib/taskExtract";
import { localWeekRange, parseWeeklyReview } from "../../lib/weeklyReview";
import { useAi, type WeeklyReviewTarget } from "../../stores/aiStore";
import { useVault } from "../../stores/vaultStore";
import { Modal } from "../ui/Modal";

interface Row extends ProposedTask {
  id: number;
  included: boolean;
}

/** Store-mounted host: renders the AI weekly-review card for the note the
 *  command palette opened it against. Keyed by note path so each open is fresh.
 *
 *  This is the Phase-2 (AI) layer. The Phase-1 deterministic digest is inserted
 *  directly from the palette without this card and works with no provider — so
 *  the AI narrative is purely additive and degrades away when unconfigured. */
export function WeeklyReviewCard() {
  const target = useAi((s) => s.weeklyReview);
  const close = useAi((s) => s.closeWeeklyReview);
  if (!target) return null;
  return <WeeklyReviewModal key={target.notePath} target={target} onClose={close} />;
}

type Status = "loading" | "ready" | "error";

function WeeklyReviewModal({
  target,
  onClose,
}: {
  target: WeeklyReviewTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation("ai");
  const connections = useAi((s) => s.connections);
  const selectedId = useAi((s) => s.selectedConnectionId);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  // Guard against a late collectAiAction resolve after the modal unmounts.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const usable = connections.filter((c) => c.enabled && c.configured && c.available);
  const selected = usable.find((c) => c.id === selectedId) ?? usable[0] ?? null;

  const run = useCallback(async () => {
    if (!selected) {
      setStatus("error");
      setError(t("review.noConnections"));
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      // The digest is computed for the current local week (see crate::review's
      // window contract). This same call is the no-AI Phase-1 path.
      const { start, end } = localWeekRange();
      const digest = await api.reviewDigest(start, end);
      const raw = await useAi.getState().collectAiAction({
        connectionId: selected.id,
        actionId: "weekly-review",
        notePath: target.notePath,
        context: { title: target.noteTitle, markdown: digest.markdown },
      });
      if (!alive.current) return;
      const parsed = parseWeeklyReview(raw, target.body);
      setNarrative(parsed.narrative);
      setRows(parsed.carryovers.map((p, id) => ({ id, included: true, ...p })));
      setStatus("ready");
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
    // target/selected are stable for the modal's lifetime (keyed remount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = rows.filter((r) => r.included && r.text.trim());

  // Insert accepted carry-overs as task lines under "## Actions" — the exact
  // insertion path the task-extraction review uses (flush → build on the note's
  // true current body → one write that reindexes + remounts the editor).
  const add = async () => {
    if (!chosen.length || saving) return;
    setSaving(true);
    setError(null);
    try {
      const newLines = chosen.map((r) =>
        buildTaskLine({
          text: r.text,
          due: r.due,
          start: r.start,
          project: r.project,
          priority: r.priority,
        }),
      );
      await useVault.getState().flushActive();
      const stored = useVault.getState().openNotes.get(target.notePath);
      if (!stored) {
        setError(t("review.saveError"));
        setSaving(false);
        return;
      }
      const fm = frontmatterOf(stored.content);
      const ed = target.editor;
      const freshBody = ed && !ed.isDestroyed ? getMarkdown(ed) : target.body;
      const newBody = appendUnderActions(freshBody, newLines);
      await useVault.getState().saveNote(target.notePath, fm + newBody);
      if (!alive.current) return;
      if ((useVault.getState().saveStates.get(target.notePath) ?? "idle") === "error") {
        setError(t("review.saveError"));
        setSaving(false);
        return;
      }
      onClose();
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Modal
      label={t("review.title")}
      onClose={onClose}
      overlayClassName="z-50 items-start justify-center pt-24"
      panelClassName="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-fg">
          <CalendarCheck size={15} className="text-accent" />
          {t("review.title")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("review.cancel")}
          className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {status === "loading" && (
          <span className="flex items-center gap-2 py-2 text-xs text-fg-faint">
            <Loader2 size={13} className="animate-spin" />
            {t("review.analyzing")}
          </span>
        )}

        {status === "error" && (
          <div className="flex items-center justify-between gap-2 py-1 text-xs">
            <span className="min-w-0 break-words text-danger">{error ?? t("review.error")}</span>
            <button
              type="button"
              onClick={() => void run()}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              {t("review.retry")}
            </button>
          </div>
        )}

        {status === "ready" && (
          <div className="flex flex-col gap-3">
            {narrative && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{narrative}</p>
            )}

            {rows.length === 0 ? (
              <span className="py-1 text-xs text-fg-faint">{t("review.empty")}</span>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-fg-faint">
                  {t("review.carryovers")}
                </span>
                <div className="flex flex-col gap-1.5">
                  {rows.map((row) => (
                    <CarryoverRow
                      key={row.id}
                      row={row}
                      onToggle={() =>
                        setRows((rs) =>
                          rs.map((r) => (r.id === row.id ? { ...r, included: !r.included } : r)),
                        )
                      }
                      onText={(text) =>
                        setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, text } : r)))
                      }
                      labels={{
                        include: t("review.include"),
                        placeholder: t("extract.textPlaceholder"),
                        priority: t("extract.priority"),
                        start: t("extract.start"),
                        due: t("extract.due"),
                        project: t("extract.project"),
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <span className="text-xs text-fg-faint">
          {status === "error" && error ? error : null}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
          >
            {t("review.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void add()}
            disabled={chosen.length === 0 || saving}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {t("review.add", { count: chosen.length })}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CarryoverRow({
  row,
  onToggle,
  onText,
  labels,
}: {
  row: Row;
  onToggle: () => void;
  onText: (text: string) => void;
  labels: {
    include: string;
    placeholder: string;
    priority: string;
    start: string;
    due: string;
    project: string;
  };
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-border bg-surface-2/40 px-2 py-1.5 ${
        row.included ? "" : "opacity-50"
      }`}
    >
      <input
        type="checkbox"
        checked={row.included}
        onChange={onToggle}
        aria-label={labels.include}
        className="mt-1.5 accent-accent"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          value={row.text}
          onChange={(e) => onText(e.target.value)}
          placeholder={labels.placeholder}
          className="w-full rounded bg-surface px-2 py-1 text-xs text-fg outline-none ring-1 ring-transparent transition placeholder:text-fg-faint focus:ring-accent/40"
        />
        {(row.priority || row.start || row.due || row.project) && (
          <div className="flex flex-wrap gap-1">
            {row.priority && <MetaChip label={labels.priority} value={row.priority} />}
            {row.start && <MetaChip label={labels.start} value={row.start} />}
            {row.due && <MetaChip label={labels.due} value={row.due} />}
            {row.project && <MetaChip label={labels.project} value={row.project} />}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] text-fg-muted">
      <span className="uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="text-fg">{value}</span>
    </span>
  );
}
