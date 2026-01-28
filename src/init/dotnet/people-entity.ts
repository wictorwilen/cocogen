import type { ConnectorIr } from "../../ir.js";
import { buildObjectTree } from "../object-tree.js";
import type { PersonEntityField, SourceDescriptor } from "../shared-types.js";
import { buildCsSourceLiteral } from "../helpers/source.js";

export type CsPersonEntityTypeInfo = {
  typeName: string;
  properties: Map<string, { csName: string; csType: string }>;
};

export type CsPersonEntityTypeMap = Map<string, CsPersonEntityTypeInfo>;

type CollectionRenderers = {
  renderNodeForCollection: (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: CsPersonEntityTypeInfo | null
  ) => string;
  renderNodeForCollectionMany: (
    node: Record<string, unknown>,
    level: number,
    info: CsPersonEntityTypeInfo | null,
    fieldVarByPath: Map<string, string>
  ) => string;
  renderCollectionNode: (
    node: Record<string, unknown>,
    propCsType: string,
    level: number,
    elementInfo: CsPersonEntityTypeInfo | null
  ) => string;
  extractListElementType: (csType: string) => string | null;
  collectFields: (node: Record<string, unknown>) => PersonEntityField[];
};

const DEFAULT_INDENT_UNIT = "    ";

function createCollectionRenderers(
  typeMap: CsPersonEntityTypeMap,
  indentUnit = DEFAULT_INDENT_UNIT
): CollectionRenderers {
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

  const extractListElementType = (csType: string): string | null => {
    const trimmed = csType.replace("?", "");
    const match = /^List<(.+)>$/.exec(trimmed);
    return match ? match[1]! : null;
  };

  const renderNodeForCollection = (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: CsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const propType = info?.properties.get(key)?.csType ?? null;
        const listElement = propType ? extractListElementType(propType) : null;
        if (listElement === "string") {
          return `${childIndent}[${JSON.stringify(key)}] = new List<string> { ${valueVar} }`;
        }
        return `${childIndent}[${JSON.stringify(key)}] = ${valueVar}`;
      }
      const propType = info?.properties.get(key)?.csType ?? null;
      const listElement = propType ? extractListElementType(propType) : null;
      if (listElement) {
        const elementInfo = typeMap.get(listElement) ?? null;
        const renderedCollection = renderCollectionNode(value as Record<string, unknown>, propType ?? "", level + 1, elementInfo);
        return `${childIndent}[${JSON.stringify(key)}] = ${renderedCollection}`;
      }
      const nestedType = propType ? typeMap.get(propType.replace("?", "")) ?? null : null;
      const renderedChild = renderNodeForCollection(value as Record<string, unknown>, level + 1, valueVar, nestedType);
      return `${childIndent}[${JSON.stringify(key)}] = ${renderedChild}`;
    });

    if (!info) {
      return `new Dictionary<string, object?>\n${indent}{\n${entries.join(",\n")}\n${indent}}`;
    }

    const typedEntries = Object.entries(node)
      .map(([key, value]) => {
        const propInfo = info.properties.get(key);
        if (!propInfo) {
          return null;
        }
        if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
          return `${childIndent}${propInfo.csName} = ${valueVar}`;
        }
        const nestedType = typeMap.get(propInfo.csType.replace("?", "")) ?? null;
        const renderedChild = renderNodeForCollection(value as Record<string, unknown>, level + 1, valueVar, nestedType);
        return `${childIndent}${propInfo.csName} = ${renderedChild}`;
      })
      .filter((entry): entry is string => Boolean(entry));

    return `new ${info.typeName}\n${indent}{\n${typedEntries.join(",\n")}\n${indent}}`;
  };

  const renderNodeForCollectionMany = (
    node: Record<string, unknown>,
    level: number,
    info: CsPersonEntityTypeInfo | null,
    fieldVarByPath: Map<string, string>
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const varName = fieldVarByPath.get(field.path) ?? "";
        const propType = info?.properties.get(key)?.csType ?? null;
        const listElement = propType ? extractListElementType(propType) : null;
        if (listElement === "string") {
          return `${childIndent}[${JSON.stringify(key)}] = GetCollectionValue(${varName}, index)`;
        }
        return `${childIndent}[${JSON.stringify(key)}] = GetValue(${varName}, index)`;
      }
      const propType = info?.properties.get(key)?.csType ?? null;
      const listElement = propType ? extractListElementType(propType) : null;
      if (listElement) {
        const elementInfo = typeMap.get(listElement) ?? null;
        const renderedCollection = renderCollectionNode(value as Record<string, unknown>, propType ?? "", level + 1, elementInfo);
        return `${childIndent}[${JSON.stringify(key)}] = ${renderedCollection}`;
      }
      const nestedType = propType ? typeMap.get(propType.replace("?", "")) ?? null : null;
      const renderedChild = renderNodeForCollectionMany(value as Record<string, unknown>, level + 1, nestedType, fieldVarByPath);
      return `${childIndent}[${JSON.stringify(key)}] = ${renderedChild}`;
    });

    if (!info) {
      return `new Dictionary<string, object?>\n${indent}{\n${entries.join(",\n")}\n${indent}}`;
    }

    const typedEntries = Object.entries(node)
      .map(([key, value]) => {
        const propInfo = info.properties.get(key);
        if (!propInfo) {
          return null;
        }
        if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
          const field = value as PersonEntityField;
          const varName = fieldVarByPath.get(field.path) ?? "";
          const listElement = extractListElementType(propInfo.csType);
          if (listElement === "string") {
            return `${childIndent}${propInfo.csName} = GetCollectionValue(${varName}, index)`;
          }
          return `${childIndent}${propInfo.csName} = GetValue(${varName}, index)`;
        }
        const listElement = extractListElementType(propInfo.csType);
        if (listElement) {
          const elementInfo = typeMap.get(listElement) ?? null;
          const renderedCollection = renderCollectionNode(value as Record<string, unknown>, propInfo.csType, level + 1, elementInfo);
          return `${childIndent}${propInfo.csName} = ${renderedCollection}`;
        }
        const nestedType = typeMap.get(propInfo.csType.replace("?", "")) ?? null;
        const renderedChild = renderNodeForCollectionMany(value as Record<string, unknown>, level + 1, nestedType, fieldVarByPath);
        return `${childIndent}${propInfo.csName} = ${renderedChild}`;
      })
      .filter((entry): entry is string => Boolean(entry));

    return `new ${info.typeName}\n${indent}{\n${typedEntries.join(",\n")}\n${indent}}`;
  };

  const renderCollectionNode = (
    node: Record<string, unknown>,
    propCsType: string,
    level: number,
    elementInfo: CsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const bodyIndent = indentUnit.repeat(level + 1);
    const elementType = extractListElementType(propCsType) ?? "object";
    const collected = collectFields(node);
    if (collected.length === 0) return "null";

    if (!elementInfo && elementType === "string") {
      const sourceLiteral = buildCsSourceLiteral(collected[0]!.source);
      return `new Func<List<string>?>(() =>\n${indent}{\n${bodyIndent}var values = RowParser.ParseStringCollection(row, ${sourceLiteral});\n${bodyIndent}return values.Count == 0 ? null : values;\n${indent}}).Invoke()`;
    }

    if (collected.length === 1) {
      const field = collected[0]!;
      const sourceLiteral = buildCsSourceLiteral(field.source);
      const objectExpression = renderNodeForCollection(node, level + 2, "value", elementInfo);

      return `new Func<List<${elementType}>?>(() =>\n${indent}{\n${bodyIndent}var values = RowParser.ParseStringCollection(row, ${sourceLiteral});\n${bodyIndent}if (values.Count == 0) return null;\n${bodyIndent}var results = new List<${elementType}>();\n${bodyIndent}foreach (var value in values)\n${bodyIndent}{\n${bodyIndent}${indentUnit}results.Add(${objectExpression});\n${bodyIndent}}\n${bodyIndent}return results;\n${indent}}).Invoke()`;
    }

    const fieldVarByPath = new Map<string, string>();
    const fieldLines = collected.map((field, index) => {
      const varName = `field${index}`;
      fieldVarByPath.set(field.path, varName);
      const sourceLiteral = buildCsSourceLiteral(field.source);
      return `${bodyIndent}var ${varName} = RowParser.ParseStringCollection(row, ${sourceLiteral});`;
    });
    const fieldVars = [...fieldVarByPath.values()];
    const lengthLines = fieldVars.length > 0
      ? `${bodyIndent}var maxLen = new[] { ${fieldVars.map((v) => `${v}.Count`).join(", ")} }.Max();`
      : `${bodyIndent}var maxLen = 0;`;

    const objectExpression = renderNodeForCollectionMany(node, level + 1, elementInfo, fieldVarByPath);

    return `new Func<List<${elementType}>?>(() =>\n${indent}{\n${fieldLines.join("\n")}\n${bodyIndent}string GetValue(List<string> values, int index)\n${bodyIndent}{\n${bodyIndent}${indentUnit}if (values.Count == 0) return \"\";\n${bodyIndent}${indentUnit}if (values.Count == 1) return values[0] ?? \"\";\n${bodyIndent}${indentUnit}return index < values.Count ? (values[index] ?? \"\") : \"\";\n${bodyIndent}}\n${bodyIndent}List<string> GetCollectionValue(List<string> values, int index)\n${bodyIndent}{\n${bodyIndent}${indentUnit}if (values.Count == 0) return new List<string>();\n${bodyIndent}${indentUnit}if (values.Count == 1) return new List<string> { values[0] ?? \"\" };\n${bodyIndent}${indentUnit}return index < values.Count ? new List<string> { values[index] ?? \"\" } : new List<string>();\n${bodyIndent}}\n${lengthLines}\n${bodyIndent}if (maxLen == 0) return null;\n${bodyIndent}var results = new List<${elementType}>();\n${bodyIndent}for (var index = 0; index < maxLen; index++)\n${bodyIndent}{\n${bodyIndent}${indentUnit}results.Add(${objectExpression});\n${bodyIndent}}\n${bodyIndent}return results;\n${indent}}).Invoke()`;
  };

  return {
    renderNodeForCollection,
    renderNodeForCollectionMany,
    renderCollectionNode,
    extractListElementType,
    collectFields,
  };
}

