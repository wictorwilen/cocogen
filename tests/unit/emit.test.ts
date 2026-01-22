import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeIrJson } from "../../src/emit/emit.js";
import { writeTempDir } from "../test-utils.js";
import type { ConnectorIr } from "../../src/ir.js";

function baseIr(): ConnectorIr {
  return {
    connection: { graphApiVersion: "v1.0", inputFormat: "csv" },
    item: { typeName: "Item", idPropertyName: "id", idEncoding: "slug" },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"] },
      },
    ],
  };
}

describe("writeIrJson", () => {
  test("returns JSON when no outPath is provided", async () => {
    const json = await writeIrJson(baseIr());
    expect(json).toContain("\"graphApiVersion\": \"v1.0\"");
    expect(json).toContain("\"typeName\": \"Item\"");
  });

  test("writes JSON to disk when outPath is provided", async () => {
    const dir = await writeTempDir();
    const outPath = path.join(dir, "ir.json");

    const result = await writeIrJson(baseIr(), outPath);

    expect(result).toBe(path.resolve(outPath));
    const onDisk = await readFile(outPath, "utf8");
    expect(onDisk).toContain("\"idPropertyName\": \"id\"");
  });
});
