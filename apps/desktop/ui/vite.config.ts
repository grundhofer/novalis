import react from "@vitejs/plugin-react";
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

export default defineConfig({
  plugins: [react(), watchCatalogs],
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
