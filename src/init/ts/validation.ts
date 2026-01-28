import type { PropertyType } from "../../ir.js";

export function buildTsStringConstraintsLiteral(prop: {
  minLength?: number;
  maxLength?: number;
  pattern?: { regex: string; message?: string };
  format?: string;
}): string | undefined {
  const parts: string[] = [];
  if (prop.minLength !== undefined) parts.push(`minLength: ${prop.minLength}`);
  if (prop.maxLength !== undefined) parts.push(`maxLength: ${prop.maxLength}`);
  if (prop.pattern?.regex) parts.push(`pattern: ${JSON.stringify(prop.pattern.regex)}`);
  if (prop.format) parts.push(`format: ${JSON.stringify(prop.format)}`);
  return parts.length > 0 ? `{ ${parts.join(", ")} }` : undefined;
}

export function buildTsNumberConstraintsLiteral(prop: { minValue?: number; maxValue?: number }): string | undefined {
  const parts: string[] = [];
  if (prop.minValue !== undefined) parts.push(`minValue: ${prop.minValue}`);
  if (prop.maxValue !== undefined) parts.push(`maxValue: ${prop.maxValue}`);
  return parts.length > 0 ? `{ ${parts.join(", ")} }` : undefined;
}

export function applyTsValidationExpression(
  prop: {
    name: string;
    type: PropertyType;
    minLength?: number;
    maxLength?: number;
    pattern?: { regex: string; message?: string };
    format?: string;
    minValue?: number;
    maxValue?: number;
  },
  expression: string
): string {
  const stringConstraints = buildTsStringConstraintsLiteral(prop);
  const numberConstraints = buildTsNumberConstraintsLiteral(prop);
  const nameLiteral = JSON.stringify(prop.name);

  switch (prop.type) {
    case "string":
    case "principal":
    case "dateTime":
      return stringConstraints ? `validateString(${nameLiteral}, ${expression}, ${stringConstraints})` : expression;
    case "stringCollection":
    case "dateTimeCollection":
      return stringConstraints
        ? `validateStringCollection(${nameLiteral}, ${expression}, ${stringConstraints})`
        : expression;
    case "int64":
    case "double":
      return numberConstraints ? `validateNumber(${nameLiteral}, ${expression}, ${numberConstraints})` : expression;
    case "int64Collection":
    case "doubleCollection":
      return numberConstraints
        ? `validateNumberCollection(${nameLiteral}, ${expression}, ${numberConstraints})`
        : expression;
    default:
      return expression;
  }
}
