#!/usr/bin/env node
// A product's raster files, drawn from the SVGs of its kit folder (shared/PRODUCT-CONTRACT.md section 6): favicon.ico,
// touch icon, manifest icons, Play icon, Play feature graphic, desktop icon. Node 20+, built-ins only; Chromium through
// the product's own Playwright, never one of this folder. No network.
// A product without a Node project (an Android app that draws its Play icon once) names a folder that holds
// node_modules/playwright in the environment variable SEBARO_PLAYWRIGHT (1.1.0); `product_kit.py build --render`
// passes it on. Named, that folder is the only place looked in; without it the lookup is the product's as before.
//
//   node <copy>/product/render.mjs <folder>       # the PNG and ICO files the record in <folder> lists
//   node <copy>/product/render.mjs share <folder> --pages og-pages.json --out public/og [--head DIR] …
//   node <copy>/product/render.mjs --version
//
// <folder> is the output folder of `product_kit.py build` (the same as `build --render`, which runs this file). Its
// record sebaro-product.json lists under "raster" each file with its size and the SVG under render/ it is drawn
// from; the ICO lists its entries. Every SVG is drawn at exactly that size, alone on a transparent page, at device
// scale 1 (a file with "body" is drawn at body x body and set in the middle of a transparent field of its size: the
// desktop icon); a PNG is written as 8-bit RGBA, or as 24-bit RGB where the record says alpha false (every pixel
// must be opaque), with an sRGB chunk and no other metadata; the ICO is a directory of PNG entries in the record's
// order.
// The same input gives the same bytes on the same Chromium.
//
// Text in a source (1.3.0; the Play feature graphic's name, laid out as HTML in a foreignObject): before the picture
// is taken, every element with data-sb-fit must be drawn in its own font, the first family of its font-family, which
// the source embeds: that face loads, and every character is drawn by it (the text has the same width with two
// different fallback fonts behind it). An element wider than its box (scrollWidth over clientWidth; the source gives
// it a max-width) is set smaller in whole px down to its data-sb-fit-min and is refused when it is still too wide.
// A refused text is a file that could not be drawn (exit 1, nothing written); the size it was drawn at is in the log.
//
// Nothing is written until every file is drawn. Then the files, and sebaro-product-raster.json: for each file its
// sha256 and the sha256 of every SVG it was drawn from. `product_kit.py check` compares those with the files and
// with the SVGs a build gives now (missing, edited, stale); it never compares pixels. A raster file of an earlier
// run that the record no longer lists is removed.
//
// `share` runs the share-image generator of a copy with the pack share-images (brand/og/render.mjs, spec/09 §18.1)
// for the product of <folder>. That generator reads the sign tile of the page list's product from
// brand/inline/tile-<id>.svg beside itself, and a profile copy holds no product's tile. So `share` copies what the
// generator reads (tokens.css, fonts/, icons/sprite.svg and sprite.css, brand/og/, brand/inline/) into a temporary
// folder, adds the product's tile there (sign/tile.svg of <folder>, named by the id of its record, with its title as
// the name), runs the generator from it with the arguments after <folder>, and removes the folder. The copy is not
// written to. The page list's site.product must be that id; a page that names another product's tile is refused by
// the generator. Its exit codes are the generator's. The generator looks for Playwright from its own file, which
// then stands in the temporary folder: `share` links the node_modules folder of the Playwright the raster files are
// drawn with into it (1.2.0), so SEBARO_PLAYWRIGHT and the product's own Playwright hold for `share` too.
//
// Inside sebaroDesign this file is tools/product_render.mjs; a copy carries it as product/render.mjs beside
// product/product_kit.py.
// Exit codes: 0 ok · 1 a file could not be drawn or the browser could not run · 2 usage or input (no record, an SVG
// that is not the one the build wrote, no Playwright).
//
// Versions (CHANGELOG):
//   1.3.0  2026-11-14  text in a source: data-sb-fit, its font and its room, for the Play feature graphic of kit 1.3.0
//                      (sebaro CHECKS.md §129); a source without text is drawn as before, to the same bytes.
//   1.2.0  2026-11-12  `share` finds Playwright where the raster files find it: the folder SEBARO_PLAYWRIGHT names,
//                      or the product's own (D148 stage 6c, sebaro CHECKS.md §120). Before, the generator looked
//                      from the temporary folder and the working folder alone.
//   1.1.0  2026-11-12  SEBARO_PLAYWRIGHT names a folder that holds node_modules/playwright, for a product without
//                      a Node project (D148 stage 6b, sebaro CHECKS.md §119); the default lookup is unchanged.
//   1.0.0  2026-11-12  first version (D148 stage 6a, sebaro CHECKS.md §118).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

