import { isExternal, stemOf } from "./paths";

/**
 * The macOS window title (feature-gaps A31): the app hides it in its own
 * title bar, but Mission Control, the Window menu, the Dock's window list
 * and ⌘` read it. The open file as its tab names it, then the vault; the
 * vault alone with no tab; the app's name with no vault. A file from
 * outside the vault (ADR-0047) is named alone: it is not the vault's. Names
 * are data, not catalog strings.
 */
export function windowTitle(active: string | null, vaultName: string | null): string {
  if (active && isExternal(active)) return stemOf(active);
  if (!vaultName) return "novalis";
  return active ? `${stemOf(active)} — ${vaultName}` : vaultName;
}
