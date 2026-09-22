import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useVault } from "../stores/vault";
import LegacyHint from "./LegacyHint";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
    expect(container.textContent).toContain("banner.legacyVault.step1");

    fireEvent.click(screen.getByText("banner.dismiss"));
    expect(container.innerHTML).toBe("");
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
