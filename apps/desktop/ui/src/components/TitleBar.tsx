import { AppTile } from "./Icon";
import { folderOf, isExternal, stemOf } from "../lib/paths";
import { useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";

/**
 * A 48 px custom bar with the app tile and the vault ▸ folder ▸ note
 * breadcrumb, or vault ▸ board while the board shows (ADR-0007, ADR-0048).
 * The `⇧⌘P` badge is gone (ADR-0050): the palette keeps its chord and menu
 * item. The tile is where the start tile lands (sebaro D52); a 2 px ink line
 * separates the bar from the window below (sebaro D46).
 *
 * The window uses `titleBarStyle: "Overlay"`, so macOS still draws the real
 * traffic lights on top-left — the padding leaves room for them, and
 * `data-tauri-drag-region` keeps the bar draggable.
 */
export default function TitleBar() {
  const vault = useVault((s) => s.vault);
  const active = useTabs((s) => s.active);
  const boardVisible = useUi((s) => s.boardVisible);
  const activeBoard = useUi((s) => s.activeBoard);
  const boardName = useBoard((s) => s.boards.find((b) => b.slug === activeBoard)?.name ?? activeBoard);

  // A file from outside the vault (ADR-0047) is not the vault's: its crumb
  // is the folder it lives in, from the root of the disk.
  const outside = active !== null && isExternal(active);
  const showingBoard = boardVisible && boardName !== null;
  const segments: string[] = [];
  if (vault && (showingBoard || !outside)) segments.push(vault.name);
  if (showingBoard) {
    segments.push(boardName as string);
  } else if (active) {
    const folder = folderOf(active);
    if (folder) segments.push(...folder.split("/").filter((part) => part !== ""));
    segments.push(stemOf(active));
  }

  return (
    <header className="titlebar" data-tauri-drag-region>
      <AppTile className="app-tile" />
      <div className="crumb" data-tauri-drag-region>
        {segments.map((segment, index) => (
          <span className="crumb-part" key={`${segment}-${index}`}>
            {index > 0 && <span className="crumb-sep" aria-hidden="true" />}
            <span className={index === segments.length - 1 ? "crumb-seg current" : "crumb-seg"}>
              {segment}
            </span>
          </span>
        ))}
      </div>
    </header>
  );
}
