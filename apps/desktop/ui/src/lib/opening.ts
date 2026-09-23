import type { OpenRequestDto } from "../ipc/client";
import { useBoard } from "../stores/board";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import { dispatchCommand } from "./commands";

/**
 * What macOS handed to the app (ADR-0045). A file inside the open vault that
 * the tree lists opens as a tab; `novalis://today` is Today's Note;
 * `novalis://open?path=<vault path>` opens that file or board. Everything
 * else — a file outside the vault, a link novalis does not know — is said in
 * a toast; nothing switches vaults and nothing is written.
 */
export function handleOpenRequests(items: readonly OpenRequestDto[]): void {
  for (const item of items) {
    if (item.kind === "file") openFile(item.path);
    else openLink(item.url);
  }
}

function openFile(absolute: string): void {
  const root = useVault.getState().vault?.root;
  const path = absolute.normalize("NFC");
  const base = root?.normalize("NFC");
  const rel = base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null;
  if (!rel || !useFiles.getState().files.includes(rel)) {
    useUi.getState().showToast("app.openOutsideVault", { path: absolute });
    return;
  }
  void useTabs.getState().open(rel).catch(report);
}

function openLink(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    useUi.getState().showToast("app.openLinkRefused", { url: raw });
    return;
  }
  if (url.hostname === "today") {
    dispatchCommand("file.todayNote");
    return;
  }
  const path = url.hostname === "open" ? url.searchParams.get("path")?.normalize("NFC") : null;
  if (path && useFiles.getState().files.includes(path)) {
    void useTabs.getState().open(path).catch(report);
    return;
  }
  const board = path ? useBoard.getState().boards.find((b) => `boards/${b.slug}` === path) : undefined;
  if (board) {
    useUi.getState().setActiveBoard(board.slug);
    void useBoard.getState().load(board.slug).catch(report);
    return;
  }
  useUi.getState().showToast("app.openLinkRefused", { url: raw });
}
