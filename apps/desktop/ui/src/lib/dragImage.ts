/**
 * A transparent pixel as the drag image: the dragged row or card keeps its
 * ink frame and the target its cobalt mark, with no ghost of it under the
 * pointer (spec/02 §4.22, DSK-11). Made once, so it has loaded by the first
 * drag. The tree and the board both use it.
 */
export const NO_DRAG_IMAGE: HTMLImageElement | null =
  typeof Image === "undefined"
    ? null
    : Object.assign(new Image(1, 1), {
        src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      });
