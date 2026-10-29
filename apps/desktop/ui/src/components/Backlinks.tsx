import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, events, unwrap, type BacklinksDto } from "../ipc/client";
import { openAt } from "../lib/openAt";
import { useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";
import "../styles/backlinks.css";
import { FileName } from "./FileName";
import Icon from "./Icon";

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
 * line naming both kinds, and separate counts. It stays there in sebaro's
 * look, not as an inspector (ADR-0051 #8).
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
      void unlisten.then((stop) => stop()).catch(report);
    };
  }, [active]);

  if (!active) return null;

  const shown = data?.path === active ? data.value : null;
  const notes = shown?.notes ?? [];
  const cards = shown?.cards ?? [];
  const empty = notes.length === 0 && cards.length === 0;

  return (
    <section className="backlinks" aria-label={t("editor.backlinks.title")}>
      {/* sebaro's list head (spec/02 §3.3): the word in `label`, no capitals
          (TXT-05), the two counts in Sans with tabular figures (SCH-03). */}
      <p className="sb-list-header">
        {t("editor.backlinks.title")}
        <span className="sb-list-header__count sb-num">
          {t("editor.backlinks.notes", { count: notes.length })} ·{" "}
          {t("editor.backlinks.cards", { count: cards.length })}
        </span>
      </p>

      <div className="backlinks-list">
        {empty ? (
          <p className="sb-list-end">{t("editor.backlinks.empty")}</p>
        ) : (
          // Two-line window rows (spec/02 §4.13, RAU-06): the note's name or
          // the card's title, under it the line the link sits on or the
          // card's board. Both wrap instead of ending in „…“ (ADR-0051 #24);
          // only a line the core cut ends in „…“, as in the vault search, so a
          // cut line does not read as whole (TXT-09, ZUG-09).
          <ul className="sb-list">
            {notes.map((note) => (
              <li key={`${note.path}:${note.line}`}>
                <button
                  className="sb-row"
                  type="button"
                  onClick={() => openAt(note.path, { line: note.line, snippet: note.snippet })}
                >
                  <Icon name="file-text" size={20} className="sb-row__icon" />
                  <span className="sb-row__main">
                    <span className="sb-row__name">
                      <FileName name={note.title} />
                    </span>
                    <span className="sb-row__sub">
                      {note.snippet ? (
                        note.snippetCutEnd ? `${note.snippet}…` : note.snippet
                      ) : (
                        <FileName name={note.path} />
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}

            {cards.map((card) => (
              <li key={`${card.board}/${card.id}`}>
                <button
                  className="sb-row"
                  type="button"
                  onClick={() => {
                    // Showing the pane is not enough: it draws whatever board was
                    // loaded last, under this card's board's name.
                    useUi.getState().setActiveBoard(card.board);
                    void useBoard.getState().load(card.board).catch(report);
                  }}
                >
                  {/* A card is a different kind of thing from a note, so it
                      gets the board's icon rather than the note's. */}
                  <Icon name="board" size={20} className="sb-row__icon" />
                  <span className="sb-row__main">
                    <span className="sb-row__name">{card.title}</span>
                    <span className="sb-row__sub">{card.boardName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