export function buildCsPersonEntityObjectExpression(
  fields: PersonEntityField[],
  fieldValueBuilder: (field: PersonEntityField) => string,
  typeInfo: CsPersonEntityTypeInfo | null,
  typeMap: CsPersonEntityTypeMap,
  indentLevel = 2,
  fieldCollectionValueBuilder: (field: PersonEntityField) => string = (field) => {
    const sourceLiteral = buildCsSourceLiteral(field.source);
    return `RowParser.ParseStringCollection(row, ${sourceLiteral})`;
  }
): string {
  const tree = buildObjectTree(fields);
  const indentUnit = DEFAULT_INDENT_UNIT;
  const {
    renderCollectionNode,
    renderNodeForCollection,
    renderNodeForCollectionMany,
    extractListElementType,
  } = createCollectionRenderers(typeMap, indentUnit);

  const renderDictionary = (
    node: Record<string, unknown>,
    level: number,
    parentInfo?: CsPersonEntityTypeInfo | null
  ): string => {
    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const entries = Object.entries(node).map(([key, value]) => {
      if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
        const field = value as PersonEntityField;
        const info = parentInfo?.properties.get(key);
        const listElement = info ? extractListElementType(info.csType) : null;
        if (listElement === "string") {
          return `${childIndent}[${JSON.stringify(key)}] = ${fieldCollectionValueBuilder(field)}`;
        }
        return `${childIndent}[${JSON.stringify(key)}] = ${fieldValueBuilder(field)}`;
      }
      const info = parentInfo?.properties.get(key);
      if (info && extractListElementType(info.csType)) {
        const elementTypeName = extractListElementType(info.csType) ?? "";
        const nestedType = typeMap.get(elementTypeName) ?? null;
        const renderedValue = renderCollectionNode(value as Record<string, unknown>, info.csType, level + 1, nestedType);
        return `${childIndent}[${JSON.stringify(key)}] = ${renderedValue}`;
      }
      const typeName = info?.csType.replace("?", "") ?? "";
      const nestedType = typeMap.get(typeName) ?? null;
      const renderedValue =
        info && nestedType && typeof value === "object" && value && !("path" in (value as PersonEntityField))
          ? renderTypedNode(value as Record<string, unknown>, nestedType, level + 1)
          : renderDictionary(value as Record<string, unknown>, level + 1, nestedType);
      return `${childIndent}[${JSON.stringify(key)}] = ${renderedValue}`;
    });

    return `new Dictionary<string, object?>\n${indent}{\n${entries.join(",\n")}\n${indent}}`;
  };

  const renderTypedNode = (
    node: Record<string, unknown>,
    info: CsPersonEntityTypeInfo,
    level: number
  ): string => {
    const entries = Object.entries(node);
    const canUse = entries.every(([key]) => info.properties.has(key));
    if (!canUse) {
      return renderDictionary(node, level, info);
    }

    const indent = indentUnit.repeat(level);
    const childIndent = indentUnit.repeat(level + 1);
    const renderedEntries = entries.map(([key, value]) => {
      const propInfo = info.properties.get(key)!;
      const listElement = extractListElementType(propInfo.csType);
      if (listElement) {
        if (typeof value === "object" && value && "path" in (value as PersonEntityField)) {
          const field = value as PersonEntityField;
          if (listElement === "string") {
            return `${childIndent}${propInfo.csName} = ${fieldCollectionValueBuilder(field)}`;
          }
          return `${childIndent}${propInfo.csName} = ${fieldValueBuilder(field)}`;
        }
        const nestedType = typeMap.get(listElement) ?? null;
        const renderedValue = renderCollectionNode(value as Record<string, unknown>, propInfo.csType, level + 1, nestedType);
        return `${childIndent}${propInfo.csName} = ${renderedValue}`;
      }
      const typeName = propInfo.csType.replace("?", "");
      const nestedType = typeMap.get(typeName) ?? null;
      const rawValue =
        typeof value === "object" && value && "path" in (value as PersonEntityField)
          ? fieldValueBuilder(value as PersonEntityField)
          : renderDictionary(value as Record<string, unknown>, level + 1, nestedType);
      const renderedValue =
        nestedType && typeof value === "object" && value && !("path" in (value as PersonEntityField))
          ? renderTypedNode(value as Record<string, unknown>, nestedType, level + 1)
          : rawValue;
      return `${childIndent}${propInfo.csName} = ${renderedValue}`;
    });

    return `new ${info.typeName}\n${indent}{\n${renderedEntries.join(",\n")}\n${indent}}`;
  };

  if (!typeInfo) {
    return renderDictionary(tree, indentLevel);
  }

  return renderTypedNode(tree, typeInfo, indentLevel);
}

