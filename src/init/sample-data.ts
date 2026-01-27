import { stringify as stringifyYaml } from "yaml";

import type { ConnectorIr, PropertyType } from "../ir.js";
import { buildObjectTree } from "./object-tree.js";
import type { PersonEntityField, SourceDescriptor } from "./shared-types.js";

type JsonPathStep =
  | { type: "prop"; key: string }
  | { type: "index"; index: number };

function csvEscape(value: string): string {
  if (value.includes("\n") || value.includes("\r") || value.includes(",") || value.includes("\"")) {
    return `"${value.replaceAll("\"", '""')}"`;
  }
  return value;
}

function jsonPathToSteps(path: string): JsonPathStep[] {
  const trimmed = path.trim();
  if (!trimmed) return [];

  let raw = trimmed;
  if (raw.startsWith("$")) {
    raw = raw.slice(1);
    if (raw.startsWith(".")) raw = raw.slice(1);
  }

  const splitSegments = (value: string): string[] => {
    const segments: string[] = [];
    let current = "";
    let bracketDepth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (const char of value) {
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

  const findClosingBracket = (value: string, start: number): number => {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;
    for (let i = start + 1; i < value.length; i += 1) {
      const char = value[i]!;
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
      if (!inSingleQuote && !inDoubleQuote && char === "]") return i;
    }
    return -1;
  };

  const parseBracketContent = (rawContent: string): JsonPathStep[] => {
    const content = rawContent.trim();
    if (!content) return [];
    if (content === "*") return [{ type: "index", index: 0 }];
    const quoted = content.match(/^['"](.*)['"]$/);
    if (quoted) {
      const key = quoted[1] ?? "";
      return key ? [{ type: "prop", key }] : [];
    }
    const index = Number.parseInt(content, 10);
    if (!Number.isNaN(index)) return [{ type: "index", index }];
    return [{ type: "prop", key: content }];
  };

  const parseSegment = (segment: string): JsonPathStep[] => {
    const steps: JsonPathStep[] = [];
    let cursor = segment;

    if (cursor.startsWith("[")) {
      while (cursor.startsWith("[")) {
        const close = findClosingBracket(cursor, 0);
        if (close === -1) break;
        const content = cursor.slice(1, close);
        steps.push(...parseBracketContent(content));
        cursor = cursor.slice(close + 1);
      }
      if (cursor.length > 0) {
        steps.push({ type: "prop", key: cursor });
      }
      return steps;
    }

    const match = cursor.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (match) {
      steps.push({ type: "prop", key: match[0] });
      cursor = cursor.slice(match[0].length);
    } else if (cursor.length > 0) {
      steps.push({ type: "prop", key: cursor });
      return steps;
    }

    while (cursor.startsWith("[")) {
      const close = findClosingBracket(cursor, 0);
      if (close === -1) break;
      const content = cursor.slice(1, close);
      steps.push(...parseBracketContent(content));
      cursor = cursor.slice(close + 1);
    }

    return steps;
  };

  return splitSegments(raw).flatMap(parseSegment);
}

function setNestedValue(target: Record<string, unknown>, steps: JsonPathStep[], value: unknown): void {
  if (steps.length === 0) return;
  let cursor: unknown = target;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const isLast = i === steps.length - 1;
    const next = steps[i + 1];

    if (step.type === "prop") {
      if (typeof cursor !== "object" || cursor === null) return;
      const container = cursor as Record<string, unknown>;
      if (isLast) {
        container[step.key] = value;
        return;
      }
      if (next?.type === "index") {
        if (!Array.isArray(container[step.key])) {
          container[step.key] = [];
        }
        cursor = container[step.key];
      } else {
        if (!container[step.key] || typeof container[step.key] !== "object" || Array.isArray(container[step.key])) {
          container[step.key] = {};
        }
        cursor = container[step.key];
      }
      continue;
    }

    if (!Array.isArray(cursor)) return;
    const index = Math.max(0, step.index);
    while (cursor.length <= index) {
      cursor.push({});
    }
    if (isLast) {
      cursor[index] = value;
      return;
    }
    if (next?.type === "index") {
      if (!Array.isArray(cursor[index])) {
        cursor[index] = [];
      }
    } else if (!cursor[index] || typeof cursor[index] !== "object" || Array.isArray(cursor[index])) {
      cursor[index] = {};
    }
    cursor = cursor[index];
  }
}

function setNestedObject(target: Record<string, unknown>, segments: string[], value: unknown): void {
  if (segments.length === 0) return;
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!;
    const existing = cursor[key];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
}

function sampleValueForType(type: PropertyType): string {
  switch (type) {
    case "boolean":
      return "true";
    case "int64":
      return "123";
    case "double":
      return "1.23";
    case "dateTime":
      return "2024-01-01T00:00:00Z";
    case "stringCollection":
      return "alpha;beta";
    case "int64Collection":
      return "1;2";
    case "doubleCollection":
      return "1.1;2.2";
    case "dateTimeCollection":
      return "2024-01-01T00:00:00Z;2024-01-02T00:00:00Z";
    case "principal":
      return "alice@contoso.com";
    case "principalCollection":
      return "alice@contoso.com;bob@contoso.com";
    case "string":
    default:
      return "sample";
  }
}

function exampleValueForType(example: unknown, type: PropertyType): string | undefined {
  if (example === undefined || example === null) return undefined;

  if (type.endsWith("Collection")) {
    if (Array.isArray(example)) {
      return example.map((value) => (value === undefined || value === null ? "" : String(value))).join(";");
    }
    if (typeof example === "string") return example;
    return JSON.stringify(example);
  }

  if (typeof example === "string") return example;
  if (typeof example === "number" || typeof example === "boolean") return String(example);
  return JSON.stringify(example);
}

function sampleValueForHeader(header: string, type?: PropertyType): string {
  const lower = header.toLowerCase();
  if (lower.includes("job title")) return "Software Engineer";
  if (lower.includes("company")) return "Contoso";
  if (lower.includes("employee")) return "E123";
  if (lower.includes("upn") || lower.includes("userprincipal")) return "user@contoso.com";
  if (lower.includes("email")) return "user@contoso.com";
  if (lower.includes("url") || lower.includes("website")) return "https://example.com";
  if (lower.includes("phone")) return "+1 555 0100";
  if (lower.includes("level")) return "expert;intermediate";
  if (lower.includes("skill")) return "TypeScript;Python";
  if (lower.includes("proficiency")) return "advancedProfessional;expert";
  if (lower.includes("name")) return "Ada Lovelace";
  if (lower.includes("address")) return "1 Main St";
  if (lower.includes("city")) return "Seattle";
  if (lower.includes("country")) return "US";
  if (lower.includes("note") || lower.includes("bio")) return "Sample profile note";
  return type ? sampleValueForType(type) : "sample";
}

function sampleValueForPrincipalKey(key: string, index = 0): string {
  const suffix = index > 0 ? index.toString() : "";
  const email = `user${suffix}@contoso.com`;
  switch (key) {
    case "upn":
    case "email":
    case "externalId":
      return email;
    case "tenantId":
    case "entraId":
      return "00000000-0000-0000-0000-000000000000";
    case "externalName":
    case "entraDisplayName":
      return suffix ? `Ada Lovelace ${suffix}` : "Ada Lovelace";
    default:
      return `sample-${key}`;
  }
}

function buildSamplePrincipalObject(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor,
  index = 0
): Record<string, unknown> {
  const entries = buildPrincipalFieldEntries(fields, fallbackSource);
  const keys = entries.length > 0 ? entries.map((entry) => entry.key) : ["upn"];
  const principal: Record<string, unknown> = {
    "@odata.type": "microsoft.graph.externalConnectors.principal",
  };
  for (const key of keys) {
    principal[key] = sampleValueForPrincipalKey(key, index);
  }
  return principal;
}

function buildSamplePrincipalCollection(
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): Array<Record<string, unknown>> {
  return [
    buildSamplePrincipalObject(fields, fallbackSource, 0),
    buildSamplePrincipalObject(fields, fallbackSource, 1),
  ];
}

function buildSamplePersonEntityObject(fields: PersonEntityField[], index = 0): Record<string, unknown> {
  const tree = buildObjectTree(fields);
  const valueByPath = new Map<string, string>();

  for (const field of fields) {
    const header = field.source.csvHeaders[0] ?? field.path;
    const raw = sampleValueForHeader(header);
    const values = raw.split(/\s*;\s*/).map((value) => value.trim()).filter(Boolean);
    const value = values.length > 0 ? (values[index] ?? values[0] ?? "") : raw;
    valueByPath.set(field.path, value);
  }

  const renderNode = (node: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        result[key] = valueByPath.get(field.path) ?? "";
      } else {
        result[key] = renderNode(value as Record<string, unknown>);
      }
    }
    return result;
  };

  return renderNode(tree);
}

function buildSamplePersonEntityPayload(fields: PersonEntityField[], isCollection: boolean): string | string[] {
  if (!isCollection) {
    return JSON.stringify(buildSamplePersonEntityObject(fields, 0));
  }

  const objects = [
    buildSamplePersonEntityObject(fields, 0),
    buildSamplePersonEntityObject(fields, 1),
  ];
  return objects.map((value) => JSON.stringify(value));
}

function exampleValueForPayload(example: unknown, type: PropertyType): unknown {
  if (example === undefined || example === null) return undefined;
  if (type.endsWith("Collection")) {
    if (Array.isArray(example)) return example;
    if (typeof example === "string") {
      return example.split(/\s*;\s*/).map((value) => value.trim()).filter(Boolean);
    }
    return [String(example)];
  }
  return example;
}

function sampleJsonValueForType(type: PropertyType): unknown {
  switch (type) {
    case "boolean":
      return true;
    case "int64":
      return 123;
    case "double":
      return 1.23;
    case "dateTime":
      return "2024-01-01T00:00:00Z";
    case "stringCollection":
      return ["alpha", "beta"];
    case "int64Collection":
      return [1, 2];
    case "doubleCollection":
      return [1.1, 2.2];
    case "dateTimeCollection":
      return ["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z"];
    case "principal":
      return "user@contoso.com";
    case "principalCollection":
      return ["user@contoso.com", "user2@contoso.com"];
    case "string":
    default:
      return "sample";
  }
}

function samplePayloadValueForType(
  type: PropertyType,
  fields: PersonEntityField[] | null,
  fallbackSource: SourceDescriptor
): unknown {
  switch (type) {
    case "boolean":
      return true;
    case "int64":
      return 123;
    case "double":
      return 1.23;
    case "dateTime":
      return "2024-01-01T00:00:00Z";
    case "stringCollection":
      return ["alpha", "beta"];
    case "int64Collection":
      return [1, 2];
    case "doubleCollection":
      return [1.1, 2.2];
    case "dateTimeCollection":
      return ["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z"];
    case "principal":
      return buildSamplePrincipalObject(fields, fallbackSource, 0);
    case "principalCollection":
      return buildSamplePrincipalCollection(fields, fallbackSource);
    case "string":
    default:
      return "sample";
  }
}

function buildPrincipalFieldEntries(
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

function buildSampleItem(ir: ConnectorIr): Record<string, unknown> {
  const item: Record<string, unknown> = {};

  for (const prop of ir.properties) {
    if (prop.personEntity) {
      const arrayGroups = new Map<string, Array<{ key: string; values: string[] }>>();

      for (const field of prop.personEntity.fields) {
        const path = field.source.jsonPath ?? field.source.csvHeaders[0] ?? field.path;
        if (path.includes("[*]")) {
          const root = path.split("[*]")[0] ?? "";
          const elementPath = path.replace(`${root}[*].`, "");
          const header = field.source.csvHeaders[0] ?? field.path;
          const sampleValue = sampleValueForHeader(header, prop.type);
          const values = sampleValue.split(/\s*;\s*/).map((value) => value.trim()).filter(Boolean);
          if (!arrayGroups.has(root)) arrayGroups.set(root, []);
          arrayGroups.get(root)!.push({ key: elementPath, values });
          continue;
        }

        const steps = jsonPathToSteps(path);
        const header = [...steps].reverse().find((step) => step.type === "prop")?.key ?? field.path;
        const sampleValue = sampleValueForHeader(header, prop.type);
        setNestedValue(item, steps, sampleValue);
      }

      for (const [root, fields] of arrayGroups) {
        const lengths = fields.map((field) => field.values.length).filter((len) => len > 0);
        const maxLen = lengths.length > 0 ? Math.max(...lengths) : 1;
        const entries = Array.from({ length: maxLen }, (_, index) => {
          const entry: Record<string, unknown> = {};
          for (const field of fields) {
            const raw = field.values[index] ?? field.values[0] ?? "";
            const steps = jsonPathToSteps(field.key);
            setNestedValue(entry, steps, raw);
          }
          return entry;
        });
        const trimmedRoot = root.replace(/\.$/, "");
        const segments = trimmedRoot.split(".").map((segment) => segment.trim()).filter(Boolean);
        setNestedObject(item, segments, entries);
      }
      continue;
    }

    const path = prop.source.jsonPath ?? prop.source.csvHeaders[0] ?? prop.name;
    const steps = jsonPathToSteps(path);
    const exampleValue = exampleValueForPayload(prop.example, prop.type);
    const value = exampleValue ?? sampleJsonValueForType(prop.type);
    setNestedValue(item, steps, value);
  }

  return item;
}

function buildSampleCsv(ir: ConnectorIr): string {
  const headers: string[] = [];
  const seen = new Set<string>();
  const addHeader = (header: string): void => {
    if (seen.has(header)) return;
    seen.add(header);
    headers.push(header);
  };

  for (const prop of ir.properties) {
    if (prop.personEntity) {
      for (const field of prop.personEntity.fields) addHeader(field.source.csvHeaders[0] ?? field.path);
      continue;
    }

    for (const header of prop.source.csvHeaders) addHeader(header);
  }

  const valueByHeader = new Map<string, string>();
  for (const prop of ir.properties) {
    if (prop.personEntity) {
      const exampleValue = exampleValueForType(prop.example, prop.type);
      if (exampleValue && prop.personEntity.fields.length === 1) {
        const header = prop.personEntity.fields[0]?.source.csvHeaders[0] ?? prop.personEntity.fields[0]?.path ?? prop.name;
        valueByHeader.set(header, exampleValue);
      }
      for (const field of prop.personEntity.fields) {
        const header = field.source.csvHeaders[0] ?? field.path;
        if (!valueByHeader.has(header)) {
          valueByHeader.set(header, sampleValueForHeader(header, prop.type));
        }
      }
      continue;
    }

    const exampleValue = exampleValueForType(prop.example, prop.type);
    for (const header of prop.source.csvHeaders) {
      if (!valueByHeader.has(header)) {
        valueByHeader.set(header, exampleValue ?? sampleValueForHeader(header, prop.type));
      }
    }
  }

  const headerLine = headers.map(csvEscape).join(",");
  const valueLine = headers.map((header) => csvEscape(valueByHeader.get(header) ?? "sample")).join(",");
  return `${headerLine}\n${valueLine}\n`;
}

function buildSampleJson(ir: ConnectorIr): string {
  return JSON.stringify([buildSampleItem(ir)], null, 2) + "\n";
}

function buildSampleYaml(ir: ConnectorIr): string {
  const yaml = stringifyYaml([buildSampleItem(ir)]);
  return yaml.endsWith("\n") ? yaml : `${yaml}\n`;
}

export {
  buildSampleCsv,
  buildSampleJson,
  buildSampleYaml,
  buildSamplePersonEntityPayload,
  exampleValueForPayload,
  exampleValueForType,
  samplePayloadValueForType,
};
