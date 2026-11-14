#!/usr/bin/env node
// update-copy.mjs: fetches a public copy of the sebaro design system and writes or updates a profile copy with it.
// Node 20+, built-ins only (node:fs, node:path, node:crypto, node:zlib, fetch). Shipped by tools/export_system.py as
// checks/update-copy.mjs in every profile copy, and published with every release as a file of its own for the first
// fetch; the source lives in sebaroDesign tools/. tools/release_copies.py builds what it reads.
//
//   node update-copy.mjs --profile android [--packs a,b] --out sebaro [--release v1.14.3]   # the first copy
//   node sebaro/checks/update-copy.mjs                     # in place: the newest release, the copy's profile and packs
//   node sebaro/checks/update-copy.mjs --packs a,b         # the same with another choice (all: every pack, none: the core)
//   node sebaro/checks/update-copy.mjs --release v1.14.3   # one release, not the newest
//   node sebaro/checks/update-copy.mjs --check             # changes nothing; exit 1 when a newer release exists
//
// A release is four kinds of file: copies.json (the index: the tag, and per profile its archive with bytes and
// sha256 and its packs with what they hold and need), sebaro-<profile>.tar.gz (the copy of that profile with every
// pack, its record sebaro-export.json, and .sebaro-cut.json, the cut plan), CHANGES.md (what changed for a product
// with each release, one section per tag; every copy holds it too) and this file. They are read from
// RELEASES below: <RELEASES>/latest/download/<file>, with --release <tag> <RELEASES>/download/<tag>/<file>. --from
// <folder or URL> or the environment variable SEBARO_COPIES names another place: a URL with the same two paths, or a
// folder that holds the files of one release (with --release <tag> also <folder>/<tag>/).
//
// What it writes is, file for file and byte for byte, what the maintainers' export of that release writes for the
// same profile and packs (`export_system.py --profile P --packs X --from-commit <tag>`). It only selects and joins:
// a file belongs to the core or to one pack (the record says which), and the one stylesheet is the stretches of the
// chosen packs, which the cut plan gives as byte ranges of the archive's stylesheet with their sha256. The record it
// writes differs from the export's in `date` (the day this copy was written), in `release` (the tag, the archive
// with its sha256, this updater and where the release came from; only a fetched copy has it) and in the gzip
// figures of `cssSizes` (`gzip`, `gzipBytes` and `minifiedGzipBytes`, which name the compressor of the machine that
// wrote the copy; `bytes` and `minifiedBytes` are measured here and are the export's numbers).
//
// After an update it prints the sections of CHANGES.md between the release the copy had and the new one: what
// changed for a product and what to do. --check prints their headings when a newer release exists.
//
// It checks the sha256 and the size of the archive against the index, the sha256 of every file against the release's
// record and of every stretch against the cut plan, writes the copy into a temporary folder beside the target, reads
// it back, and swaps the two at the end: a run that fails leaves the old copy as it was. It refuses to replace a
// copy in which a recorded file is edited or missing or a file was added (the test of verify-export.mjs --strict);
// --force replaces it anyway. What is not the copy's stays: dotfiles and dot folders, and with --force a file the old
// record does not name (unless the release writes a file of that path).
//
// Exit codes: 0 the copy was written, or with --check it is at the newest release · 1 --check: a newer release
// exists (both versions are printed) · 2 usage: an unknown option, profile or pack, a pack without a pack it needs,
// a folder that is no profile copy · 3 refused: the copy has an edited, missing or added file (--force) · 4 the
// release cannot be read or does not verify: no such release, a failed download, a sha256 or size that does not
// match, a broken archive, an index or cut plan of a format this file does not read; nothing was changed.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const VERSION = "1.2.0"; // 1.2.0 (sebaro CHECKS.md §125, the owner 2026-11-13): reads the releases of grundhofer/sebaro-blueprint, the guide's new name; GitHub forwards the old address, so a copy of v1.14.0 still finds a newer release; 1.1.0 (D148 stage 6c, sebaro CHECKS.md §120): prints the change notes (CHANGES.md) between two releases, --check their headings; measures the minified sizes of the stylesheets (cssSizes); its refusal names no repository; 1.0.0 (D148 stage 6b, sebaro CHECKS.md §119): the first version
const RELEASES = "https://github.com/grundhofer/sebaro-blueprint/releases"; // where the public copies are
const SOURCE_ENV = "SEBARO_COPIES";
const INDEX_NAME = "copies.json";
const INDEX_SCHEMA = "1"; // the major version of copies.json and of the cut plan this file reads
const MANIFEST_NAME = "sebaro-export.json";
const FORMAT_VERSION = "1.0"; // of sebaro-export.json (export_system.py FORMAT_VERSION)
const CUT_NAME = ".sebaro-cut.json"; // in the archive, never in a copy
const CHANGES_NAME = "CHANGES.md"; // in every copy and beside the archives: what changed for a product per release
const ALL_PACKS = "all";
const NO_PACKS = "none";
const FETCH_TIMEOUT_MS = 120000;

