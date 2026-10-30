import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
// `vitest/config` re-exports vite's `defineConfig` and adds the `test` key,
// so the tests compile through the same plugins and aliases as the app
// (ADR-0011). One config, one way for the build to be wrong.
import { defineConfig } from "vitest/config";

// The Tauri shell serves `dist/` from the app bundle; `just dev` runs this on
// 1420 (tauri.conf.json `devUrl`).
//
// Chunking is a budget decision (PLAN.md §11.3, scripts/bundle-budget.mjs):
// eager JS <= 250 KB gzip and no single eager chunk over 120 KB. Everything
// expensive — CodeMirror, the board pane, the palette, the German catalog — is
// behind a dynamic import, so it never reaches `index.html` as a modulepreload
// and never counts as eager. What is left (React, i18next, the shell) fits in
// one chunk, so there is no `manualChunks` here: splitting it further would
// only add requests.
// The catalogs live outside this package (`i18n/` at the repo root), and Vite
// only watches its own root: an edit to `en.json` while `just dev` runs was
// served from the module cache until the next restart, so a new key showed
// up as its own name in the running app. Watching the folder makes the edit a
// reload like any other.
const watchCatalogs = {
  name: "novalis:watch-i18n",
  configureServer(server: { watcher: { add(path: string): void } }) {
    // No node types in this tsconfig (browser lib only), so the folder is
    // resolved from the module URL rather than `node:path`.
    server.watcher.add(decodeURIComponent(new URL("../../../i18n", import.meta.url).pathname));
  },
};

// sebaro's classic scripts must run before the first paint or outside the
// module graph, so `index.html` loads them as classic `<script src>` tags
// (spec/09 §1, WEB-01, ADR-0051): `theme-init.js` ahead of every stylesheet,
// `sb-start.js` right after it (spec/03 §14), then `sb-tooltip.js` and
// `sb-menu.js` (ADR-0051 #21). Vite bundles only module scripts and leaves
// these tags as they are, so each file has to reach `/sebaro/js/<name>`
// itself: served from the export during `just dev`, copied byte for byte
// into `dist/` on build.
// The start tile in `index.html` is the export's own SVG, put where its
// `<!-- sb:inline src="…" -->` comment stands (sebaro's inlining convention,
// spec/03 §4.6), so the page carries no copy of it. The export folder is
// never edited (its files are checked by sha256).
const SEBARO_SCRIPTS = ["theme-init.js", "sb-start.js", "sb-tooltip.js", "sb-menu.js"];
const SEBARO_DIR = new URL("./src/sebaro/", import.meta.url);
const SB_INLINE = /<!-- sb:inline src="([\w./-]+)" -->/g;
const sebaroFile = (path: string) => decodeURIComponent(new URL(path, SEBARO_DIR).pathname);
const inlined = new Map<string, string>();
const sebaro: Plugin = {
  name: "novalis:sebaro",
  async buildStart() {
    // `index.html` is read here as well as by Vite: the inlined files are
    // known before its transform runs, in `just dev` and in a build.
    const html = new TextDecoder().decode(
      await this.fs.readFile(decodeURIComponent(new URL("./index.html", import.meta.url).pathname)),
    );
    for (const [, path] of html.matchAll(SB_INLINE)) {
      inlined.set(path!, new TextDecoder().decode(await this.fs.readFile(sebaroFile(path!))));
    }
  },
  transformIndexHtml(html) {
    return html.replace(SB_INLINE, (comment, path: string) => {
      const file = inlined.get(path);
      if (file === undefined) throw new Error(`novalis:sebaro: ${path} was not read (${comment})`);
      return file;
    });
  },
  configureServer(server) {
    for (const name of SEBARO_SCRIPTS) {
      server.middlewares.use(`/sebaro/js/${name}`, (_request, response, next) => {
        server
          .ssrLoadModule(`/src/sebaro/js/${name}?raw`)
          .then((module) => {
            response.setHeader("Content-Type", "text/javascript");
            response.end(module.default as string);
          })
          .catch(next);
      });
    }
  },
  async generateBundle() {
    for (const name of SEBARO_SCRIPTS) {
      this.emitFile({
        type: "asset",
        fileName: `sebaro/js/${name}`,
        source: await this.fs.readFile(sebaroFile(`js/${name}`)),
      });
    }
  },
};

export default defineConfig({
  plugins: [react(), watchCatalogs, sebaro],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // macOS 14 ships Safari 17; the WKWebView is the only target (§4.5).
    target: "safari17",
    sourcemap: false,
  },
  test: {
    // jsdom, not a real WebKit view: these cover the UI's own logic — stores,
    // dispatch, components — which is where every defect ADR-0011 lists lived.
    // CSS, hover and drag are NOT covered here (ADR-0011 consequences).
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    // A stylesheet is an empty module here — except read as text (`?raw`),
    // which a parity test does with the preview's fence rules; vitest would
    // stub that too.
    css: { include: [/\.css\?raw$/] },
    setupFiles: ["src/test/setup.ts"],
    restoreMocks: true,
    // mammoth ships a Node half and a browser half and picks between them
    // with its `browser` field (ADR-0024). The app gets the browser half
    // from Vite; vitest resolves as Node does, so without this the reader's
    // `arrayBuffer` input reaches the Node unzip, which wants a path, and
    // every document in the test would be "unreadable". The file is the
    // package's own browser build of the same code.
    alias: { mammoth: "mammoth/mammoth.browser.js" },
  },
});
