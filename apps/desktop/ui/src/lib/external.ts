import { commands, unwrap } from "../ipc/client";
import { report, useUi } from "../stores/ui";

/** A destination with a scheme — `https:`, `mailto:`, `file:` … — is not a vault path. */
export const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The schemes novalis hands to the browser or the mail app (ADR-0044). */
const OPENABLE = /^(https?|mailto):/i;

/**
 * A link out of the vault, clicked in the preview or `Cmd`-clicked in the
 * editor (ADR-0044): a web or mail link goes to macOS, which opens it in the
 * default browser or mail app — novalis itself opens no connection
 * (docs/PRIVACY.md). Any other scheme is refused, and a toast says so.
 */
export function openExternal(url: string): void {
  if (!OPENABLE.test(url.trim())) {
    useUi.getState().showToast("editor.externalLinkRefused");
    return;
  }
  void unwrap(commands.systemOpen({ kind: "url", url: url.trim() })).catch(report);
}