const USAGE = "usage: node update-copy.mjs [--profile P] [--packs a,b|all|none] [--out DIR] [--release TAG]\n" +
  "                            [--from FOLDER|URL] [--check] [--force]\n" +
  "  --profile P    the profile of a new copy (a copy that exists keeps its own)\n" +
  "  --packs LIST   the packs the copy should hold, all or none (default: the copy's packs, none for a new one)\n" +
  "  --out DIR      the folder of the copy (default: the copy this file stands in)\n" +
  "  --release TAG  that release (default: the newest)\n" +
  `  --from SRC     a folder or a URL in place of ${RELEASES} (or $${SOURCE_ENV})\n` +
  "  --check        change nothing; exit 1 when a newer release exists\n" +
  "  --force        replace a copy with edited, missing or added files";

class UsageError extends Error {} // exit 2
class ArgumentError extends UsageError {} // exit 2, with the usage text
class Refused extends Error {} // exit 3
class ReleaseError extends Error {} // exit 4

function parseArgs(argv) {
  const a = { profile: null, packs: null, out: null, release: null, from: null, check: false, force: false };
  const valued = { "--profile": "profile", "--packs": "packs", "--out": "out", "--release": "release", "--from": "from" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--version") {
      console.log(`update-copy.mjs ${VERSION}`);
      process.exit(0);
    } else if (arg === "--check") a.check = true;
    else if (arg === "--force") a.force = true;
    else if (arg in valued) {
      if (i + 1 >= argv.length) throw new ArgumentError(`${arg} needs a value`);
      a[valued[arg]] = argv[++i];
    } else if (arg.startsWith("--") && arg.includes("=") && arg.slice(0, arg.indexOf("=")) in valued) {
      a[valued[arg.slice(0, arg.indexOf("="))]] = arg.slice(arg.indexOf("=") + 1);
    } else throw new ArgumentError(`unknown argument ${arg}`);
  }
  if (a.from === "") throw new ArgumentError("--from needs a folder or a URL");
  if (a.check && (a.packs !== null || a.force)) {
    throw new ArgumentError("--check changes nothing: it takes no --packs and no --force");
  }
  return a;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function parseJson(data, what) {
  try {
    return JSON.parse(data.toString("utf8"));
  } catch (e) {
    throw new ReleaseError(`${what} is not valid JSON: ${e.message}`);
  }
}

// ----------------------------------------------------------------------------------------------- the release

