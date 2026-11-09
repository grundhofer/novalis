import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import DocHints from "./DocHints";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const vault = (kind: "local" | "fileProvider", legacy = false) =>
  ({ root: "/v", name: "v", kind, legacy, boards: [] }) as never;

// spec/02 §3.11, D142 (ADR-0051 #90): the hints above the document stand in
// sebaro's callout area, a named region.
describe("DocHints", () => {
  beforeEach(() => {
    useUi.setState({ cloudHintShown: false });
  });

  it("holds the cloud hint and the migration note in sebaro's callout area", () => {
    useVault.setState({ vault: vault("fileProvider", true) });
    render(<DocHints />);
    const area = screen.getByRole("region", { name: "banner.area" });
    expect(area.className).toBe("sb-callout-area nv-doc-hints");
    expect(area.querySelectorAll(".sb-callout")).toHaveLength(2);
    expect(area.textContent).toContain("status.cloud.hintOnce");
    expect(area.textContent).toContain("banner.legacyVault.title");
  });

  it("is empty without a hint, so app.css does not show it", () => {
    useVault.setState({ vault: vault("local") });
    const { container } = render(<DocHints />);
    expect(container.querySelector(".sb-callout-area")?.childNodes).toHaveLength(0);
  });
});
