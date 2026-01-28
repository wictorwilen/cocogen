import type { SourceDescriptor } from "../shared-types.js";

/** Emit a TS literal for JSONPath or CSV header sources. */
export function buildSourceLiteral(source: SourceDescriptor): string {
  if (source.jsonPath && source.jsonPath.trim().length > 0) {
    return JSON.stringify(source.jsonPath);
  }
  return JSON.stringify(source.csvHeaders);
}

/** Emit a C# literal for JSONPath or CSV header sources. */
export function buildCsSourceLiteral(source: SourceDescriptor): string {
  if (source.jsonPath && source.jsonPath.trim().length > 0) {
    return JSON.stringify(source.jsonPath);
  }
  return `new[] { ${source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
}
