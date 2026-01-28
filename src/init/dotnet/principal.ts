import type { PersonEntityField, SourceDescriptor } from "../shared-types.js";
import { buildCsSourceLiteral } from "../helpers/source.js";
import { buildPrincipalFieldEntries } from "../helpers/principal.js";

/** Build a principal object expression for C# transforms. */
export function buildCsPrincipalExpression(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackSource);
  const knownMap = new Map<string, string>([
    ["upn", "Upn"],
    ["userPrincipalName", "Upn"],
    ["tenantId", "TenantId"],
    ["externalName", "ExternalName"],
    ["externalId", "ExternalId"],
    ["entraDisplayName", "EntraDisplayName"],
    ["entraId", "EntraId"],
    ["email", "Email"],
  ]);

  const knownAssignments: string[] = [];
  const additionalDataEntries: string[] = [];

  for (const entry of entries) {
    const sourceLiteral = buildCsSourceLiteral(entry.source);
    const propertyName = knownMap.get(entry.key);
    if (propertyName) {
      knownAssignments.push(`    ${propertyName} = RowParser.ParseString(row, ${sourceLiteral}),`);
    } else {
      additionalDataEntries.push(
        `        [${JSON.stringify(entry.key)}] = RowParser.ParseString(row, ${sourceLiteral}),`
      );
    }
  }

  const additionalDataBlock = additionalDataEntries.length
    ? [
        "    AdditionalData = new Dictionary<string, object?>",
        "    {",
        ...additionalDataEntries,
        "    },",
      ]
    : [];

  return [
    "new Principal",
    "{",
    "    OdataType = \"microsoft.graph.externalConnectors.principal\",",
    ...knownAssignments,
    ...additionalDataBlock,
    "}",
  ].join("\n");
}

/** Build a principal collection expression for C# transforms. */
export function buildCsPrincipalCollectionExpression(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackSource);
  if (entries.length === 0) return "new List<Principal>()";

  const fieldLines = entries.map((entry, index) => {
    const sourceLiteral = buildCsSourceLiteral(entry.source);
    return `        var field${index} = RowParser.ParseStringCollection(row, ${sourceLiteral});`;
  });

  const knownMap = new Map<string, string>([
    ["upn", "Upn"],
    ["userPrincipalName", "Upn"],
    ["tenantId", "TenantId"],
    ["externalName", "ExternalName"],
    ["externalId", "ExternalId"],
    ["entraDisplayName", "EntraDisplayName"],
    ["entraId", "EntraId"],
    ["email", "Email"],
  ]);

  const knownAssignments = entries
    .map((entry, index) => {
      const propertyName = knownMap.get(entry.key);
      return propertyName ? `                ${propertyName} = GetValue(field${index}, index),` : null;
    })
    .filter((line): line is string => Boolean(line));

  const additionalDataEntries = entries
    .map((entry, index) => {
      if (knownMap.has(entry.key)) return null;
      return `                    [${JSON.stringify(entry.key)}] = GetValue(field${index}, index),`;
    })
    .filter((line): line is string => Boolean(line));

  const additionalDataBlock = additionalDataEntries.length
    ? [
        "                AdditionalData = new Dictionary<string, object?>",
        "                {",
        ...additionalDataEntries,
        "                },",
      ]
    : [];

  const lengthsLine = entries.map((_, index) => `field${index}.Count`).join(", ");

  return [
    "new Func<List<Principal>>(() =>",
    "{",
    ...fieldLines,
    `        var lengths = new[] { ${lengthsLine} };`,
    "        var maxLen = 0;",
    "        foreach (var len in lengths)",
    "        {",
    "            if (len > maxLen) maxLen = len;",
    "        }",
    "        string GetValue(IReadOnlyList<string> values, int index)",
    "        {",
    "            if (values.Count == 0) return \"\";",
    "            if (values.Count == 1) return values[0] ?? \"\";",
    "            return index < values.Count ? (values[index] ?? \"\") : \"\";",
    "        }",
    "        var results = new List<Principal>();",
    "        for (var index = 0; index < maxLen; index++)",
    "        {",
    "            var principal = new Principal",
    "            {",
    "                OdataType = \"microsoft.graph.externalConnectors.principal\",",
    ...knownAssignments,
    ...additionalDataBlock,
    "            };",
    "            results.Add(principal);",
    "        }",
    "        return results;",
    "})()",
  ].join("\n");
}
