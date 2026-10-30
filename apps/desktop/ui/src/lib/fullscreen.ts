/** What `watchFullscreen` needs of the Tauri window. */
interface FullscreenSource {
  isFullscreen(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
}

/**
 * `html[data-sb-fullscreen]` while the window is in full screen (spec/02
 * §4.17, D91 F1a): macOS hides the traffic lights there, and sebaro.css
 * gives the title bar's 80 px back. Entering and leaving full screen resize
 * the window, so the state is read again on every resize. A window that
 * cannot answer keeps the room: nothing worse than an empty start of the bar.
 * Returns the function that stops watching.
 */
export function watchFullscreen(source: FullscreenSource): () => void {
  const root = document.documentElement;
  const update = () =>
    void source
      .isFullscreen()
      .then((full) => {
        if (full) root.dataset.sbFullscreen = "";
        else delete root.dataset.sbFullscreen;
      })
      .catch(() => undefined);
  update();
  const unlisten = source.onResized(update);
  return () => void unlisten.then((stop) => stop()).catch(() => undefined);
}