// Where the files of a release are: a folder, or a URL with /latest/download/ and /download/<tag>/ below it.
function source(from) {
  const src = (from ?? (process.env[SOURCE_ENV] || RELEASES)).replace(/\/+$/, ""); // an empty variable is no source
  if (/^https?:\/\//i.test(src)) return { url: src, label: src };
  const folder = path.resolve(src.startsWith("file://") ? new URL(src).pathname : src);
  let isDir = false;
  try {
    isDir = fs.statSync(folder).isDirectory();
  } catch {
    // no such folder
  }
  if (!isDir) {
    throw new UsageError(`${folder} is no folder (--from, $${SOURCE_ENV}: a folder with the files of a release, or a URL)`);
  }
  return { folder, label: "a local folder" };
}

async function fetchFile(src, release, name) {
  if (src.folder) {
    const tagged = release ? path.join(src.folder, release) : null;
    const dir = tagged && fs.existsSync(path.join(tagged, INDEX_NAME)) ? tagged : src.folder;
    const file = path.join(dir, name);
    try {
      return fs.readFileSync(file);
    } catch (e) {
      throw new ReleaseError(`${file} cannot be read (${e.code ?? e.message})`);
    }
  }
  const url = `${src.url}/${release ? `download/${encodeURIComponent(release)}` : "latest/download"}/${name}`;
  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": `sebaro-update-copy/${VERSION}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ReleaseError(`${url} could not be fetched: ${e.cause?.message ?? e.message}`);
  }
  if (!res.ok) {
    const none = res.status === 404 ? " (no such release, or it has no such file)" : "";
    throw new ReleaseError(`${url}: HTTP ${res.status}${none}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function readIndex(src, release) {
  const index = parseJson(await fetchFile(src, release, INDEX_NAME), INDEX_NAME);
  const ok = index !== null && typeof index === "object" && typeof index.tag === "string" &&
    index.profiles !== null && typeof index.profiles === "object";
  if (!ok) throw new ReleaseError(`${INDEX_NAME} is no index of a release (no tag, no profiles)`);
  if (String(index.schemaVersion).split(".")[0] !== INDEX_SCHEMA) {
    throw new ReleaseError(`${INDEX_NAME} has schemaVersion ${JSON.stringify(index.schemaVersion)}, this updater ` +
      `(${VERSION}) reads ${INDEX_SCHEMA}.x: fetch update-copy.mjs of release ${index.tag} and run that one`);
  }
  if (release && index.tag !== release) {
    throw new ReleaseError(`${src.label} holds release ${index.tag}, not ${release}`);
  }
  return index;
}

// The packs of a profile to write, in the order of the index. `asked` is null (keep `had`), all, none or names.
function choosePacks(index, profile, asked, had) {
  const entry = index.profiles[profile];
  const packs = Array.isArray(entry.packs) ? entry.packs : [];
  const names = packs.map((p) => p.name);
  const list = names.join(", ") || "none";
  let want;
  if (asked === null) {
    want = had ?? [];
    const gone = want.filter((n) => !names.includes(n));
    if (gone.length) {
      throw new UsageError(`this copy holds the pack ${gone.map((n) => `'${n}'`).join(", ")}, which the profile ` +
        `${profile} of release ${index.tag} does not have (packs: ${list}): name the packs with --packs`);
    }
  } else {
    const given = [...new Set(asked.split(",").map((s) => s.trim()).filter(Boolean))];
    if (!given.length) throw new UsageError(`--packs needs pack names separated by commas, ${ALL_PACKS} or ${NO_PACKS}`);
    if (given.includes(ALL_PACKS) || given.includes(NO_PACKS)) {
      const word = given.includes(ALL_PACKS) ? ALL_PACKS : NO_PACKS;
      if (given.length > 1) throw new UsageError(`--packs ${word} stands alone`);
      want = given[0] === ALL_PACKS ? names : [];
    } else {
      const unknown = given.filter((n) => !names.includes(n));
      if (unknown.length) {
        throw new UsageError(`profile ${profile} of release ${index.tag} has no pack ` +
          `${unknown.map((n) => `'${n}'`).join(", ")} (packs: ${list})`);
      }
      want = given;
    }
  }
  const chosen = names.filter((n) => want.includes(n));
  for (const pack of packs) {
    if (!chosen.includes(pack.name)) continue;
    const missing = (pack.needs ?? []).filter((n) => !chosen.includes(n));
    if (missing.length) {
      throw new UsageError(`pack '${pack.name}' of profile ${profile} needs pack ` +
        `${missing.map((n) => `'${n}'`).join(", ")}: a pack is refused without the packs it needs; ` +
        `--packs ${names.filter((n) => chosen.includes(n) || missing.includes(n)).join(",")} (packs: ${list})`);
    }
  }
  return chosen;
}

// ----------------------------------------------------------------------------------------------- the archive

// The regular files of a plain ustar archive as a Map of path -> bytes. Anything but files and folders is refused.
function untar(buf, what) {
  const files = new Map();
  const text = (from, len) => {
    const field = buf.subarray(from, from + len);
    const end = field.indexOf(0);
    return field.subarray(0, end < 0 ? len : end).toString("utf8");
  };
  let at = 0;
  while (at + 512 <= buf.length) {
    const head = buf.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break; // the end of the archive
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : head[i];
    if (text(at + 257, 5) !== "ustar" || parseInt(text(at + 148, 8).trim(), 8) !== sum) {
      throw new ReleaseError(`${what} is no ustar archive (a broken header at byte ${at})`);
    }
    const size = parseInt(text(at + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(head[156] || 48);
    const prefix = text(at + 345, 155);
    const name = (prefix ? `${prefix}/` : "") + text(at, 100);
    at += 512;
    if (type === "5") continue; // a folder
    if (type !== "0") throw new ReleaseError(`${what}: ${name} is no plain file (tar type ${JSON.stringify(type)})`);
    if (!Number.isFinite(size) || at + size > buf.length) throw new ReleaseError(`${what} ends inside ${name}`);
    if (!safePath(name)) throw new ReleaseError(`${what}: ${JSON.stringify(name)} is no path inside a copy`);
    if (files.has(name)) throw new ReleaseError(`${what} holds ${name} twice`);
    files.set(name, buf.subarray(at, at + size));
    at += Math.ceil(size / 512) * 512;
  }
  return files;
}

function safePath(p) {
  return typeof p === "string" && p !== "" && !p.startsWith("/") && !p.includes("\\") && !/^[A-Za-z]:/.test(p) &&
    p.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

// The stylesheet of a copy: the head every copy has, then the stretches of the core and of the chosen packs in
// their order, joined by a line feed, or by an empty line where the source had one between them.
function joinCss(whole, css, chosen) {
  const out = [whole.subarray(0, css.bodyStart)];
  let gap = false;
  let any = false;
  for (const s of css.stretches) {
    if (s.pack !== null && !chosen.includes(s.pack)) continue;
    if (s.end === s.start) {
      gap = true; // a stretch of blank lines only
      continue;
    }
    if (any) out.push(Buffer.from(gap || s.blankBefore ? "\n\n" : "\n"));
    out.push(whole.subarray(s.start, s.end));
    gap = s.blankAfter === true;
    any = true;
  }
  out.push(Buffer.from("\n"));
  return Buffer.concat(out);
}

// Reads and checks an archive: every file of its record is there with the recorded sha256, nothing else is, the cut
// plan fits it. Returns { record, cut, files }.
function openArchive(data, index, profile, name) {
  let tar;
  try {
    tar = zlib.gunzipSync(data);
  } catch (e) {
    throw new ReleaseError(`${name} is no gzip file: ${e.message}`);
  }
  const files = untar(tar, name);
  for (const need of [MANIFEST_NAME, CUT_NAME]) {
    if (!files.has(need)) throw new ReleaseError(`${name} has no ${need}`);
  }
  const record = parseJson(files.get(MANIFEST_NAME), `${MANIFEST_NAME} of ${name}`);
  const cut = parseJson(files.get(CUT_NAME), `${CUT_NAME} of ${name}`);
  if (record?.format !== FORMAT_VERSION || !Array.isArray(record.files) || record.profile !== profile) {
    throw new ReleaseError(`${MANIFEST_NAME} of ${name} is no record of a copy of the profile ${profile} ` +
      `in format ${FORMAT_VERSION}`);
  }
  if (String(cut?.format).split(".")[0] !== INDEX_SCHEMA || cut.profile !== profile || cut.tag !== index.tag) {
    throw new ReleaseError(`${CUT_NAME} of ${name} is not the cut plan of the profile ${profile} of release ` +
      `${index.tag} in a format this updater (${VERSION}) reads`);
  }
  const packs = (index.profiles[profile].packs ?? []).map((p) => p.name);
  if (JSON.stringify(record.packsAvailable ?? []) !== JSON.stringify(packs) ||
      JSON.stringify(record.packs ?? []) !== JSON.stringify(packs)) {
    throw new ReleaseError(`${name} does not hold the packs ${INDEX_NAME} names for the profile ${profile}`);
  }
  const listed = new Set([MANIFEST_NAME, CUT_NAME]);
  for (const f of record.files) {
    if (!safePath(f?.path) || listed.has(f.path)) {
      throw new ReleaseError(`${MANIFEST_NAME} of ${name} names ${JSON.stringify(f?.path)}`);
    }
    listed.add(f.path);
    const bytes = files.get(f.path);
    if (!bytes) throw new ReleaseError(`${name} lacks ${f.path}, which its record names`);
    if (sha256(bytes) !== f.sha256) {
      throw new ReleaseError(`${name}: ${f.path} does not have the sha256 of the release's record`);
    }
    if (f.pack !== undefined && !packs.includes(f.pack)) {
      throw new ReleaseError(`${name}: ${f.path} belongs to an unknown pack ${f.pack}`);
    }
  }
  for (const p of files.keys()) {
    if (!listed.has(p)) throw new ReleaseError(`${name} holds ${p}, which its record does not name`);
  }
  if (cut.css) {
    const whole = files.get(cut.css.path);
    const sane = whole && Number.isInteger(cut.css.bodyStart) && Array.isArray(cut.css.stretches) &&
      cut.css.stretches.every((s) => Number.isInteger(s.start) && Number.isInteger(s.end) &&
        cut.css.bodyStart <= s.start && s.start <= s.end && s.end <= whole.length &&
        (s.pack === null || packs.includes(s.pack)));
    if (!sane) throw new ReleaseError(`${CUT_NAME} of ${name} does not fit ${cut.css?.path}`);
    for (const s of cut.css.stretches) {
      if (sha256(whole.subarray(s.start, s.end)) !== s.sha256) {
        throw new ReleaseError(`${name}: a stretch of ${cut.css.path} (${s.unit}) does not have the sha256 ` +
          "of the cut plan");
      }
    }
    // this Node joins the stretches as the workshop does: with every pack it is the archive's file, with none the core's
    if (!joinCss(whole, cut.css, packs).equals(whole) || sha256(joinCss(whole, cut.css, [])) !== cut.css.check?.core) {
      throw new ReleaseError(`${name}: the stretches of ${cut.css.path} do not join to the stylesheets ` +
        "the cut plan names");
    }
  }
  return { record, cut, files };
}

