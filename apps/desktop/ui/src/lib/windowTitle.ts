import { folderOf, isExternal, stemOf } from "./paths";

/**
 * The places the title bar's path names (spec/02 §4.17, ADR-0007,
 * ADR-0048): vault, folders, note; or vault and board while the board shows.
 * A file from outside the vault (ADR-0047) is not the vault's: its places
 * are the folders it lives in, from the root of the disk. `boardName` is
 * the board's name while the board shows, else `null`. Names are data, not
 * catalog strings.
 */
export function windowPlaces(vaultName: string | null, active: string | null, boardName: string | null): string[] {
  const outside = active !== null && isExternal(active);
  const places: string[] = [];
  if (vaultName && (boardName !== null || !outside)) places.push(vaultName);
  if (boardName !== null) {
    places.push(boardName);
  } else if (active) {
    const folder = folderOf(active);
    if (folder) places.push(...folder.split("/").filter((part) => part !== ""));
    places.push(stemOf(active));
  }
  return places;
}

/**
 * The macOS window title (feature-gaps A31): the app hides it in its own
 * title bar, but Mission Control, the Window menu, the Dock's window list
 * and ⌘` read it. sebaro's form „<current place> · <app>“ (spec/02 §4.17,
 * spec/11 §1a, DSK-06): the last of the title bar's places, or `none` (the
 * empty state's heading, „Kein Vault geöffnet“) where there is none, never
 * the app's name alone. `app` is the catalog's name, as in the title bar.
 */
export function windowTitle(places: readonly string[], none: string, app: string): string {
  const place = places[places.length - 1] ?? none;
  return `${place} · ${app}`;
}
