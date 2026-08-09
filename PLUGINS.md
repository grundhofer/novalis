# Novalis Plugins

Novalis has an open plugin system. Plugins are small JavaScript programs that add
**commands** (runnable from the command palette, ⌘/Ctrl+⇧+P) and interact with
your vault through a capability-scoped host API. Novalis itself is AGPL-3.0-only;
your plugin does not have to be — see [Licensing your
plugin](#licensing-your-plugin).

## Security model

**A plugin is code you choose to run.** Read this section before installing one
you did not write.

Each plugin runs **sandboxed in a Web Worker**: no DOM, no direct filesystem
access, and no network — the app's Content-Security-Policy allows outbound
connections only to Novalis' own IPC and asset channels, so a plugin cannot
phone home. It reaches the app solely through the injected `novalis` global.

What a plugin can do with that global is decided in two steps:

1. **The plugin asks.** `plugin.json` lists the `capabilities` it wants. That
   file is written by the plugin's author, so on its own it grants nothing.
2. **You grant.** Enabling a plugin (Settings → Plugins) opens a dialog listing
   exactly what it asked for; you tick what it may have. The grant is stored
   per plugin id in `<vault>/.novalis/plugins-enabled.json` — the half of the
   check the plugin cannot write.

Every host call is checked against the **intersection** of the two, so a plugin
that later edits its own manifest to ask for more gains nothing until you grant
it: Settings → Plugins shows a *Review new access* button, and the new calls are
refused meanwhile. Switching a plugin off drops its grants entirely.

Two things this does **not** protect you from, stated plainly:

- **A capability is a kind of access, not a scope.** `notes:read` means every
  note in the vault; `notes:write` means it can create a note anywhere in it
  (API version 1 offers no overwrite and no delete — `notes.create` fails if
  the path already exists). Neither reaches `.novalis/` or `.git/`: paths with
  a hidden segment, and paths that don't end in `.md`, are rejected on both
  sides of the IPC boundary. But within your ordinary notes there is no
  per-folder or per-note limit.
- **Enabling runs the code.** The sandbox and the capability grant limit what a
  plugin can reach, not whether it runs. Only install plugins you trust, from a
  source you trust.

Plugin folders live **inside the vault**, so anyone who can write to your vault
(a shared git remote, a synced folder) can add or modify a plugin. Novalis'
git sync deliberately excludes `.novalis/plugins/` and `plugins-enabled.json`
for that reason, and a plugin never auto-enables — but if you copy a vault from
someone else, treat its plugins folder as untrusted input.

## Installing a plugin

```
<vault>/.novalis/plugins/<plugin-id>/
  plugin.json     # manifest
  main.js         # entry script
```

Then open **Settings → Plugins**, switch it on, and review the access it asks
for. (Try the bundled example: copy `examples/plugins/novalis-examples/` into
`<vault>/.novalis/plugins/`.)

## Manifest (`plugin.json`)

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "What it does.",
  "entry": "main.js",
  "apiVersion": 1,
  "capabilities": ["notes:read", "notes:write", "tasks:read", "tasks:write", "search"]
}
```

The folder name must equal `id`. `capabilities` is the *request* — ask for the
least you need, because a user reads that list before granting it. The five
names above are the complete set; anything else is ignored, and is not offered
in the consent dialog.

### API version

`apiVersion` is the generation of the `novalis` host API the plugin was written
against. This build provides **version 1**
(`PLUGIN_API_VERSION` in `crates/novalis-core/src/plugins/mod.rs`).

- **Compatibility policy:** the host runs a plugin only if the numbers match
  exactly, and it checks *before* loading the plugin's code. A mismatch shows a
  message in Settings → Plugins naming both versions and the plugin stays
  inert. The number is bumped only for a change that would break an existing
  plugin — a removed method, a changed argument. Additive changes keep it, so
  feature-detect (`typeof novalis.x.y === "function"`) for anything new.
- **Omitting it** is allowed and means "version 1": manifests written before
  the field existed all targeted that API, and they keep working. New plugins
  should set it explicitly — once version 2 exists, a manifest without the field
  is treated as a version-1 plugin and refused, which is the intended outcome
  for a plugin nobody updated.

## The `novalis` host API

Available as a global inside your worker script:

```js
novalis.registerCommand(id, title, callback);  // callback runs on invocation

await novalis.notes.list();                    // [{ path, title, wordCount, ... }]   needs notes:read
await novalis.notes.get(path);                 // full note                           needs notes:read
await novalis.notes.create(path, content);     // new note (*.md, no dot-paths)       needs notes:write

await novalis.tasks.list();                    // all tasks                           needs tasks:read
await novalis.tasks.create(text);              // create a task (inline markdown)     needs tasks:write

await novalis.search(query);                   // full-text search                    needs search

novalis.notify(message);                       // show a transient toast              (no capability)
```

A call whose capability was not granted **rejects** — it never silently returns
nothing, so `await` it and surface the error.

**Types:** [`examples/plugins/plugin-api.d.ts`](examples/plugins/plugin-api.d.ts)
declares the whole surface. Copy it next to your plugin folder and reference it
from your entry script — an editor then types the `novalis` global with no
install and no build step. The path is relative to the entry script, and the
line is a comment, so a stale one costs you completion, not a crash:

```js
/// <reference path="../plugin-api.d.ts" />
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

## Licensing your plugin

**License your plugin however you like, including closed-source and paid.**

Novalis is AGPL-3.0-only, and that would normally be a problem here: the loader
concatenates Novalis' Worker bootstrap with your entry script and runs the two as
one script in one Worker (`BOOTSTRAP` in
`apps/desktop/frontend/src/stores/pluginStore.ts`), which is exactly the kind of
combination a copyleft license reaches. So [LICENSE](LICENSE) carries an
**additional permission under AGPL section 7** that takes plugins back out. Read
it once before you ship something commercial; the short version:

- A work that reaches Novalis **solely** through the interface documented on this
  page — the manifest, the injected `novalis` global, the `postMessage` protocol
  behind it — is not covered by the AGPL. Sell it, keep the source, no agreement
  to sign, nothing to ask for.
- You may ship `examples/plugins/plugin-api.d.ts` and the example plugin inside
  your own plugin under your own terms. That is deliberate: this page tells you
  to copy the `.d.ts` next to your plugin folder, and without the permission
  doing so would put AGPL source in your product.
- What is **not** covered: patching Novalis, adding or bypassing a host method or
  a capability check, linking `novalis-core`/`novalis-extension`, or copying
  Novalis source beyond those two paths. That is modifying Novalis, and the AGPL
  applies to it normally. If you need a host method that does not exist, the way
  through is a PR, not a private patch.

Anything the permission does not give you is negotiable —
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

> Status: M5 covers **command + data** plugins (the most common kind). Custom
> UI panels/views are planned for a later milestone.
