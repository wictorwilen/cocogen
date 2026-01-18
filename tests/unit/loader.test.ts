import { describe, expect, test } from "vitest";

import { loadIrFromTypeSpec } from "../../src/tsp/loader.js";
import { writeTempTspFile } from "../test-utils.js";

describe("loadIrFromTypeSpec", () => {
  test("loads description from doc comment when @coco.description is absent", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;

        /** Doc description */
        title: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    const titleProp = ir.properties.find((p) => p.name === "title");
    expect(titleProp?.description).toBe("Doc description");
  });

  test("@coco.description overrides doc comment", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;

        /** Doc description */
        @coco.description("Decorator description")
        title: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    const titleProp = ir.properties.find((p) => p.name === "title");
    expect(titleProp?.description).toBe("Decorator description");
  });

  test("rejects principalCollection", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;

        owners: coco.Principal[];
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/principalCollection is not supported/i);
  });

  test("rejects nested models", async () => {
    const entry = await writeTempTspFile(`
      model Nested {
        value: string;
      }

      @coco.item
      model Item {
        @coco.id
        id: string;

        nested: Nested;
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/Nested models are not supported/i);
  });

  test("rejects unsupported scalar types", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;

        count: int16;
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/Unsupported TypeSpec property type kind/i);
  });

  test("rejects unsupported collection element types", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;

        counts: int16[];
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/Unsupported collection element type/i);
  });

  test("surfaces TypeSpec compile errors", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/TypeSpec compilation failed/i);
  });

  test("errors when no @coco.item model exists", async () => {
    const entry = await writeTempTspFile(`
      model Item {
        @coco.id
        id: string;
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/No @coco.item/);
  });

  test("errors when multiple @coco.item models exist", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model First {
        @coco.id
        id: string;
      }

      @coco.item
      model Second {
        @coco.id
        id: string;
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/Multiple @coco.item/);
  });

  test("errors when @coco.id is missing", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        title: string;
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/Missing @coco.id/);
  });

  test("errors when multiple @coco.id properties exist", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id1: string;
        @coco.id
        id2: string;
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/Multiple @coco.id/);
  });

  test("errors when people entity mappings are missing labels", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;
        @coco.source("upn", "userPrincipalName")
        account: string;
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/missing a people label/i);
  });

  test("errors on invalid source settings", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;
        @coco.source({ csv: ["a", "b"] })
        title: string;
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/TypeSpec compilation failed/i);
  });
});