export const VERSION = "1.3.0";
const SELF = "product/render.mjs";              // this file's place in a copy; the record's notice names it
const KIT = "product/product_kit.py";
const RECORD = "sebaro-product.json";           // the kit's record: what to draw
const RASTER_RECORD = "sebaro-product-raster.json";
const RASTER_RECORD_FORMAT = "1.0";
const LOCAL = /^(file|data|blob|about):/i;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHARE_GENERATOR = "brand/og/render.mjs";  // of a copy with the pack share-images
const SHARE_READS = ["tokens.css", "fonts", "icons/sprite.svg", "icons/sprite.css", "brand/og", "brand/inline"];

class UsageError extends Error {}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ------------------------------------------------------------------------- the kit's record
function loadJobs(folder) {
  const file = path.join(folder, RECORD);
  if (!existsSync(file)) throw new UsageError(`no ${RECORD} in ${folder}: run ${KIT} build first`);
  let record;
  try { record = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new UsageError(`${file}: invalid JSON (${e.message})`); }
  const raster = record?.raster?.files;
  if (!raster || typeof raster !== "object" || typeof record.files !== "object") {
    throw new UsageError(`${file} lists no raster files (written by kit ${record?.kit ?? "?"}): run ${KIT} build of this copy`);
  }
  const jobs = [];
  for (const [rel, job] of Object.entries(raster)) {
    const body = job.body ?? null;
    if (body !== null && (job.entries || !Number.isInteger(body) || body < 1 || body > Math.min(job.width, job.height) ||
                          (job.width - body) % 2 || (job.height - body) % 2)) {
      throw new UsageError(`${file}: raster.files[${JSON.stringify(rel)}] has a body that does not stand in the middle of its field`);
    }
    const parts = Array.isArray(job.entries)
      ? job.entries.map((e) => ({ source: e.source, width: e.size, height: e.size }))
      : [{ source: job.source, width: body ?? job.width, height: body ?? job.height }];
    for (const p of parts) {
      if (typeof p.source !== "string" || !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width < 1 || p.height < 1) {
        throw new UsageError(`${file}: raster.files[${JSON.stringify(rel)}] names no source with a size`);
      }
      if (job.entries && p.width > 256) throw new UsageError(`${file}: ${rel}: an ICO entry is at most 256 px, got ${p.width}`);
      const src = path.join(folder, p.source);
      if (!existsSync(src)) throw new UsageError(`${p.source} is missing in ${folder}: run ${KIT} build again`);
      p.svg = readFileSync(src);
      p.sha256 = sha256(p.svg);
      if (record.files[p.source] !== p.sha256) {
        throw new UsageError(`${p.source} is not the file the build wrote (${RECORD} has another sha256): run ${KIT} build again`);
      }
    }
    jobs.push({ rel, ico: Array.isArray(job.entries), alpha: job.entries ? true : job.alpha !== false, parts,
                field: body === null ? null : { width: job.width, height: job.height } });
  }
  return jobs;
}

// The SVG at an exact pixel size, alone on a transparent page.
function pageOf(svg, width, height) {
  const m = /^\s*<svg\b([^>]*)>/.exec(svg);
  if (!m) throw new UsageError("a render source does not start with <svg");
  const attrs = m[1].replace(/\s(?:width|height)="[^"]*"/g, "");
  return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;' +
         "background:transparent;overflow:hidden}svg{display:block}</style></head><body>" +
         `<svg${attrs} width="${width}" height="${height}">${svg.slice(m[0].length)}</body></html>`;
}

