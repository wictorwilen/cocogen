import { describe, expect, test } from "vitest";

import { buildPrincipalFieldEntries } from "../../src/init/helpers/principal.js";

const headerSource = (header: string) => ({ csvHeaders: [header] });

describe("init/helpers/principal", () => {
  test("normalizes field keys and filters empty paths", () => {
    const fields = [
      { path: "profile.userPrincipalName", source: headerSource("upn") },
      { path: "details.email", source: headerSource("email") },
      { path: "", source: headerSource("ignored") },
    ];

    const entries = buildPrincipalFieldEntries(fields, { csvHeaders: ["fallback"] });

    expect(entries).toEqual([
      { key: "upn", source: headerSource("upn") },
      { key: "email", source: headerSource("email") },
    ]);
  });

  test("falls back to provided source descriptor", () => {
    const fallback = { csvHeaders: ["owner"] };
    const entries = buildPrincipalFieldEntries(null, fallback);
    expect(entries).toEqual([{ key: "upn", source: fallback }]);
  });

  test("returns empty array when no fields or fallback source is provided", () => {
    const entries = buildPrincipalFieldEntries(null, { csvHeaders: [] });
    expect(entries).toEqual([]);
  });
});
