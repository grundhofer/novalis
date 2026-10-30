import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { DragEvent } from "react";

import type { CardDto, ColumnDto, PositionDto } from "../ipc/client";
import {
  deleteCard,
  editDescription,
  linkNote,
  moveCardToColumn,
  openCardContextMenu,
  openCardNote,
  renameCard,
} from "../lib/cardActions";
import { createNoteFromCard, deleteBoard } from "../lib/commands";
import { NO_DRAG_IMAGE } from "../lib/dragImage";
import { isNote, stemOf } from "../lib/paths";
import { BOARD_DRAG_TYPE, CARD_DRAG_TYPE, useBoard } from "../stores/board";
import { useFiles } from "../stores/files";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";
import { Callout } from "./Banner";
import { FileName } from "./FileName";
import Icon from "./Icon";
import MoreMenu, { type MoreEntry } from "./MoreMenu";
import "../styles/board.css";

/**
 * The Kanban pane (`Shift+Cmd+B`, mockup L4), in sebaro's board (spec/02
 * §3.16, DAT-13; ADR-0051 #19).
 *
 * Every change is one `card_write` — a replayable field change, never a note
 * rewrite (PLAN.md §2.3 rule 10, §5.3 step 5). Drag and drop only decides a
 * `Position`; the fractional order key is computed in `novalis_core`, so two
 * devices dropping into the same gap stay deterministic (§8.3).
 *
 * The board is `sb-board`: columns divided by hairlines only, each a named
 * region with its word and count in the head, the cards `sb-card--item` the
 * only boxes. The board, every column and every card carry an always-visible
 * „Mehr“ (AKT-10, FOR-05) with what used to be hover buttons, „Löschen …“
 * last; a card's native context menu has the same order (menu.rs). „Neue
 * Notiz“ stays the window's one primary action (ADR-0050, D102 (36)), so
 * every column ends with its own „Neue Karte in „…““, outside the cards'
 * scrolling list. Below 640 px or 40em of the board its columns are swiped
 * (sebaro.css); the position bar `sb-board__nav` is built here, as the
 * React counterpart of `sb-board.js`, which is not loaded (ADR-0051 #21).
 */

/**
 * Where a drag would land (spec/02 §4.22, ADR-0051 #42): before or after a
 * card, by the half of it the pointer is in, or last in a column (`card`
 * null).
 */
interface Over {
  column: string;
  card: string | null;
  before: boolean;
}

/** Whether the pointer is in the upper half of the element under it. */
function upperHalf(event: DragEvent): boolean {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientY < box.top + box.height / 2;
}

/**
 * What the board takes: one of its own cards, or a file row from the tree
 * (ADR-0030; a note, which only the drop can tell, since the data is
 * unreadable until then). A tab, a board row or the Finder's files make no
 * card, so they get no mark (DSK-11).
 */
function accepts(types: readonly string[], ownDrag: boolean): boolean {
  if (ownDrag) return true;
  return types.includes("text/plain") && !types.includes(CARD_DRAG_TYPE) && !types.includes(BOARD_DRAG_TYPE);
}

/** The column whose start is at the scroller's start (`sb-board.js`'s rule). */
function columnInPlace(scroller: HTMLElement): number {
  const columns = [...scroller.children].filter((child) => child.classList.contains("sb-board__column"));
  if (columns.length === 0) return 0;
  const box = scroller.getBoundingClientRect();
  const style = getComputedStyle(scroller);
  const rtl = style.direction === "rtl";
  const pad = parseFloat(rtl ? style.paddingRight : style.paddingLeft) || 0;
  const edge = rtl ? box.right - pad : box.left + pad;
  let best = 0;
  let distance = Infinity;
  columns.forEach((column, index) => {
    const rect = column.getBoundingClientRect();
    const d = Math.abs((rtl ? rect.right : rect.left) - edge);
    if (d < distance) {
      distance = d;
      best = index;
    }
  });
  const max = scroller.scrollWidth - scroller.clientWidth;
  if (max > 1 && Math.abs(scroller.scrollLeft) >= max - 1) best = columns.length - 1;
  return best;
}