// ------------------------------------------------------------------------- PNG (8-bit RGB / RGBA, not interlaced)
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47) throw new Error("not a PNG");
  let pos = 8, ihdr = null; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString("latin1", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.depth !== 8 || ![2, 6].includes(ihdr.colorType) || ihdr.interlace) {
    throw new Error(`unsupported PNG ${JSON.stringify(ihdr)}`);
  }
  const bpp = ihdr.colorType === 6 ? 4 : 3, stride = ihdr.width * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * ihdr.height);
  for (let y = 0; y < ihdr.height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - stride + x] : 0, c = x >= bpp && y ? px[o - stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 0xFF;
    }
  }
  return { width: ihdr.width, height: ihdr.height, channels: bpp, data: px };
}

// RGBA with the least alpha of the picture, whatever the decoder gave
function rgbaOf(img) {
  if (img.channels === 4) {
    let alphaMin = 255;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < alphaMin) alphaMin = img.data[i];
    return { ...img, alphaMin };
  }
  const out = Buffer.alloc(img.width * img.height * 4, 255);
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) img.data.copy(out, j, i, i + 3);
  return { width: img.width, height: img.height, channels: 4, data: out, alphaMin: 255 };
}

// The picture in the middle of a transparent field (both sizes differ by an even number).
function centred(img, width, height) {
  const out = Buffer.alloc(width * height * 4), x0 = (width - img.width) / 2, y0 = (height - img.height) / 2;
  for (let y = 0; y < img.height; y++) img.data.copy(out, ((y0 + y) * width + x0) * 4, y * img.width * 4, (y + 1) * img.width * 4);
  return { width, height, channels: 4, data: out, alphaMin: width === img.width && height === img.height ? img.alphaMin : 0 };
}

function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// RGBA (alpha true) or 24-bit RGB of an RGBA picture; filter Sub or Up per row (the smaller sum), zlib level 9, an
// sRGB chunk and nothing else: deterministic
export function encodePng(img, alpha) {
  const bpp = alpha ? 4 : 3, stride = img.width * bpp, rows = [];
  let data = img.data;
  if (!alpha) {
    data = Buffer.alloc(img.width * img.height * 3);
    for (let i = 0, j = 0; i < img.data.length; i += 4, j += 3) img.data.copy(data, j, i, i + 3);
  }
  for (let y = 0; y < img.height; y++) {
    const o = y * stride, sub = Buffer.alloc(stride + 1), up = Buffer.alloc(stride + 1);
    sub[0] = 1; up[0] = 2;
    let sSub = 0, sUp = 0;
    for (let x = 0; x < stride; x++) {
      const v = data[o + x];
      sub[x + 1] = (v - (x >= bpp ? data[o + x - bpp] : 0)) & 0xFF;
      up[x + 1] = (v - (y ? data[o - stride + x] : 0)) & 0xFF;
      sSub += sub[x + 1] < 128 ? sub[x + 1] : 256 - sub[x + 1];
      sUp += up[x + 1] < 128 ? up[x + 1] : 256 - up[x + 1];
    }
    rows.push(sUp < sSub ? up : sub);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk("IHDR", ihdr),
    chunk("sRGB", Buffer.from([0])), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// An ICO file: the directory, then one PNG per entry in the given order (each square, at most 256 px).
export function packIco(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i, dim = size === 256 ? 0 : size;
    head[at] = dim; head[at + 1] = dim; head[at + 2] = 0; head[at + 3] = 0;
    head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(png.length, at + 8); head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.png)]);
}

// ------------------------------------------------------------------------- the browser
const PLAYWRIGHT_ENV = "SEBARO_PLAYWRIGHT";     // 1.1.0: a folder that holds node_modules/playwright
const PLAYWRIGHT_NAMES = ["playwright", "playwright-core", "@playwright/test"];
const playwrightBases = (folder) => {
  const named = process.env[PLAYWRIGHT_ENV] ? path.resolve(process.env[PLAYWRIGHT_ENV]) : null;
  return { named, bases: named ? [named] : [process.cwd(), folder] };
};
const notInNamed = (named) => new UsageError(
  "Playwright not found in " + named + ", which the environment variable " + PLAYWRIGHT_ENV +
  " names: it must be a folder that holds node_modules/playwright (in it: npm install playwright, " +
  "then npx playwright install --only-shell chromium)");

