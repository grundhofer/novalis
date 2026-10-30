import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FileName, withFileNames } from "./FileName";

/** A catalog in miniature: `{{name}}` filled in, as i18next does. */
const CATALOG: Record<string, string> = {
  "errors.notFound": "{{path}} wurde nicht gefunden.",
  "tree.movedTo": "Nach „{{folder}}“ verschoben.",
};
const translate = (key: string, values: Record<string, string | number>) =>
  CATALOG[key]!.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name]));

// D100 (6), ZUG-09: a file name breaks only after - . _ / and without a
// hyphen; the name stays whole for a screen reader and a copy.
describe("FileName", () => {
  it("puts a break opportunity after each separator and adds no character", () => {
    const { container } = render(<FileName name="Notes/2026-10-25_plan.md" />);
    const name = container.querySelector(".sb-file-name")!;
    expect(name.textContent).toBe("Notes/2026-10-25_plan.md");
    expect(name.innerHTML).toBe("Notes/<wbr>2026-<wbr>10-<wbr>25_<wbr>plan.<wbr>md");
  });

  it("does not break after the separators a name starts with, nor inside a run", () => {
    const { container } = render(<FileName name="/srv/notes//a.md" />);
    expect(container.querySelector(".sb-file-name")!.innerHTML).toBe("/srv/<wbr>notes//<wbr>a.<wbr>md");
    const hidden = render(<FileName name=".gitignore" />).container;
    expect(hidden.querySelector(".sb-file-name")!.innerHTML).toBe(".gitignore");
  });

  it("leaves a name without separators alone", () => {
    const { container } = render(<FileName name="README" />);
    expect(container.querySelector(".sb-file-name")!.innerHTML).toBe("README");
  });

  it("marks the path in a catalog sentence, keeping the catalog's word order", () => {
    const { container } = render(<p>{withFileNames(translate, "errors.notFound", { path: "a/b.md" })}</p>);
    expect(container.textContent).toBe("a/b.md wurde nicht gefunden.");
    expect(container.querySelector(".sb-file-name")!.innerHTML).toBe("a/<wbr>b.<wbr>md");

    const moved = render(<p>{withFileNames(translate, "tree.movedTo", { folder: "Archiv/2026" })}</p>).container;
    expect(moved.textContent).toBe("Nach „Archiv/2026“ verschoben.");
    expect(moved.querySelector(".sb-file-name")!.textContent).toBe("Archiv/2026");
  });

  it("is the plain sentence when no value is a file name", () => {
    expect(withFileNames(translate, "tree.movedTo", { board: "x", folder: "" })).toBe("Nach „“ verschoben.");
  });
});
