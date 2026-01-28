import { buildObjectTree } from "../object-tree.js";
import type { PersonEntityField } from "../shared-types.js";
import { buildSourceLiteral } from "../helpers/source.js";

export type TsPersonEntityTypeInfo = {
  alias: string;
  properties: Map<string, string>;
};

export type TsPersonEntityTypeMap = Map<string, TsPersonEntityTypeInfo>;

export function buildTsPersonEntityExpression(
  fields: PersonEntityField[],
  valueExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `parseString(readSourceValue(row, ${sourceLiteral}))`,
  typeInfo: TsPersonEntityTypeInfo | null,
  typeMap: TsPersonEntityTypeMap
): string {
  const tree = buildObjectTree(fields);
  const indentUnit = "  ";
  const indentLines = (text: string, prefix: string): string =>
    text
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");

  const collectFields = (node: Record<string, unknown>): PersonEntityField[] => {
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
  };

  const renderNodeForCollection = (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: TsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        return `${childIndent}${JSON.stringify(key)}: ${valueVar}`;
      }
      const propType = info?.properties.get(key) ?? null;
      const nestedType = propType && !propType.endsWith("[]") ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNodeForCollection(value as Record<string, unknown>, level + 1, valueVar, nestedType);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${childIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  const renderNodeForCollectionMany = (
    node: Record<string, unknown>,
    info: TsPersonEntityTypeInfo | null,
    level: number,
    fieldVarByPath: Map<string, string>
  ): string => {
    const entryIndent = indentUnit.repeat(level);
    const closeIndent = indentUnit.repeat(Math.max(0, level - 1));
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const varName = fieldVarByPath.get(field.path) ?? "";
        return `${entryIndent}${JSON.stringify(key)}: getValue(${varName}, index)`;
      }
      const propType = info?.properties.get(key) ?? null;
      const nestedType = propType && !propType.endsWith("[]") ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNodeForCollectionMany(value as Record<string, unknown>, nestedType, level + 1, fieldVarByPath);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${entryIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${closeIndent}}`;
  };

  const renderCollectionNode = (
    node: Record<string, unknown>,
    level: number,
    elementInfo: TsPersonEntityTypeInfo | null,
    elementType: string | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const bodyIndent = indentUnit.repeat(level + 1);
    const collected = collectFields(node);
    if (collected.length === 0) return "undefined";

    if (!elementInfo && elementType === "string") {
      const sourceLiteral = buildSourceLiteral(collected[0]!.source);
      return `(() => {\n${bodyIndent}const values = parseStringCollection(readSourceValue(row, ${sourceLiteral}));\n${bodyIndent}return values.length > 0 ? values : undefined;\n${indent}})()`;
    }

    if (collected.length === 1) {
      const field = collected[0]!;
      const sourceLiteral = buildSourceLiteral(field.source);
      const rendered = renderNodeForCollection(node, level + 1, "value", elementInfo);
      const typed = elementInfo ? `(${rendered} as ${elementInfo.alias})` : rendered;
      return `(() => {\n${bodyIndent}const values = parseStringCollection(readSourceValue(row, ${sourceLiteral}));\n${bodyIndent}if (values.length === 0) return undefined;\n${bodyIndent}return values.map((value) => ${typed});\n${indent}})()`;
    }

    const fieldVarByPath = new Map<string, string>();
    const fieldLines = collected.map((field, index) => {
      const varName = `field${index}`;
      fieldVarByPath.set(field.path, varName);
      const sourceLiteral = buildSourceLiteral(field.source);
      return `${bodyIndent}const ${varName} = parseStringCollection(readSourceValue(row, ${sourceLiteral}));`;
    });
    const fieldVars = [...fieldVarByPath.values()].join(", ");
    const lengthVars = fieldVars
      ? `${bodyIndent}const lengths = [${fieldVars}].map((value) => value.length);`
      : `${bodyIndent}const lengths = [0];`;
    const rendered = renderNodeForCollectionMany(node, elementInfo, level + 2, fieldVarByPath);
    const typed = elementInfo ? `(${rendered} as ${elementInfo.alias})` : rendered;

    return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n${bodyIndent}const maxLen = Math.max(0, ...lengths);\n${bodyIndent}if (maxLen === 0) return undefined;\n${bodyIndent}const getValue = (values: string[], index: number): string => {\n${bodyIndent}${indentUnit}if (values.length === 0) return "";\n${bodyIndent}${indentUnit}if (values.length === 1) return values[0] ?? "";\n${bodyIndent}${indentUnit}return values[index] ?? "";\n${bodyIndent}};\n${bodyIndent}const results: Array<${elementInfo ? elementInfo.alias : "unknown"}> = [];\n${bodyIndent}for (let index = 0; index < maxLen; index++) {\n${bodyIndent}${indentUnit}results.push(${typed});\n${bodyIndent}}\n${bodyIndent}return results;\n${indent}})()`;
  };

  const renderNode = (node: Record<string, unknown>, level: number, info: TsPersonEntityTypeInfo | null): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const sourceLiteral = buildSourceLiteral(field.source);
        const propType = info?.properties.get(key) ?? null;
        if (propType && propType.endsWith("[]")) {
          return `${childIndent}${JSON.stringify(key)}: parseStringCollection(readSourceValue(row, ${sourceLiteral}))`;
        }
        return `${childIndent}${JSON.stringify(key)}: ${valueExpressionBuilder(sourceLiteral)}`;
      }

      const propType = info?.properties.get(key) ?? null;
      if (propType && propType.endsWith("[]")) {
        const elementType = propType.slice(0, -2);
        const elementInfo = typeMap.get(elementType) ?? null;
        const renderedCollection = renderCollectionNode(value as Record<string, unknown>, level + 1, elementInfo, elementType);
        return `${childIndent}${JSON.stringify(key)}: ${renderedCollection}`;
      }
      const nestedType = propType ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNode(value as Record<string, unknown>, level + 1, nestedType);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${childIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  const rendered = renderNode(tree, 0, typeInfo);
  const typed = typeInfo ? `(${rendered} as ${typeInfo.alias})` : rendered;
  const typedIndented = indentLines(typed, indentUnit.repeat(3));
  return `JSON.stringify(\n${typedIndented}\n${indentUnit.repeat(2)})`;
}

