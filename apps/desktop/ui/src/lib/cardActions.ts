import { commands, unwrap, type BoardDto, type CardDto } from "../ipc/client";
import { useBoard } from "../stores/board";
import { useTabs } from "../stores/tabs";
import { report, useUi } from "../stores/ui";

/**
 * What can be done to a card, for the pane's hover buttons and for the
 * card's context menu (ADR-0032) alike: one implementation of each.
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
    titleKey: "menu.file.rename",
    placeholderKey: "board.cardTitlePlaceholder",
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
    titleKey: "board.editDescription",
    placeholderKey: "board.cardDescriptionPlaceholder",
    initial: card.description ?? "",
    multiline: true,
    submit: async (description) => {
      if (description === (card.description ?? "")) return;
      await useBoard.getState().apply({ kind: "setDescription", id: card.id, description });
    },
  });
}

export function deleteCard(card: CardDto): void {
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
    const column = id.slice(MOVE_TO_COLUMN.length);
    void useBoard
      .getState()
      .apply({ kind: "move", id: card.id, column, position: { kind: "last" } })
      .catch(report);
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
    case "card.delete":
      deleteCard(card);
      break;
  }
  return true;
}