// TEXT without comments and without the white space a browser does not need, step for step css_minify of
// tools/export_profiles.py: the measure of `minifiedBytes` in the record.
function minifyCss(text) {
  const out = [];
  let space = false;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") {
      const j = text.indexOf("*/", i + 2);
      i = j < 0 ? text.length : j + 2;
      space = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      space = true;
      i++;
      continue;
    }
    let token = c;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      token = text.slice(i, j + 1);
      i = j + 1;
    } else i++;
    const prev = out.length ? out[out.length - 1] : "";
    const last = prev ? prev[prev.length - 1] : "";
    if (space && last && !"{};,:".includes(last) && !"{};,".includes(token)) out.push(" ");
    space = false;
    if (token === "}" && last === ";") out.pop();
    out.push(token);
  }
  return out.join("");
}

function today() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// The files and the record of the copy with the chosen packs, cut from the archive.
function cutCopy(archive, chosen, release) {
  const { record, cut, files } = archive;
  const out = [];
  const rows = [];
  for (const f of record.files) {
    if (f.pack !== undefined && !chosen.includes(f.pack)) continue;
    let bytes = files.get(f.path);
    let row = f;
    if (cut.css && f.path === cut.css.path) {
      bytes = joinCss(bytes, cut.css, chosen);
      row = { ...f, sha256: sha256(bytes), bytes: bytes.length };
    }
    out.push([f.path, bytes]);
    rows.push(row);
  }
  const rec = {};
  for (const [key, value] of Object.entries(JSON.parse(JSON.stringify(record)))) {
    rec[key] = value;
    if (key === "packsAvailable") rec.release = release;
  }
  if (!("release" in rec)) rec.release = release;
  rec.date = today();
  rec.packs = chosen;
  rec.files = rows;
  for (const rule of cut.recordOnlyWith ?? []) {
    if (chosen.includes(rule.pack)) continue;
    const keys = [...rule.key];
    let node = rec;
    while (keys.length > 1 && node !== null && typeof node === "object") node = node[keys.shift()];
    if (node === null || typeof node !== "object") continue;
    if ("item" in rule) {
      if (Array.isArray(node[keys[0]])) node[keys[0]] = node[keys[0]].filter((x) => x !== rule.item);
    } else delete node[keys[0]];
  }
  if (cut.css && rec.cssSizes && Array.isArray(rec.cssSizes.files)) {
    rec.cssSizes.gzip = `gzip level 9, mtime 0, zlib ${process.versions.zlib}`;
    rec.cssSizes.files = rec.cssSizes.files.map((row) => {
      const hit = out.find(([p]) => p === row.path);
      if (!hit) return row;
      const sized = { ...row, bytes: hit[1].length, gzipBytes: zlib.gzipSync(hit[1], { level: 9 }).length };
      if ("minifiedBytes" in row) {
        const small = Buffer.from(minifyCss(hit[1].toString("utf8")), "utf8");
        sized.minifiedBytes = small.length;
        sized.minifiedGzipBytes = zlib.gzipSync(small, { level: 9 }).length;
      }
      return sized;
    });
  }
  return { files: out, record: rec, text: JSON.stringify(rec, null, 2) + "\n" };
}

