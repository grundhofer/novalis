import { commands, unwrap, type BoardDto, type CardDto } from "../ipc/client";
import { useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";

/**
 * What can be done to a card, for the card's „Mehr“ menu in the pane and for
 * its native context menu (ADR-0032, ADR-0051 #19) alike: one
 * implementation of each.
 */

/**
 * D21: the card opens its note in a tab; showing it in place of the board is
 * `tabs.activate`'s job. A card without a note opens what it has, its
 * dialog with the description (ADR-0030, ADR-0054).
 */
export function openCardNote(card: CardDto): void {
  const note = card.notes[0];
  if (!note) return editCard(card);
  void openFromBoard(note, useBoard.getState().boardOf(card.id)).catch(report);
}

/**
 * Open a note from a board — `board`, else the current one — and remember
 * the way back (ADR-0053): the title bar offers „Zurück zu <Board>“ while
 * that note is current.
 */
export async function openFromBoard(path: string, board = useBoard.getState().slug): Promise<void> {
  if (board) useUi.getState().setBoardReturn({ path, board });
  await useTabs.getState().open(path);
}

/**
 * „Zurück zu <Board>“ (ADR-0053): the boards view again, scrolled to that
 * board (ADR-0054), which becomes the current one.
 */
export function returnToBoard(slug: string): void {
  useUi.getState().setActiveBoard(slug);
  if (useBoard.getState().slug !== slug) void useBoard.getState().load(slug).catch(report);
}

/**
 * „Karte bearbeiten“ (ADR-0054): the title, the description and the fields
 * in one dialog (`CardDialog`), for the card on the board that holds it.
 */
export function editCard(card: CardDto): void {
  const slug = useBoard.getState().boardOf(card.id);
  if (slug) useUi.getState().setCardEdit({ slug, id: card.id });
}

/**
 * Link Note… (ADR-0030): the note picker, any note, the open one first;
 * the notes the card already links are left out, and the pick is the write.
 */
export function linkNote(card: CardDto): void {
  useUi.getState().setOverlay({
    kind: "pickNote",
    exclude: card.notes,
    onPick: (path) => useBoard.getState().apply({ kind: "linkNote", id: card.id, path }),
  });
}

/** Move to Column (ADR-0032): last in the column, the way without dragging (DSK-11). */
export function moveCardToColumn(card: CardDto, column: string): void {
  void useBoard
    .getState()
    .apply({ kind: "move", id: card.id, column, position: { kind: "last" } })
    .catch(report);
}

export function deleteCard(card: CardDto): void {
  useUi.getState().ask({
    titleKey: "board.deleteCardTitle",
    confirm: {
      bodyKey: "board.deleteCardBody",
      values: { title: card.title },
      confirmKey: "app.delete",
    },
    submit: async () => {
      await useBoard.getState().apply({ kind: "remove", id: card.id });
    },
  });
}

/** The card the last context menu was opened on; its entries act on it. */
let menuCard: string | null = null;

/**
 * Right-click on a card (ADR-0032): the shell pops a native menu with the
 * card's actions and the board's columns; a click comes back as a
 * `MenuAction` that `runCardMenuAction` answers.
 */
export function openCardContextMenu(card: CardDto, board: BoardDto): Promise<void> {
  menuCard = card.id;
  const column = board.columns.some((c) => c.id === card.column) ? card.column : "";
  return unwrap(
    commands.contextMenu({
      kind: "card",
      columns: board.columns,
      column,
      hasNote: card.notes.length > 0,
    }),
  ).then(() => undefined);
}

const MOVE_TO_COLUMN = "card.moveToColumn:";

/** The card the last context menu was opened on, as the board has it now. */
export function menuCardNow(): CardDto | undefined {
  // Any board the view shows, not only the current one (ADR-0054).
  for (const board of Object.values(useBoard.getState().docs)) {
    const card = board.cards.find((c) => c.id === menuCard);
    if (card) return card;
  }
  return undefined;
}

/**
 * A card menu's `MenuAction`, or `false` for any other id. The card is looked
 * up again in the board as it is now: a card deleted or moved to another
 * board meanwhile is simply gone, and nothing happens.
 */
export function runCardMenuAction(id: string): boolean {
  if (!id.startsWith("card.")) return false;
  const card = menuCardNow();
  if (!card) return true;
  if (id.startsWith(MOVE_TO_COLUMN)) {
    moveCardToColumn(card, id.slice(MOVE_TO_COLUMN.length));
    return true;
  }
  switch (id) {
    case "card.openNote":
      openCardNote(card);
      break;
    case "card.edit":
      editCard(card);
      break;
    case "card.linkNote":
      linkNote(card);
      break;
    case "card.delete":
      deleteCard(card);
      break;
  }
  return true;
}
