import type { PropertyType } from "../ir.js";

/** Map property types to TypeScript types used in templates. */
export function toTsType(type: PropertyType): string {
  switch (type) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "int64":
    case "double":
      return "number";
    case "dateTime":
      return "string";
    case "stringCollection":
      return "string[]";
    case "int64Collection":
    case "doubleCollection":
      return "number[]";
    case "dateTimeCollection":
      return "string[]";
    case "principal":
      return "Principal";
    case "principalCollection":
      return "Principal[]";
    default:
      return "unknown";
  }
}

/** Map property types to C# types used in templates. */
export function toCsType(type: PropertyType): string {
  switch (type) {
    case "string":
      return "string";
    case "principal":
      return "Principal";
    case "principalCollection":
      return "List<Principal>";
    case "boolean":
      return "bool";
    case "int64":
      return "long";
    case "double":
      return "double";
    case "dateTime":
      return "DateTimeOffset";
    case "stringCollection":
      return "List<string>";
    case "int64Collection":
      return "List<long>";
    case "doubleCollection":
      return "List<double>";
    case "dateTimeCollection":
      return "List<DateTimeOffset>";
    default:
      return "object";
  }
}

/** Convert an arbitrary name into a C#-friendly identifier. */
export function toCsIdentifier(name: string): string {
  const parts = name.split(/[_\-\s]+/g).filter(Boolean);
  const pascal = parts.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join("");
  return pascal || "Item";
}

/** Convert a name to PascalCase for C# symbols. */
export function toCsPascal(name: string): string {
  if (!name) return "Value";
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

/** Choose a unique C# property name avoiding collisions. */
export function toCsPropertyName(name: string, itemTypeName: string, used: Set<string>): string {
  const base = toCsIdentifier(name);
  const forbidden = itemTypeName.toLowerCase();
  let candidate = base.toLowerCase() === forbidden ? `${base}Value` : base;
  let suffix = 1;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Convert an arbitrary name into a TypeScript identifier. */
export function toTsIdentifier(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/g).filter(Boolean);
  if (parts.length === 0) return "Item";

  const pascal = parts.map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join("");
  const sanitized = pascal.replaceAll(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

/** Resolve a C# schema folder name from the connection name. */
export function toSchemaFolderName(connectionName: string | undefined): string {
  const cleaned = (connectionName ?? "").trim();
  if (!cleaned) return "Schema";
  const candidate = toCsIdentifier(cleaned);
  return candidate || "Schema";
}

/** Resolve a TS schema folder name from the connection name. */
export function toTsSchemaFolderName(connectionName: string | undefined): string {
  const cleaned = (connectionName ?? "").trim();
  if (!cleaned) return "schema";
  const candidate = toTsIdentifier(cleaned);
  return candidate || "schema";
}

/** Normalize a project name into a C# namespace. */
export function toCsNamespace(projectName: string): string {
  const cleaned = projectName
    .replaceAll(/[^A-Za-z0-9_\.\-\s]/g, "")
    .replaceAll(/[\-\s]+/g, "_")
    .replaceAll(/\.+/g, ".")
    .trim();

  const parts = cleaned.split(".").filter(Boolean).map(toCsIdentifier);
  return parts.length > 0 ? parts.join(".") : "Connector";
}