// ----------------------------------------------------------------------------------------------- the copy on disk

function readRecord(dir) {
  const file = path.join(dir, MANIFEST_NAME);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let rec;
  try {
    rec = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON: ${e.message}`);
  }
  if (rec === null || typeof rec !== "object" || !Array.isArray(rec.files)) {
    throw new UsageError(`${file} is not an export record`);
  }
  if (rec.format !== FORMAT_VERSION) {
    throw new UsageError(`${file} has format ${JSON.stringify(rec.format)}, not "${FORMAT_VERSION}"`);
  }
  if (typeof rec.profile !== "string") {
    throw new UsageError(`${dir} is an export without a profile (export_system.py --target): the updater writes ` +
      "profile copies; write a profile copy into another folder");
  }
  return rec;
}

// Files below dir as posix paths, without dotfiles and anything in a dot folder (as verify-export.mjs).
function visibleFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), r);
      else out.push(r);
    }
  };
  walk(dir, "");
  return out.sort();
}

// What verify-export.mjs --strict reports: a recorded file edited or missing, a file the record does not name.
function localChanges(dir, rec) {
  const found = [];
  const recorded = new Map(rec.files.map((f) => [f.path, f]));
  for (const p of [...recorded.keys()].sort()) {
    if (!safePath(p)) {
      found.push(`outside the copy: ${p}`);
      continue;
    }
    let bytes = null;
    try {
      if (fs.statSync(path.join(dir, p)).isFile()) bytes = fs.readFileSync(path.join(dir, p));
    } catch {
      // missing
    }
    if (bytes === null) found.push(`missing: ${p}`);
    else if (sha256(bytes) !== recorded.get(p).sha256) found.push(`edited: ${p}`);
  }
  for (const rel of visibleFiles(dir)) {
    if (rel !== MANIFEST_NAME && !recorded.has(rel)) found.push(`not part of the copy: ${rel}`);
  }
  return found;
}

// Moves what is not the old copy's from `old` into `dir`: dotfiles and dot folders, and files the old record does
// not name. A path the new copy writes keeps the new file. Returns the paths that were not carried over.
function carryOver(old, dir, owned) {
  const dropped = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(old, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        walk(r);
        continue;
      }
      if (!entry.name.startsWith(".") && owned.has(r)) continue; // the old copy's own file
      const to = path.join(dir, r);
      if (fs.existsSync(to)) {
        dropped.push(r);
        continue;
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(path.join(old, r), to);
    }
  };
  walk("");
  return dropped;
}

// Writes the copy into a folder beside `dir`, reads it back, then swaps. Throws before the swap leaves `dir` whole.
function writeCopy(dir, copy, oldRec) {
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  const tmp = path.join(parent, `.${base}.update-${process.pid}`);
  const old = path.join(parent, `.${base}.old-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    fs.mkdirSync(tmp, { recursive: true });
    for (const [p, bytes] of [...copy.files, [MANIFEST_NAME, Buffer.from(copy.text, "utf8")]]) {
      const to = path.join(tmp, p);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, bytes);
    }
    for (const row of copy.record.files) {
      if (sha256(fs.readFileSync(path.join(tmp, row.path))) !== row.sha256) {
        throw new ReleaseError(`${row.path} was not written as the release has it (read back from ${tmp})`);
      }
    }
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e instanceof ReleaseError ? e : new ReleaseError(`the copy could not be written beside ${dir}: ${e.message}`);
  }
  const existed = fs.existsSync(dir);
  try {
    if (existed) fs.renameSync(dir, old);
    try {
      fs.renameSync(tmp, dir);
    } catch (e) {
      if (existed) fs.renameSync(old, dir); // put the old copy back
      throw e;
    }
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new ReleaseError(`the new copy could not take the place of ${dir}: ${e.message}`);
  }
  if (!existed) return [];
  const owned = new Set([MANIFEST_NAME, ...(oldRec?.files ?? []).map((f) => f.path)]);
  let dropped;
  try {
    dropped = carryOver(old, dir, owned);
  } catch (e) {
    throw new ReleaseError(`the new copy is in ${dir}, but files that were not the old copy's could not be moved ` +
      `into it (${e.message}); they are in ${old}`);
  }
  fs.rmSync(old, { recursive: true, force: true });
  return dropped;
}

