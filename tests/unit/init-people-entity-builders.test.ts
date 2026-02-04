import { describe, expect, test } from "vitest";

import {
  buildCsPersonEntityCollectionExpression,
  buildCsPersonEntityExpression,
  buildCsPersonEntityObjectExpression,
  type CsPersonEntityTypeInfo,
  type CsPersonEntityTypeMap,
} from "../../src/init/dotnet/people-entity.js";
import {
  buildTsPersonEntityCollectionExpression,
  buildTsPersonEntityExpression,
  type TsPersonEntityTypeInfo,
  type TsPersonEntityTypeMap,
} from "../../src/init/ts/people-entity.js";
import type { PersonEntityField } from "../../src/init/shared-types.js";

const csvField = (path: string, header: string): PersonEntityField => ({
  path,
  source: { csvHeaders: [header] },
});

const jsonField = (path: string, jsonPath: string): PersonEntityField => ({
  path,
  source: { csvHeaders: [], jsonPath },
});

const tsTypeMap: TsPersonEntityTypeMap = new Map([
  [
    "SkillEntry",
    {
      alias: "SkillEntry",
      properties: new Map([
        ["name", "string"],
        ["level", "string"],
      ]),
    },
  ],
  [
    "PositionInfo",
    {
      alias: "PositionInfo",
      properties: new Map([
        ["title", "string"],
        ["organizations", "OrganizationInfo[]"],
      ]),
    },
  ],
  [
    "OrganizationInfo",
    {
      alias: "OrganizationInfo",
      properties: new Map([["name", "string"]]),
    },
  ],
]);

const tsPersonType: TsPersonEntityTypeInfo = {
  alias: "PersonRecord",
  properties: new Map([
    ["displayName", "string"],
    ["skills", "SkillEntry[]"],
    ["position", "PositionInfo"],
    ["tags", "string[]"],
  ]),
};

const csTypeMap: CsPersonEntityTypeMap = new Map<string, CsPersonEntityTypeInfo>([
  [
    "SkillEntry",
    {
      typeName: "SkillEntry",
      properties: new Map([
        ["name", { csName: "Name", csType: "string?" }],
        ["level", { csName: "Level", csType: "string?" }],
      ]),
    },
  ],
  [
    "PositionInfo",
    {
      typeName: "PositionInfo",
      properties: new Map([
        ["title", { csName: "Title", csType: "string?" }],
        ["organizations", { csName: "Organizations", csType: "List<OrganizationInfo>?" }],
      ]),
    },
  ],
  [
    "OrganizationInfo",
    {
      typeName: "OrganizationInfo",
      properties: new Map([["name", { csName: "Name", csType: "string?" }]]),
    },
  ],
]);

const csPersonType: CsPersonEntityTypeInfo = {
  typeName: "PersonRecord",
  properties: new Map([
    ["displayName", { csName: "DisplayName", csType: "string?" }],
    ["skills", { csName: "Skills", csType: "List<SkillEntry>?" }],
    ["position", { csName: "Position", csType: "PositionInfo?" }],
    ["tags", { csName: "Tags", csType: "List<string>?" }],
  ]),
};

