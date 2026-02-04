import { buildObjectTree } from "../object-tree.js";
import type { PersonEntityField } from "../shared-types.js";
import { buildSourceLiteral } from "../helpers/source.js";
import { collectPersonEntityFields, TS_INDENT } from "../helpers/people-entity.js";
import { createCollectionRenderer } from "../people/entity-renderer.js";

export type TsPersonEntityTypeInfo = {
  alias: string;
  properties: Map<string, string>;
};

export type TsPersonEntityTypeMap = Map<string, TsPersonEntityTypeInfo>;

type TsCollectionRenderers = {
  renderNodeForCollection: (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: TsPersonEntityTypeInfo | null
  ) => string;
  renderNodeForCollectionMany: (
    node: Record<string, unknown>,
    level: number,
    info: TsPersonEntityTypeInfo | null,
    fieldVarByPath: Map<string, string>
  ) => string;
  renderCollectionNode: (
    node: Record<string, unknown>,
    level: number,
    propType: string | null,
    elementInfo: TsPersonEntityTypeInfo | null
  ) => string;
};

const DEFAULT_INDENT_UNIT = TS_INDENT;

const indentMultilineValue = (value: string, indent: string): string => {
  const lines = value.split("\n");
  if (lines.length <= 1) return value;
  return [lines[0]!, ...lines.slice(1).map((line) => `${indent}${line}`)].join("\n");
};

const formatObjectEntry = (
  key: string,
  value: string,
  childIndent: string,
  indentUnit: string
): string => {
  const valueIndent = `${childIndent}${indentUnit}`;
  const formattedValue = indentMultilineValue(value, valueIndent);
  return `${childIndent}${JSON.stringify(key)}: ${formattedValue}`;
};

const applyDefaultStringExpression = (value: string, source: { default?: string }): string =>
  source.default !== undefined ? `applyDefaultString(${value}, ${JSON.stringify(source.default)})` : value;

const applyDefaultCollectionExpression = (value: string, source: { default?: string }): string =>
  source.default !== undefined ? `applyDefaultCollection(${value}, ${JSON.stringify(source.default)})` : value;

