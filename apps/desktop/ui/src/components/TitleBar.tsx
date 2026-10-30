import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import tile from "../sebaro/brand/inline/tile-novalis-small.svg?raw";
import { dispatchCommand } from "../lib/commands";
import { ariaKeyshortcutsOf, bindingFor } from "../lib/keymap";
import { leaveSettingsView } from "../lib/settingsView";
import { windowPlaces } from "../lib/windowTitle";
import { useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { sidebarShown, useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import Icon from "./Icon";
import Keys from "./Keys";

/**
 * sebaro's title bar (`sb-window__titlebar`, spec/02 §4.17, DSK-06): the
 * 32 px tile, the app's name, the path to the current place and the
 * window's tools. On macOS it *is* the title bar (`titleBarStyle: Overlay`):
 * the system draws the traffic lights at its start, level with the tile
 * (`trafficLightPosition` y 25 in tauri.conf.json: measured, the lights'
 * centre moves about 1 px per unit of y, 29.5 px at y 32), and
 * sebaro.css leaves them 80 px under `html[data-sb-platform="mac"]` (set by
 * the shell before the first paint; kept in px by styles/app.css, so 200 %
 * text does not widen it) unless `data-sb-fullscreen` is set. The whole
 * bar drags the window (`deep`: every child but a control); its 2 px ink
 * line below is the layer line (EBE-01).
 *
 * The tile is the export's `tile-novalis-small.svg`, inlined unchanged
 * (ZEI-07): the one place the product colour appears (D65). The name stands
 * beside it, so it is `aria-hidden`. It is where the start tile lands
 * (`data-sb-start-target`, lib/start.ts).
 *
 * The path is text, not a navigation (spec/02 §4.17, docs/sebaro-luecken.md
 * „Titelleiste“): the places with `chevron-right--16` between them, the
 * last one the current place; earlier places are cut first, a deliberate
 * ellipsis (`data-sb-truncate`).
 *
 * The one tool is the sidebar's (DSK-04, ADR-0051 #5): it fires the same
 * `sidebar.toggle` as ⌃⌘S and View ▸ Sidebar, but as a tool it moves focus
 * into the overlay it opens (ADR-0051 #48). Its tooltip is sebaro's
 * (`sb-tooltip.js`, loaded by index.html): the name, `aria-hidden` because
 * the button carries it, and the shortcut. The sidebar stays in the page
 * with `hidden` while it is hidden (spec/02 §4.17), so `aria-controls`
 * always names it, as the divider's does. The tooltip stays open while the pointer is on it, so it
 * leaves the drag surface (`data-tauri-drag-region="false"`): a press on it
 * neither drags nor zooms the window.
 *
 * While the settings view shows (spec/02 §4.24, ADR-0051 #1) the path is
 * „Einstellungen“, and „Zurück zu <Ort>“ follows the sidebar tool: sebaro's
 * compact text action with `arrow-left`, `data-sb-escape` for the Escape
 * that presses it (lib/settingsView.ts). The place is the one the path
 * named before; with none (no vault, no file) it says „Zurück“. Below
 * 722 px only „Zurück“ shows (app.css, docs/sebaro-luecken.md U): name,
 * tools and word do not shrink, and a long place ran past the window's
 * edge at 480 px. The button's name keeps the place.
 */
export default function TitleBar() {
  const { t } = useTranslation();
  const vault = useVault((s) => s.vault);
  const active = useTabs((s) => s.active);
  const boardVisible = useUi((s) => s.boardVisible);
  const activeBoard = useUi((s) => s.activeBoard);
  // The tool says what shows (spec/02 §4.17): over the content, the overlay.
  const sidebarVisible = useUi(sidebarShown);
  const boardName = useBoard((s) => s.boards.find((b) => b.slug === activeBoard)?.name ?? activeBoard);

  const settingsView = useUi((s) => s.settingsView);

  const before = windowPlaces(vault?.name ?? null, active, boardVisible ? boardName : null);
  const places = settingsView ? [t("sidebar.settings")] : before;
  const back = before[before.length - 1];
  const sidebarChord = bindingFor("sidebar.toggle")?.chord;

  return (
    <header className="sb-window__titlebar" data-tauri-drag-region="deep">
      <span
        className="sb-sign-tile sb-sign-tile--32"
        aria-hidden="true"
        data-sb-start-target=""
        dangerouslySetInnerHTML={{ __html: tile }}
      />
      <p className="sb-window__name">{t("app.name")}</p>
      {places.length > 0 && (
        <p className="sb-window__path" data-sb-truncate="">
          <span className="sb-visually-hidden">{t("window.place")}</span>
          {places.map((place, index) => (
            <Fragment key={`${place}-${index}`}>
              {index > 0 && <Icon name="chevron-right" />}
              <span>{place}</span>
            </Fragment>
          ))}
        </p>
      )}
      <div className="sb-window__tools" role="group" aria-label={t("window.tools")}>
        <button
          className="sb-icon-button sb-icon-button--compact"
          type="button"
          aria-label={t("sidebar.label")}
          aria-expanded={sidebarVisible}
          aria-controls="sidebar"
          aria-keyshortcuts={sidebarChord ? ariaKeyshortcutsOf(sidebarChord) : undefined}
          aria-describedby="tip-sidebar"
          data-sb-window-toggle=""
          onClick={() => dispatchCommand("sidebar.toggle", "tool")}
        >
          <Icon name="sidebar" size={20} />
        </button>
        <span
          className="sb-tooltip"
          role="tooltip"
          id="tip-sidebar"
          popover="manual"
          data-tauri-drag-region="false"
        >
          <span aria-hidden="true">{t("sidebar.label")}</span>
          {sidebarChord && <Keys chord={sidebarChord} />}
        </span>
        {settingsView && (
          <button
            className="sb-text-action sb-text-action--compact"
            type="button"
            aria-label={back === undefined ? undefined : t("settingsView.backTo", { place: back })}
            data-sb-escape=""
            onClick={() => leaveSettingsView()}
          >
            <Icon name="arrow-left" size={20} />
            <span className="sb-window__word">
              {back === undefined ? (
                t("settingsView.back")
              ) : (
                <>
                  <span className="nv-word-long">{t("settingsView.backTo", { place: back })}</span>
                  <span className="nv-word-short">{t("settingsView.back")}</span>
                </>
              )}
            </span>
          </button>
        )}
      </div>
    </header>
  );
}
