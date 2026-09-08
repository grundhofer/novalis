import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, events, unwrap, type BacklinksDto } from "../ipc/client";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import "../styles/backlinks.css";

/**
 * What points at the open note (§4.4, approved for v1).
 *
 * Notes come from the cache, so they arrive once the first scan has finished
 * and refresh on `cache-updated` rather than on a timer (§2.3 rule 12). Cards
 * are read from the board files, so they are correct immediately — a card is
 * not a note and is never indexed.
 *
 * A pane under the editor, not a second sidebar and not a split view (D21).
 * The catalog decided this shape before the code existed: a title, an empty
 * line naming both kinds, and separate counts.
 */
export default function Backlinks() {
  const { t } = useTranslation();
  const active = useTabs((s) => s.active);
  // Keyed by the path it describes: switching notes must not show the previous
  // note's backlinks for a frame while the new ones load.
  const [data, setData] = useState<{ path: string; value: BacklinksDto } | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const load = () => {
      void unwrap(commands.backlinks(active))
        .then((value) => {
          if (live) setData({ path: active, value });
        })
        .catch(() => {
          if (live) setData(null);
        });
    };
    load();
    const unlisten = events.cacheUpdated.listen(load);
    return () => {
      live = false;
      void unlisten.then((stop) => stop());
    };
  }, [active]);

  if (!active) return null;

  const shown = data?.path === active ? data.value : null;
  const notes = shown?.notes ?? [];
  const cards = shown?.cards ?? [];
  const empty = notes.length === 0 && cards.length === 0;

  return (
    <section className="backlinks" aria-label={t("editor.backlinks.title")}>
      <header className="backlinks-head">
        <span className="backlinks-title">{t("editor.backlinks.title")}</span>
        <span className="backlinks-counts">
          {t("editor.backlinks.notes", { count: notes.length })} ·{" "}
          {t("editor.backlinks.cards", { count: cards.length })}
        </span>
      </header>

      <div className="backlinks-list">
        {empty && <p className="backlinks-empty">{t("editor.backlinks.empty")}</p>}

        {notes.map((note) => (
          <button
            className="backlink"
            type="button"
            key={`${note.path}:${note.line}`}
            onClick={() => void useTabs.getState().open(note.path)}
          >
            <span className="backlink-glyph" aria-hidden="true" />
            <span className="backlink-name">{note.title}</span>
            <span className="backlink-meta">{note.path}</span>
          </button>
        ))}

        {cards.map((card) => (
          <button
            className="backlink card"
            type="button"
            key={`${card.board}/${card.id}`}
            onClick={() => {
              useUi.getState().setActiveBoard(card.board);
            }}
          >
            <span className="backlink-glyph card" aria-hidden="true" />
            <span className="backlink-name">{card.title}</span>
            <span className="backlink-meta">{card.boardName}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
