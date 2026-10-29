import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import de from "../../../../../i18n/de.json";
import en from "../../../../../i18n/en.json";
import NoVault from "./NoVault";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// spec/02 §3.14, DAT-07, ADR-0048: heading and one sentence, no button of its own.
describe("NoVault", () => {
  it("is sebaro's empty state on its own, without a button", () => {
    const { container } = render(<NoVault />);
    // `App` puts it alone into `.sb-window__content`, which sebaro centres
    // (NV-E18): no wrapper of its own.
    expect(container.children).toHaveLength(1);
    const empty = container.firstElementChild!;
    expect(empty.className).toBe("sb-empty");
    const title = empty.querySelector("h1.sb-empty__title")!;
    expect(title.textContent).toBe("app.openVault.title");
    expect(empty.querySelector("p.sb-empty__text")?.textContent).toBe("app.openVault.body");
    expect(empty.children).toHaveLength(2);
    expect(container.querySelector("button, a")).toBeNull();
  });

  // DAT-07, spec/07 §4.2: one sentence how the view fills.
  it("says how the window fills in one sentence, in both languages", () => {
    for (const catalog of [de, en]) {
      const body = catalog["app.openVault.body"];
      expect(body.match(/[.?!](\s|$)/gu)).toHaveLength(1);
      expect(body.endsWith(".")).toBe(true);
    }
  });
});