function loadPlaywright(folder) {
  const { named, bases } = playwrightBases(folder);
  for (const base of bases) {
    const req = createRequire(path.join(base, "package.json"));
    for (const name of PLAYWRIGHT_NAMES) {
      try {
        const pw = req(name);
        let version = null;
        try { version = req(`${name}/package.json`).version; } catch { /* exports map without package.json */ }
        return { pw, version };
      } catch { /* next */ }
    }
  }
  if (named) throw notInNamed(named);
  throw new UsageError("Playwright not found from the working folder or from the product's folder: the renderer uses " +
                       "the product's own (npm install --save-dev playwright, then npx playwright install --only-shell chromium), " +
                       "or the one of a folder named in the environment variable " + PLAYWRIGHT_ENV);
}

// 1.2.0: the node_modules folder that holds the Playwright loadPlaywright would load, for `share`: the folder
// SEBARO_PLAYWRIGHT names (the only place then: without one there, exit 2), else the working folder's or the
// product's. null when there is none: the generator then says what it needs, and --html-only needs no browser.
function playwrightModules(folder) {
  const { named, bases } = playwrightBases(folder);
  const mark = `${path.sep}node_modules${path.sep}`;
  for (const base of bases) {
    const req = createRequire(path.join(base, "package.json"));
    for (const name of PLAYWRIGHT_NAMES) {
      try {
        const file = req.resolve(name);
        if (file.includes(mark)) return file.slice(0, file.lastIndexOf(mark) + mark.length - 1);
      } catch { /* next */ }
    }
  }
  if (named) throw notInNamed(named);
  return null;
}

