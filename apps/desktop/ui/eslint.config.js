import js from "@eslint/js";
import i18next from "eslint-plugin-i18next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Flat config (PLAN.md §5.1). Two rules carry real weight here:
//
//   i18next/no-literal-string  — every user-visible string lives in
//     i18n/{en,de}.json, never inline. Checked in JSX text and in the
//     attributes that reach the user.
//   react-hooks/*              — the recommended set; the stores are plain
//     zustand hooks and a missing dependency is a stale-render bug.
export default tseslint.config(
  { ignores: ["dist", "src/ipc/bindings.ts"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { i18next, "react-hooks": reactHooks },
    rules: {
      // The plugin ships its recommended set as an eslintrc-shaped object, so
      // the rules are spread in rather than the config being extended.
      ...reactHooks.configs["recommended-latest"].rules,
      // React Compiler advice, and we do not run the compiler: it fires on
      // `useVirtualizer()`, which is the tree's whole reason for existing.
      "react-hooks/incompatible-library": "off",
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-text-only",
          "should-validate-template": true,
          message: "User-visible strings belong in i18n/en.json and i18n/de.json (PLAN.md §5.8)",
          callees: { exclude: [".*"] },
          "jsx-attributes": {
            include: ["placeholder", "title", "aria-label", "alt", "aria-placeholder"],
          },
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The IPC boundary is typed; `any` would be a hole in it.
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "smart"],
      "no-console": "error",
    },
  },
  {
    // Node scripts and config files: no browser globals, no i18n rule.
    files: ["scripts/**/*.mjs", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
);
