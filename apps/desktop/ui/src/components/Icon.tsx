/**
 * The sebaro icons the app uses (ADR-0048), drawn as inline SVG in
 * `currentColor`: no icon font, no image file, no request. The paths are
 * copied from sebaroDesign `systems/sebaro/icons/dist/sprite.svg`; a 24-unit
 * symbol drawn at 16 px takes the system's 16 px stroke (2.25 units = 1.5 px).
 */
const PATHS = {
  plus: ["M12 5 V19", "M5 12 H19"],
  folder: [
    "M3.875 17.625 V6.375 A2 2 0 0 1 5.875 4.375 H9.5 L11.5 6.375 H18.125 A2 2 0 0 1 20.125 8.375 V17.625 A2 2 0 0 1 18.125 19.625 H5.875 A2 2 0 0 1 3.875 17.625 Z",
  ],
  board: [
    "M5.875 3.875 H18.125 A2 2 0 0 1 20.125 5.875 V18.125 A2 2 0 0 1 18.125 20.125 H5.875 A2 2 0 0 1 3.875 18.125 V5.875 A2 2 0 0 1 5.875 3.875 Z",
    "M8 8 V15",
    "M12 8 V12",
    "M16 8 V16",
  ],
  settings: [
    "M3.5 7.25 H12.375 A2.625 2.625 0 0 1 17.625 7.25 H20.5",
    "M12.375 7.25 A2.625 2.625 0 0 0 17.625 7.25",
    "M3.5 16.75 H6.375 A2.625 2.625 0 0 1 11.625 16.75 H20.5",
    "M6.375 16.75 A2.625 2.625 0 0 0 11.625 16.75",
  ],
  trash: [
    "M3.5 6.5 H20.5",
    "M9.875 6.5 V3.5 H14.125 V6.5",
    "M5.5 6.5 V18.125 A2 2 0 0 0 7.5 20.125 H16.5 A2 2 0 0 0 18.5 18.125 V6.5",
    "M9.875 10.5 V16",
    "M14.125 10.5 V16",
  ],
} as const;

export type IconName = keyof typeof PATHS;

/** The 16-unit `external-link--16` symbol: the box with the arrow (sebaro D56). */
const EXTERNAL_LINK_16 = [
  "M5.75 2.75 H4 A1.25 1.25 0 0 0 2.75 4 V12 A1.25 1.25 0 0 0 4 13.25 H12 A1.25 1.25 0 0 0 13.25 12 V10.25",
  "M7.5 8.5 L13.25 2.75",
  "M9.25 2.75 H13.25 V6.75",
];

/**
 * The icon a link that leaves the app ends in (sebaro D56, spec/03 §15), as
 * a DOM node: the preview's fragment is written outside React.
 */
export function externalLinkIcon(doc: Document): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("class", "icon icon-16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of EXTERNAL_LINK_16) {
    const path = doc.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export default function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * The novalis app tile (sebaro D57, D62): the flower symbol on the petrol
 * tile, without the code below 48 px. Path from sebaroDesign
 * `systems/sebaro/brand/inline/tile-novalis-small.svg`; the colours are the
 * `--ds-color-tile*` tokens, the only place the product colour appears.
 */
export function AppTile({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 72 72" aria-hidden="true" focusable="false">
      <rect className="tile-ground" width="72" height="72" rx="12.002" />
      <path
        className="tile-glyph"
        transform="translate(14.4 14.4) scale(1.8)"
        fillRule="nonzero"
        d="M7.515 5.828 A4.5 4.5 0 1 1 16.485 5.828 A4.5 4.5 0 1 1 19.256 14.358 A4.5 4.5 0 1 1 12 19.63 A4.5 4.5 0 1 1 4.744 14.358 A4.5 4.5 0 1 1 7.515 5.828 Z M9.8 12 A2.2 2.2 0 1 0 14.2 12 A2.2 2.2 0 1 0 9.8 12 Z"
      />
    </svg>
  );
}
