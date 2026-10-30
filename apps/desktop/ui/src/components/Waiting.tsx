import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fileNameOf, folderOf, isExternal } from "../lib/paths";
import { useVault } from "../stores/vault";
import { withFileNames } from "./FileName";
import Icon from "./Icon";

/** How long a wait stays silent before it is named (STA-06). */
export const WAITING_SILENT_MS = 1000;
/** How long a named wait says only „Wird geladen …“ before it says what runs (STA-06). */
export const WAITING_LONG_MS = 10_000;

/**
 * A pane while it waits for `path`, a viewer's file or a note on its way:
 * empty and `aria-busy`. Only a file that lives in the cloud is named, and
 * only after a second (STA-06, ADR-0051 #27.8): sebaro's `sb-loading`, the
 * turning `loader` and „Wird geladen …“; after 10 s it says what runs,
 * „„<Name>“ wird heruntergeladen …“, the spinner staying (spec/07 §4.5).
 * `read_blob`, `read_packed` and the note's read download such a file
 * before they return. A local read stays silent however long it takes. The
 * live region (`role="status"`) is in the pane from the start, empty, so
 * what is written into it is announced. The pane is sebaro's
 * `sb-view__content`, which places a lone loading line (spec/02 §3.12).
 *
 * The tree's row says whether the file is cloud-only, and it is read from
 * the store, not once: a file opened from quick open, a link, search or the
 * restored session can be shown before its folder is listed (folders are
 * listed lazily, and `reveal` follows `activate`). A folder nobody listed
 * yet is listed here, without opening it in the tree; its entries then
 * count toward the cloud counts (`cloudCounts`) as a revealed folder's do,
 * which changes only a restored tab, since `reveal` lists the folder for
 * every other open. Until the row is
 * known the second runs; once the row has said cloud, the wait stays named,
 * even when the finished download's watcher batch takes `cloudOnly` away
 * before the read returns. A file outside the vault (ADR-0047) and a pane
 * without a path are silent.
 */
export default function Waiting({ path }: { path?: string }) {
  const { t } = useTranslation();
  const vaultFile = path !== undefined && !isExternal(path);
  const folder = vaultFile ? folderOf(path) : null;
  const listed = useVault((s) => folder !== null && s.children[folder] !== undefined);
  const row = useVault((s) => (folder === null ? undefined : s.children[folder]?.find((e) => e.path === path)));
  const [wasCloud, setWasCloud] = useState(false);
  const [late, setLate] = useState(false);
  const [long, setLong] = useState(false);

  const cloudNow = row?.cloudOnly ?? false;
  if (cloudNow && !wasCloud) setWasCloud(true);
  const cloud = cloudNow || wasCloud;
  // Known to be local: no timer at all. A file without a row in a listed
  // folder is not in the tree's view of the vault; it is taken as local.
  const silent = !vaultFile || (!cloud && (row !== undefined || listed));

  useEffect(() => {
    if (folder === null || useVault.getState().children[folder] !== undefined) return;
    // Only to learn the row; the viewer's own read reports a failure.
    useVault.getState().reload(folder).catch(() => undefined);
  }, [folder]);

  useEffect(() => {
    if (silent) return undefined;
    // Both measured from the start of the wait.
    const timers = [
      setTimeout(() => setLate(true), WAITING_SILENT_MS),
      setTimeout(() => setLong(true), WAITING_LONG_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [silent]);

  const named = cloud && late;
  return (
    <div className="sb-view__content" aria-busy="true">
      <p className="sb-loading" role="status">
        {named && <Icon name="loader" size={20} className="sb-spinner" />}
        {named && !long && t("editor.loading")}
        {named && long && path !== undefined && (
          <span>{withFileNames((key, values) => t(key, values), "editor.downloading", { name: fileNameOf(path) })}</span>
        )}
      </p>
    </div>
  );
}
