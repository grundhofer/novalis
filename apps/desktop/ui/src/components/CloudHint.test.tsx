import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../stores/ui";
import { useVault } from "../stores/vault";
import CloudHint from "./CloudHint";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const vault = (kind: "local" | "fileProvider" | "mirrored") =>
  ({ root: "/v", name: "v", kind, boards: [] }) as never;

describe("CloudHint", () => {
  beforeEach(() => {
    useUi.setState({ cloudHintShown: false });
  });

  it("says it once for a cloud vault and stays away after dismissal", () => {
    useVault.setState({ vault: vault("fileProvider") });
    const { container } = render(<CloudHint />);
    expect(screen.getByText("status.cloud.hintOnce")).toBeTruthy();

    fireEvent.click(screen.getByText("banner.dismiss"));
    expect(useUi.getState().cloudHintShown).toBe(true);
    expect(container.innerHTML).toBe("");
  });

  it("has nothing to say for a local vault, or once it was said", () => {
    useVault.setState({ vault: vault("local") });
    expect(render(<CloudHint />).container.innerHTML).toBe("");

    useVault.setState({ vault: vault("mirrored") });
    useUi.setState({ cloudHintShown: true });
    expect(render(<CloudHint />).container.innerHTML).toBe("");
  });
});