// 1.3.0: runs in the page. Every [data-sb-fit] element: its font loads and draws every character, and it fits its
// box, set smaller in whole px down to data-sb-fit-min. Returns the problems and the size each element is drawn at.
async function fitText() {
  const boxes = [...document.querySelectorAll("[data-sb-fit]")], problems = [], sizes = [];
  if (!boxes.length) return { problems, sizes };
  await document.fonts.ready;
  const bare = (family) => family.trim().replace(/^["']|["']$/g, "");
  for (const el of boxes) {
    const style = getComputedStyle(el), text = el.textContent, family = style.fontFamily.split(",")[0].trim();
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${family}`;
    try { await document.fonts.load(font, text); } catch (e) { problems.push(`${font}: ${e.message}`); }
    const faces = [...document.fonts].filter((f) => bare(f.family) === bare(family));
    if (!faces.some((f) => f.status === "loaded")) {
      problems.push(`the font ${bare(family)} did not load (${faces.map((f) => f.status).join(", ") || "no face"})`);
    }
    const width = (fallback) => {
      const probe = document.createElement("span");
      probe.textContent = text;
      probe.style.cssText = `position:absolute;white-space:nowrap;font:${style.fontStyle} ${style.fontWeight} ${style.fontSize} ` +
                            `${family}, ${fallback};font-synthesis:none;letter-spacing:${style.letterSpacing}`;
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return w;
    };
    if (width("monospace") !== width("serif")) {
      problems.push(`"${text}" has a character ${bare(family)} does not draw (another font would draw it)`);
    }
    const least = Number(el.dataset.sbFitMin) || parseFloat(style.fontSize);
    let size = parseFloat(style.fontSize);
    while (el.scrollWidth > el.clientWidth && size > least) {
      size = Math.max(least, size - 1);
      el.style.fontSize = `${size}px`;
    }
    if (el.scrollWidth > el.clientWidth) {
      problems.push(`"${text}" is ${el.scrollWidth} px wide at ${size} px, its room is ${el.clientWidth} px (set no smaller than ${least} px)`);
    }
    sizes.push(size);
  }
  return { problems, sizes };
}

async function draw(jobs, pw) {
  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--disable-lcd-text"] });
  } catch (e) {
    throw new Error(`Chromium did not start (npx playwright install --only-shell chromium): ${e.message.split("\n")[0]}`);
  }
  const chromium = browser.version(), failed = [], drawn = new Map();
  try {
    const context = await browser.newContext({ viewport: { width: 100, height: 100 }, deviceScaleFactor: 1,
                                               colorScheme: "light", reducedMotion: "reduce", locale: "de-DE" });
    let blocked = [], consoleErrors = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (LOCAL.test(url)) return route.continue();
      blocked.push(url);
      return route.abort("blockedbyclient");
    });
    const tab = await context.newPage();
    tab.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    tab.on("pageerror", (e) => consoleErrors.push(String(e)));
    for (const job of jobs) {
      const problems = [];
      for (const p of job.parts) {
        const key = `${p.sha256} ${p.width}x${p.height}`;
        if (!drawn.has(key)) {
          blocked = []; consoleErrors = [];
          await tab.setViewportSize({ width: p.width, height: p.height });
          await tab.setContent(pageOf(p.svg.toString("utf8"), p.width, p.height), { waitUntil: "load", timeout: 60000 });
          const text = await tab.evaluate(fitText);         // 1.3.0: nothing to do in a source without text
          const shot = await tab.screenshot({ clip: { x: 0, y: 0, width: p.width, height: p.height }, omitBackground: true,
                                              animations: "disabled", timeout: 60000 });
          const img = rgbaOf(decodePng(shot));
          const found = [...text.problems];
          img.textSizes = text.sizes;
          if (img.width !== p.width || img.height !== p.height) found.push(`${img.width} x ${img.height} drawn, expected ${p.width} x ${p.height}`);
          if (blocked.length) found.push(`requests blocked: ${blocked.join(", ")}`);
          if (consoleErrors.length) found.push(`console errors: ${consoleErrors.join(" | ").slice(0, 400)}`);
          drawn.set(key, { img, found });
        }
        const { img, found } = drawn.get(key);
        p.img = img;
        problems.push(...found.map((f) => `${p.source}: ${f}`));
        if (!job.alpha && img.alphaMin < 255) problems.push(`${p.source}: transparent pixels in a file without alpha`);
      }
      if (problems.length) failed.push([job.rel, problems]);
    }
  } finally {
    await browser.close();
  }
  return { chromium, failed };
}

// ------------------------------------------------------------------------- the files and their record
function readRasterRecord(folder) {
  try {
    const doc = JSON.parse(readFileSync(path.join(folder, RASTER_RECORD), "utf8"));
    return doc && typeof doc.files === "object" && doc.files ? doc.files : {};
  } catch { return {}; }       // none, or unreadable: nothing of an earlier run is known
}

function removeStale(folder, before, now) {
  const removed = [];
  for (const rel of Object.keys(before).filter((r) => !now.has(r)).sort()) {
    const file = path.resolve(folder, rel);
    if (path.relative(folder, file).startsWith("..") || !existsSync(file)) continue;
    unlinkSync(file);
    removed.push(rel);
    for (let dir = path.dirname(file); dir !== folder && dir.startsWith(folder) && !readdirSync(dir).length; dir = path.dirname(dir)) rmdirSync(dir);
  }
  return removed;
}

async function render(folder) {
  const jobs = loadJobs(folder);
  if (!jobs.length) { console.log(`no raster file to draw: ${RECORD} in ${folder} lists none`); return 0; }
  const { pw, version } = loadPlaywright(folder);
  let chromium, failed;
  try { ({ chromium, failed } = await draw(jobs, pw)); } catch (e) { console.error(`error: ${e.message}`); return 1; }
  if (failed.length) {
    for (const [rel, problems] of failed) console.log(`FAIL ${rel}: ${problems.join("; ")}`);
    console.log(`nothing written: ${failed.length} of ${jobs.length} raster file(s) could not be drawn (Playwright ${version ?? "?"}, Chromium ${chromium})`);
    return 1;
  }
  const files = {};
  for (const job of jobs) {
    const data = job.ico ? packIco(job.parts.map((p) => ({ size: p.width, png: encodePng(p.img, true) })))
                         : encodePng(job.field ? centred(job.parts[0].img, job.field.width, job.field.height) : job.parts[0].img, job.alpha);
    const dest = path.join(folder, job.rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, data);
    files[job.rel] = { sha256: sha256(data), sources: Object.fromEntries(job.parts.map((p) => [p.source, p.sha256])) };
    const size = job.field ?? job.parts[0];
    const sizes = job.parts.flatMap((p) => p.img.textSizes || []);
    const what = job.ico ? `ICO, ${job.parts.map((p) => p.width).join(", ")} px`
                         : `${size.width} x ${size.height}, ${job.alpha ? "RGBA" : "RGB"}` + (job.field ? `, body ${job.parts[0].width} px` : "") +
                           (sizes.length ? `, text at ${sizes.join(", ")} px` : "");
    console.log(`ok   ${job.rel} (${what})`);
  }
  for (const rel of removeStale(folder, readRasterRecord(folder), new Set(Object.keys(files)))) console.log(`removed ${rel} (no longer an output)`);
  writeFileSync(path.join(folder, RASTER_RECORD), JSON.stringify({
    $generated: `generated by ${SELF} — do not edit; \`${KIT} check\` compares it with the files and the SVGs under render/`,
    format: RASTER_RECORD_FORMAT, renderer: VERSION, playwright: version, chromium, files }, null, 2) + "\n");
  console.log(`${jobs.length} raster file(s) and ${RASTER_RECORD} written to ${folder} (renderer ${VERSION}, Playwright ${version ?? "?"}, Chromium ${chromium})`);
  return 0;
}

