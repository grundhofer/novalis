/**
 * The allow-list copy the EPUB reader shows (ADR-0023).
 *
 * A chapter is a stranger's XHTML: it may carry scripts, frames, remote
 * stylesheets, fonts and tracking pixels. Nothing of it reaches the page as
 * it was written. The chapter is parsed with `DOMParser` into an inert
 * document — no script runs, no resource loads there — and what the reader
 * shows is a *new* tree built element by element from the list below. An
 * element that is not on the list keeps its text and loses itself; an
 * element on the second list loses its children too, because its content is
 * not prose (a `<script>` body is not text to read).
 *
 * It is a copy and not a scrub on purpose: a filter has to think of every
 * attack, a copy has to think of every feature, and a feature that is
 * forgotten only fails to render.
 *
 * An `<img>` keeps no `src`: the reader resolves the entry inside the book
 * and sets a `blob:` URL (`data-src` carries the raw value until then), so
 * nothing is ever fetched by the mere act of showing a chapter — which the
 * CSP would refuse anyway, and which would otherwise flash a broken image.
 * A `data:image/…` source is carried the same way and for the same reason,
 * even though it fetches nothing: it is what a DOCX's pictures arrive as
 * (ADR-0024), and it stays the reader's decision what an `<img>` loads.
 */

/** Elements copied with their children. */
const ELEMENTS = new Set([
  // block
  "p", "div", "section", "article", "aside", "header", "footer", "main", "nav",
  "blockquote", "pre", "figure", "figcaption", "address", "hr", "br", "wbr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  // lists
  "ul", "ol", "li", "dl", "dt", "dd",
  // tables
  "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td",
  // inline
  "span", "a", "em", "strong", "i", "b", "u", "s", "small", "big", "sub", "sup",
  "code", "kbd", "samp", "var", "cite", "q", "abbr", "dfn", "mark", "time",
  "del", "ins", "bdi", "bdo", "ruby", "rt", "rp", "rb", "rtc",
  // media
  "img",
]);

/**
 * Elements dropped with everything inside them. The rest of the document's
 * unknown elements (`epub:switch`, a book's own `<poem>`) are unwrapped
 * instead, so their text still reads.
 */
const DROPPED = new Set([
  "script", "style", "link", "meta", "base", "title", "head", "noscript", "template",
  "iframe", "frame", "frameset", "object", "embed", "applet", "param",
  "form", "input", "button", "select", "option", "optgroup", "textarea", "label", "fieldset",
  "canvas", "audio", "video", "source", "track", "map", "area",
  // Both carry their own scripting and fetching surface, and neither is
  // prose; a cover drawn as SVG is the one thing this costs (ADR-0023).
  "svg", "math",
]);

/** Attributes copied on any allowed element. `id` carries fragment links. */
const GLOBAL_ATTRIBUTES = new Set(["id", "lang", "dir", "title"]);

/** Attributes copied on one element only. */
const ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  a: new Set(["href"]),
  img: new Set(["alt", "width", "height"]),
  td: new Set(["colspan", "rowspan", "headers"]),
  th: new Set(["colspan", "rowspan", "headers", "scope"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  ol: new Set(["start", "reversed", "type"]),
  li: new Set(["value"]),
  time: new Set(["datetime"]),
  bdo: new Set(["dir"]),
};

/** `https:`, `mailto:` and the like — the test `lib/links.ts` uses. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** An inline picture: the whole image is the value, so nothing is fetched. */
const DATA_IMAGE = /^data:image\//i;

/** The schemes a link may name; anything else (`javascript:`) is dropped. */
const LINK_SCHEMES = /^(?:https?|mailto|tel):/i;

/**
 * Whether a link's destination may be kept. A fragment and a relative path
 * stay because they point inside the book; an outside URL stays because the
 * reader answers a click on it with the preview's toast, and a link the
 * reader silently swallowed would look broken instead.
 */
function keepHref(href: string): boolean {
  if (!SCHEME.test(href)) return true;
  return LINK_SCHEMES.test(href);
}

/** A copy of `source`'s children, built in `into`, with only what is allowed. */
export function sanitizeInto(source: Element, into: Document): DocumentFragment {
  const fragment = into.createDocumentFragment();
  copyChildren(source, fragment, into);
  return fragment;
}

function copyChildren(source: Node, target: Node, into: Document): void {
  for (const child of source.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(into.createTextNode(child.nodeValue ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    // `localName` and not `tagName`: XHTML is case-sensitive and namespaced,
    // and `tagName` would hand back `epub:switch` as its own name.
    const name = element.localName.toLowerCase();
    if (DROPPED.has(name)) continue;
    if (!ELEMENTS.has(name)) {
      // Unknown, but its text is the book's: keep the children, lose the tag.
      copyChildren(element, target, into);
      continue;
    }
    const copy = into.createElement(name);
    copyAttributes(element, copy, name);
    copyChildren(element, copy, into);
    target.appendChild(copy);
  }
}

function copyAttributes(source: Element, target: Element, name: string): void {
  const allowed = ATTRIBUTES[name];
  for (const attribute of source.attributes) {
    const key = attribute.localName.toLowerCase();
    const value = attribute.value;
    if (key === "href" && name === "a") {
      if (keepHref(value)) target.setAttribute("href", value);
      continue;
    }
    if (!GLOBAL_ATTRIBUTES.has(key) && !allowed?.has(key)) continue;
    target.setAttribute(key, value);
  }
  // The raw `src` as the book wrote it; the reader turns it into a `blob:`
  // URL once it has the bytes, and an image it cannot find stays alt text.
  if (name === "img") {
    const src = source.getAttribute("src");
    if (src && (!SCHEME.test(src) || DATA_IMAGE.test(src))) target.setAttribute("data-src", src);
  }
}
