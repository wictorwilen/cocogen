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

/** Emit a TS literal for source transforms. */
export function buildSourceTransformsLiteral(source: Pick<SourceDescriptor, "transforms">): string | null {
  if (!source.transforms || source.transforms.length === 0) {
    return null;
  }
  return JSON.stringify(source.transforms);
}

/** Emit a C# literal for source transforms. */
export function buildCsSourceTransformsLiteral(source: Pick<SourceDescriptor, "transforms">): string | null {
  if (!source.transforms || source.transforms.length === 0) {
    return null;
  }
  return `new[] { ${source.transforms.map((transform) => JSON.stringify(transform)).join(", ")} }`;
}
