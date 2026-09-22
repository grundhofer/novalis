import { describe, expect, it } from "vitest";

import { sanitizeInto } from "./sanitize";

/** The copy of a chapter body, as markup, for one assertion per case. */
function clean(html: string): string {
  const source = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
  const host = document.createElement("div");
  host.append(sanitizeInto(source, document));
  return host.innerHTML;
}

describe("sanitizeInto", () => {
  it("keeps prose, lists, tables, links and images", () => {
    expect(clean("<p>Text with <em>stress</em> and <code>code</code>.</p>")).toBe(
      "<p>Text with <em>stress</em> and <code>code</code>.</p>",
    );
    expect(clean("<ul><li>one</li><li>two</li></ul>")).toBe("<ul><li>one</li><li>two</li></ul>");
    expect(clean('<table><tr><th colspan="2">h</th></tr></table>')).toContain(
      '<th colspan="2">h</th>',
    );
    expect(clean('<h2 id="part">Part</h2>')).toBe('<h2 id="part">Part</h2>');
  });

  it("drops what a book might want to run, with everything inside it", () => {
    expect(clean("<p>before</p><script>alert(1)</script><p>after</p>")).toBe(
      "<p>before</p><p>after</p>",
    );
    expect(clean('<iframe src="https://example.com">fallback</iframe>')).toBe("");
    expect(clean("<object data='x.swf'><param name='a'></object>")).toBe("");
    expect(clean("<style>p { color: red }</style><p>x</p>")).toBe("<p>x</p>");
    expect(clean("<svg><text>cover</text></svg>")).toBe("");
    expect(clean("<form><input name='a'><button>go</button></form>")).toBe("");
  });

  it("drops event handlers, inline styles and classes", () => {
    expect(clean('<p onclick="steal()" onmouseover="x()">hi</p>')).toBe("<p>hi</p>");
    expect(clean('<p style="background: url(https://example.com/pixel)">hi</p>')).toBe("<p>hi</p>");
    expect(clean('<p class="book-style">hi</p>')).toBe("<p>hi</p>");
  });

  it("keeps a link inside the book and one that leaves it, and no other scheme", () => {
    expect(clean('<a href="#note-1">note</a>')).toBe('<a href="#note-1">note</a>');
    expect(clean('<a href="../ch2.xhtml">on</a>')).toBe('<a href="../ch2.xhtml">on</a>');
    expect(clean('<a href="https://example.com">out</a>')).toBe(
      '<a href="https://example.com">out</a>',
    );
    // Nothing navigates the webview anyway, but a destination that is only
    // ever code has no business being copied at all.
    expect(clean('<a href="javascript:alert(1)">no</a>')).toBe("<a>no</a>");
    expect(clean('<a href="data:text/html,<b>no</b>">no</a>')).toBe("<a>no</a>");
  });

  it("hands an image no src until the reader has its bytes", () => {
    expect(clean('<img src="../images/a.png" alt="A picture">')).toBe(
      '<img alt="A picture" data-src="../images/a.png">',
    );
    // A remote image is not fetched and not remembered: without a name
    // inside the book there is nothing for the reader to resolve.
    expect(clean('<img src="https://example.com/pixel.gif" alt="">')).toBe('<img alt="">');
  });

  it("keeps the text of an element it does not know, and loses the element", () => {
    expect(clean("<epub:switch><epub:case>text</epub:case></epub:switch>")).toBe("text");
    expect(clean("<poem><p>a line</p></poem>")).toBe("<p>a line</p>");
  });

  it("copies nothing by reference: the source tree is never shown", () => {
    const source = new DOMParser().parseFromString("<body><p>x</p></body>", "text/html").body;
    const host = document.createElement("div");
    host.append(sanitizeInto(source, document));
    expect(host.firstElementChild).not.toBe(source.firstElementChild);
    expect(host.firstElementChild?.ownerDocument).toBe(document);
  });
});
