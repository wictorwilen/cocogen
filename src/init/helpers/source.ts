import type { SourceDescriptor } from "../shared-types.js";

export function buildSourceLiteral(source: SourceDescriptor): string {
  if (source.jsonPath && source.jsonPath.trim().length > 0) {
    return JSON.stringify(source.jsonPath);
  }
  return JSON.stringify(source.csvHeaders);
}

export function buildCsSourceLiteral(source: SourceDescriptor): string {
  if (source.jsonPath && source.jsonPath.trim().length > 0) {
    return JSON.stringify(source.jsonPath);
  }
  return `new[] { ${source.csvHeaders.map((h) => JSON.stringify(h)).join(", ")} }`;
}
