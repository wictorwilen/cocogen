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

  test("@coco.noSource disables default CSV mapping", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;

        @coco.noSource
        title: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    const titleProp = ir.properties.find((p) => p.name === "title");
    expect(titleProp?.source.csvHeaders).toEqual([]);
    expect(titleProp?.source.noSource).toBe(true);
  });

  test("maps principalCollection", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;

        owners: coco.Principal[];
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    const ownersProp = ir.properties.find((p) => p.name === "owners");
    expect(ownersProp?.type).toBe("principalCollection");
    expect(ir.connection.graphApiVersion).toBe("beta");
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

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/Unsupported TypeSpec scalar type: int16/i);
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

  test("captures docs, examples, and validation metadata", async () => {
    const entry = await writeTempTspFile(`
      @doc("Item-level docs")
      @coco.item
      model Item {
        @coco.id
        @example("TCK-1001")
        @pattern("^TCK-[0-9]+$")
        id: string;

        @doc("Display name")
        @example("Ada Lovelace")
        @minLength(2)
        @maxLength(64)
        name: string;

        @format("email")
        @example("ada@contoso.com")
        email: string;

        @minValue(1)
        @maxValue(10)
        rating: int64;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    expect(ir.item.doc).toBe("Item-level docs");

    const idProp = ir.properties.find((p) => p.name === "id");
    expect(idProp?.example).toBe("TCK-1001");
    expect(idProp?.pattern?.regex).toBe("^TCK-[0-9]+$");

    const nameProp = ir.properties.find((p) => p.name === "name");
    expect(nameProp?.doc).toBe("Display name");
    expect(nameProp?.example).toBe("Ada Lovelace");
    expect(nameProp?.minLength).toBe(2);
    expect(nameProp?.maxLength).toBe(64);

    const emailProp = ir.properties.find((p) => p.name === "email");
    expect(emailProp?.format).toBe("email");

    const ratingProp = ir.properties.find((p) => p.name === "rating");
    expect(ratingProp?.minValue).toBe(1);
    expect(ratingProp?.maxValue).toBe(10);
  });

  test("ignores deprecated properties", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;

        #deprecated "Legacy field"
        legacy: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    expect(ir.properties.some((p) => p.name === "legacy")).toBe(false);
  });

  test("errors when #deprecated is used on @coco.id", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        #deprecated "Legacy id"
        id: string;
      }
    `);

    await expect(loadIrFromTypeSpec(entry)).rejects.toThrow(/@coco.id property cannot be marked #deprecated/i);
  });

  test("defaults id encoding to slug", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    expect(ir.item.idEncoding).toBe("slug");
  });

  test("supports @coco.id encoding settings", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id({ encoding: "base64" })
        id: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    expect(ir.item.idEncoding).toBe("base64");
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

  test("allows principal entity mapping without people labels", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;
        @coco.source("manager", "userPrincipalName")
        projectManager: coco.Principal;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    const prop = ir.properties.find((p) => p.name === "projectManager");
    expect(prop?.type).toBe("principal");
    expect(prop?.personEntity?.fields[0]?.path).toBe("userPrincipalName");
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

  test("defaults graph API version to v1.0 when no category or principal", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;
        title: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    expect(ir.connection.graphApiVersion).toBe("v1.0");
  });

  test("uses beta graph API version when contentCategory is set", async () => {
    const entry = await writeTempTspFile(`
      @coco.connection({
        contentCategory: "crm",
        name: "CRM Connector",
        connectionId: "crm-connector",
        connectionDescription: "CRM data"
      })
      @coco.item
      model Item {
        @coco.id
        id: string;
        title: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    expect(ir.connection.graphApiVersion).toBe("beta");
  });

  test("uses beta graph API version when principal properties are present", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;
        owner: coco.Principal;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    expect(ir.connection.graphApiVersion).toBe("beta");
  });

  test("falls back to property name for blank @coco.source", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id
        id: string;
        @coco.source("   ")
        title: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    const titleProp = ir.properties.find((p) => p.name === "title");
    expect(titleProp?.source.csvHeaders).toEqual(["title"]);
  });

  test("supports hash id encoding", async () => {
    const entry = await writeTempTspFile(`
      @coco.item
      model Item {
        @coco.id({ encoding: "hash" })
        id: string;
      }
    `);

    const ir = await loadIrFromTypeSpec(entry);
    expect(ir.item.idEncoding).toBe("hash");
  });
});
