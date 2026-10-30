/**
 * The sebaro icons the app uses, from the export's sprite (ICO-04, spec/04
 * §3; ADR-0051): `main.tsx` inlines `sebaro/icons/sprite.svg` once at the top
 * of <body>, and each icon is a `<use>` of one of its symbols in
 * `currentColor`. No path is drawn here. At 16 px an icon takes its own
 * 16-unit master where the sprite has one (`plus--16`, or the master's own
 * name where it is not `<name>--16`); the others are the 24-unit symbol at
 * 16 px with the stroke `sprite.css` gives that size.
 */
const NAMES = {
  plus: true,
  folder: false,
  board: false,
  settings: false,
  trash: false,
  sidebar: false,
  "chevron-right": true,
  "chevron-left": true,
  "external-link": true,
  error: true,
  warning: true,
  home: false,
  "file-text": false,
  info: true,
  "arrow-up": true,
  "arrow-down": true,
  close: true,
  search: true,
  check: true,
  "chevron-up": true,
  "chevron-down": true,
  // The callouts' 20 px status glyphs (STA-05); filled, no 16 px master.
  "warning--filled": false,
  "info--filled": false,
  // A field's error sign (EIN-02); its 16-unit master is `error--filled-16`.
  "error--filled": "error--filled-16",
  // The waiting state of a secondary action (spec/02 §1.7).
  loader: false,
  // The readers' zoom (spec/02 §4.25.3, approved with D104 (15)).
  "zoom-out": false,
  "zoom-in": false,
  "zoom-fit": false,
  // A changed document's tab: the dot (spec/02 §4.21, D102 (4), D105 (5)).
  changed: true,
  // The preview switch's eye before its word (spec/02 §4.17, D105 (2)).
  eye: false,
  // „Mehr“ on the board, its columns and cards (spec/02 §3.16, AKT-10).
  "more-horizontal": true,
  // The settings view (spec/02 §4.24): „Zurück zu <Ort>“, and the place
  // „Einstellungen“ while it is the current one (NAV-01's filled icon).
  "arrow-left": true,
  "settings--filled": false,
} as const;

export type IconName = keyof typeof NAMES;

/**
 * The sprite symbol for an icon at a size: the `--16` master at 16 px where
 * there is one (ICO-04).
 */
export function symbolOf(name: IconName, size: 16 | 20 | 24): string {
  const master: boolean | string = NAMES[name];
  if (size !== 16 || !master) return name;
  return master === true ? `${name}--16` : master;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * One icon as a DOM node, the markup `Icon` renders, for what is written
 * outside React: the preview's fragment, CodeMirror's panels.
 */
export function iconNode(doc: Document, name: IconName, size: 16 | 20 | 24 = 16): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `sb-icon sb-icon--${size}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = doc.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${symbolOf(name, size)}`);
  svg.append(use);
  return svg;
}

/**
 * The icon a link that leaves the app ends in (sebaro D56, spec/03 §15), as
 * a DOM node: the preview's fragment is written outside React. sebaro.css
 * places it (`a > .sb-icon--16:last-child`).
 */
export function externalLinkIcon(doc: Document): SVGSVGElement {
  return iconNode(doc, "external-link", 16);
}

/**
 * One icon, 16 px unless a tool asks for its 20 px (spec/02 §4.18); a
 * part's own class (`sb-row__icon`) goes after sebaro's two.
 */
export default function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: 16 | 20 | 24;
  className?: string;
}) {
  return (
    <svg
      className={className ? `sb-icon sb-icon--${size} ${className}` : `sb-icon sb-icon--${size}`}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`#${symbolOf(name, size)}`} />
    </svg>
  );
}
