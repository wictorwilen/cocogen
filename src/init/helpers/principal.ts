import type { PersonEntityField, SourceDescriptor } from "../shared-types.js";

export function buildPrincipalFieldEntries(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): Array<{ key: string; source: SourceDescriptor }> {
  if (fields && fields.length > 0) {
    return fields
      .map((field) => {
        const rawKey = field.path.split(".").pop() ?? field.path;
        const key = rawKey === "userPrincipalName" ? "upn" : rawKey;
        return {
          key,
          source: field.source,
        };
      })
      .filter((entry) => entry.key.length > 0);
  }

  if (fallbackSource.jsonPath || fallbackSource.csvHeaders.length > 0) {
    return [
      {
        key: "upn",
        source: fallbackSource,
      },
    ];
  }

  return [];
}
