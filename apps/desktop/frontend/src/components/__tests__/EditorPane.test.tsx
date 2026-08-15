// @vitest-environment jsdom
//
// EditorPane is the PRODUCER of the autosave contract that uiStore and
// vaultStore consume: it registers `{ flush, pendingPath, discard }` and every
// navigation guard is only as good as what those three report. If registration
// breaks, or `pendingPath()` under-reports, the guards silently degrade into
// no-ops and the failure mode is lost work rather than a crash.
//
// The editor itself is not under test here (packages/editor has 131 tests of
// its own) — `@novalis/editor` is stubbed so the pane's props can be driven
// directly. Raw createRoot + act, no testing-library (mirrors CanvasView.test).
//
// Mutation-tested: eleven guards in EditorPane.tsx were broken one at a time
// and ten are caught below. The one that is NOT is `onChange`'s own
// `if (discarded.current) return` — with the `pendingPath` and `flush` discard
// guards in place, an autosave armed after a discard is unobservable (both mask
// it, and the epoch-bump effect clears `pending` on remount). It is genuine
// defense in depth rather than a gap in these tests; if it ever becomes
// load-bearing, that will be because one of the other two was removed, and
// those are pinned.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Pane } from "../../lib/workspacePrefs";

/** Props the stubbed editor was last rendered with, so tests can call
 *  `onChange` / `onEditorReady` the way the real editor would. */
let editorProps: {
  onChange: (body: string) => void;
  onEditorReady?: (ed: unknown) => void;
} | null = null;

vi.mock("@novalis/editor", () => ({
  NovalisEditor: (props: Record<string, unknown>) => {
    editorProps = props as unknown as typeof editorProps;
    return null;
  },
  getMarkdown: (ed: { __md?: string }) => ed.__md ?? "",
  assignBlockId: vi.fn(),
  extractHeadings: () => [],
  // Sibling components read the live editor once one exists; they are not under
  // test, so they are answered with "nothing to show".
  rewriteInfo: () => ({ active: false }),
}));

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));

// EditorPane reaches for many commands during mount (properties, backlinks,
// outline, …) and none of them is under test. A Proxy answers every one with a
// vi.fn resolving to `[]`, so a new call site cannot break this file — the
// explicit per-method mock other component tests use would. `[]` rather than
// `null` because the list-shaped commands dominate and their panels read
// `.length` during render.
vi.mock("../../ipc/api", () => ({
  api: new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (t[k] ??= vi.fn(async () => [])),
  }),
}));

import i18n from "../../lib/i18n";
import { useUi } from "../../stores/uiStore";
import { useVault, type PaneFlush } from "../../stores/vaultStore";
import { EditorPane } from "../EditorPane";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "a.md";
const PANE: Pane = { id: "main", tabs: [PATH], activeTab: PATH };

