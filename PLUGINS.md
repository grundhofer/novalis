# Novalis Plugins

Novalis has an open, MIT-friendly plugin system. Plugins are small JavaScript
programs that add **commands** (runnable from the command palette, ⌘/Ctrl+⇧+P)
and interact with your vault through a capability-scoped host API.

## Security model

Each plugin runs **sandboxed in a Web Worker**: no DOM, no direct filesystem,
no network. It can only call the `novalis` host API, and only the parts allowed
by the `capabilities` it declares. The app enforces capabilities before every
call, so a plugin can never do more than it asked for.

## Installing a plugin

Plugins live inside your vault so they sync with it:

```
<vault>/.novalis/plugins/<plugin-id>/
  plugin.json     # manifest
  main.js         # entry script
```

Then open **Settings → Plugins** and toggle it on. (Try the bundled example:
copy `examples/plugins/novalis-examples/` into `<vault>/.novalis/plugins/`.)

## Manifest (`plugin.json`)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "What it does.",
  "entry": "main.js",
  "capabilities": ["notes:read", "notes:write", "tasks:read", "tasks:write", "search"]
}
```

The folder name must equal `id`.

## The `novalis` host API

Available as a global inside your worker script:

```js
novalis.registerCommand(id, title, callback);  // callback runs on invocation

await novalis.notes.list();                    // [{ path, title, wordCount, ... }]   needs notes:read
await novalis.notes.get(path);                 // full note                           needs notes:read
await novalis.notes.create(path, content);     // create a note                       needs notes:write

await novalis.tasks.list();                    // all tasks                           needs tasks:read
await novalis.tasks.create(text);              // create a task (inline markdown)     needs tasks:write

await novalis.search(query);                   // full-text search                    needs search

novalis.notify(message);                       // show a transient toast              (no capability)
```

## Example

```js
novalis.registerCommand("word-count", "Count words in vault", async () => {
  const notes = await novalis.notes.list();
  const words = notes.reduce((sum, n) => sum + (n.wordCount || 0), 0);
  novalis.notify(`${notes.length} notes · ${words} words`);
});
```

See `examples/plugins/novalis-examples/` for a complete, working plugin.

> Status: M5 covers **command + data** plugins (the most common kind). Custom
> UI panels/views are planned for a later milestone.
