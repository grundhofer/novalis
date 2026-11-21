// reveal.ts: what is scrolled into view inside a part.

/** Scrolls `scroller`, and nothing else, by the least amount that shows `element` inside it. Unlike
 *  scrollIntoView it leaves the place alone from which Tab goes on. */
export function reveal(scroller: HTMLElement, element: HTMLElement): void {
  const [frame, box] = [scroller.getBoundingClientRect(), element.getBoundingClientRect()];
  if (box.left < frame.left) scroller.scrollLeft += box.left - frame.left;
  else if (box.right > frame.right) scroller.scrollLeft += box.right - frame.right;
  if (box.top < frame.top) scroller.scrollTop += box.top - frame.top;
  else if (box.bottom > frame.bottom) scroller.scrollTop += box.bottom - frame.bottom;
}
