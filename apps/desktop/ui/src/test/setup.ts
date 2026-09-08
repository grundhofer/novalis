// `globals: false` means Testing Library's automatic cleanup never registers,
// so a component from one test would still be in the document during the next.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
