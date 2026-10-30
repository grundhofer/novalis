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
 * description (ADR-0030).
 */
export function openCardNote(card: CardDto): void {
  const note = card.notes[0];
  if (!note) return editDescription(card);
  void useTabs.getState().open(note).catch(report);
}

export function renameCard(card: CardDto): void {
  useUi.getState().ask({
    titleKey: "board.renameCardTitle",
    submitKey: "app.rename",
    busyKey: "app.renaming",
    labelKey: "board.cardTitleLabel",
    initial: card.title,
    submit: async (title) => {
      if (title === card.title) return;
      await useBoard.getState().apply({ kind: "retitle", id: card.id, title });
    },
  });
}

// The same dialog as the rename, grown to a textarea (ADR-0013). An emptied
// field is the way to clear the text, so it is submitted like any other.
export function editDescription(card: CardDto): void {
  useUi.getState().ask({
    titleKey: "board.editDescriptionTitle",
    submitKey: "app.save",
    labelKey: "board.cardDescriptionLabel",
    // The text is Markdown, rendered on the card (ADR-0033).
    hint: { key: "board.cardDescriptionHint" },
    initial: card.description ?? "",
    multiline: true,
    submit: async (description) => {
      if (description === (card.description ?? "")) return;
      await useBoard.getState().apply({ kind: "setDescription", id: card.id, description });
    },
  });
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
  return useBoard.getState().board?.cards.find((c) => c.id === menuCard);
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
    case "card.rename":
      renameCard(card);
      break;
    case "card.editDescription":
      editDescription(card);
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
