// Fixed, theme-consistent color palette shared by the folder-color picker
// (Sidebar) and the appearance accent picker (Settings). Stored as tokens
// (vault-synced); the hex drives folder icon tints / accent bars and, for the
// accent setting, the runtime `--accent` CSS variable.

export const COLOR_HEX: Record<string, string> = {
  indigo: "#818cf8",
  sky: "#38bdf8",
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
  violet: "#a78bfa",
  slate: "#94a3b8",
};

export const COLOR_TOKENS = Object.keys(COLOR_HEX);

/** The hex tint a note inherits from its DEEPEST colored ancestor folder (the
 *  same map the sidebar's folder rows read), or null when no ancestor is
 *  colored — callers fall back to a neutral theme token. */
export function colorForNotePath(
  path: string,
  folderColors: Record<string, string>,
): string | null {
  const parts = path.split("/");
  parts.pop(); // the note's filename
  for (let i = parts.length; i > 0; i--) {
    const folder = parts.slice(0, i).join("/");
    const token = folderColors[folder];
    if (token && COLOR_HEX[token]) return COLOR_HEX[token];
  }
  return null;
}