// ----------------------------------------------------------------------------------------------- versions

// v1.14.3 or 1.14.3-rc.1 as [major, minor, patch, isRelease, pre]; null when the tag is no version.
function version(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? 0 : 1, m[4] ?? ""] : null;
}

// 1 when tag b is newer than tag a, -1 when older, 0 when the same; null when one of them is no version.
function newer(a, b) {
  if (a === b) return 0;
  const x = version(a);
  const y = version(b);
  if (!x || !y) return null;
  for (let i = 0; i < 5; i++) {
    if (x[i] !== y[i]) return (i < 4 ? y[i] > x[i] : y[i].localeCompare(x[i], "en", { numeric: true }) > 0) ? 1 : -1;
  }
  return 0;
}

// The sections of a CHANGES.md in the order of the file: { tag, text }, a section from its heading `## v1.14.0` to
// the next one.
function changeSections(text) {
  const heads = [...text.matchAll(/^## (v\d+\.\d+\.\d+)[ \t]*$/gm)];
  return heads.map((m, n) => ({
    tag: m[1],
    text: text.slice(m.index + m[0].length, n + 1 < heads.length ? heads[n + 1].index : text.length).trim(),
  }));
}

// The sections a copy reads on its way from release `from` to release `to`: newer than `from`, not newer than the
// version of `to` (a release with a label, v1.14.0-rc.1, stands under the section of its version). Without a known
// `from` (a copy that records no release): the section of `to` alone.
function changesBetween(sections, from, to) {
  const v = version(to);
  const upTo = v ? `v${v[0]}.${v[1]}.${v[2]}` : to;
  if (from === null || version(from) === null) return sections.filter((s) => s.tag === upTo);
  return sections.filter((s) => newer(from, s.tag) === 1 && newer(s.tag, upTo) !== -1);
}

// After an update: what changed for a product, from the copy's own CHANGES.md. `from` is undefined for a new copy.
function printChanges(text, from, to) {
  if (from === undefined) {
    console.log(`    what changed for a product with each release: ${CHANGES_NAME} in the copy`);
    return;
  }
  const sections = changesBetween(changeSections(text), from, to);
  if (!sections.length) return;
  console.log(`\nchanges for a product ${from ? `from ${from} to ${to}` : `in ${to}`} (${CHANGES_NAME} in the copy):`);
  for (const s of sections) console.log(`\n## ${s.tag}\n\n${s.text}`);
}

// With --check and a newer release: the headings of the sections the update would print, from the release's own
// CHANGES.md. A release without one, or a file that cannot be read, changes nothing about the check.
async function printChangeHeadings(src, release, index, from) {
  const entry = index.changes;
  if (!entry || typeof entry.file !== "string" || path.basename(entry.file) !== entry.file) return;
  let data;
  try {
    data = await fetchFile(src, release, entry.file);
  } catch (e) {
    console.log(`    (${entry.file} of the release could not be read: ${e.message})`);
    return;
  }
  if (data.length !== entry.bytes || sha256(data) !== entry.sha256) {
    console.log(`    (${entry.file} is not the file ${INDEX_NAME} names; its sections are not shown)`);
    return;
  }
  const sections = changesBetween(changeSections(data.toString("utf8")), from, index.tag);
  if (!sections.length) return;
  console.log(`    what changed for a product (${entry.file} of the release; the update prints the sections):`);
  for (const s of sections) console.log(`        ## ${s.tag}`);
}

// The release a copy is at: the one it records, or the index's when the copy was written from the same commit.
function releaseOf(rec, index) {
  const commit = rec.sebaroDesign?.commit;
  return rec.release?.tag ?? (commit && commit === index.commit ? index.tag : null);
}

function describe(rec) {
  return `profile ${rec.profile}, packs ${(rec.packs ?? []).join(", ") || "none"}`;
}

function check(dir, rec, index) {
  const commit = rec.sebaroDesign?.commit;
  const at = releaseOf(rec, index);
  const has = at ?? `no release (written by ${rec.tool ?? "an export"} from commit ` +
    `${commit ? commit.slice(0, 12) : "unknown"})`;
  const order = at ? newer(at, index.tag) : null;
  if (order === 0) {
    console.log(`up to date: ${dir} is at release ${at}, the newest (${describe(rec)})`);
    return 0;
  }
  if (order === -1) {
    console.log(`up to date: ${dir} is at release ${at}, which is newer than the release found, ${index.tag} ` +
      `(${describe(rec)})`);
    return 0;
  }
  console.log(`update available: ${dir} is at ${at ? `release ${has}` : has}, the newest release is ${index.tag} ` +
    `(${describe(rec)})`);
  console.log("    to update: node update-copy.mjs --out <this copy>, or the copy's own checks/update-copy.mjs");
  return 1;
}

// ----------------------------------------------------------------------------------------------- main

async function run(argv) {
  const a = parseArgs(argv);
  const here = import.meta.dirname ?? fs.realpathSync(new URL(".", import.meta.url));
  const inCopy = fs.existsSync(path.join(here, "..", MANIFEST_NAME)) ? path.resolve(here, "..") : null;
  if (a.out === null && inCopy === null) {
    throw new UsageError("--out DIR is needed: this file does not stand in a copy (checks/update-copy.mjs of a " +
      "copy updates that copy)");
  }
  const dir = path.resolve(a.out ?? inCopy);
  let rec = null;
  if (fs.existsSync(dir)) {
    if (!fs.statSync(dir).isDirectory()) throw new UsageError(`${dir} exists and is not a folder`);
    rec = readRecord(dir);
    if (rec === null && fs.readdirSync(dir).some((n) => !n.startsWith("."))) {
      throw new UsageError(`${dir} is not empty and no copy (no ${MANIFEST_NAME}): name a new or an empty folder`);
    }
  }
  if (a.check && rec === null) throw new UsageError(`--check needs a copy: ${dir} has no ${MANIFEST_NAME}`);
  if (rec && a.profile !== null && a.profile !== rec.profile) {
    throw new UsageError(`${dir} is a copy of the profile ${rec.profile}: a copy keeps its profile (write the profile ` +
      `${a.profile} into another folder)`);
  }
  const profile = rec?.profile ?? a.profile;
  if (profile === null) throw new UsageError("a new copy needs --profile");
  const src = source(a.from);
  const index = await readIndex(src, a.release);
  if (!Object.hasOwn(index.profiles, profile)) {
    throw new UsageError(`release ${index.tag} has no profile '${profile}' ` +
      `(profiles: ${Object.keys(index.profiles).join(", ")})`);
  }
  if (rec?.system?.slug && index.system?.slug && rec.system.slug !== index.system.slug) {
    throw new UsageError(`${dir} is a copy of the system ${rec.system.slug}, release ${index.tag} is of ` +
      `${index.system.slug}`);
  }
  if (a.check) {
    const code = check(dir, rec, index);
    if (code === 1) await printChangeHeadings(src, a.release, index, releaseOf(rec, index));
    return code;
  }

  const chosen = choosePacks(index, profile, a.packs, rec?.packs ?? null);
  if (rec && !a.force) {
    const changes = localChanges(dir, rec);
    if (changes.length) {
      throw new Refused(`${dir} has local changes; nothing was written (undo them, or run again with --force; a ` +
        `change the system should have goes to its maintainers):\n    ${changes.join("\n    ")}`);
    }
  }
  const entry = index.profiles[profile];
  const name = entry.file;
  if (typeof name !== "string" || path.basename(name) !== name) {
    throw new ReleaseError(`${INDEX_NAME} names no archive for the profile ${profile}`);
  }
  const data = await fetchFile(src, a.release, name);
  if (data.length !== entry.bytes || sha256(data) !== entry.sha256) {
    throw new ReleaseError(`${name} is not the file ${INDEX_NAME} names: ${data.length} bytes with sha256 ` +
      `${sha256(data)}, expected ${entry.bytes} bytes with ${entry.sha256}`);
  }
  const archive = openArchive(data, index, profile, name);
  const copy = cutCopy(archive, chosen, {
    tag: index.tag,
    asset: name,
    sha256: entry.sha256,
    updater: `update-copy.mjs ${VERSION}`,
    from: src.label,
  });
  const dropped = writeCopy(dir, copy, rec);
  const was = rec ? ` (was ${rec.release?.tag ?? "no release"}, ${describe(rec)})` : "";
  console.log(`wrote ${dir}: release ${index.tag}, ${describe(copy.record)}, ${copy.files.length} files + ` +
    `${MANIFEST_NAME}${was}`);
  for (const p of dropped) console.log(`    replaced by the release's file (the one that was here is not kept): ${p}`);
  if (inCopy === null && copy.files.some(([p]) => p === "checks/update-copy.mjs")) {
    console.log(`    from now on: node ${path.join(dir, "checks", "update-copy.mjs")} [--check]`);
  }
  const notes = archive.files.get(CHANGES_NAME);
  if (notes) printChanges(notes.toString("utf8"), rec ? rec.release?.tag ?? null : undefined, index.tag);
  return 0;
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 20) {
    console.error(`error: update-copy.mjs needs Node 20 or newer (this is ${process.versions.node})`);
    return 2;
  }
  try {
    return await run(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`error: ${e.message}` + (e instanceof ArgumentError ? `\n${USAGE}` : ""));
      return 2;
    }
    if (e instanceof Refused) {
      console.error(`refused: ${e.message}`);
      return 3;
    }
    if (e instanceof ReleaseError) {
      console.error(`error: ${e.message}. Nothing was changed.`);
      return 4;
    }
    throw e;
  }
}

process.exitCode = await main();
