// Property "kind" affordances for the properties panel: which widget a custom
// frontmatter value gets (text/number/date/checkbox/list), how a value is
// coerced when the user switches kinds, and the DEVICE-LOCAL per-key override
// that remembers an explicit choice. The YAML value stays the synced source of
// truth — a fresh clone shows inferred kinds only.

import type { PropertyValue } from "../ipc/api";

export type PropertyKind = "text" | "number" | "date" | "checkbox" | "list";

export const PROPERTY_KINDS: PropertyKind[] = ["text", "number", "date", "checkbox", "list"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The kind a stored value suggests on its own ("date" is a UI affordance
 *  over a date-shaped string — on disk it is a plain YAML scalar). */
export function inferKind(value: PropertyValue): PropertyKind {
  switch (value.kind) {
    case "number":
      return "number";
    case "checkbox":
      return "checkbox";
    case "list":
      return "list";
    case "text":
      return DATE_RE.test(value.value) ? "date" : "text";
  }
}

/** The widget kind to render: a device-local override wins while the stored
 *  value is still compatible with it; an external edit that changes the
 *  value's shape silently drops back to inference. A "date" hint additionally
 *  requires a date-shaped (or empty — a just-cleared picker) string, so the
 *  date input can never mask an arbitrary text value as empty. */
export function effectiveKind(value: PropertyValue, hint: PropertyKind | null): PropertyKind {
  if (!hint) return inferKind(value);
  const compatible =
    hint === "date"
      ? value.kind === "text" && (value.value === "" || DATE_RE.test(value.value))
      : hint === "text"
        ? value.kind === "text"
        : hint === value.kind;
  return compatible ? hint : inferKind(value);
}

/** Coerce `value` for a kind switch. `null` = not coercible — callers show a
 *  localized error and write nothing (a lossy guess is worse than a no). That
 *  rule includes lists with comma-CONTAINING items: their join is ambiguous to
 *  invert (a later list-split would silently break the item apart), so any
 *  list→scalar switch refuses them. */
export function coerceTo(value: PropertyValue, kind: PropertyKind): PropertyValue | null {
  if (value.kind === "list" && kind !== "list" && value.value.some((i) => i.includes(","))) {
    return null;
  }
  const asText = (): string => {
    switch (value.kind) {
      case "text":
        return value.value;
      case "number":
        return value.value == null ? "" : String(value.value);
      case "checkbox":
        return value.value ? "true" : "false";
      case "list":
        return value.value.join(", ");
    }
  };
  switch (kind) {
    case "text":
      return { kind: "text", value: asText() };
    case "number": {
      if (value.kind === "number") return value;
      if (value.kind === "checkbox") return { kind: "number", value: value.value ? 1 : 0 };
      const t = asText().trim();
      const n = Number(t);
      return t !== "" && Number.isFinite(n) ? { kind: "number", value: n } : null;
    }
    case "date": {
      // Empty is allowed: a fresh (text) property switches to an empty date
      // picker without any write — the add-then-pick-kind flow.
      const t = asText().trim();
      return t === "" || DATE_RE.test(t) ? { kind: "text", value: t } : null;
    }
    case "checkbox": {
      if (value.kind === "checkbox") return value;
      const t = asText().trim().toLowerCase();
      if (t === "true" || t === "1") return { kind: "checkbox", value: true };
      if (t === "false" || t === "0" || t === "") return { kind: "checkbox", value: false };
      return null;
    }
    case "list": {
      if (value.kind === "list") return value;
      const items = asText()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return { kind: "list", value: items };
    }
  }
}

// ── Device-local kind overrides ─────────────────────────────────────────────
// One JSON map under a single key, entries keyed `${vault}::${note}::${prop}`.
// Hints for renamed/deleted properties are migrated/cleared by the panel; a
// note move orphans its hints (cosmetic — inference takes over).

const HINTS_KEY = "novalis:device:propertyKinds";

function readHints(): Record<string, PropertyKind> {
  try {
    const raw = localStorage.getItem(HINTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PropertyKind>) : {};
  } catch {
    return {};
  }
}

function writeHints(hints: Record<string, PropertyKind>): void {
  try {
    localStorage.setItem(HINTS_KEY, JSON.stringify(hints));
  } catch {
    /* ignore */
  }
}

const hintKey = (vaultPath: string, notePath: string, key: string) =>
  `${vaultPath}::${notePath}::${key}`;

export function getKindHint(
  vaultPath: string,
  notePath: string,
  key: string,
): PropertyKind | null {
  const k = readHints()[hintKey(vaultPath, notePath, key)];
  return PROPERTY_KINDS.includes(k) ? k : null;
}

/** Set (or with `null` clear) the override for one property. */
export function setKindHint(
  vaultPath: string,
  notePath: string,
  key: string,
  kind: PropertyKind | null,
): void {
  const hints = readHints();
  const hk = hintKey(vaultPath, notePath, key);
  if (kind) hints[hk] = kind;
  else delete hints[hk];
  writeHints(hints);
}

/** Migrate the override when a property is renamed. */
export function moveKindHint(vaultPath: string, notePath: string, from: string, to: string): void {
  const hints = readHints();
  const fromKey = hintKey(vaultPath, notePath, from);
  const hint = hints[fromKey];
  if (!hint) return;
  delete hints[fromKey];
  hints[hintKey(vaultPath, notePath, to)] = hint;
  writeHints(hints);
}
