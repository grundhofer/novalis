// A stand-in for the Tauri shell (ADR-0051 #69): answers the UI's commands
// with a small vault of made-up notes, enough tabs to overflow the row, the
// last one current. `window.__NV_THEME` and `window.__NV_ROOT_FONT` are set
// in front of this file by scripts/measure-tab-row.mjs.
(function () {
  const names = [
    "Atlas.md",
    "Einkaufsliste.md",
    "Texte zum Lernen.md",
    "Ohne Titel 2.md",
    "Projekt Orion Planung.md",
    "Leseliste.md",
    "Notizen zum Treffen.md",
    "Reise im Herbst.md",
    "Ideen.md",
    "Eingang.md",
  ];
  const entry = (name) => ({ path: name, name, dir: false, size: "10", mtimeNs: "1", cloudOnly: false, boardSlug: null });
  const vault = { root: "/vault", name: "Vault", kind: "local", boards: [] };
  const settings = {
    version: 1,
    language: "de",
    appearance: window.__NV_THEME || "light",
    tone: "cool",
    editor: { fontSize: 16 },
    spellcheck: true,
    reduceMotion: false,
    lastVault: "/vault",
  };
  const state = {
    openTabs: names,
    activeTab: names[names.length - 1],
    sidebarVisible: true,
    sidebarWidth: 240,
    boardVisible: false,
    activeBoard: null,
    treeSort: "name",
    backlinksVisible: false,
    cloudHintShown: true,
    recentFiles: [],
  };
  // What the shell's initialisation script gives theme-init.js.
  window.rs = settings;
  if (window.__NV_ROOT_FONT) document.documentElement.style.fontSize = window.__NV_ROOT_FONT;
  let callback = 1;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: (fn) => {
      const id = callback++;
      window[`_${id}`] = fn;
      return id;
    },
    unregisterCallback: () => {},
    convertFileSrc: (path) => path,
    invoke: async (command, args) => {
      switch (command) {
        case "bootstrap":
          return { settings, vault, tree: names.map(entry), lastOpen: state, locale: "de", perf: null, pendingOpen: [] };
        case "open_vault":
          return { vault, tree: names.map(entry) };
        case "list_dir":
          return names.map(entry);
        case "list_files":
          return names;
        case "read_file":
          return {
            path: args.path,
            text: `# ${args.path}\n\nText.\n`,
            precondition: { mtimeNs: "1", size: "10", hash: "h" },
            utf8: true,
            binary: false,
          };
        case "render_markdown":
          return "<p>Text.</p>";
        default:
          return null;
      }
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
})();
