import { useEffect, useState } from "react";

import type { Task } from "../ipc/api";
import { COLOR_HEX } from "../lib/colors";
import { useSettings } from "../stores/settingsStore";
import { useTasks } from "../stores/taskStore";
import { ColorSwatchPicker } from "./ui/ColorSwatchPicker";

type SlugFieldName = "project" | "epic";

/** Assign/clear a task's slug-valued annotation (`@project` or `@epic`) by
 *  typing or picking an existing value. For `project` (`withColor`) it also
 *  edits that project's color. Writes via `update_task` (slug) and `taskView`
 *  preferences (color). */
export function SlugField({
  task,
  field,
  suggestions,
  datalistId,
  placeholder,
  withColor = false,
}: {
  task: Task;
  field: SlugFieldName;
  suggestions: string[];
  datalistId: string;
  placeholder?: string;
  withColor?: boolean;
}) {
  const updateField = useTasks((s) => s.updateField);
  const projectColors = useSettings((s) => s.prefs?.taskView?.projectColors);
  const setTaskView = useSettings((s) => s.setTaskView);

  const slug = task[field] ?? null;
  const [draft, setDraft] = useState(slug ?? "");
  useEffect(() => {
    setDraft(slug ?? "");
  }, [task.id, slug, field]);

  // Commit the slug: lowercase, validate, write via `update_task` (null clears).
  // Invalid input reverts to the task's current value.
  const commit = () => {
    const v = draft.trim().toLowerCase();
    const next = v === "" ? null : v;
    if (next === slug) return;
    if (next !== null && !/^[a-z0-9-]+$/.test(next)) {
      setDraft(slug ?? "");
      return;
    }
    void updateField(task.id, field, next);
  };

  const setColor = (token: string) => {
    if (!slug) return;
    setTaskView({ projectColors: { ...(projectColors ?? {}), [slug]: token } });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        list={datalistId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="w-32 rounded-md bg-surface-2 px-2 py-1 text-sm text-fg outline-none ring-1 ring-border focus:ring-accent/50"
      />
      <datalist id={datalistId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {withColor && slug && (
        <ColorSwatchPicker
          value={projectColors?.[slug] ?? ""}
          onChange={setColor}
          colors={COLOR_HEX}
        />
      )}
    </div>
  );
}
