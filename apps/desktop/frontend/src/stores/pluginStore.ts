import { create } from "zustand";

import i18n from "../lib/i18n";
import { api, type PluginInfo } from "../ipc/api";
import { PLUGIN_API_VERSION, PLUGIN_CAPABILITIES } from "../ipc/bindings";

export interface PluginCommand {
  id: string;
  title: string;
  pluginId: string;
  run: () => void;
}

/** The capability vocabulary, from the Rust constant that also documents it —
 *  so the table below cannot name a capability the docs don't have. */
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

// Host method -> required capability (null = always allowed).
export const CAP: Record<string, PluginCapability | null> = {
  "notes.list": "notes:read",
  "notes.get": "notes:read",
  "notes.create": "notes:write",
  "tasks.list": "tasks:read",
  "tasks.create": "tasks:write",
  search: "search",
};

/** What a manifest without `apiVersion` is taken to mean. It is the literal 1,
 *  not `PLUGIN_API_VERSION`: every manifest written before the field existed
 *  targeted API 1, so pinning it here makes a future API 2 refuse them (which
 *  is correct) instead of waving them through (which is not). */
const UNVERSIONED_PLUGIN_API = 1;

/** Whether this build can run the plugin — checked before its source is turned
 *  into a Worker, since after that the damage is done. */
export function apiVersionOf(plugin: PluginInfo): number {
  return plugin.manifest.apiVersion ?? UNVERSIONED_PLUGIN_API;
}

/**
 * The capability check, as an intersection: a host call needs the capability to
 * be both *asked for* by the manifest and *granted* by the user. The manifest
 * alone is the plugin's own file, so gating on it decided nothing — a plugin
 * simply listed everything. Returns the missing capability, or null if allowed.
 */
export function missingCapability(plugin: PluginInfo, method: string): PluginCapability | null {
  const need = CAP[method];
  if (!need) return null;
  const asked = plugin.manifest.capabilities ?? [];
  const granted = plugin.grantedCapabilities ?? [];
  return asked.includes(need) && granted.includes(need) ? null : need;
}

// Runtime injected into each plugin's Web Worker. The plugin script runs after
// it and talks to the app only through the `novalis` global (postMessage RPC).
const BOOTSTRAP = `
const __pending = new Map();
let __seq = 0;
function __call(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++__seq;
    __pending.set(id, { resolve, reject });
    self.postMessage({ type: "rpc", id, method, params: params || {} });
  });
}
const __commands = new Map();
self.novalis = {
  registerCommand(id, title, callback) {
    __commands.set(id, callback);
    self.postMessage({ type: "registerCommand", id, title });
  },
  notes: {
    list: () => __call("notes.list"),
    get: (path) => __call("notes.get", { path }),
    create: (path, content) => __call("notes.create", { path, content }),
  },
  tasks: {
    list: () => __call("tasks.list"),
    create: (text) => __call("tasks.create", { text }),
  },
  search: (query) => __call("search", { query }),
  notify: (message) => self.postMessage({ type: "notify", message: String(message) }),
};
self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "rpcResult") {
    const p = __pending.get(m.id);
    if (p) { __pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); }
  } else if (m.type === "runCommand") {
    const cb = __commands.get(m.id);
    if (cb) Promise.resolve().then(cb).catch((e) => self.postMessage({ type: "error", message: String(e) }));
  }
};
`;

interface PluginState {
  commands: PluginCommand[];
  notify: (msg: string) => void;
  setNotify: (fn: (msg: string) => void) => void;
  reload: () => Promise<void>;
  /** Terminate every plugin worker and drop its commands — the teardown half
   *  of reload(), used when the plugins feature is switched off. */
  unload: () => void;
}

const workers = new Map<string, Worker>();