/** Reduced motion, the system's or the app's (ADR-0049). */
function reducedMotion(): boolean {
  return (
    document.documentElement.dataset.sbMotion === "reduce" ||
    (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}

export default function BoardPane() {
  const { t } = useTranslation();
  const board = useBoard((s) => s.board);
  const boards = useBoard((s) => s.boards);
  const busy = useBoard((s) => s.busy);
  const notice = useBoard((s) => (s.board ? s.notices[s.board.slug] : undefined));
  const fileList = useFiles((s) => s.files);
  const filesLoaded = useFiles((s) => s.loaded);
  const files = useMemo(() => new Set(fileList), [fileList]);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  /** The card the focus is in: it alone carries the place line (FOR-05, NAV-01). */
  const [current, setCurrent] = useState<string | null>(null);
  const ids = useId();
  const switcherId = `${ids}-switcher`;
  const columnsRef = useRef<HTMLDivElement>(null);
  const [inPlace, setInPlace] = useState(0);
  const columnCount = board?.columns.length ?? 0;

  // The position bar's column (spec/02 §3.16, weak point 1): followed on
  // scroll and on resize, as `sb-board.js` does.
  useEffect(() => {
    const scroller = columnsRef.current;
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setInPlace(columnInPlace(scroller));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(scroller);
    update();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [board?.slug, columnCount]);

  if (!board) {
    // No board at all (DAT-07): heading and sentence, no button of its own;
    // „Neues Board“ is in the File menu and the palette, the action zone
    // keeps „Neue Notiz“ (ADR-0048). Alone in the view, sebaro centres it.
    return (
      <div className="sb-view__content">
        <div className="sb-empty">
          <h2 className="sb-empty__title">{t("board.noBoardTitle")}</h2>
          <p className="sb-empty__text">{t("board.noBoardText")}</p>
        </div>
      </div>
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
   * A linked note that is no longer in the vault (deleted or moved outside
   * the app since it was linked): its name is drawn grey without the link's
   * line and opens nothing. Only once the file list has loaded — before
   * that, every note would look missing.
   */
  const missing = (note: string) => filesLoaded && !files.has(note);

  const moveColumn = (index: number, delta: number) => {
    const target = index + delta;
    const moving = board.columns[index];
    const displaced = board.columns[target];
    if (!moving || !displaced) return;
    const next = board.columns.map((c, i) => (i === index ? displaced : i === target ? moving : c));
    void useBoard.getState().setColumns(next).catch(report);
  };

  const renameColumn = (column: ColumnDto) =>
    useUi.getState().ask({
      titleKey: "board.renameColumnTitle",
      submitKey: "app.rename",
      busyKey: "app.renaming",
      labelKey: "board.columnNameLabel",
      initial: column.name,
      submit: async (name) => {
        await useBoard
          .getState()
          .setColumns(board.columns.map((c) => (c.id === column.id ? { ...c, name } : c)));
      },
    });

  const deleteColumn = (column: ColumnDto) => {
    // Cards are never deleted with their column: they become orphans and show
    // in the first column with a marker until they are moved (§8.5).
    const stranded = board.cards.filter((c) => c.column === column.id).length;
    useUi.getState().ask({
      titleKey: "board.deleteColumnTitle",
      confirm: {
        bodyKey: "board.deleteColumnBody",
        values: { count: stranded, name: column.name },
        confirmKey: "app.delete",
      },
      submit: async () => {
        await useBoard.getState().setColumns(board.columns.filter((c) => c.id !== column.id));
      },
    });
  };

  const renameBoard = () =>
    useUi.getState().ask({
      titleKey: "board.renameTitle",
      submitKey: "app.rename",
      busyKey: "app.renaming",
      labelKey: "board.boardNameLabel",
      initial: board.name,
      submit: async (name) => {
        if (name !== board.name) await useBoard.getState().renameBoard(name);
      },
    });

  const addColumn = () =>
    useUi.getState().ask({
      titleKey: "board.addColumnTitle",
      submitKey: "app.add",
      busyKey: "app.adding",
      labelKey: "board.columnNameLabel",
      initial: "",
      submit: async (name) => {
        const id = crypto.randomUUID();
        await useBoard.getState().setColumns([...board.columns, { id, name }]);
      },
    });

  const newCard = (column: ColumnDto) =>
    useUi.getState().ask({
      titleKey: "board.newCard",
      submitKey: "app.create",
      busyKey: "app.creating",
      labelKey: "board.cardTitleLabel",
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
    });

  /**
   * A card's „Mehr“, in the order of its native context menu (menu.rs):
   * open, rename, describe, link, a note from it, move, then „Löschen …“.
   */
  const cardEntries = (card: CardDto): MoreEntry[] => [
    ...(card.notes.length > 0 ? [{ label: t("board.openNote"), onSelect: () => openCardNote(card) }] : []),
    { label: t("menu.file.rename"), onSelect: () => renameCard(card) },
    { label: t("board.editDescription"), onSelect: () => editDescription(card) },
    { label: t("board.linkNote"), onSelect: () => linkNote(card) },
    { label: t("board.createNote"), onSelect: () => void createNoteFromCard(card).catch(report) },
    ...(board.columns.length > 1
      ? [
          {
            label: t("board.moveToColumn"),
            choices: board.columns.map((column) => ({
              label: column.name,
              checked: column.id === card.column,
              onSelect: () => moveCardToColumn(card, column.id),
            })),
          },
        ]
      : []),
    { label: t("board.deleteCard"), danger: true, onSelect: () => deleteCard(card) },
  ];

  /**
   * The core's place for a drop (§8.3): after a card, or before one as after
   * the card above it — the moving card left out — and first when none is.
   * The free space of a column is last. A card let go over itself, or in
   * the gap beside it, stays where it is: `null`, nothing to send.
   */
  const positionOf = (column: ColumnDto, moving: string | null): PositionDto | null => {
    if (over?.column !== column.id || over.card === null) return { kind: "last" };
    if (over.card === moving) return null;
    if (!over.before) return { kind: "after", id: over.card };
    const others = cardsOf(column).filter((card) => card.id !== moving);
    const above = others[others.findIndex((card) => card.id === over.card) - 1];
    return above ? { kind: "after", id: above.id } : { kind: "first" };
  };

  const drop = (column: ColumnDto, event: DragEvent) => {
    const position = positionOf(column, drag);
    setOver(null);
    if (!position) {
      setDrag(null);
      return;
    }
    if (!drag) {
      // A note dragged from the tree (ADR-0030): a new card titled by its
      // stem and linked to it, where it was dropped. The tree's rows carry
      // the path as `text/plain`; a card carries its own type too, and
      // anything else — a tab, a folder, a PDF — makes no card.
      const { types } = event.dataTransfer;
      const path =
        types.includes("text/plain") && !types.includes(CARD_DRAG_TYPE)
          ? event.dataTransfer.getData("text/plain")
          : "";
      if (!isNote(path) || !files.has(path)) return;
      void useBoard
        .getState()
        .apply({
          kind: "add",
          title: stemOf(path),
          column: column.id,
          notes: [path],
          position,
        })
        .catch(report);
      return;
    }
    // Dropped on a card: before it from its upper half, after it from its
    // lower half. Dropped on the column's free space: last.
    const cardId = drag;
    setDrag(null);
    void useBoard.getState().apply({ kind: "move", id: cardId, column: column.id, position }).catch(report);
  };

  /** The step buttons of the position bar: the next or previous column into place. */
  const step = (delta: number) => {
    const scroller = columnsRef.current;
    if (!scroller) return;
    const columns = [...scroller.children].filter((child) => child.classList.contains("sb-board__column"));
    const target = columns[Math.max(0, Math.min(columns.length - 1, inPlace + delta))];
    target?.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest", inline: "start" });
  };
  const place = Math.min(inPlace, Math.max(0, board.columns.length - 1));

  return (
    <section className="board" aria-busy={busy || undefined}>
      {/* The board's head (spec/02 §4.17 `sb-window__head`): its name as the
          heading and the counts under it as one group (`sb-window__head-text`,
          sebaro D108 NV-Z7), its tools at the end, under the pair when the
          head wraps at large text. Renaming and deleting are in its „Mehr“
          (AKT-10). */}
      <div className="sb-window__head">
        <div className="sb-window__head-text">
          <h2 className="sb-window__heading">{board.name}</h2>
          <p className="sb-window__meta">
            {t("board.columns", { count: board.columns.length })} · {t("board.cards", { count: board.cards.length })}
          </p>
        </div>
        <div className="sb-window__head-tools">
          {boards.length > 1 && (
            <div className="sb-field__control sb-select board-switcher">
              <select
                id={switcherId}
                value={board.slug}
                aria-label={t("board.switcher")}
                onChange={(event) => {
                  useUi.getState().setActiveBoard(event.target.value);
                  void useBoard.getState().load(event.target.value).catch(report);
                }}
              >
                {boards.map((ref) => (
                  <option key={ref.slug} value={ref.slug}>
                    {ref.name}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={24} />
            </div>
          )}
          <button className="sb-secondary-action sb-secondary-action--compact" type="button" onClick={addColumn}>
            <Icon name="plus" />
            {t("board.addColumn")}
          </button>
          <MoreMenu
            label={t("board.moreBoard")}
            entries={[
              { label: t("board.rename"), onSelect: renameBoard },
              { label: t("board.deleteBoard"), danger: true, onSelect: () => deleteBoard(board.slug) },
            ]}
          />
        </div>
      </div>

      {/* §8.4 resolved cards or columns when this board was first read, or a
          card file could not be used. All were silent before: a card simply
          was not on the board and nothing said why. The resolution is a past
          event and only informs, so it is a note that can be hidden; the
          unreadable files are still on disk and a card is missing because of
          them, so that is a warning that stays as long as it is true
          (STA-05, ADR-0051 #32). */}
      {notice !== undefined && (
        <Callout
          kind="note"
          text={
            <>
              {notice.cards > 0 && (
                <span className="board-notice-line">
                  {t("board.conflictNotice", { board: board.name, count: notice.cards })}
                </span>
              )}
              {notice.columns && (
                <span className="board-notice-line">{t("board.columnsMerged", { board: board.name })}</span>
              )}
            </>
          }
          onHide={() => useBoard.getState().dismissNotice(board.slug)}
        />
      )}
      {board.unreadable.length > 0 && (
        <Callout
          kind="warning"
          text={t("board.unreadableCards", { count: board.unreadable.length, folder: `boards/${board.slug}/cards` })}
        />
      )}
      {board.cloudOnly.length > 0 && (
        <Callout kind="note" text={t("errors.cloudOnlySkipped", { count: board.cloudOnly.length })} />
      )}

      {board.columns.length === 0 ? (
        // No column yet (DAT-07): „Spalte hinzufügen“ stands in the head. An
        // empty state under the board's heading, in its padding: sebaro's
        // section form, never larger than the heading (spec/02 §3.14, D108).
        <div className="sb-empty sb-empty--section">
          <h3 className="sb-empty__title">{t("board.emptyTitle")}</h3>
          <p className="sb-empty__text">{t("board.empty")}</p>
        </div>
      ) : (
        <div className="sb-board">
          {/* The narrow board's position bar (spec/02 §3.16, DAT-13);
              sebaro.css shows it only while the columns are swiped. */}
          <div className="sb-board__nav">
            <button
              className="sb-icon-button"
              type="button"
              aria-label={t("board.previousColumn")}
              aria-disabled={place === 0}
              onClick={() => step(-1)}
            >
              <Icon name="chevron-left" size={24} />
            </button>
            <p className="sb-board__position" aria-live="polite">
              {t("board.position", {
                n: place + 1,
                total: board.columns.length,
                name: board.columns[place]?.name ?? "",
              })}
            </p>
            <button
              className="sb-icon-button"
              type="button"
              aria-label={t("board.nextColumn")}
              aria-disabled={place === board.columns.length - 1}
              onClick={() => step(1)}
            >
              <Icon name="chevron-right" size={24} />
            </button>
          </div>
          <div
            className="sb-board__columns"
            ref={columnsRef}
            onDragLeave={(event) => {
              // Off the board: no mark stays behind (a drag from the tree
              // ends where the board cannot hear it).
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
            }}
          >
            {board.columns.map((column, columnIndex) => {
              const cards = cardsOf(column);
              const headingId = `${ids}-column-${columnIndex}`;
              return (
                <section
                  className="sb-board__column"
                  key={column.id}
                  aria-labelledby={headingId}
                  data-sb-state={over?.column === column.id && over.card === null ? "drop-into" : undefined}
                  onDragOver={(event) => {
                    if (!accepts(event.dataTransfer.types, drag !== null)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    // In the 8 px between two cards the place stays where it
                    // was, so the line does not flicker into the column's
                    // frame; the head, the free end and the foot are „last“.
                    const between =
                      event.target instanceof Element && event.target.closest(".sb-board__cards") !== null;
                    if (between && over?.column === column.id) return;
                    if (over?.column !== column.id || over.card !== null)
                      setOver({ column: column.id, card: null, before: false });
                  }}
                  onDrop={(event) => drop(column, event)}
                >
                  <div className="sb-board__head">
                    <h3 className="sb-board__title" id={headingId}>
                      <span className="sb-board__name">{column.name}</span>{" "}
                      <span className="sb-board__count">
                        {cards.length}
                        <span className="sb-visually-hidden"> {t("board.cardsWord", { count: cards.length })}</span>
                      </span>
                    </h3>
                    <MoreMenu
                      label={t("board.more", { name: column.name })}
                      entries={[
                        { label: t("board.renameColumn"), onSelect: () => renameColumn(column) },
                        {
                          label: t("board.moveColumnLeft"),
                          disabled: columnIndex === 0,
                          onSelect: () => moveColumn(columnIndex, -1),
                        },
                        {
                          label: t("board.moveColumnRight"),
                          disabled: columnIndex === board.columns.length - 1,
                          onSelect: () => moveColumn(columnIndex, 1),
                        },
                        { label: t("board.deleteColumn"), danger: true, onSelect: () => deleteColumn(column) },
                      ]}
                    />
                  </div>

                  {cards.length === 0 ? (
                    <p className="sb-board__empty">{t("board.emptyColumn")}</p>
                  ) : (
                    <ul className="sb-board__cards sb-board__cards--scroll">
                      {cards.map((card) => (
                        <li
                          className="sb-card sb-card--item"
                          key={card.id}
                          aria-current={current === card.id ? "true" : undefined}
                          data-sb-state={
                            drag === card.id
                              ? "dragging"
                              : over?.card === card.id
                                ? over.before
                                  ? "drop-before"
                                  : "drop-after"
                                : undefined
                          }
                          draggable
                          onFocus={() => setCurrent(card.id)}
                          onBlur={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                              setCurrent((was) => (was === card.id ? null : was));
                          }}
                          onDragStart={(event) => {
                            // WebKit abandons a drag whose data store is still
                            // empty when dragstart returns, so the drop never
                            // fires. The payload is unused here — `drag`
                            // carries the state — but it has to be there. The
                            // card's own type is what a board row in the tree
                            // reads (ADR-0019); it is not `text/plain`, so a
                            // folder row does not take the card for a file.
                            // No ghost under the pointer: the card keeps its
                            // ink frame instead (DSK-11).
                            event.dataTransfer.setData("text/plain", card.id);
                            event.dataTransfer.setData(CARD_DRAG_TYPE, card.id);
                            event.dataTransfer.effectAllowed = "move";
                            if (NO_DRAG_IMAGE) event.dataTransfer.setDragImage?.(NO_DRAG_IMAGE, 0, 0);
                            setDrag(card.id);
                          }}
                          onDragEnd={() => {
                            setDrag(null);
                            setOver(null);
                          }}
                          onDragOver={(event) => {
                            if (!accepts(event.dataTransfer.types, drag !== null)) return;
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = "move";
                            // The upper half drops before the card, the lower
                            // half after it (spec/02 §4.22, ADR-0051 #42), so
                            // a card can go first.
                            const before = upperHalf(event);
                            if (over?.card !== card.id || over.before !== before)
                              setOver({ column: column.id, card: card.id, before });
                          }}
                          onClick={() => openCardNote(card)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            void openCardContextMenu(card, board).catch(report);
                          }}
                        >
                          <p className="sb-card__title">{card.title}</p>
                          <MoreMenu label={t("board.more", { name: card.title })} entries={cardEntries(card)} />
                          {/* The description rendered by the shell (ADR-0033):
                              the preview's renderer, raw HTML escaped, all of
                              it (D102 (40), ADR-0051 #24). Inert — a link or a
                              box in it is not a target (board.css); the click
                              is the card's. */}
                          {card.descriptionHtml && (
                            <div
                              className="sb-card__text card-body"
                              onClick={(event) => event.preventDefault()}
                              dangerouslySetInnerHTML={{ __html: card.descriptionHtml }}
                            />
                          )}
                          {(card.notes.length > 0 || board.orphanCards.includes(card.id)) && (
                            <p className="sb-card__meta">
                              {board.orphanCards.includes(card.id) && (
                                <span className="sb-status sb-status--warning">
                                  <Icon name="warning" />
                                  {t("board.columnMissing")}
                                </span>
                              )}
                              {card.notes.map((note) => (
                                <span className={missing(note) ? "card-note missing" : "card-note"} key={note}>
                                  <Icon name="file-text" />
                                  {missing(note) ? (
                                    <>
                                      <span className="card-note-name" title={t("board.noteMissing")}>
                                        <FileName name={stemOf(note)} />
                                      </span>
                                      <span className="sb-visually-hidden">, {t("board.noteMissing")}</span>
                                    </>
                                  ) : (
                                    <button
                                      className="card-note-name"
                                      type="button"
                                      draggable={false}
                                      title={t("board.openNote")}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void useTabs.getState().open(note).catch(report);
                                      }}
                                    >
                                      <FileName name={stemOf(note)} />
                                    </button>
                                  )}
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
                                        .apply({ kind: "unlinkNote", id: card.id, path: note })
                                        .catch(report);
                                    }}
                                  >
                                    <Icon name="close" />
                                  </button>
                                </span>
                              ))}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Outside the scrolling cards, so a long column never
                      scrolls it out of sight (ADR-0050); a secondary action
                      that names its column, the lime one is the action
                      zone's „Neue Notiz“ (D102 (36)). */}
                  <button
                    className="sb-secondary-action sb-board__add"
                    type="button"
                    onClick={() => newCard(column)}
                  >
                    <Icon name="plus" size={24} />
                    {t("board.newCardIn", { name: column.name })}
                  </button>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
