import { describe, expect, it } from "vitest";

import { windowPlaces, windowTitle } from "./windowTitle";

describe("windowPlaces", () => {
  it("names the vault, its folders and the note", () => {
    expect(windowPlaces("Vault", "notes/2026/Atlas Overview.md", null)).toEqual([
      "Vault",
      "notes",
      "2026",
      "Atlas Overview",
    ]);
    expect(windowPlaces("Vault", null, null)).toEqual(["Vault"]);
    expect(windowPlaces(null, null, null)).toEqual([]);
  });

  it("names the vault and the board while the board shows", () => {
    expect(windowPlaces("Vault", "notes/a.md", "Wochenplan")).toEqual(["Vault", "Wochenplan"]);
  });

  // ADR-0047: a file from outside the vault is not the vault's.
  it("names a file from outside the vault by its own folders", () => {
    expect(windowPlaces("Vault", "/Users/me/Downloads/draußen.md", null)).toEqual([
      "Users",
      "me",
      "Downloads",
      "draußen",
    ]);
  });
});

// spec/02 §4.17, spec/11 §1a: „<current place> · <app>“.
describe("windowTitle", () => {
  // DSK-06: never the app's name alone; without a place the empty state's
  // heading is the place.
  it("names the current place and the app, or the empty state and the app", () => {
    expect(windowTitle(["Vault", "notes", "Atlas Overview"], "No vault open", "novalis")).toBe(
      "Atlas Overview · novalis",
    );
    expect(windowTitle(["Vault"], "No vault open", "novalis")).toBe("Vault · novalis");
    expect(windowTitle([], "No vault open", "novalis")).toBe("No vault open · novalis");
  });
});