export const usePlugins = create<PluginState>((set, get) => ({
  commands: [],
  notify: () => {},
  setNotify: (fn) => set({ notify: fn }),

  unload: () => {
    workers.forEach((w) => w.terminate());
    workers.clear();
    set({ commands: [] });
  },

  reload: async () => {
    get().unload();

    let plugins;
    try {
      plugins = await api.listPlugins();
    } catch {
      return;
    }

    for (const p of plugins.filter((x) => x.enabled)) {
      const declared = apiVersionOf(p);
      if (declared !== PLUGIN_API_VERSION) {
        get().notify(
          i18n.t("settings:plugins.apiMismatch", {
            id: p.manifest.id,
            declared,
            current: PLUGIN_API_VERSION,
          }),
        );
        continue;
      }
      try {
        const src = await api.readPluginSource(p.manifest.id);
        const blob = new Blob([BOOTSTRAP + "\n" + src], { type: "text/javascript" });
        const worker = new Worker(URL.createObjectURL(blob));
        worker.onmessage = (ev) => handleMessage(p, worker, ev.data, set, get);
        worker.onerror = (e) => get().notify(`[${p.manifest.id}] ${e.message}`);
        workers.set(p.manifest.id, worker);
      } catch (e) {
        get().notify(i18n.t("settings:plugins.loadFailed", { id: p.manifest.id, error: String(e) }));
      }
    }
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = any;

function handleMessage(
  plugin: PluginInfo,
  worker: Worker,
  msg: Msg,
  set: (fn: (s: PluginState) => Partial<PluginState>) => void,
  get: () => PluginState,
) {
  const manifest = plugin.manifest;
  if (msg.type === "registerCommand") {
    const cmd: PluginCommand = {
      id: `${manifest.id}:${msg.id}`,
      title: msg.title,
      pluginId: manifest.id,
      run: () => worker.postMessage({ type: "runCommand", id: msg.id }),
    };
    set((s) => ({ commands: [...s.commands.filter((c) => c.id !== cmd.id), cmd] }));
  } else if (msg.type === "rpc") {
    void dispatchRpc(plugin, msg.method, msg.params).then(
      (result) => worker.postMessage({ type: "rpcResult", id: msg.id, result }),
      (err) => worker.postMessage({ type: "rpcResult", id: msg.id, error: String(err) }),
    );
  } else if (msg.type === "notify") {
    get().notify(`${manifest.name}: ${msg.message}`);
  } else if (msg.type === "error") {
    get().notify(`[${manifest.id}] ${msg.message}`);
  }
}

/**
 * Reject anything that is not an ordinary note path before it reaches the
 * backend. A capability like `notes:write` names a *kind* of access, not a
 * *scope* — without this, it also reaches `.novalis/plugins/` (auto-loaded
 * into a Worker on the next vault open), `.novalis/config.json` (the feature
 * flags, including the one that enables plugins at all) and `.git/config`
 * (the sync remote, i.e. where the whole vault gets pushed).
 *
 * The Rust side enforces the same rule in `vault_fs::vault_note_rel`; this
 * copy exists so a plugin gets a clear error instead of an opaque backend
 * one, and so the boundary is visible where the capability check is.
 */
export function assertNotePath(pluginId: string, path: unknown): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`${pluginId}: note path must be a non-empty string`);
  }
  const segments = path.split(/[/\\]/);
  if (segments.some((s) => s.startsWith("."))) {
    throw new Error(`${pluginId}: note path must not contain a hidden segment: ${path}`);
  }
  if (!path.endsWith(".md")) {
    throw new Error(`${pluginId}: note path must end in .md: ${path}`);
  }
  return path;
}

async function dispatchRpc(plugin: PluginInfo, method: string, params: Msg): Promise<unknown> {
  const manifest = plugin.manifest;
  const missing = missingCapability(plugin, method);
  if (missing) {
    throw new Error(`Capability '${missing}' not granted to ${manifest.id}`);
  }
  switch (method) {
    case "notes.list":
      return api.listNotes();
    case "notes.get":
      return api.getNote(assertNotePath(manifest.id, params.path));
    case "notes.create":
      return api.createNote(assertNotePath(manifest.id, params.path), {
        content: params.content,
      });
    case "tasks.list":
      return api.listTasks("all");
    case "tasks.create":
      return api.createTask(params.text);
    case "search":
      return api.search(params.query);
    default:
      throw new Error(`Unknown host method: ${method}`);
  }
}
