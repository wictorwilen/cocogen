import { describe, expect, test } from "vitest";

import { normalizeInputFormat } from "../../src/tsp/input-format.js";

describe("input-format", () => {
  describe("normalizeInputFormat", () => {
    test("returns csv as default when no value provided", () => {
      expect(normalizeInputFormat()).toBe("csv");
      expect(normalizeInputFormat(undefined)).toBe("csv");
    });

    test("normalizes csv format", () => {
      expect(normalizeInputFormat("csv")).toBe("csv");
      expect(normalizeInputFormat("CSV")).toBe("csv");
      expect(normalizeInputFormat("  csv  ")).toBe("csv");
      expect(normalizeInputFormat("  CSV  ")).toBe("csv");
    });

    test("normalizes json format", () => {
      expect(normalizeInputFormat("json")).toBe("json");
      expect(normalizeInputFormat("JSON")).toBe("json");
      expect(normalizeInputFormat("  json  ")).toBe("json");
      expect(normalizeInputFormat("  JSON  ")).toBe("json");
    });

    test("normalizes yaml format", () => {
      expect(normalizeInputFormat("yaml")).toBe("yaml");
      expect(normalizeInputFormat("YAML")).toBe("yaml");
      expect(normalizeInputFormat("  yaml  ")).toBe("yaml");
      expect(normalizeInputFormat("  YAML  ")).toBe("yaml");
    });

    test("normalizes custom format", () => {
      expect(normalizeInputFormat("custom")).toBe("custom");
      expect(normalizeInputFormat("CUSTOM")).toBe("custom");
      expect(normalizeInputFormat("  custom  ")).toBe("custom");
      expect(normalizeInputFormat("  CUSTOM  ")).toBe("custom");
    });

    test("normalizes rest format", () => {
      expect(normalizeInputFormat("rest")).toBe("rest");
      expect(normalizeInputFormat("REST")).toBe("rest");
      expect(normalizeInputFormat("  rest  ")).toBe("rest");
      expect(normalizeInputFormat("  REST  ")).toBe("rest");
    });

    test("throws error for invalid format", () => {
      expect(() => normalizeInputFormat("invalid")).toThrow(
        "Invalid input format. Expected csv, json, yaml, rest, or custom."
      );
      expect(() => normalizeInputFormat("xml")).toThrow(
        "Invalid input format. Expected csv, json, yaml, rest, or custom."
      );
      expect(() => normalizeInputFormat("txt")).toThrow(
        "Invalid input format. Expected csv, json, yaml, rest, or custom."
      );
      expect(() => normalizeInputFormat("  invalid  ")).toThrow(
        "Invalid input format. Expected csv, json, yaml, rest, or custom."
      );
    });

    test("empty string returns csv (falsy check), whitespace throws error", () => {
      // Empty string is falsy, so !raw returns csv
      expect(normalizeInputFormat("")).toBe("csv");
      // Whitespace string is truthy, but trims to empty, so throws error
      expect(() => normalizeInputFormat("   ")).toThrow(
        "Invalid input format. Expected csv, json, yaml, rest, or custom."
      );
    });
  });
});
