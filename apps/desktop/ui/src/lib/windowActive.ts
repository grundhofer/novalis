/** What `watchWindowActive` needs of the Tauri window. */
interface FocusSource {
  isFocused(): Promise<boolean>;
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<() => void>;
}

/**
 * `html[data-sb-window-active]` from the window's focus (spec/02 §4.17,
 * F9a): sebaro.css lets the current place of the title bar's path recede
 * while the window is not in front. sebaro's `sb-window.js` sets it in a web
 * page; novalis does not load that script (ADR-0051 #21), so this is its
 * counterpart. A window that cannot answer counts as in front: nothing worse
 * than a current place in ink. Returns the function that stops watching.
 */
export function watchWindowActive(source: FocusSource): () => void {
  const root = document.documentElement;
  const mark = (active: boolean) => {
    root.dataset.sbWindowActive = String(active);
  };
  mark(true);
  void source
    .isFocused()
    .then(mark)
    .catch(() => undefined);
  const unlisten = source.onFocusChanged(({ payload }) => mark(payload));
  return () => void unlisten.then((stop) => stop()).catch(() => undefined);
}
