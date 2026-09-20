import { describe, expect, it } from "vitest";

import { burstSize, summarize } from "./perf";

describe("perf probe helpers", () => {
  it("summarizes an empty and a small sample set", () => {
    expect(summarize([])).toEqual({ n: 0, p50: 0, p95: 0, max: 0 });
    expect(summarize([5, 1, 3, 2, 4])).toEqual({ n: 5, p50: 3, p95: 5, max: 5 });
    expect(summarize([16.66, 16.71])).toEqual({ n: 2, p50: 16.7, p95: 16.7, max: 16.7 });
  });

  it("reads the burst size only from a type:<n> mode", () => {
    expect(burstSize("type:120")).toBe(120);
    expect(burstSize("1")).toBe(0);
    expect(burstSize("type:")).toBe(0);
    expect(burstSize("type:12x")).toBe(0);
  });
});