let container: HTMLDivElement;
let root: Root;
/** The contract this pane handed to the store. */
let entry: PaneFlush | null;
let saveNote: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  // jsdom implements no media queries; useIsMobile calls this during render.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  editorProps = null;
  entry = null;
  saveNote = vi.fn(async () => {});
  useUi.setState({
    workspace: { panes: [PANE], focusedPaneId: PANE.id, direction: "row" },
  });
  useVault.setState({
    vaultPath: "/vault",
    openNotes: new Map([
      [PATH, { path: PATH, title: PATH, content: "body", frontmatter: {}, wordCount: 1 }],
    ]),
    paneEpochs: new Map(),
    saveStates: new Map(),
    saveErrors: new Map(),
    saveNote,
    loadNote: vi.fn(async () => {}),
    markDirty: vi.fn(),
    registerFlush: vi.fn((_id: string, e: PaneFlush | null) => {
      entry = e;
    }),
  } as unknown as Parameters<typeof useVault.setState>[0]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(): void {
  act(() => root.render(<EditorPane pane={PANE} />));
}

/** Drive the stubbed editor the way a keystroke would. */
function type(body: string): void {
  act(() => editorProps?.onChange(body));
}

describe("EditorPane autosave contract", () => {
  it("registers the pane's hooks on mount and withdraws them on unmount", () => {
    mount();
    expect(entry).not.toBeNull();

    act(() => root.unmount());
    // A stale entry would make the store flush an editor that no longer exists.
    expect(entry).toBeNull();
  });

  it("reports the pending path once an edit is armed, and saves it as this pane", async () => {
    mount();
    expect(entry?.pendingPath()).toBeNull(); // nothing typed yet

    type("edited");
    expect(entry?.pendingPath()).toBe(PATH);

    await act(async () => entry?.flush());

    // The pane id travels with the save so mirror-on-save spares the pane that
    // produced it — without it this editor remounts under the user's cursor.
    expect(saveNote).toHaveBeenCalledWith(PATH, expect.stringContaining("edited"), PANE.id);
    expect(entry?.pendingPath()).toBeNull();
  });

  it("flushes the live document when typing outran the serialize debounce", async () => {
    mount();
    // A burst of continuous typing resets the editor's serialize debounce on
    // every keystroke, so `onChange` may not have fired ONCE — the pane knows
    // it is dirty only from the editor's update events.
    let onUpdate: ((e: { transaction: { docChanged: boolean } }) => void) | null = null;
    const fakeEditor = {
      __md: "what the user actually typed",
      isDestroyed: false,
      on: (evt: string, fn: typeof onUpdate) => {
        if (evt === "update") onUpdate = fn;
      },
      off: () => {},
    };
    act(() => editorProps?.onEditorReady?.(fakeEditor));
    act(() => onUpdate?.({ transaction: { docChanged: true } }));

    // Mirror-on-save must see this pane as dirty or it will remount it mid-word.
    expect(entry?.pendingPath()).toBe(PATH);

    await act(async () => entry?.flush());

    // Serialized from the editor, not from a debounced snapshot that never got
    // taken — the difference is every keystroke of the burst.
    expect(saveNote).toHaveBeenCalledWith(
      PATH,
      expect.stringContaining("what the user actually typed"),
      PANE.id,
    );
  });

  it("ignores editor updates that changed no document content", () => {
    mount();
    let onUpdate: ((e: { transaction: { docChanged: boolean } }) => void) | null = null;
    act(() =>
      editorProps?.onEditorReady?.({
        __md: "",
        isDestroyed: false,
        on: (evt: string, fn: typeof onUpdate) => {
          if (evt === "update") onUpdate = fn;
        },
        off: () => {},
      }),
    );
    // `update` also fires for non-doc transactions (setEditable, selection). A
    // false positive here makes the pane claim edits it does not have, and
    // mirror-on-save then skips it forever — the pane never converges.
    act(() => onUpdate?.({ transaction: { docChanged: false } }));

    expect(entry?.pendingPath()).toBeNull();
  });

  it("keeps the pending edit when the save failed, so a retry still has it", async () => {
    mount();
    type("edited");

    useVault.setState({ saveStates: new Map([[PATH, "error"]]) } as unknown as Parameters<
      typeof useVault.setState
    >[0]);
    await act(async () => entry?.flush());

    // Dropping it here is the data-loss case: the editor holds the only copy.
    expect(entry?.pendingPath()).toBe(PATH);
    await act(async () => entry?.flush());
    expect(saveNote).toHaveBeenCalledTimes(2);
  });

  it("never writes back content the user discarded, even while the doomed editor lives on", async () => {
    // `discard` is called by Reload-from-disk and by an external delete. The
    // editor is NOT gone at that moment — it stays mounted until the remount
    // resolves the state, and it keeps emitting update events for the doc the
    // user just threw away. Both the pending report and the flush have to stay
    // deaf to it, or the discarded content is written back over what replaced it.
    mount();
    let onUpdate: ((e: { transaction: { docChanged: boolean } }) => void) | null = null;
    act(() =>
      editorProps?.onEditorReady?.({
        __md: "the content the user threw away",
        isDestroyed: false,
        on: (evt: string, fn: typeof onUpdate) => {
          if (evt === "update") onUpdate = fn;
        },
        off: () => {},
      }),
    );
    type("edited");

    act(() => entry?.discard());
    // The doomed doc keeps changing under the reload fetch.
    act(() => onUpdate?.({ transaction: { docChanged: true } }));

    // Reporting a pending edit here would also make mirror-on-save skip this
    // pane forever — it would never converge.
    expect(entry?.pendingPath()).toBeNull();

    await act(async () => entry?.flush());
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("drops a late serialization arriving after this pane switched tabs", () => {
    mount();
    // The outgoing editor's callback, still bound to a.md. Capturing it before
    // the switch is the whole point: a fresh one would be bound to the new tab
    // and would rightly accept the edit.
    const outgoing = editorProps!.onChange;

    act(() =>
      useUi.setState({
        workspace: {
          panes: [{ id: PANE.id, tabs: ["b.md"], activeTab: "b.md" }],
          focusedPaneId: PANE.id,
          direction: "row",
        },
      }),
    );
    // Its content was already persisted by the navigating flush. Accepting it
    // now would stamp the previous note's body onto the newly opened one.
    act(() => outgoing("body of the note we just left"));

    expect(entry?.pendingPath()).toBeNull();
  });

  it("drops a serialization from an editor that an epoch bump already replaced", () => {
    mount();
    const outgoing = editorProps!.onChange; // bound to the pre-bump epoch

    // A bump means this pane adopted content from elsewhere and remounted.
    act(() =>
      useVault.setState({ paneEpochs: new Map([[PANE.id, 1]]) } as unknown as Parameters<
        typeof useVault.setState
      >[0]),
    );
    // The replaced editor's serialize-flush carries the PRE-adoption doc, which
    // would overwrite what was just adopted.
    act(() => outgoing("pre-adoption content"));

    expect(entry?.pendingPath()).toBeNull();
  });
});
