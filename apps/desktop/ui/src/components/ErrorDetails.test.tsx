import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { errorKey, errorValues, NovalisError } from "../ipc/client";
import ErrorDetails, { detailsOf } from "./ErrorDetails";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const ipc = (code: string, detail?: string) =>
  new NovalisError({ code, path: "a.md", detail: detail ?? null, name: null, candidates: [] });

// spec/02 §3.28, spec/07 §4.1, TXT-07.
describe("ErrorDetails", () => {
  it("is sebaro's closed details: chevron and „Details“, then the text in a samp", () => {
    const { container } = render(<ErrorDetails text="EACCES: open 'Archiv/2026/Wochen_plan.md'" />);
    const details = container.firstElementChild as HTMLDetailsElement;
    expect(details.tagName).toBe("DETAILS");
    expect(details.className).toBe("sb-details");
    expect(details.open).toBe(false);
    const summary = details.querySelector(":scope > summary")!;
    expect(summary.textContent).toBe("errors.details");
    const icon = summary.querySelector("svg")!;
    expect(icon.getAttribute("class")).toBe("sb-icon sb-icon--16");
    expect(icon.querySelector("use")?.getAttribute("href")).toBe("#chevron-down--16");
    const samp = details.querySelector(":scope > samp.sb-details__text")!;
    expect(samp.textContent).toBe("EACCES: open 'Archiv/2026/Wochen_plan.md'");
    // A path breaks between its parts first: after each / _ and .
    expect(samp.querySelectorAll("wbr")).toHaveLength(4);
  });

  it("takes the detail only of the sentences that leave it out", () => {
    expect(detailsOf(errorKey(ipc("io", "Permission denied")), errorValues(ipc("io", "Permission denied")))).toBe(
      "Permission denied",
    );
    expect(detailsOf(errorKey(ipc("parse", "line 3")), errorValues(ipc("parse", "line 3")))).toBe("line 3");
    expect(detailsOf(errorKey(ipc("bad_request", "too big")), errorValues(ipc("bad_request", "too big")))).toBe(
      "too big",
    );
    // A parse error without a path has its own sentence, with the same details.
    const unknown = new NovalisError({ code: "parse", path: null, detail: "EOF at line 1", name: null, candidates: [] });
    expect(errorKey(unknown)).toBe("errors.parseUnknown");
    expect(detailsOf(errorKey(unknown), errorValues(unknown))).toBe("EOF at line 1");
    expect(errorKey(ipc("parse", "line 3"))).toBe("errors.parse");
    expect(detailsOf(errorKey(new Error("boom")), errorValues(new Error("boom")))).toBe("Error: boom");
    // A sentence that says it all, or a detail that is no text for people.
    expect(detailsOf(errorKey(ipc("not_found", "x")), errorValues(ipc("not_found", "x")))).toBeNull();
    expect(detailsOf(errorKey(ipc("invalid_path", "symlink")), errorValues(ipc("invalid_path", "symlink")))).toBeNull();
    expect(detailsOf("errors.io", {})).toBeNull();
  });
});
