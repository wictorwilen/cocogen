import { describe, expect, test } from "vitest";

import {
  buildCsPersonEntityCollectionExpression,
  buildCsPersonEntityExpression,
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
  test("buildTsPersonEntityExpression renders typed objects and collections", () => {
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

  test("buildTsPersonEntityExpression falls back to plain objects when type info is missing", () => {
    const expression = buildTsPersonEntityExpression([csvField("nickname", "Nickname")], undefined, null, tsTypeMap);
    expect(expression).toContain(`"nickname": parseString(readSourceValue(row, ["Nickname"]))`);
  });

  test("buildTsPersonEntityCollectionExpression handles single-field collections", () => {
    const fields = [csvField("skills.name", "Skill Name")];
    const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
    expect(expression).toContain(".map((value) => JSON.stringify(");
  });

  test("buildTsPersonEntityCollectionExpression handles single string-collection fields", () => {
    const fields = [csvField("tags", "Tag Value")];
    const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
    expect(expression).toContain(`"tags": (value ? [value] : [])`);
  });

  test("buildTsPersonEntityCollectionExpression builds multi-field collectors", () => {
    const fields = [
      csvField("skills.name", "Skill Name"),
      csvField("skills.level", "Skill Level"),
      csvField("position.title", "Title"),
    ];
    const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
    expect(expression).toContain("getCollectionValue");
    expect(expression).toContain("const maxLen = Math.max(0, ...lengths);");
  });

  test("buildTsPersonEntityCollectionExpression wraps scalar references for string arrays", () => {
    const fields = [
      csvField("tags", "Tag Value"),
      csvField("skills.name", "Skill Name"),
      csvField("skills.level", "Skill Level"),
    ];

    const expression = buildTsPersonEntityCollectionExpression(fields, undefined, tsPersonType, tsTypeMap);
    expect(expression).toContain("const getCollectionValue = (values: string[], index: number): string[] => {");
    expect(expression).toContain("getCollectionValue(field0, index)");
  });

  test("buildCsPersonEntityExpression emits typed C# object graphs", () => {
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

  test("buildCsPersonEntityCollectionExpression simplifies CSV single-field collections", () => {
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

  test("buildCsPersonEntityCollectionExpression flattens JSON array roots", () => {
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

  test("buildCsPersonEntityCollectionExpression emits GetValue helpers for multi-field rows", () => {
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
});
