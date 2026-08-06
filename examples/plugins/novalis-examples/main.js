/// <reference path="../plugin-api.d.ts" />
// Novalis example plugin.
//
// This runs sandboxed in a Web Worker. It has no DOM and no direct filesystem
// or network access — it reaches the app only through the injected `novalis`
// host API, and only for the capabilities that plugin.json declares AND the
// user granted when enabling the plugin. Declaring one is a request, not a
// grant: a call whose capability was not granted rejects.
//
// The reference above is the whole toolchain — no install, no build step; an
// editor picks up ../plugin-api.d.ts and types the `novalis` global.

// A read-only command: sum word counts across the vault.
novalis.registerCommand("word-count", "Example: count words in vault", async () => {
  const notes = await novalis.notes.list();
  const words = notes.reduce((sum, n) => sum + (n.wordCount || 0), 0);
  novalis.notify(`${notes.length} notes · ${words} words total`);
});

// A write command: create today's daily note (needs the "notes:write" capability).
novalis.registerCommand("daily-note", "Example: create today's daily note", async () => {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  const path = `Daily/${date}.md`;
  await novalis.notes.create(path, `# ${date}\n\n`);
  novalis.notify(`Created ${path}`);
});
