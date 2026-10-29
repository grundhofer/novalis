#!/usr/bin/env node
// verify-export.mjs: checks a sebaro design export folder against its own record, sebaro-export.json.
// Node 20+, standard library only (node:fs, node:path, node:crypto). Shipped by tools/export_system.py as
// checks/verify-export.mjs in every web, tauri and android export; the source lives in sebaroDesign tools/.
//
//   node checks/verify-export.mjs              # the export folder one level above this script
//   node checks/verify-export.mjs DIR          # another export folder
//   node checks/verify-export.mjs --strict     # a file in the folder that the record does not name is an error too
//
// It checks what `export_system.py --verify DIR --files-only` checks, without Python and without a sebaroDesign
// checkout: every file listed in sebaro-export.json must exist and match its recorded sha256 ("missing in target",
// "edited in target"). A file in the folder that the record does not name is a warning, or an error with --strict.
// Never counted as such a file: sebaro-export.json itself, and dotfiles or anything inside a dot folder (.DS_Store,
// .git), which the export never writes. Not checked: whether the sources in sebaroDesign moved on, and the system's
// gates; the full `export_system.py --verify DIR` with a sebaroDesign checkout does that.
//
// Exit codes: 0 no errors (warnings allowed) · 1 errors: a missing or edited file, or with --strict an unlisted file ·
// 2 usage error, no such folder, or a missing or unreadable sebaro-export.json.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MANIFEST_NAME = "sebaro-export.json";
const FORMAT_VERSION = "1.0"; // the record format this checker reads (export_system.py FORMAT_VERSION)

const USAGE = "usage: node verify-export.mjs [DIR] [--strict]\n" +
  "  DIR       the export folder (default: the folder one level above this script)\n" +
  "  --strict  a file in DIR that sebaro-export.json does not name is an error, not a warning";

class UsageError extends Error {}

function parseArgs(argv) {
  let dir = null;
  let strict = false;
  for (const arg of argv) {
    if (arg === "--strict") strict = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith("-")) throw new UsageError(`unknown option ${arg}`);
    else if (dir !== null) throw new UsageError(`more than one folder given (${dir}, ${arg})`);
    else dir = arg;
  }
  // import.meta.dirname needs Node 20.11; older Node 20 resolves the script's folder from its URL
  const here = import.meta.dirname ?? fs.realpathSync(new URL(".", import.meta.url));
  return { dir: path.resolve(dir ?? path.join(here, "..")), strict };
}

function readRecord(dir) {
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new UsageError(`${dir} does not exist`);
  }
  if (!stat.isDirectory()) throw new UsageError(`${dir} is not a directory`);
  const file = path.join(dir, MANIFEST_NAME);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new UsageError(`${dir} has no readable ${MANIFEST_NAME} (${e.code ?? e.message}): not an export`);
  }
  let rec;
  try {
    rec = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON: ${e.message}`);
  }
  if (rec === null || typeof rec !== "object" || !Array.isArray(rec.files)) {
    throw new UsageError(`${file} is not an export record (no files list)`);
  }
  if (rec.format !== FORMAT_VERSION) {
    throw new UsageError(`${MANIFEST_NAME} format ${JSON.stringify(rec.format)} is not "${FORMAT_VERSION}"; ` +
      "re-export, or use the checker of the export that wrote it");
  }
  for (const f of rec.files) {
    if (f === null || typeof f !== "object" || typeof f.path !== "string" || typeof f.sha256 !== "string") {
      throw new UsageError(`${file}: a files entry without a path or sha256: ${JSON.stringify(f)}`);
    }
  }
  return rec;
}

// Files below dir as posix paths relative to it, sorted; without dotfiles and without anything in a dot folder.
// A symbolic link counts when it points at a file; linked folders are not entered.
function visibleFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const a = path.join(abs, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(a, r);
      else if (entry.isFile()) out.push(r);
      else if (entry.isSymbolicLink()) {
        try {
          if (fs.statSync(a).isFile()) out.push(r);
        } catch {
          // a broken link is no file
        }
      }
    }
  };
  walk(dir, "");
  return out.sort();
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function check(dir, rec, strict) {
  const errors = [];
  const warnings = [];
  const recorded = new Map(rec.files.map((f) => [f.path, f]));
  for (const p of [...recorded.keys()].sort()) {
    const rel = path.normalize(p);
    if (path.isAbsolute(p) || rel === ".." || rel.startsWith(`..${path.sep}`)) {
      errors.push(`outside the export folder: ${p}`); // a record never names such a path; refuse to read it
      continue;
    }
    const abs = path.join(dir, p);
    let isFile = false;
    try {
      isFile = fs.statSync(abs).isFile();
    } catch {
      // missing
    }
    if (!isFile) errors.push(`missing in target: ${p}`);
    else if (sha256(abs) !== recorded.get(p).sha256) errors.push(`edited in target: ${p}`);
  }
  for (const rel of visibleFiles(dir)) {
    if (rel === MANIFEST_NAME || recorded.has(rel)) continue;
    (strict ? errors : warnings).push(`not part of the export: ${rel}`);
  }
  return { errors, warnings, files: recorded.size };
}

function main() {
  let args, rec;
  try {
    args = parseArgs(process.argv.slice(2));
    rec = readRecord(args.dir);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`error: ${e.message}\n${USAGE}`);
    return 2;
  }
  const { errors, warnings, files } = check(args.dir, rec, args.strict);
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`FAIL  ${e}`);
  const what = `${rec.system?.slug ?? "?"} for ${rec.target ?? "?"}` + (rec.product ? `, product ${rec.product}` : "") +
    ` (exported ${rec.date ?? "?"} by ${rec.tool ?? "?"})`;
  const mode = args.strict ? ", strict" : "";
  const tail = " · source drift and gates NOT checked (export_system.py --verify with a sebaroDesign checkout)";
  if (errors.length) {
    console.log(`result: drift, ${errors.length} error(s), ${warnings.length} warning(s) (exit 1)${mode} · ` +
      `${args.dir}: ${what}${tail}`);
    return 1;
  }
  console.log(`result: up to date, ${files} files, ${warnings.length} warning(s)${mode} · ${args.dir}: ${what}${tail}`);
  return 0;
}

process.exitCode = main();
