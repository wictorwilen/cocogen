import { describe, expect, test } from "vitest";

import { assertValidJsonPath, normalizeJsonPath } from "../../src/tsp/jsonpath.js";

test("normalizeJsonPath handles basic paths", () => {
  expect(normalizeJsonPath("")).toBe("");
  expect(normalizeJsonPath("  ")).toBe("");
  expect(normalizeJsonPath("$")).toBe("$");
  expect(normalizeJsonPath("$.foo")).toBe("$.foo");
  expect(normalizeJsonPath("[0]")).toBe("$[0]");
  expect(normalizeJsonPath("[*]")).toBe("$[*]");
  expect(normalizeJsonPath("items[0].name")).toBe("$.items[0].name");
  expect(normalizeJsonPath("items[0][1]")).toBe("$.items[0][1]");
});

test("normalizeJsonPath quotes segments with special characters", () => {
  expect(normalizeJsonPath("my field")).toBe("$['my field']");
  expect(normalizeJsonPath("meta['source.id']")).toBe("$.meta['source.id']");
  expect(normalizeJsonPath("meta[\"source.id\"]")).toBe("$.meta[\"source.id\"]");
  expect(normalizeJsonPath("meta.source-id")).toBe("$.meta['source-id']");
  expect(normalizeJsonPath("meta['O\\'Reilly']")).toBe("$.meta['O\\'Reilly']");
  expect(normalizeJsonPath("meta\\path")).toBe("$['meta\\\\path']");
  expect(normalizeJsonPath("meta[\"O'Reilly\"]")).toBe("$.meta[\"O'Reilly\"]");
  expect(normalizeJsonPath("meta['She said \\\"hi\\\"']")).toBe("$.meta['She said \\\"hi\\\"']");
  expect(normalizeJsonPath("meta[\"She said 'hi'\"]")).toBe("$.meta[\"She said 'hi'\"]");
  expect(normalizeJsonPath("meta['a\\\\b']")).toBe("$.meta['a\\\\b']");
});

describe("assertValidJsonPath", () => {
  test("accepts empty or whitespace", () => {
    expect(() => assertValidJsonPath("")).not.toThrow();
    expect(() => assertValidJsonPath("  ")).not.toThrow();
  });

  test("accepts valid jsonpath", () => {
    expect(() => assertValidJsonPath("$.items[0].name")).not.toThrow();
    expect(() => assertValidJsonPath("$['weird.key']")).not.toThrow();
    expect(() => assertValidJsonPath("$['O\\'Reilly']")).not.toThrow();
    expect(() => assertValidJsonPath("$[\"O'Reilly\"]")).not.toThrow();
    expect(() => assertValidJsonPath("$['She said \\\"hi\\\"']")).not.toThrow();
    expect(() => assertValidJsonPath("$[\"She said 'hi'\"]")).not.toThrow();
  });

  test("rejects unbalanced brackets or quotes", () => {
    expect(() => assertValidJsonPath("]")).toThrow(/Unbalanced brackets/);
    expect(() => assertValidJsonPath("$.items[0")).toThrow(/Unbalanced brackets/);
    expect(() => assertValidJsonPath("$['unterminated]")).toThrow(/Unbalanced brackets or quotes/);
  });

  test("rejects empty bracket expressions", () => {
    expect(() => assertValidJsonPath("$.items[]")).toThrow(/Empty bracket expression/);
  });

  test("rejects invalid JSONPath syntax", () => {
    expect(() => assertValidJsonPath("$..@")).toThrow(/Invalid JSONPath syntax/);
  });

  test("uses custom error factory", () => {
    const factory = (message: string) => new TypeError(message);
    expect(() => assertValidJsonPath("]", factory)).toThrow(TypeError);
  });
});
