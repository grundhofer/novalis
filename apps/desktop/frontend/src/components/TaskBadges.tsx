import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";

import { tagHue } from "../lib/taskDisplay";

export function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useTranslation("tasks");
  const color =
    priority === "urgent"
      ? "bg-red-500/20 text-danger"
      : priority === "high"
        ? "bg-orange-500/20 text-orange-300"
        : priority === "medium"
          ? "bg-yellow-500/20 text-yellow-200"
          : "bg-surface-2 text-fg-muted";
  const labels: Record<string, string> = {
    urgent: t("priority.urgent"),
    high: t("priority.high"),
    medium: t("priority.medium"),
    low: t("priority.low"),
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${color}`}>
      {labels[priority] ?? priority}
    </span>
  );
}

export function DueBadge({ due, completed }: { due: string; completed?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !completed && due < today;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs ${
        overdue ? "font-medium text-danger" : "text-fg-subtle"
      }`}
    >
      📅 {due}
    </span>
  );
}

export function SubtaskBadge({ done, total }: { done: number; total: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
        done === total ? "bg-emerald-500/15 text-emerald-300" : "bg-surface-2 text-fg-muted"
      }`}
    >
      <ListChecks size={11} />
      {`${done}/${total}`}
    </span>
  );
}

export function TagChip({ tag }: { tag: string }) {
  const hue = tagHue(tag);
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px]"
      style={{ backgroundColor: `hsl(${hue} 50% 45% / 0.18)`, color: `hsl(${hue} 65% 72%)` }}
    >
      #{tag}
    </span>
  );
}
