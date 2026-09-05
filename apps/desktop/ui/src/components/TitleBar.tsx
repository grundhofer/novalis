import { useTranslation } from "react-i18next";

import { glyphsOf } from "../lib/keymap";
import { folderOf, stemOf } from "../lib/paths";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";

/**
 * The Dev-Noir signature: a 38 px custom bar with the vault ▸ folder ▸ note
 * breadcrumb and the command-palette chord (§4.6 decision 7).
 *
 * The window uses `titleBarStyle: "Overlay"`, so macOS still draws the real
 * traffic lights on top-left — the padding leaves room for them, and
 * `data-tauri-drag-region` keeps the bar draggable.
 */
export default function TitleBar() {
  const { t } = useTranslation();
  const vault = useVault((s) => s.vault);
  const active = useTabs((s) => s.active);
  const setOverlay = useUi((s) => s.setOverlay);

  const segments: string[] = [];
  if (vault) segments.push(vault.name);
  if (active) {
    const folder = folderOf(active);
    if (folder) segments.push(...folder.split("/"));
    segments.push(stemOf(active));
  }

  return (
    <header className="titlebar" data-tauri-drag-region>
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
      <button
        className="kbd"
        type="button"
        title={t("menu.go.commandPalette")}
        onClick={() => setOverlay({ kind: "palette" })}
      >
        {glyphsOf("Shift+Cmd+P")}
      </button>
    </header>
  );
}
