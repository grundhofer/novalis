import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
export default defineConfig({
  plugins: [react()],
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
});