export function buildCsPersonEntityExpression(
  fields: PersonEntityField[],
  valueExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `RowParser.ParseString(row, ${sourceLiteral})`,
  typeInfo: CsPersonEntityTypeInfo | null,
  typeMap: CsPersonEntityTypeMap
): string {
  const indentUnit = "    ";
  const objectExpression = buildCsPersonEntityObjectExpression(
    fields,
    (field) => {
      const sourceLiteral = buildCsSourceLiteral(field.source);
      return valueExpressionBuilder(sourceLiteral);
    },
    typeInfo,
    typeMap,
    2
  );

  return `JsonSerializer.Serialize(\n${indentUnit.repeat(2)}${objectExpression}\n${indentUnit.repeat(2)})`;
}

export function buildCsPersonEntityCollectionExpression(
  fields: PersonEntityField[],
  collectionExpressionBuilder: (sourceLiteral: string) => string = (sourceLiteral) =>
    `RowParser.ParseStringCollection(row, ${sourceLiteral})`,
  typeInfo: CsPersonEntityTypeInfo | null,
  typeMap: CsPersonEntityTypeMap,
  inputFormat: ConnectorIr["connection"]["inputFormat"]
): string {
  const indentUnit = DEFAULT_INDENT_UNIT;
  const { renderNodeForCollectionMany } = createCollectionRenderers(typeMap, indentUnit);

  const getCommonJsonArrayRoot = ():
    | { root: string; relativeByPath: Map<string, string> }
    | null => {
    const relativeByPath = new Map<string, string>();
    let root: string | null = null;
    for (const field of fields) {
      const jsonPath = field.source.jsonPath;
      if (!jsonPath) return null;
      const index = jsonPath.indexOf("[*]");
      if (index < 0) return null;
      const candidateRoot = jsonPath.slice(0, index + 3);
      if (root && root !== candidateRoot) return null;
      root = candidateRoot;
      const remainder = jsonPath.slice(index + 3);
      const relative = remainder.startsWith(".") ? remainder.slice(1) : remainder;
      relativeByPath.set(field.path, relative);
    }
    if (!root) return null;
    return { root, relativeByPath };
  };

  if (inputFormat !== "csv") {
    const common = getCommonJsonArrayRoot();
    if (common) {
      const objectExpression = buildCsPersonEntityObjectExpression(
        fields,
        (field) => {
          const relative = common.relativeByPath.get(field.path) ?? "";
          return relative
            ? `RowParser.ParseString(entry, ${JSON.stringify(relative)})`
            : "RowParser.ParseString(entry)";
        },
        typeInfo,
        typeMap,
        2,
        (field) => {
          const relative = common.relativeByPath.get(field.path) ?? "";
          return relative
            ? `RowParser.ParseStringCollection(entry, ${JSON.stringify(relative)})`
            : "RowParser.ParseStringCollection(entry)";
        }
      );

      return `new Func<List<string>>(() =>\n    {\n        var results = new List<string>();\n        foreach (var entry in RowParser.ReadArrayEntries(row, ${JSON.stringify(common.root)}))\n        {\n            results.Add(JsonSerializer.Serialize(${objectExpression}));\n        }\n        return results;\n    }).Invoke()`;
    }
  }

  if (fields.length === 1) {
    const tree = buildObjectTree(fields);
    const field = fields[0]!;
    const sourceLiteral = buildCsSourceLiteral(field.source);
    const objectExpression = buildCsPersonEntityObjectExpression(
      fields,
      () => "value",
      typeInfo,
      typeMap,
      3,
      () => "new List<string> { value }"
    );

    return `${collectionExpressionBuilder(sourceLiteral)}
                .Select(value => JsonSerializer.Serialize(\n${indentUnit.repeat(3)}${objectExpression}\n${indentUnit.repeat(3)}))
            .ToList()`;
  }

  const tree = buildObjectTree(fields);
  const fieldVarByPath = new Map<string, string>();
  const fieldLines = fields.map((field, index) => {
    const varName = `field${index}`;
    fieldVarByPath.set(field.path, varName);
    const sourceLiteral = buildCsSourceLiteral(field.source);
    return `        var ${varName} = ${collectionExpressionBuilder(sourceLiteral)};`;
  });

  const fieldVars = [...fieldVarByPath.values()];
  const lengthLines = fieldVars.length > 0
    ? `        var maxLen = new[] { ${fieldVars.map((v) => `${v}.Count`).join(", ")} }.Max();`
    : "        var maxLen = 0;";

  const objectExpression = renderNodeForCollectionMany(tree, 2, typeInfo, fieldVarByPath);

  return `new Func<List<string>>(() =>\n    {\n${fieldLines.join("\n")}\n        string GetValue(List<string> values, int index)\n        {\n            if (values.Count == 0) return \"\";\n            if (values.Count == 1) return values[0] ?? \"\";\n            return index < values.Count ? (values[index] ?? \"\") : \"\";\n        }\n        List<string> GetCollectionValue(List<string> values, int index)\n        {\n            if (values.Count == 0) return new List<string>();\n            if (values.Count == 1) return new List<string> { values[0] ?? \"\" };\n            return index < values.Count ? new List<string> { values[index] ?? \"\" } : new List<string>();\n        }\n${lengthLines}\n        var results = new List<string>();\n        for (var index = 0; index < maxLen; index++)\n        {\n            results.Add(JsonSerializer.Serialize(${objectExpression}));\n        }\n        return results;\n    }).Invoke()`;
}
