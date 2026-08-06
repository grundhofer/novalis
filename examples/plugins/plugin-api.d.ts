/**
 * Novalis plugin API — host surface for plugin API version 1.
 *
 * Reference it from a plugin entry script to get completion and errors in an
 * editor without any build step or dependency:
 *
 *     /// <reference path="../plugin-api.d.ts" />
 *
 * The plugin runs in a Web Worker with `novalis` injected as a global, and that
 * global is the only way to reach the app: no DOM, no filesystem. `fetch` is a
 * worker built-in and therefore still defined, but the app's
 * Content-Security-Policy limits outbound connections to Novalis' own IPC and
 * asset channels, so a request to anywhere else is blocked.
 *
 * Every method annotated "needs `x`" is refused unless the capability is BOTH
 * declared in `plugin.json` and granted by the user when enabling the plugin
 * (Settings → Plugins). A refusal rejects the returned promise; it never
 * silently returns nothing. See PLUGINS.md for the security model.
 *
 * Keep this file in sync with `PLUGIN_API_VERSION` — it describes version 1.
 */

/** Capability names the host understands. Mirrors `PLUGIN_CAPABILITIES` in
 *  `crates/novalis-core/src/plugins/mod.rs`. */
type NovalisCapability = "notes:read" | "notes:write" | "tasks:read" | "tasks:write" | "search";

/** `plugin.json`. `id` must equal the plugin's folder name. */
interface NovalisPluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  /** Entry script, relative to the plugin folder. Default `main.js`. */
  entry?: string;
  /** Host API generation this plugin targets. Omit only in plugins written
   *  before the field existed — those are assumed to target version 1. */
  apiVersion?: number;
  /** What the plugin asks for. The user decides what it gets. */
  capabilities?: NovalisCapability[];
}

/** One note in a vault listing. */
interface NovalisNoteSummary {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  aliases?: string[];
  created: string;
  modified: string;
  pinned: boolean;
  wordCount: number;
  taskTotal: number;
  taskCompleted: number;
  /** True for a cloud placeholder (OneDrive/iCloud) not yet on disk — reading
   *  it triggers a download, so skip these in bulk passes. */
  cloudOnly: boolean;
}

/** A note with its body. `frontmatter` is the parsed YAML header: the keys
 *  below are Novalis' own, any others are the note's custom ones. */
interface NovalisNote {
  path: string;
  title: string;
  content: string;
  wordCount: number;
  frontmatter: {
    title?: string | null;
    tags?: string[];
    aliases?: string[];
    created?: string;
    modified?: string;
    pinned?: boolean;
    [key: string]: unknown;
  };
  /** Typed view of the custom frontmatter keys. The value is Novalis'
   *  internal property union — narrow it before use. */
  properties?: { key: string; value: unknown }[];
}

/** A task parsed out of a note's markdown. The optional fields carry the
 *  `@`-annotations, and are absent when the task line has none. */
interface NovalisTask {
  id: string;
  text: string;
  completed: boolean;
  priority: string | null;
  dueDate: string | null;
  /** `@start(YYYY-MM-DD)` — the scheduled "do" date, distinct from due. */
  startDate?: string | null;
  /** `@remind(YYYY-MM-DDTHH:MM)` — an absolute (local) reminder datetime. */
  remind?: string | null;
  status: string | null;
  sourceNote: string;
  sourceLine: number;
  tags: string[];
  /** `@repeat(daily|weekly|monthly|yearly|every N days|…)`. */
  repeat?: string | null;
  parentId?: string | null;
  /** The source note's display title, and the nearest preceding heading. */
  noteTitle?: string;
  heading?: string | null;
  /** `@project(slug)` / `@epic(slug)` buckets. */
  project?: string | null;
  epic?: string | null;
}

/** One full-text search hit. `snippet` carries the match context. */
interface NovalisSearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number | null;
}

interface NovalisHost {
  /**
   * Register a command. While the plugin is enabled it appears in the command
   * palette (⌘/Ctrl+⇧+P by default — the keymap is configurable) under `title`,
   * with the plugin's id as the right-hand badge, so make `title` say what it
   * does rather than repeating the plugin name. Call this at the top level of
   * the entry script so the command exists before the user goes looking.
   */
  registerCommand(id: string, title: string, callback: () => void | Promise<void>): void;

  notes: {
    /** Every note in the vault. Needs `notes:read`. */
    list(): Promise<NovalisNoteSummary[]>;
    /** One note including its body. Needs `notes:read`. */
    get(path: string): Promise<NovalisNote>;
    /**
     * Create a note, creating parent folders as needed. Rejects if the path
     * already exists — version 1 has no overwrite and no delete, so this
     * cannot destroy anything. Needs `notes:write`.
     *
     * `path` is vault-relative, must end in `.md`, and must not contain a
     * segment starting with `.` — plugins cannot reach `.novalis/` or `.git/`
     * (that would be a way to install code or repoint the sync remote).
     */
    create(path: string, content: string): Promise<NovalisNote>;
  };

  tasks: {
    /** Every task in the vault, open and completed. Needs `tasks:read`. */
    list(): Promise<NovalisTask[]>;
    /** Append a task as a markdown checkbox line, in whatever note the user's
     *  task-creation setting resolves to (daily note, inbox, …). `text` may
     *  carry the `@`-annotation syntax. Needs `tasks:write`. */
    create(text: string): Promise<NovalisTask>;
  };

  /** Full-text search across the vault. Needs `search`. */
  search(query: string): Promise<NovalisSearchResult[]>;

  /** Show a transient toast, prefixed with the plugin's name. Needs no
   *  capability: it reaches no vault data. */
  notify(message: string): void;
}

declare const novalis: NovalisHost;
