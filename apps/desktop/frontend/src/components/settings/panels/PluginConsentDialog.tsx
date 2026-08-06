import { useRef, useState } from "react";

import { useTranslation } from "react-i18next";

import type { PluginInfo } from "../../../ipc/api";
import { PLUGIN_CAPABILITIES } from "../../../ipc/bindings";
import type { PluginCapability } from "../../../stores/pluginStore";
import { Modal } from "../../ui";

/**
 * The consent step: the only place a capability is actually granted. A plugin's
 * `plugin.json` states what it *asks for*; nothing in it can grant anything,
 * because the plugin (and, since plugin folders live in the vault, anyone who
 * can write to the vault) authors that file. What the user ticks here is what
 * `pluginStore` intersects the manifest with before every host call.
 *
 * The same dialog handles the re-consent case: an already-enabled plugin whose
 * manifest grew a new capability keeps working, but the new capability is
 * refused until it is granted here, so a silently-updated plugin cannot widen
 * its own access.
 */
export function PluginConsentDialog({
  plugin,
  onCancel,
  onConfirm,
}: {
  plugin: PluginInfo;
  onCancel: () => void;
  onConfirm: (granted: string[]) => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const confirmRef = useRef<HTMLButtonElement>(null);

  /** Plain-language description of what a capability actually lets a plugin
   *  do. Spelled out per case instead of looked up by key so i18next-parser
   *  sees literal keys (a dynamic `t(LABELS[cap])` gets pruned from the
   *  catalogs), and so the switch stays exhaustive over the union. */
  const capabilityLabel = (cap: PluginCapability): string => {
    switch (cap) {
      case "notes:read":
        return t("plugins.cap.notesRead");
      case "notes:write":
        return t("plugins.cap.notesWrite");
      case "tasks:read":
        return t("plugins.cap.tasksRead");
      case "tasks:write":
        return t("plugins.cap.tasksWrite");
      case "search":
        return t("plugins.cap.search");
    }
  };
  // A manifest is plugin-authored text, so it can name anything. Only the
  // capabilities this host implements are offered — an unknown one cannot be
  // granted, and showing it would imply the host understood it.
  const requested = (plugin.manifest.capabilities ?? []).filter((c): c is PluginCapability =>
    (PLUGIN_CAPABILITIES as readonly string[]).includes(c),
  );
  const already = plugin.grantedCapabilities ?? [];
  // Re-consent keeps the existing ticks and pre-ticks the new asks, so the
  // default action is "yes" but the diff is still visible (each new row is
  // badged). A first enable starts with everything ticked.
  const [checked, setChecked] = useState<string[]>(requested);
  const review = plugin.enabled;

  const toggle = (cap: string) =>
    setChecked((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));

  const title = review
    ? t("plugins.consent.reviewTitle", { name: plugin.manifest.name })
    : t("plugins.consent.title", { name: plugin.manifest.name });

  return (
    <Modal
      label={title}
      onClose={onCancel}
      initialFocusRef={confirmRef}
      overlayClassName="z-[60] items-center justify-center p-6"
      panelClassName="w-full max-w-md overflow-hidden rounded-xl border border-border-strong bg-surface p-5 shadow-2xl"
    >
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-2 text-xs leading-relaxed text-fg-muted">
        {review ? t("plugins.consent.reviewIntro") : t("plugins.consent.intro")}
      </p>

      {requested.length === 0 ? (
        <p className="mt-4 text-xs leading-relaxed text-fg-subtle">{t("plugins.consent.none")}</p>
      ) : (
        <>
          <div className="mt-4 text-xs font-medium text-fg-subtle">
            {t("plugins.consent.requests")}
          </div>
          <div className="mt-2 space-y-2">
            {requested.map((cap) => (
              <label key={cap} className="flex items-start gap-2 text-xs text-fg">
                <input
                  type="checkbox"
                  checked={checked.includes(cap)}
                  onChange={() => toggle(cap)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1">
                  {capabilityLabel(cap)}
                  <span className="ml-1 text-fg-faint">({cap})</span>
                  {review && !already.includes(cap) && (
                    <span className="ml-1 rounded bg-accent/15 px-1 py-0.5 text-[10px] font-medium uppercase text-accent">
                      {t("plugins.consent.newBadge")}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      <p className="mt-4 text-xs leading-relaxed text-fg-faint">{t("plugins.consent.scope")}</p>

      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        >
          {t("common:cancel")}
        </button>
        <button
          ref={confirmRef}
          onClick={() => onConfirm(checked)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:opacity-90"
        >
          {review ? t("plugins.consent.confirmReview") : t("plugins.consent.confirm")}
        </button>
      </div>
    </Modal>
  );
}
