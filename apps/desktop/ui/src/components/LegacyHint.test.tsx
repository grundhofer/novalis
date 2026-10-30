import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useVault } from "../stores/vault";
import LegacyHint from "./LegacyHint";

// The step's command in backticks, as the catalogs write it.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "banner.legacyVault.step1" ? "Run `novalis migrate --dry-run`." : key),
  }),
}));

const vault = (root: string, legacy: boolean) => ({ root, name: root, kind: "local" as const, boards: [], legacy });

// feature-gaps A32: PLAN.md §10's read-only first-open prompt.
describe("LegacyHint", () => {
  beforeEach(() => {
    useVault.setState({ vault: null });
  });

  it("says what to run in a vault the old app wrote, until dismissed", () => {
    useVault.setState({ vault: vault("/old", true) as never });
    const { container } = render(<LegacyHint />);
    expect(screen.getByText("banner.legacyVault.title")).toBeTruthy();
    expect(container.textContent).toContain("Run novalis migrate --dry-run. banner.legacyVault.step2");
    // sebaro's note callout (STA-05): titled, the text wraps instead of
    // hiding in a tooltip (ZUG-09), the action a secondary one.
    // A polite live region around it announces it when it appears.
    expect(container.firstElementChild?.getAttribute("role")).toBe("status");
    const callout = container.querySelector(".sb-callout")!;
    expect(callout.className).toBe("sb-callout sb-callout--note nv-callout");
    expect(callout.getAttribute("aria-labelledby")).toBe(screen.getByText("banner.legacyVault.title").id);
    expect(container.querySelector("[title]")).toBeNull();
    expect(screen.getByText("banner.dismiss").className).toBe("sb-text-action sb-text-action--compact sb-callout__hide");

    fireEvent.click(screen.getByText("banner.dismiss"));
    expect(container.innerHTML).toBe("");
  });

  it("sets the command the step names in code (spec/07 §3 rule 11)", () => {
    useVault.setState({ vault: vault("/old", true) as never });
    const { container } = render(<LegacyHint />);
    expect([...container.querySelectorAll(".sb-callout__text code")].map((code) => code.textContent)).toEqual([
      "novalis migrate --dry-run",
    ]);
  });

  it("says nothing in a vault that is not the old app's or was migrated", () => {
    useVault.setState({ vault: vault("/new", false) as never });
    expect(render(<LegacyHint />).container.innerHTML).toBe("");
  });

  it("comes back for another legacy vault after one was dismissed", () => {
    useVault.setState({ vault: vault("/old", true) as never });
    const { rerender } = render(<LegacyHint />);
    fireEvent.click(screen.getByText("banner.dismiss"));
    useVault.setState({ vault: vault("/older", true) as never });
    rerender(<LegacyHint />);
    expect(screen.getByText("banner.legacyVault.title")).toBeTruthy();
  });
});
