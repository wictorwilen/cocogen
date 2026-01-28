import { describe, expect, test } from "vitest";

import { buildCsPrincipalCollectionExpression, buildCsPrincipalExpression } from "../../src/init/dotnet/principal.js";
import { buildTsPrincipalCollectionExpression, buildTsPrincipalExpression } from "../../src/init/ts/principal.js";
import type { PersonEntityField, SourceDescriptor } from "../../src/init/shared-types.js";

const toField = (path: string, header: string): PersonEntityField => ({
  path,
  source: { csvHeaders: [header] },
});

const fallbackSource = (header: string): SourceDescriptor => ({ csvHeaders: [header] });

describe("init principal builders", () => {
  test("buildTsPrincipalExpression maps people entity fields", () => {
    const expression = buildTsPrincipalExpression(
      [toField("profile.userPrincipalName", "account"), toField("profile.email", "email")],
      fallbackSource("fallback")
    );

    expect(expression).toContain(`"@odata.type": "microsoft.graph.externalConnectors.principal"`);
    expect(expression).toContain(`"upn": parseString(readSourceValue(row, ["account"]))`);
    expect(expression).toContain(`"email": parseString(readSourceValue(row, ["email"]))`);
  });

  test("buildTsPrincipalExpression falls back to primary source", () => {
    const expression = buildTsPrincipalExpression(null, fallbackSource("owner"));
    expect(expression).toContain(`"upn": parseString(readSourceValue(row, ["owner"]))`);
  });

  test("buildTsPrincipalCollectionExpression emits results builder", () => {
    const expression = buildTsPrincipalCollectionExpression(
      [toField("profile.userPrincipalName", "owners"), toField("profile.email", "emails")],
      fallbackSource("fallback")
    );

    expect(expression).toContain("results.push({");
    expect(expression).toContain(`parseStringCollection(readSourceValue(row, ["owners"]))`);
    expect(expression).toContain(`return results;`);
  });

  test("buildTsPrincipalCollectionExpression returns empty array when no sources exist", () => {
    expect(buildTsPrincipalCollectionExpression(null, { csvHeaders: [] })).toBe("[]");
  });

  test("buildTsPrincipalExpression returns minimal payload when no sources are available", () => {
    const expression = buildTsPrincipalExpression(null, { csvHeaders: [] });
    expect(expression).toBe(
      [
        "({",
        '  "@odata.type": "microsoft.graph.externalConnectors.principal"',
        "})",
      ].join("\n")
    );
  });

  test("buildCsPrincipalExpression maps known and additional properties", () => {
    const expression = buildCsPrincipalExpression(
      [toField("profile.userPrincipalName", "User Principal"), toField("profile.alias", "Alias")],
      fallbackSource("fallback")
    );

    expect(expression).toContain(`OdataType = "microsoft.graph.externalConnectors.principal"`);
    expect(expression).toContain(`Upn = RowParser.ParseString(row, new[] { "User Principal" })`);
    expect(expression).toContain(`["alias"] = RowParser.ParseString(row, new[] { "Alias" })`);
  });

  test("buildCsPrincipalCollectionExpression generates looping serializer", () => {
    const expression = buildCsPrincipalCollectionExpression(
      [toField("profile.userPrincipalName", "owners"), toField("profile.alias", "aliases")],
      fallbackSource("fallback")
    );

    expect(expression).toContain("results.Add(principal);");
    expect(expression).toContain("AdditionalData = new Dictionary<string, object?>");
  });

  test("buildCsPrincipalCollectionExpression returns empty list without sources", () => {
    expect(buildCsPrincipalCollectionExpression(null, { csvHeaders: [] })).toBe("new List<Principal>()");
  });
});
