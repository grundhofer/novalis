// @vitest-environment jsdom
//
// Closes a standing hole: until now NOTHING in this repo rendered a formula, so
// every katex bump passed CI on the strength of "it still installs".
//
// The second block is the one that actually needed writing.
// `pnpm-workspace.yaml` forces a single `katex: ^0.18.4` across the workspace,
// because `mermaid@11.16.1` — the latest — depends on `katex: ^0.16.45`, and
// without the override the tree carries both copies and the shipped chunk
// doubles (measured: 255 kB -> 511 kB raw, 76 kB -> 151 kB gzip). The price is
// that mermaid runs against a katex TWO MAJORS beyond its declared range, and
// mermaid renders diagram-label math through katex itself. Nothing else checks
// that, and the override lives in a file Dependabot cannot even see.
//
// LIMIT, stated so nobody reads more into a green run than is there: jsdom has
// no SVG layout engine, so `getBBox` is stubbed. These tests prove the
// integration — mermaid drives katex, katex produces KaTeX markup, neither
// throws — and prove nothing about glyphs, metrics or layout. A human still has
// to look at a rendered diagram once.

import { beforeAll, describe, expect, it } from "vitest";

interface KatexLike {
  renderToString(tex: string, options: { displayMode: boolean; throwOnError: boolean }): string;
}

async function loadKatex(): Promise<KatexLike> {
  const mod = (await import("katex")) as unknown as { default?: KatexLike } & KatexLike;
  return mod.default ?? mod;
}

async function loadMermaid() {
  const mod = await import("mermaid");
  return ((mod as unknown as { default?: unknown }).default ?? mod) as {
    initialize(config: Record<string, unknown>): void;
    render(id: string, src: string): Promise<{ svg: string }>;
  };
}

describe("katex", () => {
  it("renders inline and display math the way Math.ts asks for it", async () => {
    const katex = await loadKatex();

    // Same call shape as Math.ts:45, notably `throwOnError: false`.
    const inline = katex.renderToString("a^2 + b^2 = c^2", {
      displayMode: false,
      throwOnError: false,
    });
    expect(inline).toContain("katex");
    expect(inline).not.toContain("<script");

    const display = katex.renderToString("\\frac{a}{b}", {
      displayMode: true,
      throwOnError: false,
    });
    expect(display).toContain("katex-display");
  });

  it("degrades on malformed input instead of throwing through throwOnError", async () => {
    const katex = await loadKatex();
    // katex 0.18.4's changelog names this shape as one that previously escaped
    // `throwOnError: false` and crashed the caller. `Math.ts` only survives that
    // today because `render()` wraps the call in try/catch.
    expect(() =>
      katex.renderToString("\\begin{ma trix}", { displayMode: false, throwOnError: false }),
    ).not.toThrow();
  });
});

describe("mermaid against the overridden katex", () => {
  beforeAll(() => {
    // jsdom implements no SVG layout. Without these, mermaid dies with
    // "text2.getBBox is not a function" before reaching any label content.
    const proto = (globalThis as unknown as { SVGElement: { prototype: Record<string, unknown> } })
      .SVGElement.prototype;
    proto.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 });
    proto.getComputedTextLength = () => 100;
  });

  it("renders a plain diagram", async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({ startOnLoad: false });
    const { svg } = await mermaid.render("test-plain", "graph TD\n  A[Start] --> B[End]");
    expect(svg).toContain("<svg");
  }, 60_000);

  it("drives katex for math in a diagram label, rather than leaving it raw", async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({ startOnLoad: false });
    const { svg } = await mermaid.render(
      "test-math",
      'graph TD\n  A["$$a^2+b^2=c^2$$"] --> B[Done]',
    );

    expect(svg).toContain("<svg");
    // The assertion that matters: KaTeX markup is present AND the raw TeX is
    // gone. If the override ever puts mermaid on a katex it cannot use, this
    // flips to raw source with no error anywhere.
    expect(svg).toContain("katex");
    expect(svg).not.toContain("a^2+b^2=c^2");
  }, 60_000);
});
