import { describe, expect, it } from "vitest";

import indexHtml from "../index.html?raw";
import mainSource from "./main.tsx?raw";
import sebaroCss from "./sebaro/css/sebaro.css?raw";
import sebaroFontsCss from "./sebaro/fonts/fonts.css?raw";
import sebaroTokensCss from "./sebaro/tokens.css?raw";

// The fonts come from the sebaro export alone (ADR-0051 #27, sebaro D68–D71):
// its `fonts.css` registers sebaro Sans and sebaro Mono, the page names those
// families through the export's tokens, and nothing registers a face a second
// time. Read as text: jsdom loads no font and computes no style (ADR-0011).

/** Every stylesheet novalis writes itself, outside the export. */
const OWN_CSS = Object.entries(
  import.meta.glob<string>(["./**/*.css", "!./sebaro/**"], { query: "?raw", import: "default", eager: true }),
);

/** Every source file novalis writes itself, outside the export, tests included. */
const OWN_SOURCES = Object.entries(
  import.meta.glob<string>(["./**/*.{css,ts,tsx}", "!./sebaro/**"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

/** The body block of app.css, where the page's text gets its type. */
function appBody(): string {
  const own = OWN_CSS.find(([path]) => path === "./styles/app.css")?.[1] ?? "";
  const start = own.indexOf("\nbody {");
  expect(start).toBeGreaterThanOrEqual(0);
  return own.slice(start, own.indexOf("\n}", start));
}

/** The value of a custom property in the first block that opens with `selector {`. */
function token(css: string, selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("\n}", start));
  const value = new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1];
  expect(value, `${selector} ${name}`).toBeDefined();
  return value!.trim();
}

/** `[family, style, weight]` of every `@font-face` in a stylesheet. */
function faces(css: string): string[][] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => [
    /font-family:\s*"([^"]+)"/.exec(body!)?.[1] ?? "",
    /font-style:\s*([^;]+);/.exec(body!)?.[1] ?? "",
    /font-weight:\s*([^;]+);/.exec(body!)?.[1] ?? "",
  ]);
}

describe("fonts", () => {
  it("are registered by the export only, each family and style once", () => {
    expect(OWN_CSS.length).toBeGreaterThan(0);
    for (const [path, css] of OWN_CSS) expect(css, path).not.toContain("@font-face");

    expect(faces(sebaroFontsCss)).toEqual([
      ["sebaro Sans", "normal", "400 700"],
      ["sebaro Sans", "italic", "400 700"],
      // Medium only (D70): every weight resolves to it.
      ["sebaro Mono", "normal", "500"],
    ]);
    // The export's stylesheet is imported, and no other font stylesheet.
    expect(mainSource).toContain('import "./sebaro/fonts/fonts.css";');
    expect(mainSource).not.toMatch(/styles\/fonts\.css|\/fonts\/(?!fonts\.css)/);
  });

  it("are the families the export's tokens name, and the page text takes them", () => {
    expect(token(sebaroTokensCss, ":root", "--sb-font-family-ui")).toMatch(/^"sebaro Sans",/);
    expect(token(sebaroTokensCss, ":root", "--sb-font-family-mono")).toMatch(/^"sebaro Mono",/);
    expect(appBody()).toContain("font-family: var(--sb-font-family-ui);");
  });

  it("weigh what sebaro's roles weigh, 30 units heavier in dark (D40, SCH-05)", () => {
    for (const role of ["--sb-type-body-weight", "--sb-type-body-strong-weight", "--sb-type-title-weight"]) {
      const light = token(sebaroTokensCss, '\n[data-theme="light"]', role);
      const dark = token(sebaroTokensCss, '\n[data-theme="dark"]', role);
      expect(Number(dark) - Number(light), role).toBe(30);
    }
    // The page text takes the body weight, so the dark shift reaches it.
    expect(appBody()).toContain("font-weight: var(--sb-type-body-weight);");
    expect(appBody()).toContain("font-synthesis: none;");
  });
});

