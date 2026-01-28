import type { PersonEntityField } from "../shared-types.js";

export const TS_INDENT = "  ";
export const CS_INDENT = "    ";

/** Collect all person-entity fields from a nested object tree. */
export function collectPersonEntityFields(node: Record<string, unknown>): PersonEntityField[] {
  const collected: PersonEntityField[] = [];
  const visit = (value: Record<string, unknown>): void => {
    for (const entry of Object.values(value)) {
      if (typeof entry === "object" && entry && "path" in (entry as PersonEntityField)) {
        collected.push(entry as PersonEntityField);
        continue;
      }
      if (typeof entry === "object" && entry && !Array.isArray(entry)) {
        visit(entry as Record<string, unknown>);
      }
    }
  };
  visit(node);
  return collected;
}
