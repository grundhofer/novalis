/**
 * Keystroke → paint and open time, the PLAN.md §11.3 rows `keystrokeP50Ms` /
 * `keystrokeP95Ms` / `openNote*Ms`, measured in the app itself behind
 * `NOVALIS_PERF` (`BootstrapDto.perf`). A CI runner has no WebView, so these
 * rows are measured by hand and quoted in the pull request that changes them.
 *
 * `NOVALIS_PERF=1`: a `keydown` inside the editor starts the clock. Three
 * series per keystroke:
 *   - `work`: until a macrotask posted from the keydown runs — the keystroke's
 *     own task and its microtasks (WebKit's insert, CodeMirror's DOM observer
 *     and transaction, the app's listeners, React's render). Not quantised.
 *   - `busy`: until the first animation frame — `work` rounded up to the
 *     frame; CodeMirror's `measure()` pass, which runs in its own frame
 *     callback, is not in it.
 *   - `paint`: until the second frame, after which the change is on screen
 *     and `measure()` has run. Floor: two frames (≈33 ms at 60 Hz).
 * A human keystroke lands at a random point in the frame, so `busy` and
 * `paint` carry the remainder of that frame; the burst below starts each
 * keystroke right after a frame callback, so they floor at one and two full
 * frames there. `work` is the number a change to the keystroke path moves.
 * Samples go into a ring of 200; every 50 the percentiles are printed as one
 * JSON line — through `console.warn`, which is what the Tauri dev log
 * forwards (`console.log` is not).
 *
 * `NOVALIS_PERF=type:<n>`: the same probe, plus a burst of `n` characters
 * typed into the first editor that mounts, one after the other, each through
 * `execCommand("insertText")` after a synthetic `keydown` the probe times.
 * That is the DOM-side path of typing (WebKit's typing command, CodeMirror's
 * mutation observer, input handlers, the update listener); the native key
 * and IME step is not in the sample. It makes the numbers reproducible
 * without an automation tool driving the keyboard, and without a human whose
 * other windows would receive the keys. **The burst edits the note and the
 * autosave writes it** — run it on a throwaway vault, never on real notes.
 *
 * `open`: in either mode, one sample per run — from the moment the probe
 * starts (bootstrap answered, before the last session's tabs are restored)
 * until the restored editor is painted (two frames after `.cm-content`
 * appears). It includes the editor chunk on a cold start, the `read_file`
 * round trip and CodeMirror's construction; it is the "open note" row for
 * the file that was active when the app last quit.
 */

const RING = 200;
const REPORT_EVERY = 50;
const EDITOR_POLL_MS = 50;
const EDITOR_WAIT_MS = 60_000;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

/** Percentiles of a sample set, rounded to a tenth of a millisecond. */
export function summarize(samples: readonly number[]): { n: number; p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    n: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted[sorted.length - 1] ?? 0),
  };
}

/** The burst size in a `type:<n>` mode; 0 for every other value. */
export function burstSize(mode: string): number {
  const match = /^type:(\d+)$/.exec(mode);
  return match ? Number(match[1]) : 0;
}

function log(record: Record<string, unknown>): void {
  // eslint-disable-next-line no-console -- the probe's output is its purpose (PLAN.md §11.3)
  console.warn(JSON.stringify(record));
}

function push(series: number[], value: number): void {
  if (series.length === RING) series.shift();
  series.push(value);
}

/** Starts the probe for `mode` (the env value); returns the function that stops it. */
export function startKeystrokeProbe(mode: string): () => void {
  const started = performance.now();
  const work: number[] = [];
  const busy: number[] = [];
  const paint: number[] = [];
  let taken = 0;
  let settle: (() => void) | null = null;
  const report = (extra: Record<string, unknown> = {}) =>
    log({ perf: "keystroke", ...extra, work: summarize(work), busy: summarize(busy), paint: summarize(paint) });

  const onKeyDown = (event: KeyboardEvent) => {
    // Only keys that reach the buffer: a modifier alone, or a chord the app
    // handles, paints nothing worth timing.
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
    if (!(event.target instanceof Element) || !event.target.closest(".cm-content")) return;
    const start = performance.now();
    setTimeout(() => push(work, performance.now() - start), 0);
    requestAnimationFrame(() => {
      push(busy, performance.now() - start);
      requestAnimationFrame(() => {
        push(paint, performance.now() - start);
        taken += 1;
        if (taken % REPORT_EVERY === 0) report();
        settle?.();
      });
    });
  };
  document.addEventListener("keydown", onKeyDown, true);

  const burst = burstSize(mode);
  let stopped = false;
  void (async () => {
    const content = await waitForEditor();
    if (!content || stopped) return log({ perf: "open", error: "no editor mounted" });
    await painted();
    log({ perf: "open", ms: Math.round(performance.now() - started) });
    if (burst === 0) return;
    content.focus();
    for (let i = 0; i < burst && !stopped; i += 1) {
      const done = new Promise<void>((resolve) => (settle = resolve));
      content.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
      document.execCommand("insertText", false, "x");
      await done;
    }
    settle = null;
    // The macrotask of the last keystroke has run by now (it was posted
    // before that keystroke's frames), so `work` is complete.
    report({ burst });
  })().catch((error: unknown) => log({ perf: "keystroke", error: String(error) }));

  return () => {
    stopped = true;
    document.removeEventListener("keydown", onKeyDown, true);
  };
}

function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function waitForEditor(): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const from = performance.now();
    const poll = () => {
      const content = document.querySelector<HTMLElement>(".cm-content");
      if (content) return resolve(content);
      if (performance.now() - from > EDITOR_WAIT_MS) return resolve(null);
      setTimeout(poll, EDITOR_POLL_MS);
    };
    poll();
  });
}