// The export's tokens are the one source of sebaro's values (TEC-07, HAL-07,
// ADR-0051 #23): novalis names them as `--sb-*`, declares none of them itself
// and keeps no alias layer. None of its own `--nv-*` values is left
// (styles/app.css); a new one needs a gap row.
describe("tokens", () => {
  const exported = new Set(
    [...`${sebaroTokensCss}\n${sebaroCss}`.matchAll(/(--sb-[\w-]+)\s*:/g)].map(([, name]) => name),
  );
  const declaredOwn = new Set(
    OWN_SOURCES.flatMap(([, text]) => [
      ...[...text.matchAll(/(--nv-[\w-]+)\s*:/g)].map(([, name]) => name),
      ...[...text.matchAll(/setProperty\("(--nv-[\w-]+)"/g)].map(([, name]) => name),
    ]),
  );

  it("are sebaro's names only, with no pilot name left", () => {
    expect(OWN_SOURCES.length).toBeGreaterThan(0);
    // Built from parts so this file does not name what it looks for.
    const pilot = new RegExp(`--${"ds"}-`);
    for (const [path, text] of OWN_SOURCES) expect(text, path).not.toMatch(pilot);
    expect(mainSource).not.toContain("@novalis/tokens");
  });

  it("name only properties the export or novalis's own CSS declares", () => {
    for (const [path, text] of OWN_SOURCES) {
      for (const [, name] of text.matchAll(/var\((--(?:sb|nv)-[\w-]+)/g)) {
        const known = name!.startsWith("--sb-") ? exported.has(name!) : declaredOwn.has(name!);
        expect(known, `${path} ${name}`).toBe(true);
      }
    }
  });

  // The one exception sebaro itself names: a product may set the board's
  // column token wider on its board (spec/02 §3.16, D102 (40)); novalis's
  // 268 px, on `.board > .sb-board` in board.css and nowhere else.
  const BOARD_COLUMN = /\.board > \.sb-board \{\n {2}--sb-x-sebaro-board-column: 268px;/;

  it("declare no sebaro token in novalis's own CSS", () => {
    for (const [path, css] of OWN_CSS) {
      const own = path === "./styles/board.css" ? css.replace(BOARD_COLUMN, "") : css;
      expect(own, path).not.toMatch(/--sb-[\w-]+\s*:/);
    }
    expect(OWN_CSS.find(([path]) => path === "./styles/board.css")?.[1]).toMatch(BOARD_COLUMN);
  });
});

// sebaro's classic scripts and the start (spec/09 §1, WEB-01, spec/03 §14,
// STR-01; ADR-0051 #21, #26): files, not inline code (CSP `script-src
// 'self'`), in sebaro's order, and only the two window scripts ADR-0051
// allows. The start tile is the export's file, put in by vite.config.ts.
describe("index.html", () => {
  const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([^<]*)<\/script>/g)];

  it("loads theme-init.js, then sb-start.js, then sb-tooltip.js and sb-menu.js, as files", () => {
    for (const [, , body] of scripts) expect(body!.trim()).toBe("");
    const classic = scripts.map(([, attrs]) => /src="([^"]+)"/.exec(attrs!)?.[1]).filter((src) => src?.startsWith("/sebaro/"));
    expect(classic).toEqual([
      "/sebaro/js/theme-init.js",
      "/sebaro/js/sb-start.js",
      "/sebaro/js/sb-tooltip.js",
      "/sebaro/js/sb-menu.js",
    ]);
    // Ahead of the module that brings the stylesheets (main.tsx).
    expect(indexHtml.indexOf("theme-init.js")).toBeLessThan(indexHtml.indexOf("/src/main.tsx"));
  });

  // spec/09 §13.1, ADOPTION §5 step 8: the window's density from the first
  // frame, for what stands outside `.sb-window` too (a start error).
  it("sets the window's density on <html>", () => {
    expect(indexHtml).toMatch(/<html [^>]*\bdata-sb-density="window"/);
  });

  it("opts into the start, with the export's tile first in <body>", () => {
    expect(indexHtml).toMatch(/<html [^>]*\bdata-sb-start\b/);
    const body = indexHtml.slice(indexHtml.indexOf("<body>") + "<body>".length).trim();
    expect(body.startsWith('<div class="sb-start" aria-hidden="true"><span class="sb-start__tile">')).toBe(true);
    expect(body).toContain('<!-- sb:inline src="brand/inline/tile-novalis-small.svg" -->');
    // Held before React mounts (lib/start.ts).
    expect(mainSource.indexOf("holdStart();")).toBeLessThan(mainSource.indexOf("createRoot("));
  });
});

// Rule 5 (fail loud), spec/09 §13.1, sebaro D108 (NV-W3): a failure that
// React cannot show is sebaro's last-resort notice, written with
// `textContent` only, never `innerHTML` with the error's text.
describe("the last-resort notice", () => {
  it("is sebaro's sb-fatal with the message in a samp", () => {
    const body = mainSource.slice(mainSource.indexOf("function reportFatal"), mainSource.indexOf('window.addEventListener("error"'));
    expect(body).toContain('notice.className = "sb-fatal";');
    expect(body).toContain('notice.setAttribute("role", "alert");');
    expect(body).toContain('document.createElement("samp")');
    expect(body).toContain("message.textContent = what;");
    expect(body).not.toContain("innerHTML");
    expect(sebaroCss).toContain(".sb-fatal {");
  });
});