describe("init people entity builders", () => {
  describe("TypeScript buildTsPersonEntityExpression", () => {
    test("renders typed objects and collections", () => {
      const fields: PersonEntityField[] = [
        csvField("displayName", "Display Name"),
        csvField("skills.name", "Skill Name"),
        csvField("skills.level", "Skill Level"),
        csvField("position.title", "Title"),
        csvField("position.organizations.name", "Organization"),
        csvField("tags", "Tag"),
      ];

      const expression = buildTsPersonEntityExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("JSON.stringify(");
      expect(expression).toContain(`"skills": (() => {`);
      expect(expression).toContain(`"tags": parseStringCollection`);
    });

    test("falls back to plain objects when type info is missing", () => {
      const expression = buildTsPersonEntityExpression([csvField("nickname", "Nickname")], undefined, null, tsTypeMap);
      expect(expression).toContain(`"nickname": parseString(readSourceValue(row, ["Nickname"]))`);
    });

    test("handles nested objects without type info", () => {
      const fields = [
        csvField("user.name", "Name"),
        csvField("user.email", "Email"),
      ];
      const expression = buildTsPersonEntityExpression(fields, undefined, null, new Map());
      expect(expression).toContain(`"user":`);
      expect(expression).toContain(`"name":`);
      expect(expression).toContain(`"email":`);
    });

    test("handles nested typed objects", () => {
      const fields = [
        csvField("position.title", "Title"),
        csvField("position.organizations.name", "Org"),
      ];
      const expression = buildTsPersonEntityExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("as PositionInfo");
      expect(expression).toContain(`"organizations": (() => {`);
    });

    test("handles string collections in nested objects", () => {
      const nestedTypeMap = new Map<string, TsPersonEntityTypeInfo>([
        ...tsTypeMap.entries(),
        [
          "ProfileData",
          {
            alias: "ProfileData",
            properties: new Map([["hobbies", "string[]"]]),
          },
        ],
      ]);
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "User",
        properties: new Map([["profile", "ProfileData"]]),
      };
      const fields = [csvField("profile.hobbies", "Hobbies")];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, nestedTypeMap);
      expect(expression).toContain("parseStringCollection");
    });

    test("handles unknown nested types gracefully", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "User",
        properties: new Map([["metadata", "UnknownType"]]),
      };
      const fields = [csvField("metadata.key", "Key")];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain(`"metadata":`);
    });

    test("handles empty fields for collections", () => {
      const fields = [csvField("emptyList.item", "Item")];
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([["emptyList", "ItemType[]"]]),
      };
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain(`"emptyList": (() => {`);
      expect(expression).toContain("return undefined");
    });

    test("handles collection of primitives (strings)", () => {
      const fields = [csvField("tags", "Tags")];
      const expression = buildTsPersonEntityExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain(`"tags": parseStringCollection`);
    });

    test("handles collection with single field and element info", () => {
      const fields = [csvField("skills.name", "Skill")];
      const expression = buildTsPersonEntityExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("values.map((value) =>");
      expect(expression).toContain("as SkillEntry");
    });

    test("handles collection without element info (unknown type)", () => {
      const fields = [csvField("items.value", "Value")];
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "UnknownItem[]"]]),
      };
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain(`"items": (() => {`);
      expect(expression).toContain("values.map((value) =>");
    });

    test("handles multi-field collections with getValue helper", () => {
      const fields = [
        csvField("skills.name", "Skill Name"),
        csvField("skills.level", "Skill Level"),
      ];
      const expression = buildTsPersonEntityExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("const getValue = (values: string[], index: number): string =>");
      expect(expression).toContain("if (values.length === 0) return");
      expect(expression).toContain("if (values.length === 1) return values[0]");
      expect(expression).toContain("return values[index]");
      expect(expression).toContain("const maxLen = Math.max(0, ...lengths);");
    });

    test("handles deeply nested collections", () => {
      const fields = [csvField("position.organizations.name", "Org Name")];
      const expression = buildTsPersonEntityExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain(`"position":`);
      expect(expression).toContain(`"organizations": (() => {`);
    });

    test("handles renderNode with array property field", () => {
      const fields = [csvField("tags", "Tags")];
      const expression = buildTsPersonEntityExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain(`"tags": parseStringCollection(readSourceValue(row, ["Tags"]))`);
    });

    test("handles renderNode with nested array property", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([["nested", "Nested"]]),
      };
      const nestedType: TsPersonEntityTypeInfo = {
        alias: "Nested",
        properties: new Map([["items", "string[]"]]),
      };
      const typeMap = new Map([[nestedType.alias, nestedType]]);
      const fields = [csvField("nested.items", "Items")];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain(`"nested":`);
      expect(expression).toContain("parseStringCollection");
    });

    test("handles renderNode with nested non-array property and type", () => {
      const fields = [csvField("position.title", "Title")];
      const expression = buildTsPersonEntityExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("as PositionInfo");
    });

    test("handles custom value expression builder", () => {
      const fields = [csvField("name", "Name")];
      const customBuilder = (src: string) => `customParse(${src})`;
      const expression = buildTsPersonEntityExpression(fields, customBuilder, null, new Map());
      expect(expression).toContain("customParse(");
    });

    test("handles renderNodeForCollection without elementInfo", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "UnknownType[]"]]),
      };
      const fields = [csvField("items.value", "Value")];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain(`"items": (() => {`);
      expect(expression).toContain("values.map((value) =>");
    });

    test("handles renderCollectionNode in renderNode with custom type", () => {
      const itemType: TsPersonEntityTypeInfo = {
        alias: "CustomItem",
        properties: new Map([["name", "string"]]),
      };
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "CustomItem[]"]]),
      };
      const typeMap = new Map([[itemType.alias, itemType]]);
      const fields = [csvField("items.name", "Name")];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("as CustomItem");
      expect(expression).toContain("values.map((value) =>");
    });
  });

  describe("TypeScript buildTsPersonEntityCollectionExpression", () => {
    test("handles single-field collections", () => {
      const fields = [csvField("skills.name", "Skill Name")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain(".map((value) => JSON.stringify(");
    });

    test("applies defaults for single-field collections", () => {
      const fields: PersonEntityField[] = [
        { path: "tags", source: { csvHeaders: ["Tag"], default: "fallback" } },
      ];
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([["tags", "string[]"]]),
      };
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("applyDefaultCollection(");
      expect(expression).toContain("\"fallback\"");
    });

    test("handles single string-collection fields", () => {
      const fields = [csvField("tags", "Tag Value")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain(`"tags": (value ? [value] : [])`);
    });

    test("builds multi-field collectors", () => {
      const fields = [
        csvField("skills.name", "Skill Name"),
        csvField("skills.level", "Skill Level"),
        csvField("position.title", "Title"),
      ];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("getCollectionValue");
      expect(expression).toContain("const maxLen = Math.max(0, ...lengths);");
    });

    test("applies defaults for multi-field collections", () => {
      const fields: PersonEntityField[] = [
        { path: "tags", source: { csvHeaders: ["Tag"], default: "fallback" } },
        csvField("skills.name", "Skill Name"),
      ];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("applyDefaultCollection(");
      expect(expression).toContain("\"fallback\"");
    });

    test("wraps scalar references for string arrays", () => {
      const fields = [
        csvField("tags", "Tag Value"),
        csvField("skills.name", "Skill Name"),
        csvField("skills.level", "Skill Level"),
      ];

      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("const getCollectionValue = (values: string[], index: number): string[] => {");
      expect(expression).toContain("getCollectionValue(field0, index)");
    });

    test("handles nested collections within multi-field collections", () => {
      const fields = [
        csvField("skills.name", "Skill Name"),
        csvField("position.organizations.name", "Org Name"),
      ];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("getValue");
      expect(expression).toContain(`"organizations": (() => {`);
    });

    test("handles string arrays in nested structures", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([["nested", "NestedType"]]),
      };
      const nestedType: TsPersonEntityTypeInfo = {
        alias: "NestedType",
        properties: new Map([["tags", "string[]"]]),
      };
      const typeMap = new Map([[nestedType.alias, nestedType]]);
      const fields = [csvField("nested.tags", "Tags")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain(`"nested":`);
    });

    test("handles collection of unknown element types", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "UnknownType[]"]]),
      };
      const fields = [csvField("items.value", "Value")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("values.map((value) =>");
    });

    test("handles empty collections gracefully", () => {
      const fields = [csvField("emptyArray.item", "Item")];
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["emptyArray", "ItemType[]"]]),
      };
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("return undefined");
    });

    test("handles single-field string array collections", () => {
      const fields = [csvField("tags", "Tag")];
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([["tags", "string[]"]]),
      };
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("value ? [value] : []");
      expect(expression).toContain(".map((value) => JSON.stringify(");
    });

    test("generates getCollectionValue helper for multiple fields with string arrays", () => {
      const fields = [
        csvField("tags", "Tag"),
        csvField("categories", "Category"),
      ];
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([
          ["tags", "string[]"],
          ["categories", "string[]"],
        ]),
      };
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("const getCollectionValue = (values: string[], index: number): string[] => {");
      expect(expression).toContain("if (values.length === 0) return []");
      expect(expression).toContain("if (values.length === 1) return [values[0]");
      expect(expression).toContain("return index < values.length ? [values[index]");
    });

    test("handles deeply nested collections in multi-field mode", () => {
      const fields = [
        csvField("position.title", "Title"),
        csvField("position.organizations.name", "Org"),
      ];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("getValue");
      expect(expression).toContain("results.push");
    });

    test("handles renderNodeForCollection with array type property", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "ItemType[]"]]),
      };
      const itemType: TsPersonEntityTypeInfo = {
        alias: "ItemType",
        properties: new Map([["value", "string"]]),
      };
      const typeMap = new Map([[itemType.alias, itemType]]);
      const fields = [csvField("items.value", "Value")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain(`"items": (() => {`);
    });

    test("handles renderNodeForCollectionMany with array properties", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([
          ["tags", "string[]"],
          ["items", "ItemType[]"],
        ]),
      };
      const itemType: TsPersonEntityTypeInfo = {
        alias: "ItemType",
        properties: new Map([["name", "string"]]),
      };
      const typeMap = new Map([[itemType.alias, itemType]]);
      const fields = [
        csvField("tags", "Tag"),
        csvField("items.name", "Name"),
      ];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("getCollectionValue(field0, index)");
      expect(expression).toContain(`"items": (() => {`);
    });

    test("handles nested type resolution in renderNodeForCollectionMany", () => {
      const fields = [
        csvField("position.title", "Title"),
        csvField("displayName", "Name"),
      ];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
      expect(expression).toContain("getValue(field0, index)");
      expect(expression).toContain(`"position":`);
    });

    test("handles collection with nested array properties", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["nested", "Nested"]]),
      };
      const nestedType: TsPersonEntityTypeInfo = {
        alias: "Nested",
        properties: new Map([["tags", "string[]"]]),
      };
      const typeMap = new Map([[nestedType.alias, nestedType]]);
      const fields = [csvField("nested.tags", "Tags")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain(`"nested":`);
      expect(expression).toContain("value ? [value] : []");
    });

    test("handles renderNode in collection with nested type resolution", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["metadata", "Metadata"]]),
      };
      const metadataType: TsPersonEntityTypeInfo = {
        alias: "Metadata",
        properties: new Map([["key", "string"]]),
      };
      const typeMap = new Map([[metadataType.alias, metadataType]]);
      const fields = [csvField("metadata.key", "Key")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("as Metadata");
    });

    test("handles custom collection expression builder", () => {
      const fields = [csvField("items.value", "Value")];
      const customBuilder = (src: string) => `customCollectionParse(${src})`;
      const expression = buildTsPersonEntityCollectionExpression(fields, customBuilder, null, new Map());
      expect(expression).toContain("customCollectionParse(");
    });

    test("handles renderNodeForCollection with array property in collection mode", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["tags", "string[]"]]),
      };
      const fields = [csvField("tags", "Tag")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("value ? [value] : []");
    });

    test("handles renderCollectionNode with elementInfo but nested properties", () => {
      const itemType: TsPersonEntityTypeInfo = {
        alias: "ComplexItem",
        properties: new Map([
          ["name", "string"],
          ["value", "string"],
        ]),
      };
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "ComplexItem[]"]]),
      };
      const typeMap = new Map([[itemType.alias, itemType]]);
      const fields = [
        csvField("items.name", "Name"),
        csvField("items.value", "Value"),
      ];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("as ComplexItem");
      expect(expression).toContain("getValue(");
    });

    test("handles renderNodeForCollection in collection mode with nested type", () => {
      const nestedType: TsPersonEntityTypeInfo = {
        alias: "NestedInfo",
        properties: new Map([["title", "string"]]),
      };
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Item",
        properties: new Map([["info", "NestedInfo"]]),
      };
      const containerType: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "Item[]"]]),
      };
      const typeMap = new Map([
        [nestedType.alias, nestedType],
        [typeInfo.alias, typeInfo],
      ]);
      const fields = [csvField("items.info.title", "Title")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, containerType, typeMap);
      expect(expression).toContain("as NestedInfo");
    });
    test("handles renderNodeForCollection in collection mode with nested type", () => {
      const nestedType: TsPersonEntityTypeInfo = {
        alias: "NestedInfo",
        properties: new Map([["title", "string"]]),
      };
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Item",
        properties: new Map([["info", "NestedInfo"]]),
      };
      const containerType: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "Item[]"]]),
      };
      const typeMap = new Map([
        [nestedType.alias, nestedType],
        [typeInfo.alias, typeInfo],
      ]);
      const fields = [csvField("items.info.title", "Title")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, containerType, typeMap);
      expect(expression).toContain("as NestedInfo");
    });

    test("handles renderNodeForCollectionMany with field in array property", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([["tags", "string[]"]]),
      };
      const fields = [csvField("tags", "Tag")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("value ? [value] : []");
    });

    test("handles renderNodeForCollectionMany with array property in nested object", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["data", "DataInfo"]]),
      };
      const dataType: TsPersonEntityTypeInfo = {
        alias: "DataInfo",
        properties: new Map([["tags", "string[]"]]),
      };
      const typeMap = new Map([[dataType.alias, dataType]]);
      const fields = [
        csvField("data.tags", "Tag1"),
        csvField("name", "Name"),
      ];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("getCollectionValue(field0, index)");
    });

    test("handles renderNodeForCollectionMany with nested complex type", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([
          ["metadata", "Metadata"],
          ["value", "string"],
        ]),
      };
      const metadataType: TsPersonEntityTypeInfo = {
        alias: "Metadata",
        properties: new Map([["key", "string"]]),
      };
      const typeMap = new Map([[metadataType.alias, metadataType]]);
      const fields = [
        csvField("metadata.key", "Key"),
        csvField("value", "Value"),
      ];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("as Metadata");
      expect(expression).toContain("getValue(field0, index)");
    });

    test("handles renderCollectionNode with no elementInfo and non-string type", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "UnknownItem[]"]]),
      };
      const fields = [csvField("items.value", "Value")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("values.map((value) =>");
    });

    test("handles renderNodeForCollection in collection mode with array property", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["nested", "Nested"]]),
      };
      const nestedType: TsPersonEntityTypeInfo = {
        alias: "Nested",
        properties: new Map([["items", "string[]"]]),
      };
      const typeMap = new Map([[nestedType.alias, nestedType]]);
      const fields = [csvField("nested.items", "Item")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain(`"nested":`);
    });

    test("handles renderNodeForCollection with field path and array property type", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([["tags", "string[]"]]),
      };
      const fields = [csvField("tags", "Tag")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("value ? [value] : []");
      expect(expression).toContain(".map((value) => JSON.stringify(");
    });

    test("handles renderNodeForCollection with nested field path and array property", () => {
      const nestedType: TsPersonEntityTypeInfo = {
        alias: "Nested",
        properties: new Map([["items", "string[]"]]),
      };
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["nested", "Nested"]]),
      };
      const typeMap = new Map([[nestedType.alias, nestedType]]);
      const fields = [csvField("nested.items", "Items")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain(`"items": (value ? [value] : [])`);
    });

    test("handles renderCollectionNode with no elementInfo but elementType is string", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["tags", "string[]"]]),
      };
      const fields = [csvField("tags", "Tag")];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("parseStringCollection");
    });

    test("handles renderCollectionNode in expression mode with string element type", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([["keywords", "string[]"]]),
      };
      const fields = [csvField("keywords", "Keyword")];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain(`"keywords": parseStringCollection`);
    });

    test("handles collection node with no element type info but string element type", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["tags", "string[]"]]),
      };
      const fields = [csvField("tags.value", "Value")];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("(() => {");
      expect(expression).toContain("values.length > 0 ? values : undefined");
    });

    test("handles collection expression with single-field map shortcut", () => {
      const fields = [csvField("single.value", "Value")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, null, new Map());
      expect(expression).toContain(".map((value) => JSON.stringify(");
    });

    test("handles nested type in collection node with non-array property", () => {
      const nestedType: TsPersonEntityTypeInfo = {
        alias: "Nested",
        properties: new Map([["key", "string"]]),
      };
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["data", "Nested"]]),
      };
      const typeMap = new Map([[nestedType.alias, nestedType]]);
      const fields = [csvField("data.key", "Key")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("as Nested");
    });

    test("handles array property field path in collection rendering", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Record",
        properties: new Map([["tags", "string[]"]]),
      };
      const fields = [csvField("tags", "Tag")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("value ? [value] : []");
    });

    test("handles collection node without type mapping for nested property", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["data", "UnknownType"]]),
      };
      const fields = [csvField("data.key", "Key")];
      const expression = buildTsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain(`"data":`);
      expect(expression).toContain(`"key":`);
    });

    test("handles multi-field collection without element type info", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["items", "UnknownType[]"]]),
      };
      const fields = [
        csvField("items.name", "Name"),
        csvField("items.value", "Value"),
      ];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("getValue");
      expect(expression).toContain("const results: Array<unknown> = []");
    });

    test("handles collection node with no collected fields", () => {
      const typeInfo: TsPersonEntityTypeInfo = {
        alias: "Container",
        properties: new Map([["emptyItems", "EmptyType[]"]]),
      };
      const fields = [csvField("emptyItems.phantom", "Phantom")];
      const expression = buildTsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain(`"emptyItems": (() => {`);
    });
  });

  describe("C# buildCsPersonEntityExpression", () => {
    test("emits typed C# object graphs", () => {
      const fields: PersonEntityField[] = [
        csvField("displayName", "Display Name"),
        csvField("skills.name", "Skill Name"),
        csvField("skills.level", "Skill Level"),
        csvField("position.title", "Position Title"),
        csvField("position.organizations.name", "Org Name"),
        csvField("tags", "Tag"),
      ];

      const expression = buildCsPersonEntityExpression(fields, undefined, csPersonType, csTypeMap);
      expect(expression).toContain("JsonSerializer.Serialize(");
      expect(expression).toContain("GetCollectionValue(List<string> values, int index)");
      expect(expression).toContain("RowParser.ParseStringCollection");
    });

    test("handles nested typed objects", () => {
      const fields = [
        csvField("position.title", "Title"),
        csvField("position.organizations.name", "Org"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, csPersonType, csTypeMap);
      expect(expression).toContain("new PositionInfo");
      expect(expression).toContain("Organizations =");
    });

    test("falls back to Dictionary when type info is null", () => {
      const fields = [
        csvField("name", "Name"),
        csvField("value", "Value"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, null, csTypeMap);
      expect(expression).toContain("new Dictionary<string, object?>");
    });

    test("handles string list fields", () => {
      const fields = [csvField("tags", "Tags")];
      const expression = buildCsPersonEntityExpression(fields, undefined, csPersonType, csTypeMap);
      expect(expression).toContain("RowParser.ParseStringCollection");
    });

    test("handles collection fields with single source", () => {
      const fields = [csvField("skills.name", "Skill")];
      const expression = buildCsPersonEntityExpression(fields, undefined, csPersonType, csTypeMap);
      expect(expression).toContain("foreach (var value in values)");
      expect(expression).toContain("results.Add");
    });

    test("handles collection with typed element info", () => {
      const fields = [
        csvField("skills.name", "Skill Name"),
        csvField("skills.level", "Skill Level"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, csPersonType, csTypeMap);
      expect(expression).toContain("new SkillEntry");
    });

    test("handles collections without element type info", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["items", { csName: "Items", csType: "List<UnknownType>?" }]]),
      };
      const fields = [csvField("items.value", "Value")];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("new List<UnknownType>");
    });

    test("handles nested dictionaries when type cannot match", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["data", { csName: "Data", csType: "DataType?" }]]),
      };
      const fields = [
        csvField("data.key1", "Key1"),
        csvField("data.unmapped", "Unmapped"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, csTypeMap);
      expect(expression).toContain("Data =");
    });

    test("handles empty collection fields", () => {
      const fields = [csvField("emptyList.item", "Item")];
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["emptyList", { csName: "EmptyList", csType: "List<string>?" }]]),
      };
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("values.Count == 0 ? null : values");
    });

    test("handles nullable list element types", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["items", { csName: "Items", csType: "List<ItemType>?" }]]),
      };
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "ItemType",
        properties: new Map([["value", { csName: "Value", csType: "string?" }]]),
      };
      const typeMap = new Map<string, CsPersonEntityTypeInfo>([["ItemType", itemType]]);
      const fields = [csvField("items.value", "Val")];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("new ItemType");
    });

    test("handles GetValue helper with various list sizes", () => {
      const fields = [
        csvField("skills.name", "Name"),
        csvField("skills.level", "Level"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, csPersonType, csTypeMap);
      expect(expression).toContain("if (values.Count == 0) return");
      expect(expression).toContain("if (values.Count == 1) return values[0]");
      expect(expression).toContain("return index < values.Count ? (values[index]");
    });

    test("handles GetCollectionValue with List<string> wrapping", () => {
      const fields = [
        csvField("tags", "Tag"),
        csvField("skills.name", "Skill"),
        csvField("skills.level", "Level"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, csPersonType, csTypeMap);
      expect(expression).toContain("Tags = RowParser.ParseStringCollection");
      expect(expression).toContain("new SkillEntry");
    });

    test("handles deeply nested structures with multiple levels", () => {
      const fields = [csvField("position.organizations.name", "Org")];
      const expression = buildCsPersonEntityExpression(fields, undefined, csPersonType, csTypeMap);
      expect(expression).toContain("new PositionInfo");
      expect(expression).toContain("Organizations =");
    });

    test("handles renderNodeForCollection with info and typed properties", () => {
      const fields = [
        csvField("skills.name", "Name"),
        csvField("skills.level", "Level"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, csPersonType, csTypeMap);
      expect(expression).toContain("new SkillEntry");
      expect(expression).toContain("Name = GetValue(field0, index)");
    });

    test("handles renderTypedNode fallback when properties mismatch", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["knownProp", { csName: "KnownProp", csType: "string?" }]]),
      };
      const fields = [
        csvField("knownProp", "Known"),
        csvField("unknownProp", "Unknown"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("new Dictionary<string, object?>");
    });

    test("handles list element type with non-string in collection", () => {
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "Item",
        properties: new Map([["id", { csName: "Id", csType: "string?" }]]),
      };
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["items", { csName: "Items", csType: "List<Item>?" }]]),
      };
      const typeMap = new Map([["Item", itemType]]);
      const fields = [csvField("items.id", "ID")];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("new Item");
      expect(expression).toContain("Id =");
    });

    test("handles nested type in renderTypedNode", () => {
      const nestedType: CsPersonEntityTypeInfo = {
        typeName: "Metadata",
        properties: new Map([["key", { csName: "Key", csType: "string?" }]]),
      };
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["metadata", { csName: "Metadata", csType: "Metadata?" }]]),
      };
      const typeMap = new Map([["Metadata", nestedType]]);
      const fields = [csvField("metadata.key", "MetaKey")];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("new Metadata");
      expect(expression).toContain("Key =");
    });

    test("handles field as path in renderTypedNode", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([
          ["name", { csName: "Name", csType: "string?" }],
          ["tags", { csName: "Tags", csType: "List<string>?" }],
        ]),
      };
      const fields = [
        csvField("name", "Name"),
        csvField("tags", "Tags"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("new Record");
      expect(expression).toContain("Name = RowParser.ParseString");
      expect(expression).toContain("Tags = RowParser.ParseStringCollection");
    });

    test("handles renderNodeForCollection with string list wrapping", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const fields = [csvField("tags", "Tag")];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, new Map());
      expect(expression).toContain("Tags = RowParser.ParseStringCollection");
    });

    test("handles renderNodeForCollection with list element extraction", () => {
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "Item",
        properties: new Map([["value", { csName: "Value", csType: "string?" }]]),
      };
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["items", { csName: "Items", csType: "List<Item>?" }]]),
      };
      const typeMap = new Map([["Item", itemType]]);
      const fields = [csvField("items.value", "Value")];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("new Item");
      expect(expression).toContain("foreach (var value in values)");
    });

    test("handles renderTypedNode with list property that is field path", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["items", { csName: "Items", csType: "List<ItemType>?" }]]),
      };
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "ItemType",
        properties: new Map([["id", { csName: "Id", csType: "string?" }]]),
      };
      const typeMap = new Map([["ItemType", itemType]]);
      const fields = [csvField("items.id", "ID")];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("new ItemType");
    });

    test("handles renderTypedNode with list property that is string and is path field", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const fields = [csvField("tags", "Tag")];
      const customFieldBuilder = (field: PersonEntityField) => "customValueBuilder()";
      const customCollectionBuilder = (field: PersonEntityField) => "customCollectionBuilder()";
      const expression = buildCsPersonEntityObjectExpression(
        fields,
        customFieldBuilder,
        typeInfo,
        new Map(),
        2,
        customCollectionBuilder
      );
      expect(expression).toContain("customCollectionBuilder()");
    });

    test("handles renderNodeForCollection with typed info and string list in dictionary mode", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const fields = [csvField("data.tags", "Tag")];
      const customBuilder = (field: PersonEntityField) => "customValue";
      const expression = buildCsPersonEntityObjectExpression(fields, customBuilder, typeInfo, new Map(), 2);
      expect(expression).toContain("new Dictionary<string, object?>");
    });

    test("handles renderNodeForCollection typed entries with propInfo not found", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["knownField", { csName: "KnownField", csType: "string?" }]]),
      };
      const fields = [
        csvField("knownField", "Known"),
        csvField("unknownField", "Unknown"),
      ];
      const customBuilder = (field: PersonEntityField) => {
        if (field.path === "knownField") return "knownValue";
        return "unknownValue";
      };
      const expression = buildCsPersonEntityObjectExpression(fields, customBuilder, typeInfo, new Map(), 2);
      expect(expression).toContain("new Dictionary<string, object?>");
      expect(expression).toContain("knownValue");
    });

    test("handles renderNodeForCollectionMany with field that is not string list element", () => {
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "Item",
        properties: new Map([["value", { csName: "Value", csType: "string?" }]]),
      };
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([
          ["items", { csName: "Items", csType: "List<Item>?" }],
          ["name", { csName: "Name", csType: "string?" }],
        ]),
      };
      const typeMap = new Map([["Item", itemType]]);
      const fields = [
        csvField("items.value", "Value"),
        csvField("name", "Name"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap, "csv");
      expect(expression).toContain("new Item");
      expect(expression).toContain("GetValue(");
    });

    test("handles renderFieldMapping with non-string list element", () => {
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "ComplexItem",
        properties: new Map([["id", { csName: "Id", csType: "string?" }]]),
      };
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["items", { csName: "Items", csType: "List<ComplexItem>?" }]]),
      };
      const typeMap = new Map([["ComplexItem", itemType]]);
      const fields = [csvField("items.id", "ID")];
      const customFieldBuilder = (field: PersonEntityField) => `field_${field.path}`;
      const expression = buildCsPersonEntityObjectExpression(fields, customFieldBuilder, typeInfo, typeMap, 2);
      expect(expression).toContain("new ComplexItem");
      expect(expression).toContain("Id =");
    });

    test("handles field mappings with string list element type", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([
          ["name", { csName: "Name", csType: "string?" }],
          ["tags", { csName: "Tags", csType: "List<string>?" }],
        ]),
      };
      const fields = [csvField("tags", "Tags")];
      const expression = buildCsPersonEntityObjectExpression(
        fields,
        (field) => "customValue",
        typeInfo,
        new Map(),
        2,
        (field) => "customCollection"
      );
      expect(expression).toContain("new Record");
      expect(expression).toContain("Tags = customCollection");
    });

    test("handles string list property in field mappings with custom builders", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Person",
        properties: new Map([["emails", { csName: "Emails", csType: "List<string>?" }]]),
      };
      const fields = [csvField("emails", "Email")];
      const customBuilder = (field: PersonEntityField) => "emailValue";
      const customCollectionBuilder = (field: PersonEntityField) => "emailCollection";
      const expression = buildCsPersonEntityObjectExpression(
        fields,
        customBuilder,
        typeInfo,
        new Map(),
        2,
        customCollectionBuilder
      );
      expect(expression).toContain("Emails = emailCollection");
    });

    test("handles string list property in nested object field mappings", () => {
      const nestedType: CsPersonEntityTypeInfo = {
        typeName: "NestedData",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["nested", { csName: "Nested", csType: "NestedData?" }]]),
      };
      const typeMap = new Map([["NestedData", nestedType]]);
      const fields = [csvField("nested.tags", "Tag")];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("new NestedData");
      expect(expression).toContain("Tags =");
    });

    test("handles single-field collection with nested object containing string list", () => {
      const addressType: CsPersonEntityTypeInfo = {
        typeName: "Address",
        properties: new Map([
          ["street", { csName: "Street", csType: "string?" }],
          ["phones", { csName: "Phones", csType: "List<string>?" }],
        ]),
      };
      const personType: CsPersonEntityTypeInfo = {
        typeName: "Person",
        properties: new Map([["addresses", { csName: "Addresses", csType: "List<Address>?" }]]),
      };
      const typeMap = new Map([["Address", addressType]]);
      const fields = [
        csvField("addresses.street", "Street"),
        csvField("addresses.phones", "Phone"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, personType, typeMap);
      expect(expression).toContain("new Address");
      expect(expression).toContain("new List<string>");
    });

    test("handles multi-field collection with element containing string list property", () => {
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "Item",
        properties: new Map([
          ["name", { csName: "Name", csType: "string?" }],
          ["categories", { csName: "Categories", csType: "List<string>?" }],
        ]),
      };
      const containerType: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["items", { csName: "Items", csType: "List<Item>?" }]]),
      };
      const typeMap = new Map([["Item", itemType]]);
      const fields = [
        csvField("items.name", "Name"),
        csvField("items.categories", "Category"),
      ];
      const expression = buildCsPersonEntityExpression(fields, undefined, containerType, typeMap);
      expect(expression).toContain("new List<string> {");
      expect(expression).toContain("GetValue(field");
    });

    test("handles single-field collection where element has string list property", () => {
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "Item",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const containerType: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["items", { csName: "Items", csType: "List<Item>?" }]]),
      };
      const typeMap = new Map([["Item", itemType]]);
      const fields = [csvField("items.tags", "Tag")];
      const expression = buildCsPersonEntityExpression(fields, undefined, containerType, typeMap);
      expect(expression).toContain("new List<string> { value }");
      expect(expression).toContain("foreach (var value in values)");
    });

    test("handles typed node with non-string list property as field path", () => {
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "Item",
        properties: new Map([["id", { csName: "Id", csType: "string?" }]]),
      };
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["items", { csName: "Items", csType: "List<Item>?" }]]),
      };
      const typeMap = new Map([["Item", itemType]]);
      const fields = [csvField("items", "Item Data")];
      const expression = buildCsPersonEntityExpression(fields, undefined, typeInfo, typeMap);
      expect(expression).toContain("Items = RowParser.ParseString");
    });
  });

  describe("C# buildCsPersonEntityCollectionExpression", () => {
    test("simplifies CSV single-field collections", () => {
      const fields = [csvField("skills.name", "Skill Name")];
      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        undefined,
        csPersonType,
        csTypeMap,
        "csv"
      );
      expect(expression).toContain(".Select(value => JsonSerializer.Serialize(");
    });

    test("flattens JSON array roots", () => {
      const fields = [
        jsonField("skills.name", "$.skills[*].name"),
        jsonField("skills.level", "$.skills[*].level"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        undefined,
        csPersonType,
        csTypeMap,
        "json"
      );
      expect(expression).toContain("RowParser.ReadArrayEntries");
      expect(expression).toContain("results.Add(JsonSerializer.Serialize(");
    });

    test("handles JSON array roots with different roots (no common root)", () => {
      const fields = [
        jsonField("skills.name", "$.skills[*].name"),
        jsonField("tags", "$.tags[*]"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        undefined,
        csPersonType,
        csTypeMap,
        "json"
      );
      expect(expression).toContain("var field0 =");
      expect(expression).toContain("var field1 =");
    });

    test("handles JSON array with relative paths", () => {
      const fields = [
        jsonField("skills.name", "$.items[*].name"),
        jsonField("skills.level", "$.items[*].level"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        undefined,
        csPersonType,
        csTypeMap,
        "json"
      );
      expect(expression).toContain("RowParser.ReadArrayEntries(row, \"$.items[*]\")");
      expect(expression).toContain("new SkillEntry");
    });

    test("handles JSON array with root-level array element", () => {
      const fields = [jsonField("name", "$.data[*]")];
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["name", { csName: "Name", csType: "string?" }]]),
      };
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "json");
      expect(expression).toContain("RowParser.ReadArrayEntries(row, \"$.data[*]\")");
      expect(expression).toContain("RowParser.ParseString(entry)");
    });

    test("handles JSON fields without array markers (no common root)", () => {
      const fields = [
        jsonField("name", "$.user.name"),
        jsonField("email", "$.user.email"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        undefined,
        csPersonType,
        csTypeMap,
        "json"
      );
      expect(expression).toContain("var field0 =");
      expect(expression).toContain("var field1 =");
    });

    test("emits GetValue helpers for multi-field rows", () => {
      const fields = [
        csvField("tags", "Tag Value"),
        csvField("skills.name", "Skill Name"),
        csvField("skills.level", "Skill Level"),
      ];

      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        undefined,
        csPersonType,
        csTypeMap,
        "csv"
      );
      expect(expression).toContain("var field0 = RowParser.ParseStringCollection(row, new[] { \"Tag Value\" });");
      expect(expression).toContain("GetCollectionValue(field0, index)");
      expect(expression).toContain("GetValue(field1, index)");
    });

    test("handles single string-type collection field", () => {
      const fields = [csvField("tags", "Tag")];
      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        undefined,
        csPersonType,
        csTypeMap,
        "csv"
      );
      expect(expression).toContain(".Select(value => JsonSerializer.Serialize(");
      expect(expression).toContain("new List<string> { value }");
    });

    test("handles nested collections in multi-field mode", () => {
      const fields = [
        csvField("skills.name", "Skill"),
        csvField("position.organizations.name", "Org"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        undefined,
        csPersonType,
        csTypeMap,
        "csv"
      );
      expect(expression).toContain("Organizations =");
      expect(expression).toContain("foreach (var value in values)");
    });

    test("handles collection with no type info", () => {
      const fields = [
        csvField("items.a", "A"),
        csvField("items.b", "B"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, csTypeMap, "csv");
      expect(expression).toContain("new Dictionary<string, object?>");
    });

    test("handles nested string arrays in typed structures", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["nested", { csName: "Nested", csType: "NestedType?" }]]),
      };
      const nestedType: CsPersonEntityTypeInfo = {
        typeName: "NestedType",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const typeMap = new Map([[nestedType.typeName, nestedType]]);
      const fields = [csvField("nested.tags", "Tags")];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap, "csv");
      expect(expression).toContain("Tags =");
      expect(expression).toContain("new List<string> { value }");
    });

    test("handles empty maxLen calculation when no fields", () => {
      const fields = [csvField("empty.item", "Item")];
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["empty", { csName: "Empty", csType: "List<ItemType>?" }]]),
      };
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "csv");
      expect(expression).toContain("Select(value => JsonSerializer.Serialize(");
      expect(expression).toContain("if (values.Count == 0) return null");
    });

    test("handles JSON collection with string list element type", () => {
      const fields = [jsonField("tags", "$.tags[*]")];
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "json");
      expect(expression).toContain("RowParser.ReadArrayEntries(row, \"$.tags[*]\")");
      expect(expression).toContain("RowParser.ParseStringCollection(entry)");
    });

    test("handles mixed JSON paths with partial array roots", () => {
      const fields = [
        jsonField("skills.name", "$.data[*].skills.name"),
        jsonField("skills.level", "$.data[*].skills.level"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        undefined,
        csPersonType,
        csTypeMap,
        "json"
      );
      expect(expression).toContain("RowParser.ReadArrayEntries(row, \"$.data[*]\")");
      expect(expression).toContain("skills.name");
      expect(expression).toContain("skills.level");
    });

    test("handles collection value builders with custom expressions", () => {
      const fields = [csvField("items.value", "Value")];
      const customBuilder = (src: string) => `CustomParser(${src})`;
      const expression = buildCsPersonEntityCollectionExpression(
        fields,
        customBuilder,
        null,
        csTypeMap,
        "csv"
      );
      expect(expression).toContain("CustomParser(");
      expect(expression).toContain(".Select(value => JsonSerializer.Serialize(");
    });

    test("handles JSON common root without relative path", () => {
      const fields = [jsonField("name", "$.users[*]")];
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "User",
        properties: new Map([["name", { csName: "Name", csType: "string?" }]]),
      };
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "json");
      expect(expression).toContain("RowParser.ReadArrayEntries(row, \"$.users[*]\")");
      expect(expression).toContain("RowParser.ParseString(entry)");
    });

    test("handles multi-field with nested object in dictionary mode", () => {
      const fields = [
        csvField("data.nested.value", "Value"),
        csvField("data.nested.other", "Other"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "csv");
      expect(expression).toContain("var field0 =");
      expect(expression).toContain("var field1 =");
      expect(expression).toContain("GetValue(");
    });

    test("handles list element type extraction for nullable types", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Container",
        properties: new Map([["items", { csName: "Items", csType: "List<ItemType>?" }]]),
      };
      const itemType: CsPersonEntityTypeInfo = {
        typeName: "ItemType",
        properties: new Map([["value", { csName: "Value", csType: "string?" }]]),
      };
      const typeMap = new Map([["ItemType", itemType]]);
      const fields = [csvField("items.value", "Val")];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, typeMap, "csv");
      expect(expression).toContain("new ItemType");
    });

    test("handles renderCollectionNode with string element without info", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const fields = [csvField("tags", "Tag")];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "csv");
      expect(expression).toContain("new List<string> { value }");
    });

    test("handles renderNodeForCollectionMany with string list element", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const fields = [
        csvField("tags", "Tag1"),
        csvField("name", "Name"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "csv");
      expect(expression).toContain("GetCollectionValue(");
    });

    test("handles renderDictionary with collection fields", () => {
      const fields = [
        csvField("items.name", "Name"),
        csvField("items.tags", "Tags"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "csv");
      expect(expression).toContain("new Dictionary<string, object?>");
      expect(expression).toContain("GetValue(");
    });

    test("handles getCommonJsonArrayRoot with no jsonPath in field", () => {
      const fields = [
        csvField("name", "Name"),
        jsonField("skills.level", "$.skills[*].level"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "json");
      expect(expression).toContain("var field0 =");
      expect(expression).toContain("var field1 =");
    });

    test("handles getCommonJsonArrayRoot with no [*] in jsonPath", () => {
      const fields = [
        jsonField("name", "$.user.name"),
        jsonField("email", "$.user.email"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "json");
      expect(expression).toContain("var field0 =");
    });

    test("handles getCommonJsonArrayRoot with different roots", () => {
      const fields = [
        jsonField("name", "$.users[*].name"),
        jsonField("skill", "$.skills[*].name"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "json");
      expect(expression).toContain("var field0 =");
      expect(expression).toContain("var field1 =");
    });

    test("handles getCommonJsonArrayRoot with empty relative path", () => {
      const fields = [jsonField("value", "$.items[*]")];
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["value", { csName: "Value", csType: "string?" }]]),
      };
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "json");
      expect(expression).toContain("RowParser.ReadArrayEntries");
      expect(expression).toContain("RowParser.ParseString(entry)");
    });

    test("handles renderNodeForCollectionMany with field that has string list element", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([
          ["tags", { csName: "Tags", csType: "List<string>?" }],
          ["name", { csName: "Name", csType: "string?" }],
        ]),
      };
      const fields = [
        csvField("tags", "Tag"),
        csvField("name", "Name"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "csv");
      expect(expression).toContain("GetCollectionValue(field0, index)");
      expect(expression).toContain("GetValue(field1, index)");
    });

    test("handles renderNodeForCollectionMany in dictionary mode", () => {
      const fields = [
        csvField("data.tags", "Tags"),
        csvField("data.value", "Value"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "csv");
      expect(expression).toContain("new Dictionary<string, object?>");
      expect(expression).toContain("GetValue(field0, index)");
    });

    test("handles JSON common root extraction with relative paths", () => {
      const fields = [
        jsonField("name", "$.users[*].profile.name"),
        jsonField("email", "$.users[*].profile.email"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "json");
      expect(expression).toContain("RowParser.ParseString(entry, \"profile.name\")");
      expect(expression).toContain("RowParser.ParseString(entry, \"profile.email\")");
    });

    test("handles JSON common root with collection field and relative path", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const fields = [jsonField("tags", "$.data[*].categories")];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "json");
      expect(expression).toContain("RowParser.ParseStringCollection(entry, \"categories\")");
    });

    test("handles JSON common root with collection field at array root", () => {
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["value", { csName: "Value", csType: "List<string>?" }]]),
      };
      const fields = [jsonField("value", "$.items[*]")];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "json");
      expect(expression).toContain("RowParser.ParseStringCollection(entry)");
    });

    test("handles collection expression with no field variables", () => {
      const fields = [
        csvField("item1.value", "Value1"),
        csvField("item2.value", "Value2"),
      ];
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([
          ["item1", { csName: "Item1", csType: "List<UnknownType>?" }],
          ["item2", { csName: "Item2", csType: "List<UnknownType>?" }],
        ]),
      };
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "csv");
      expect(expression).toContain("var maxLen");
    });

    test("handles JSON common root with empty relative path for scalar field", () => {
      const fields = [jsonField("value", "$.items[*]")];
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["value", { csName: "Value", csType: "string?" }]]),
      };
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "json");
      expect(expression).toContain("RowParser.ParseString(entry)");
      expect(expression).toContain("ReadArrayEntries");
    });

    test("handles JSON common root with empty relative path for collection field", () => {
      const fields = [jsonField("tags", "$.data[*]")];
      const typeInfo: CsPersonEntityTypeInfo = {
        typeName: "Record",
        properties: new Map([["tags", { csName: "Tags", csType: "List<string>?" }]]),
      };
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, typeInfo, new Map(), "json");
      expect(expression).toContain("RowParser.ParseStringCollection(entry)");
      expect(expression).toContain("ReadArrayEntries");
    });

    test("handles getCommonJsonArrayRoot finding valid root", () => {
      const fields = [
        jsonField("name", "$.users[*].name"),
        jsonField("email", "$.users[*].email"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "json");
      expect(expression).toContain("RowParser.ReadArrayEntries(row, \"$.users[*]\")");
      expect(expression).toContain("RowParser.ParseString(entry, \"name\")");
    });

    test("handles multi-field CSV collection building max length calculation", () => {
      const fields = [
        csvField("skills.name", "Skill Name"),
        csvField("skills.level", "Skill Level"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, csPersonType, csTypeMap, "csv");
      expect(expression).toContain("var maxLen = new[] {");
      expect(expression).toContain(".Max()");
    });

    test("handles JSON array root with remainder not starting with dot", () => {
      const fields = [jsonField("id", "$.users[*]id")];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "json");
      expect(expression).toContain("ReadArrayEntries");
    });

    test("handles common root when root is found after iteration", () => {
      const fields = [
        jsonField("first", "$.root[*].first"),
        jsonField("second", "$.root[*].second"),
      ];
      const expression = buildCsPersonEntityCollectionExpression(fields, undefined, null, new Map(), "json");
      expect(expression).toContain("$.root[*]");
      expect(expression).toContain("first");
    });
  });
});
