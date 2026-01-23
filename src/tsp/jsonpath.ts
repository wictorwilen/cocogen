import { JSONPath } from "jsonpath-plus";

export function normalizeJsonPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("$")) return trimmed;
  if (trimmed.startsWith("[")) return `$${trimmed}`;

  const splitSegments = (raw: string): string[] => {
    const segments: string[] = [];
    let current = "";
    let bracketDepth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (const char of raw) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        current += char;
        escaped = true;
        continue;
      }
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        current += char;
        continue;
      }
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        current += char;
        continue;
      }
      if (!inSingleQuote && !inDoubleQuote) {
        if (char === "[") {
          bracketDepth += 1;
        } else if (char === "]") {
          bracketDepth = Math.max(0, bracketDepth - 1);
        } else if (char === "." && bracketDepth === 0) {
          if (current.length > 0) segments.push(current);
          current = "";
          continue;
        }
      }
      current += char;
    }

    if (current.length > 0) segments.push(current);
    return segments.filter(Boolean);
  };

  const segments = splitSegments(trimmed);
  if (segments.length === 0) return "";
  const encoded = segments
    .map((segment) => {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
        return `.${segment}`;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]+\])+$/u.test(segment)) {
        return `.${segment}`;
      }
      const escaped = segment.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      return `['${escaped}']`;
    })
    .join("");
  return `$${encoded}`;
}

export function assertValidJsonPath(
  value: string,
  createError: (message: string) => Error = (message) => new Error(message)
): void {
  if (!value || value.trim().length === 0) return;
  let bracketDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "[") bracketDepth += 1;
      if (char === "]") bracketDepth -= 1;
      if (bracketDepth < 0) {
        throw createError(`Invalid JSONPath syntax '${value}'. Unbalanced brackets.`);
      }
    }
  }
  if (bracketDepth !== 0 || inSingleQuote || inDoubleQuote) {
    throw createError(`Invalid JSONPath syntax '${value}'. Unbalanced brackets or quotes.`);
  }
  if (/\[\s*\]/u.test(value)) {
    throw createError(`Invalid JSONPath syntax '${value}'. Empty bracket expression.`);
  }
  try {
    JSONPath({ path: value, json: {}, wrap: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createError(`Invalid JSONPath syntax '${value}'. ${message}`);
  }
}
