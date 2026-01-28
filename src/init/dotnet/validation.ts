import type { PropertyType } from "../../ir.js";

export function buildCsStringConstraintsLiteral(prop: {
  minLength?: number;
  maxLength?: number;
  pattern?: { regex: string; message?: string };
  format?: string;
}): { minLength: string; maxLength: string; pattern: string; format: string; hasAny: boolean } {
  const minLength = prop.minLength !== undefined ? prop.minLength.toString() : "null";
  const maxLength = prop.maxLength !== undefined ? prop.maxLength.toString() : "null";
  const pattern = prop.pattern?.regex ? JSON.stringify(prop.pattern.regex) : "null";
  const format = prop.format ? JSON.stringify(prop.format) : "null";
  const hasAny =
    prop.minLength !== undefined ||
    prop.maxLength !== undefined ||
    Boolean(prop.pattern?.regex) ||
    Boolean(prop.format);
  return { minLength, maxLength, pattern, format, hasAny };
}

export function buildCsNumberConstraintsLiteral(prop: { minValue?: number; maxValue?: number }): {
  minValue: string;
  maxValue: string;
  hasAny: boolean;
} {
  const minValue = prop.minValue !== undefined ? prop.minValue.toString() : "null";
  const maxValue = prop.maxValue !== undefined ? prop.maxValue.toString() : "null";
  const hasAny = prop.minValue !== undefined || prop.maxValue !== undefined;
  return { minValue, maxValue, hasAny };
}

export function applyCsValidationExpression(
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
  expression: string,
  sourceLiteral: string
): string {
  const stringConstraints = buildCsStringConstraintsLiteral(prop);
  const numberConstraints = buildCsNumberConstraintsLiteral(prop);
  const nameLiteral = JSON.stringify(prop.name);

  switch (prop.type) {
    case "string":
    case "principal":
      return stringConstraints.hasAny
        ? `Validation.ValidateString(${nameLiteral}, ${expression}, ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format})`
        : expression;
    case "dateTime":
      if (!stringConstraints.hasAny) return expression;
      return `RowParser.ParseDateTime(Validation.ValidateString(${nameLiteral}, RowParser.ReadValue(row, ${sourceLiteral}), ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format}))`;
    case "stringCollection":
      return stringConstraints.hasAny
        ? `Validation.ValidateStringCollection(${nameLiteral}, ${expression}, ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format})`
        : expression;
    case "dateTimeCollection":
      if (!stringConstraints.hasAny) return expression;
      return `Validation.ValidateStringCollection(${nameLiteral}, RowParser.ParseStringCollection(RowParser.ReadValue(row, ${sourceLiteral})), ${stringConstraints.minLength}, ${stringConstraints.maxLength}, ${stringConstraints.pattern}, ${stringConstraints.format}).Select(value => RowParser.ParseDateTime(value)).ToList()`;
    case "int64":
      return numberConstraints.hasAny
        ? `Validation.ValidateInt64(${nameLiteral}, ${expression}, ${numberConstraints.minValue}, ${numberConstraints.maxValue})`
        : expression;
    case "double":
      return numberConstraints.hasAny
        ? `Validation.ValidateDouble(${nameLiteral}, ${expression}, ${numberConstraints.minValue}, ${numberConstraints.maxValue})`
        : expression;
    case "int64Collection":
      return numberConstraints.hasAny
        ? `Validation.ValidateInt64Collection(${nameLiteral}, ${expression}, ${numberConstraints.minValue}, ${numberConstraints.maxValue})`
        : expression;
    case "doubleCollection":
      return numberConstraints.hasAny
        ? `Validation.ValidateDoubleCollection(${nameLiteral}, ${expression}, ${numberConstraints.minValue}, ${numberConstraints.maxValue})`
        : expression;
    default:
      return expression;
  }
}
