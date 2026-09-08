import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { CardDto, ColumnDto, PositionDto } from "../ipc/client";
import { stemOf } from "../lib/paths";
import { useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { useUi } from "../stores/ui";
import "../styles/board.css";

/**
 * The Kanban pane (`Shift+Cmd+B`, mockup L4).
 *
 * Every change is one `card_write` — a replayable field change, never a note
 * rewrite (PLAN.md §2.3 rule 10, §5.3 step 5). Drag and drop only decides a
 * `Position`; the fractional order key is computed in `novalis_core`, so two
 * devices dropping into the same gap stay deterministic (§8.3).
 */

interface DragState {
  cardId: string;
  from: string;
}

export default function BoardPane() {
  const { t } = useTranslation();
  const board = useBoard((s) => s.board);
  const boards = useBoard((s) => s.boards);
  const busy = useBoard((s) => s.busy);
  const activeNote = useTabs((s) => s.active);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [over, setOver] = useState<{ column: string; beforeCardId: string | null } | null>(null);

  if (!board) {
    return (
      <section className="board board-empty">
        <button className="btn primary" type="button" onClick={() => void newBoard(t)}>
          {t("board.newBoard")}
        </button>
      </section>
    );
  }

  const cardsOf = (column: ColumnDto): CardDto[] =>
    board.cards
      .filter(
        (card) =>
          card.column === column.id ||
          (board.orphanCards.includes(card.id) && board.columns[0]?.id === column.id),
      )
      .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id) : a.order < b.order ? -1 : 1));

  /**
   * D21 chose "the card opens the note in a tab" over a split view. The board
   * fills the same pane as the editor, so opening the note without closing the
   * board leaves it invisible — which is the outcome D21 was avoiding.
   */
  const openCardNote = (card: CardDto) => {
    const note = card.notes[0];
    if (!note) return;
    void useTabs.getState().open(note);
    if (useUi.getState().boardVisible) useUi.getState().toggleBoard();
  };

  const renameCard = (card: CardDto) => {
    useUi.getState().ask({
      titleKey: "menu.file.rename",
      placeholderKey: "board.cardTitlePlaceholder",
      initial: card.title,
      submit: async (title) => {
        if (title === card.title) return;
        await useBoard.getState().apply({ kind: "retitle", id: card.id, title });
      },
    });
  };

  const deleteCard = (card: CardDto) => {
    useUi.getState().ask({
      titleKey: "board.deleteCard",
      confirm: {
        bodyKey: "board.deleteCardBody",
        values: { title: card.title },
        confirmKey: "board.deleteCard",
      },
      submit: async () => {
        await useBoard.getState().apply({ kind: "remove", id: card.id });
      },
    });
  };

  const moveColumn = (index: number, delta: number) => {
    const target = index + delta;
    const moving = board.columns[index];
    const displaced = board.columns[target];
    if (!moving || !displaced) return;
    const next = board.columns.map((c, i) => (i === index ? displaced : i === target ? moving : c));
    void useBoard.getState().setColumns(next);
  };

  const deleteColumn = (column: ColumnDto) => {
    // Cards are never deleted with their column: they become orphans and show
    // in the first column with a marker until they are moved (§8.5).
    const stranded = board.cards.filter((c) => c.column === column.id).length;
    useUi.getState().ask({
      titleKey: "board.deleteColumn",
      confirm: {
        bodyKey: "board.deleteColumnBody",
        values: { count: stranded },
        confirmKey: "board.deleteColumn",
      },
      submit: async () => {
        await useBoard.getState().setColumns(board.columns.filter((c) => c.id !== column.id));
      },
    });
  };

  const drop = (column: string) => {
    if (!drag) return;
    const beforeCardId = over?.column === column ? over.beforeCardId : null;
    // Dropped on a card: after it. Dropped on the column's empty space: last.
    const position: PositionDto = beforeCardId
      ? { kind: "after", id: beforeCardId }
      : { kind: "last" };
    setDrag(null);
    setOver(null);
    void useBoard.getState().apply({ kind: "move", id: drag.cardId, column, position });
  };

  return (
    <section className="board">
      <header className="board-head">
        <button
          className="board-name"
          type="button"
          title={t("board.rename")}
          onClick={() =>
            useUi.getState().ask({
              titleKey: "board.rename",
              placeholderKey: "board.boardNamePlaceholder",
              initial: board.name,
              submit: async (name) => {
                if (name !== board.name) await useBoard.getState().renameBoard(name);
              },
            })
          }
        >
          {board.name}
        </button>
        <span className="board-sub">
          {t("board.columns", { count: board.columns.length })} ·{" "}
          {t("board.cards", { count: board.cards.length })}
        </span>
        <span className="board-spacer" />
        {boards.length > 1 && (
          <select
            className="btn ghost"
            value={board.slug}
            aria-label={t("board.switcher")}
            onChange={(event) => {
              useUi.getState().setActiveBoard(event.target.value);
              void useBoard.getState().load(event.target.value);
            }}
          >
            {boards.map((ref) => (
              <option key={ref.slug} value={ref.slug}>
                {ref.name}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn ghost"
          type="button"
          onClick={() =>
            useUi.getState().ask({
              titleKey: "board.addColumn",
              placeholderKey: "board.columnNamePlaceholder",
              initial: "",
              submit: async (name) => {
                const id = crypto.randomUUID();
                await useBoard.getState().setColumns([...board.columns, { id, name }]);
              },
            })
          }
        >
          {t("board.addColumn")}
        </button>
      </header>

      <div className="columns">
        {board.columns.map((column, columnIndex) => {
          const cards = cardsOf(column);
          return (
            <div
              className="column"
              key={column.id}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (!over || over.column !== column.id) setOver({ column: column.id, beforeCardId: null });
              }}
              onDrop={() => drop(column.id)}
            >
              <header className="col-head">
                <span className="col-name">{column.name}</span>
                <span className="col-count">{cards.length}</span>
                <span className="col-actions">
                  <button
                    className="btn ghost col-action"
                    type="button"
                    title={t("board.moveColumnLeft")}
                    aria-label={t("board.moveColumnLeft")}
                    disabled={columnIndex === 0}
                    onClick={() => moveColumn(columnIndex, -1)}
                  >
                    &#8592;
                  </button>
                  <button
                    className="btn ghost col-action"
                    type="button"
                    title={t("board.moveColumnRight")}
                    aria-label={t("board.moveColumnRight")}
                    disabled={columnIndex === board.columns.length - 1}
                    onClick={() => moveColumn(columnIndex, 1)}
                  >
                    &#8594;
                  </button>
                  <button
                    className="btn ghost col-action wide"
                    type="button"
                    title={t("board.renameColumn")}
                    aria-label={t("board.renameColumn")}
                    onClick={() =>
                      useUi.getState().ask({
                        titleKey: "board.renameColumn",
                        placeholderKey: "board.columnNamePlaceholder",
                        initial: column.name,
                        submit: async (name) => {
                          await useBoard
                            .getState()
                            .setColumns(board.columns.map((c) => (c.id === column.id ? { ...c, name } : c)));
                        },
                      })
                    }
                  >
                    {t("menu.file.rename")}
                  </button>
                  <button
                    className="btn ghost col-action danger"
                    type="button"
                    title={t("board.deleteColumn")}
                    aria-label={t("board.deleteColumn")}
                    onClick={() => deleteColumn(column)}
                  >
                    &#215;
                  </button>
                </span>
              </header>

              <div className="cards">
                {cards.map((card) => (
                  <article
                    className={drag?.cardId === card.id ? "card dragging" : "card"}
                    key={card.id}
                    draggable
                    onDragStart={(event) => {
                      // WebKit abandons a drag whose data store is still empty
                      // when dragstart returns, so the drop never fires. The
                      // payload is unused — `drag` carries the state — but it
                      // has to be there.
                      event.dataTransfer.setData("text/plain", card.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDrag({ cardId: card.id, from: column.id });
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setOver(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = "move";
                      setOver({ column: column.id, beforeCardId: card.id });
                    }}
                    onClick={() => openCardNote(card)}
                  >
                    <span className="card-title">{card.title}</span>

                    {/* draggable=false: without it a press on a control
                        starts the card drag instead of clicking. */}
                    <span className="card-actions" draggable={false}>
                      <button
                        className="btn ghost card-action"
                        type="button"
                        title={t("menu.file.rename")}
                        aria-label={t("menu.file.rename")}
                        onClick={(event) => {
                          event.stopPropagation();
                          renameCard(card);
                        }}
                      >
                        {t("menu.file.rename")}
                      </button>
                      <button
                        className="btn ghost card-action"
                        type="button"
                        title={activeNote ? t("board.linkNote") : t("board.linkNoteNeedsNote")}
                        aria-label={t("board.linkNote")}
                        disabled={!activeNote || card.notes.includes(activeNote)}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (activeNote) {
                            void useBoard
                              .getState()
                              .apply({ kind: "linkNote", id: card.id, path: activeNote });
                          }
                        }}
                      >
                        {t("board.linkNote")}
                      </button>
                      <button
                        className="btn ghost card-action danger"
                        type="button"
                        title={t("board.deleteCard")}
                        aria-label={t("board.deleteCard")}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteCard(card);
                        }}
                      >
                        ×
                      </button>
                    </span>

                    {board.orphanCards.includes(card.id) && (
                      <span className="card-state warn">{t("board.columnMissing")}</span>
                    )}
                    {card.notes.map((note) => (
                      <span className="card-note" key={note}>
                        <span className="card-note-glyph" aria-hidden="true" />
                        <span className="card-note-name">{stemOf(note)}</span>
                        <button
                          className="card-note-unlink"
                          type="button"
                          draggable={false}
                          title={t("board.unlinkNote")}
                          aria-label={t("board.unlinkNote")}
                          onClick={(event) => {
                            event.stopPropagation();
                            void useBoard
                              .getState()
                              .apply({ kind: "unlinkNote", id: card.id, path: note });
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </article>
                ))}

                <button
                  className="btn ghost card-add"
                  type="button"
                  onClick={() =>
                    useUi.getState().ask({
                      titleKey: "board.newCard",
                      placeholderKey: "board.cardTitlePlaceholder",
                      initial: "",
                      submit: async (title) => {
                        await useBoard.getState().apply({
                          kind: "add",
                          title,
                          column: column.id,
                          notes: [],
                          position: { kind: "last" },
                        });
                      },
                    })
                  }
                >
                  {t("board.newCard")}
                </button>
              </div>
            </div>
          );
        })}

        {board.columns.length === 0 && (
          <p className="board-hint">{t("board.empty")}</p>
        )}
      </div>

      {busy && <span className="board-busy">{t("editor.loading")}</span>}
      {board.cloudOnly.length > 0 && (
        <p className="board-hint">
          {t("errors.cloudOnlySkipped", { count: board.cloudOnly.length })}
        </p>
      )}
    </section>
  );
}

/** Ask for a name and create a board — the empty state's only action. */
function newBoard(t: (key: string) => string): void {
  void t;
  useUi.getState().ask({
    titleKey: "board.newBoard",
    placeholderKey: "board.boardNamePlaceholder",
    initial: "",
    submit: async (name) => {
      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "");
      if (!slug) return;
      await useBoard.getState().createBoard(slug, name.trim());
      useUi.getState().setActiveBoard(slug);
    },
  });
}