export function buildTsPersonEntityCollectionExpression(
  fields: PersonEntityField[],
  collectionExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `parseStringCollection(readSourceValue(row, ${sourceLiteral}))`,
  typeInfo: TsPersonEntityTypeInfo | null,
  typeMap: TsPersonEntityTypeMap
): string {
  const indentUnit = "  ";
  const bodyIndent = "      ";
  const closeIndent = "    ";
  const indentLines = (text: string, prefix: string): string =>
    text
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");

  const collectFields = (node: Record<string, unknown>): PersonEntityField[] => {
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
  };

  const renderNodeForCollection = (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: TsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const propType = info?.properties.get(key) ?? null;
        if (propType && propType.endsWith("[]")) {
          return `${childIndent}${JSON.stringify(key)}: (${valueVar} ? [${valueVar}] : [])`;
        }
        return `${childIndent}${JSON.stringify(key)}: ${valueVar}`;
      }
      const propType = info?.properties.get(key) ?? null;
      if (propType && propType.endsWith("[]")) {
        const elementType = propType.slice(0, -2);
        const elementInfo = typeMap.get(elementType) ?? null;
        const renderedCollection = renderCollectionNode(value as Record<string, unknown>, level + 1, elementInfo, elementType);
        return `${childIndent}${JSON.stringify(key)}: ${renderedCollection}`;
      }
      const nestedType = propType && !propType.endsWith("[]") ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNodeForCollection(value as Record<string, unknown>, level + 1, valueVar, nestedType);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${childIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  const renderNodeForCollectionMany = (
    node: Record<string, unknown>,
    info: TsPersonEntityTypeInfo | null,
    level: number,
    fieldVarByPath: Map<string, string>
  ): string => {
    const entryIndent = indentUnit.repeat(level);
    const closeIndent = indentUnit.repeat(Math.max(0, level - 1));
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const varName = fieldVarByPath.get(field.path) ?? "";
        const propType = info?.properties.get(key) ?? null;
        if (propType && propType.endsWith("[]")) {
          return `${entryIndent}${JSON.stringify(key)}: getCollectionValue(${varName}, index)`;
        }
        return `${entryIndent}${JSON.stringify(key)}: getValue(${varName}, index)`;
      }
      const propType = info?.properties.get(key) ?? null;
      if (propType && propType.endsWith("[]")) {
        const elementType = propType.slice(0, -2);
        const elementInfo = typeMap.get(elementType) ?? null;
        const renderedCollection = renderCollectionNode(value as Record<string, unknown>, level + 1, elementInfo, elementType);
        return `${entryIndent}${JSON.stringify(key)}: ${renderedCollection}`;
      }
      const nestedType = propType && !propType.endsWith("[]") ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNodeForCollectionMany(value as Record<string, unknown>, nestedType, level + 1, fieldVarByPath);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${entryIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${closeIndent}}`;
  };

  const renderCollectionNode = (
    node: Record<string, unknown>,
    level: number,
    elementInfo: TsPersonEntityTypeInfo | null,
    elementType: string | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const bodyIndent = indentUnit.repeat(level + 1);
    const collected = collectFields(node);
    if (collected.length === 0) return "undefined";

    if (!elementInfo && elementType === "string") {
      const sourceLiteral = buildSourceLiteral(collected[0]!.source);
      return `(() => {\n${bodyIndent}const values = parseStringCollection(readSourceValue(row, ${sourceLiteral}));\n${bodyIndent}return values.length > 0 ? values : undefined;\n${indent}})()`;
    }

    if (collected.length === 1) {
      const field = collected[0]!;
      const sourceLiteral = buildSourceLiteral(field.source);
      const rendered = renderNodeForCollection(node, level + 1, "value", elementInfo);
      const typed = elementInfo ? `(${rendered} as ${elementInfo.alias})` : rendered;
      return `(() => {\n${bodyIndent}const values = parseStringCollection(readSourceValue(row, ${sourceLiteral}));\n${bodyIndent}if (values.length === 0) return undefined;\n${bodyIndent}return values.map((value) => ${typed});\n${indent}})()`;
    }

    const fieldVarByPath = new Map<string, string>();
    const fieldLines = collected.map((field, index) => {
      const varName = `field${index}`;
      fieldVarByPath.set(field.path, varName);
      const sourceLiteral = buildSourceLiteral(field.source);
      return `${bodyIndent}const ${varName} = parseStringCollection(readSourceValue(row, ${sourceLiteral}));`;
    });
    const fieldVars = [...fieldVarByPath.values()].join(", ");
    const lengthVars = fieldVars
      ? `${bodyIndent}const lengths = [${fieldVars}].map((value) => value.length);`
      : `${bodyIndent}const lengths = [0];`;
    const rendered = renderNodeForCollectionMany(node, elementInfo, level + 2, fieldVarByPath);
    const typed = elementInfo ? `(${rendered} as ${elementInfo.alias})` : rendered;

    return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n${bodyIndent}const maxLen = Math.max(0, ...lengths);\n${bodyIndent}if (maxLen === 0) return undefined;\n${bodyIndent}const getValue = (values: string[], index: number): string => {\n${bodyIndent}${indentUnit}if (values.length === 0) return "";\n${bodyIndent}${indentUnit}if (values.length === 1) return values[0] ?? "";\n${bodyIndent}${indentUnit}return values[index] ?? "";\n${bodyIndent}};\n${bodyIndent}const getCollectionValue = (values: string[], index: number): string[] => {\n${bodyIndent}${indentUnit}if (values.length === 0) return [];\n${bodyIndent}${indentUnit}if (values.length === 1) return [values[0] ?? ""];\n${bodyIndent}${indentUnit}return index < values.length ? [values[index] ?? ""] : [];\n${bodyIndent}};\n${bodyIndent}const results: Array<${elementInfo ? elementInfo.alias : "unknown"}> = [];\n${bodyIndent}for (let index = 0; index < maxLen; index++) {\n${bodyIndent}${indentUnit}results.push(${typed});\n${bodyIndent}}\n${bodyIndent}return results;\n${indent}})()`;
  };

  const renderNode = (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: TsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const propType = info?.properties.get(key) ?? null;
        if (propType && propType.endsWith("[]")) {
          return `${childIndent}${JSON.stringify(key)}: (${valueVar} ? [${valueVar}] : [])`;
        }
        return `${childIndent}${JSON.stringify(key)}: ${valueVar}`;
      }
      const propType = info?.properties.get(key) ?? null;
      if (propType && propType.endsWith("[]")) {
        const elementType = propType.slice(0, -2);
        const elementInfo = typeMap.get(elementType) ?? null;
        const renderedCollection = renderCollectionNode(value as Record<string, unknown>, level + 1, elementInfo, elementType);
        return `${childIndent}${JSON.stringify(key)}: ${renderedCollection}`;
      }
      const nestedType = propType ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNode(value as Record<string, unknown>, level + 1, valueVar, nestedType);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return `${childIndent}${JSON.stringify(key)}: ${typedChild}`;
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  if (fields.length === 1) {
    const tree = buildObjectTree(fields);
    const field = fields[0]!;
    const sourceLiteral = buildSourceLiteral(field.source);
    const rendered = renderNode(tree, 0, "value", typeInfo);
    const typed = typeInfo ? `(${rendered} as ${typeInfo.alias})` : rendered;
    const typedIndented = indentLines(typed, indentUnit.repeat(4));

    return `${collectionExpressionBuilder(sourceLiteral)}
  ${indentUnit.repeat(2)}.map((value) => JSON.stringify(\n${typedIndented}\n${indentUnit.repeat(2)}))`;
  }

  const tree = buildObjectTree(fields);
  const fieldVarByPath = new Map<string, string>();
  const fieldLines = fields.map((field, index) => {
    const varName = `field${index}`;
    fieldVarByPath.set(field.path, varName);
    const sourceLiteral = buildSourceLiteral(field.source);
    return `${bodyIndent}const ${varName} = ${collectionExpressionBuilder(sourceLiteral)};`;
  });

  const fieldVars = [...fieldVarByPath.values()].join(", ");
  const lengthVars = fieldVars
    ? `${bodyIndent}const lengths = [${fieldVars}].map((value) => value.length);`
    : `${bodyIndent}const lengths = [0];`;

  const renderedMany = renderNodeForCollectionMany(tree, typeInfo, 1, fieldVarByPath);
  const typedMany = typeInfo ? `(${renderedMany} as ${typeInfo.alias})` : renderedMany;
  const typedManyIndented = indentLines(typedMany, `${bodyIndent}${indentUnit}${indentUnit}`);

  return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n${bodyIndent}const maxLen = Math.max(0, ...lengths);\n${bodyIndent}const getValue = (values: string[], index: number): string => {\n${bodyIndent}${indentUnit}if (values.length === 0) return "";\n${bodyIndent}${indentUnit}if (values.length === 1) return values[0] ?? "";\n${bodyIndent}${indentUnit}return values[index] ?? "";\n${bodyIndent}};\n${bodyIndent}const getCollectionValue = (values: string[], index: number): string[] => {\n${bodyIndent}${indentUnit}if (values.length === 0) return [];\n${bodyIndent}${indentUnit}if (values.length === 1) return [values[0] ?? ""];\n${bodyIndent}${indentUnit}return index < values.length ? [values[index] ?? ""] : [];\n${bodyIndent}};\n${bodyIndent}const results: string[] = [];\n${bodyIndent}for (let index = 0; index < maxLen; index++) {\n${bodyIndent}${indentUnit}results.push(JSON.stringify(\n${typedManyIndented}\n${bodyIndent}${indentUnit}));\n${bodyIndent}}\n${bodyIndent}return results;\n${closeIndent}})()`;
}
