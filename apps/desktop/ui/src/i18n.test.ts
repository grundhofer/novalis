import { afterAll, beforeAll, describe, expect, it } from "vitest";

import i18next, { formatCount, initI18n, setLocale } from "./i18n";

// spec/07 §3 rule 4: counts in the language's digits, „12.000“ / „12,000“;
// line and column numbers carry no separator (D105 (45)).

describe("numbers in the catalog", () => {
  beforeAll(async () => {
    await initI18n("de");
  });
  afterAll(async () => {
    await setLocale("en");
  });

  it("puts German thousands separators into counts", () => {
    expect(i18next.t("status.words", { count: 12000 })).toBe("12.000\u00a0Wörter");
    expect(i18next.t("status.words", { count: 1 })).toBe("1\u00a0Wort");
    expect(i18next.t("editor.find.matchCount", { current: 1, count: 12000 })).toBe("Treffer 1 von 12.000");
    expect(i18next.t("editor.find.matchTotal", { count: 1000 })).toBe("1.000\u00a0Treffer");
    expect(formatCount(12000)).toBe("12.000");
  });

  it("leaves line and column numbers bare", () => {
    expect(i18next.t("status.position", { line: 1000, column: 4 })).toBe("Zeile 1000, Spalte 4");
  });

  it("switches to English separators with the language", async () => {
    await setLocale("en");
    expect(i18next.t("status.words", { count: 12000 })).toBe("12,000\u00a0words");
    expect(i18next.t("editor.search.results", { count: 12000 })).toBe("12,000\u00a0matches");
    expect(formatCount(12000)).toBe("12,000");
  });
});