/** Build shared renderers for TS people-entity collections. */
function createTsCollectionRenderers(
  typeMap: TsPersonEntityTypeMap,
  indentUnit = DEFAULT_INDENT_UNIT
): TsCollectionRenderers {
  const collectionRenderer = createCollectionRenderer<TsPersonEntityTypeInfo, string>({
    indentUnit,
    getPropInfo: (info, key) => info?.properties.get(key) ?? null,
    getPropType: (propInfo) => propInfo,
    isCollectionType: (propType) => propType.endsWith("[]"),
    getNestedInfo: (propType) => {
      const typeName = propType.endsWith("[]") ? propType.slice(0, -2) : propType;
      return typeMap.get(typeName) ?? null;
    },
    buildEntry: ({ key, value, level }) => {
      const childIndent = indentUnit.repeat(level + 1);
      return formatObjectEntry(key, value, childIndent, indentUnit);
    },
    wrapObject: (entries, level) => `{
${entries.join(",\n")}
${indentUnit.repeat(level)}}`,
    formatNestedValue: (value, nestedInfo) =>
      nestedInfo ? `(${value} as ${nestedInfo.alias})` : value,
  });

  const renderNodeForCollection = (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: TsPersonEntityTypeInfo | null
  ): string =>
    collectionRenderer.renderNodeForCollection(
      node,
      level,
      valueVar,
      info,
      renderCollectionNode,
      (propType, value) => (propType?.endsWith("[]") ? `(${value} ? [${value}] : [])` : value)
    );

  const renderNodeForCollectionMany = (
    node: Record<string, unknown>,
    level: number,
    info: TsPersonEntityTypeInfo | null,
    fieldVarByPath: Map<string, string>
  ): string =>
    collectionRenderer.renderNodeForCollectionMany(
      node,
      level,
      info,
      fieldVarByPath,
      renderCollectionNode,
      (propType, value) =>
        propType?.endsWith("[]") ? `getCollectionValue(${value}, index)` : `getValue(${value}, index)`
    );

  function renderCollectionNode(
    node: Record<string, unknown>,
    level: number,
    propType: string | null,
    elementInfo: TsPersonEntityTypeInfo | null
  ): string {
    const elementType = propType?.endsWith("[]") ? propType.slice(0, -2) : propType;
    const indent = indentUnit.repeat(level);
    const bodyIndent = indentUnit.repeat(level + 1);
    const collected = collectPersonEntityFields(node);
    if (collected.length === 0) return "undefined";

    if (!elementInfo && elementType === "string") {
      const sourceLiteral = buildSourceLiteral(collected[0]!.source);
      return `(() => {\n${bodyIndent}const values = ${applyDefaultCollectionExpression(
        `parseStringCollection(readSourceValue(row, ${sourceLiteral}))`,
        collected[0]!.source
      )};\n${bodyIndent}return values.length > 0 ? values : undefined;\n${indent}})()`;
    }

    if (collected.length === 1) {
      const field = collected[0]!;
      const sourceLiteral = buildSourceLiteral(field.source);
      const rendered = renderNodeForCollection(node, level + 1, "value", elementInfo);
      const typed = elementInfo ? `(${rendered} as ${elementInfo.alias})` : rendered;
      return `(() => {\n${bodyIndent}const values = ${applyDefaultCollectionExpression(
        `parseStringCollection(readSourceValue(row, ${sourceLiteral}))`,
        field.source
      )};\n${bodyIndent}if (values.length === 0) return undefined;\n${bodyIndent}return values.map((value) => ${typed});\n${indent}})()`;
    }

    const fieldVarByPath = new Map<string, string>();
    const fieldLines = collected.map((field, index) => {
      const varName = `field${index}`;
      fieldVarByPath.set(field.path, varName);
      const sourceLiteral = buildSourceLiteral(field.source);
      return `${bodyIndent}const ${varName} = ${applyDefaultCollectionExpression(
        `parseStringCollection(readSourceValue(row, ${sourceLiteral}))`,
        field.source
      )};`;
    });
    const fieldVars = [...fieldVarByPath.values()].join(", ");
    const lengthVars = fieldVars
      ? `${bodyIndent}const lengths = [${fieldVars}].map((value) => value.length);`
      : `${bodyIndent}const lengths = [0];`;
    const rendered = renderNodeForCollectionMany(node, level + 2, elementInfo, fieldVarByPath);
    const typed = elementInfo ? `(${rendered} as ${elementInfo.alias})` : rendered;

    return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n${bodyIndent}const maxLen = Math.max(0, ...lengths);\n${bodyIndent}if (maxLen === 0) return undefined;\n${bodyIndent}const getValue = (values: string[], index: number): string => {\n${bodyIndent}${indentUnit}if (values.length === 0) return "";\n${bodyIndent}${indentUnit}if (values.length === 1) return values[0] ?? "";\n${bodyIndent}${indentUnit}return values[index] ?? "";\n${bodyIndent}};\n${bodyIndent}const getCollectionValue = (values: string[], index: number): string[] => {\n${bodyIndent}${indentUnit}if (values.length === 0) return [];\n${bodyIndent}${indentUnit}if (values.length === 1) return [values[0] ?? ""];\n${bodyIndent}${indentUnit}return index < values.length ? [values[index] ?? ""] : [];\n${bodyIndent}};\n${bodyIndent}const results: Array<${elementInfo ? elementInfo.alias : "unknown"}> = [];\n${bodyIndent}for (let index = 0; index < maxLen; index++) {\n${bodyIndent}${indentUnit}results.push(${typed});\n${bodyIndent}}\n${bodyIndent}return results;\n${indent}})()`;
  }

  return {
    renderNodeForCollection,
    renderNodeForCollectionMany,
    renderCollectionNode,
  };
}

/** Build a TS JSON string expression for a person-entity object. */
export function buildTsPersonEntityExpression(
  fields: PersonEntityField[],
  valueExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `parseString(readSourceValue(row, ${sourceLiteral}))`,
  typeInfo: TsPersonEntityTypeInfo | null,
  typeMap: TsPersonEntityTypeMap
): string {
  const tree = buildObjectTree(fields);
  const indentUnit = DEFAULT_INDENT_UNIT;
  const { renderCollectionNode } = createTsCollectionRenderers(typeMap, indentUnit);

  const fieldValueBuilder = (field: PersonEntityField): string => {
    const sourceLiteral = buildSourceLiteral(field.source);
    const base = valueExpressionBuilder(sourceLiteral);
    return applyDefaultStringExpression(base, field.source);
  };

  const fieldCollectionValueBuilder = (field: PersonEntityField): string => {
    const sourceLiteral = buildSourceLiteral(field.source);
    return applyDefaultCollectionExpression(
      `parseStringCollection(readSourceValue(row, ${sourceLiteral}))`,
      field.source
    );
  };

  const renderNode = (
    node: Record<string, unknown>,
    level: number,
    info: TsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const propType = info?.properties.get(key) ?? null;
        if (propType && propType.endsWith("[]")) {
          return formatObjectEntry(
            key,
            fieldCollectionValueBuilder(field),
            childIndent,
            indentUnit
          );
        }
        return formatObjectEntry(key, fieldValueBuilder(field), childIndent, indentUnit);
      }
      const propType = info?.properties.get(key) ?? null;
      if (propType && propType.endsWith("[]")) {
        const elementType = propType.slice(0, -2);
        const elementInfo = typeMap.get(elementType) ?? null;
        const renderedCollection = renderCollectionNode(value as Record<string, unknown>, level + 1, propType, elementInfo);
        return formatObjectEntry(key, renderedCollection, childIndent, indentUnit);
      }
      const nestedType = propType ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNode(value as Record<string, unknown>, level + 1, nestedType);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return formatObjectEntry(key, typedChild, childIndent, indentUnit);
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  const objectExpression = renderNode(tree, 0, typeInfo);
  const typedObjectExpression = typeInfo ? `(${objectExpression} as ${typeInfo.alias})` : objectExpression;

  return `JSON.stringify(\n${typedObjectExpression}\n)`;
}

/** Build a TS JSON string[] expression for person-entity collections. */
export function buildTsPersonEntityCollectionExpression(
  fields: PersonEntityField[],
  collectionExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `parseStringCollection(readSourceValue(row, ${sourceLiteral}))`,
  typeInfo: TsPersonEntityTypeInfo | null,
  typeMap: TsPersonEntityTypeMap
): string {
  const indentUnit = DEFAULT_INDENT_UNIT;
  const bodyIndent = indentUnit.repeat(2);
  const closeIndent = indentUnit;
  const indentLines = (text: string, prefix: string): string =>
    text
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");

  const { renderNodeForCollectionMany, renderCollectionNode } = createTsCollectionRenderers(
    typeMap,
    indentUnit
  );

  const renderNodeWithValueVar = (
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
          return formatObjectEntry(
            key,
            `(${valueVar} ? [${valueVar}] : [])`,
            childIndent,
            indentUnit
          );
        }
        return formatObjectEntry(key, valueVar, childIndent, indentUnit);
      }
      const propType = info?.properties.get(key) ?? null;
      if (propType && propType.endsWith("[]")) {
        const elementType = propType.slice(0, -2);
        const elementInfo = typeMap.get(elementType) ?? null;
        const renderedCollection = renderCollectionNode(value as Record<string, unknown>, level + 1, propType, elementInfo);
        return formatObjectEntry(key, renderedCollection, childIndent, indentUnit);
      }
      const nestedType = propType ? typeMap.get(propType) ?? null : null;
      const renderedChild = renderNodeWithValueVar(value as Record<string, unknown>, level + 1, valueVar, nestedType);
      const typedChild = nestedType ? `(${renderedChild} as ${nestedType.alias})` : renderedChild;
      return formatObjectEntry(key, typedChild, childIndent, indentUnit);
    });
    return `{
${entries.join(",\n")}
${indent}}`;
  };

  if (fields.length === 1) {
    const tree = buildObjectTree(fields);
    const field = fields[0]!;
    const sourceLiteral = buildSourceLiteral(field.source);
    const rendered = renderNodeWithValueVar(tree, 0, "value", typeInfo);
    const typed = typeInfo ? `(${rendered} as ${typeInfo.alias})` : rendered;
    const typedIndented = indentLines(typed, indentUnit.repeat(4));

    return `${applyDefaultCollectionExpression(collectionExpressionBuilder(sourceLiteral), field.source)}
  ${indentUnit.repeat(2)}.map((value) => JSON.stringify(\n${typedIndented}\n${indentUnit.repeat(2)}))`;
  }

  const tree = buildObjectTree(fields);
  const fieldVarByPath = new Map<string, string>();
  const fieldLines = fields.map((field, index) => {
    const varName = `field${index}`;
    fieldVarByPath.set(field.path, varName);
    const sourceLiteral = buildSourceLiteral(field.source);
    return `${bodyIndent}const ${varName} = ${applyDefaultCollectionExpression(
      collectionExpressionBuilder(sourceLiteral),
      field.source
    )};`;
  });

  const fieldVars = [...fieldVarByPath.values()].join(", ");
  const lengthVars = fieldVars
    ? `${bodyIndent}const lengths = [${fieldVars}].map((value) => value.length);`
    : `${bodyIndent}const lengths = [0];`;

  const renderedMany = renderNodeForCollectionMany(tree, 1, typeInfo, fieldVarByPath);
  const typedMany = typeInfo ? `(${renderedMany} as ${typeInfo.alias})` : renderedMany;
  const typedManyIndented = indentLines(typedMany, `${bodyIndent}${indentUnit}${indentUnit}`);

  return `(() => {\n${fieldLines.join("\n")}\n${lengthVars}\n${bodyIndent}const maxLen = Math.max(0, ...lengths);\n${bodyIndent}const getValue = (values: string[], index: number): string => {\n${bodyIndent}${indentUnit}if (values.length === 0) return "";\n${bodyIndent}${indentUnit}if (values.length === 1) return values[0] ?? "";\n${bodyIndent}${indentUnit}return values[index] ?? "";\n${bodyIndent}};\n${bodyIndent}const getCollectionValue = (values: string[], index: number): string[] => {\n${bodyIndent}${indentUnit}if (values.length === 0) return [];\n${bodyIndent}${indentUnit}if (values.length === 1) return [values[0] ?? ""];\n${bodyIndent}${indentUnit}return index < values.length ? [values[index] ?? ""] : [];\n${bodyIndent}};\n${bodyIndent}const results: string[] = [];\n${bodyIndent}for (let index = 0; index < maxLen; index++) {\n${bodyIndent}${indentUnit}results.push(JSON.stringify(\n${typedManyIndented}\n${bodyIndent}${indentUnit}));\n${bodyIndent}}\n${bodyIndent}return results;\n${closeIndent}})()`;
}