// ------------------------------------------------------------------------- share images of a profile copy
async function share(argv) {
  const copy = path.resolve(HERE, "..");
  if (!argv.length || argv[0].startsWith("-")) {
    throw new UsageError(`usage: node ${SELF} share <folder> --pages <page list> --out <dir> …   (the arguments of ${SHARE_GENERATOR})`);
  }
  if (!existsSync(path.join(copy, SHARE_GENERATOR))) {
    throw new UsageError(`no ${SHARE_GENERATOR} in ${copy}: share images need a copy of the profile website or webapp with the pack share-images`);
  }
  const folder = path.resolve(argv[0]), recordFile = path.join(folder, RECORD), tileFile = path.join(folder, "sign", "tile.svg");
  if (!existsSync(recordFile)) throw new UsageError(`no ${RECORD} in ${folder}: run ${KIT} build first`);
  let id;
  try { id = JSON.parse(readFileSync(recordFile, "utf8")).product; } catch (e) { throw new UsageError(`${recordFile}: invalid JSON (${e.message})`); }
  if (typeof id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new UsageError(`${recordFile} names no product`);
  if (!existsSync(tileFile)) throw new UsageError(`no sign/tile.svg in ${folder}: the declaration's outputs need "web" (or "desktop")`);
  const tile = readFileSync(tileFile, "utf8"), title = /<title>([^<]*)<\/title>/.exec(tile);
  if (!title) throw new UsageError(`${tileFile} has no <title> (the product's name)`);
  const stage = realpathSync(mkdtempSync(path.join(tmpdir(), "sebaro-share-")));
  try {
    for (const rel of SHARE_READS) {
      if (!existsSync(path.join(copy, rel))) throw new UsageError(`missing in ${copy}: ${rel}`);
      cpSync(path.join(copy, rel), path.join(stage, rel), { recursive: true });
    }
    // the tile as the generator reads it: the name as aria-label (the title holds it XML-escaped already)
    writeFileSync(path.join(stage, "brand", "inline", `tile-${id}.svg`),
                  tile.replace(/^<svg\b/, `<svg aria-label="${title[1].replace(/"/g, "&quot;")}"`));
    const modules = playwrightModules(folder);      // 1.2.0: the generator looks from the stage
    if (modules) symlinkSync(modules, path.join(stage, "node_modules"), "junction");
    const generator = await import(pathToFileURL(path.join(stage, SHARE_GENERATOR)).href);
    return await generator.main(argv.slice(1));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------- main
export async function main(argv) {
  try {
    if (argv.includes("--version") && argv[0] !== "share") { console.log(`render.mjs ${VERSION}`); return 0; }
    if (argv[0] === "share") return await share(argv.slice(1));
    const unknown = argv.filter((a) => a.startsWith("-"));
    if (unknown.length || argv.length !== 1) {
      throw new UsageError(unknown.length ? `unknown argument ${unknown[0]}` : `usage: node ${SELF} <folder>   (the output folder of ${KIT} build)`);
    }
    const folder = path.resolve(argv[0]);
    if (!existsSync(folder)) throw new UsageError(`${argv[0]} is not a folder: run ${KIT} build first`);
    return await render(realpathSync(folder));
  } catch (e) {
    if (e instanceof UsageError) { console.error(`error: ${e.message}`); return 2; }
    console.error(`error: ${e.stack || e}`);
    return 1;
  }
}

// run as a script (also through a symbolic link such as macOS /var -> /private/var), not when imported
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
