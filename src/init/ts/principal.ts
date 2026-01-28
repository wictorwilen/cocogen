import type { PersonEntityField, SourceDescriptor } from "../shared-types.js";
import { buildSourceLiteral } from "../helpers/source.js";
import { buildPrincipalFieldEntries } from "../helpers/principal.js";

/** Build a principal JSON expression for a single item. */
export function buildTsPrincipalExpression(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackSource).map(
    (entry) =>
      `  ${JSON.stringify(entry.key)}: parseString(readSourceValue(row, ${buildSourceLiteral(entry.source)}))`
  );

  return `({\n  "@odata.type": "microsoft.graph.externalConnectors.principal"${
    entries.length ? ",\n" + entries.join(",\n") : ""
  }\n})`;
}

/** Build a principal JSON expression for a collection of items. */
export function buildTsPrincipalCollectionExpression(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): string {
  const entries = buildPrincipalFieldEntries(fields, fallbackSource);
  if (entries.length === 0) return "[]";

  const fieldLines = entries.map(
    (entry, index) =>
      `  const field${index} = parseStringCollection(readSourceValue(row, ${buildSourceLiteral(entry.source)}));`
  );
  const lengthVars = entries.length
    ? `  const lengths = [${entries.map((_, index) => `field${index}.length`).join(", ")}];`
    : "  const lengths = [0];";

  const fieldsBlock = entries
    .map((entry, index) => `      ${JSON.stringify(entry.key)}: getValue(field${index}, index)`)
    .join(",\n");

  return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n  const maxLen = Math.max(0, ...lengths);\n  const getValue = (values: string[], index: number): string => {\n    if (values.length === 0) return "";\n    if (values.length === 1) return values[0] ?? "";\n    return values[index] ?? "";\n  };\n  const results: Principal[] = [];\n  for (let index = 0; index < maxLen; index++) {\n    results.push({\n      "@odata.type": "microsoft.graph.externalConnectors.principal",\n${fieldsBlock}\n    });\n  }\n  return results;\n})()`;
}
