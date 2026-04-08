import { access, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { getPeopleLabelDefinition, getPeopleLabelInfo, supportedPeopleLabels } from "../../people/label-registry.js";
import { getProfileEnum, graphProfileSchema } from "../../people/profile-schema.js";
import {
  toCsIdentifier,
  toCsNamespace,
  toCsPascal,
  toCsPropertyName,
  toCsType,
  toSchemaFolderName,
  toTsIdentifier,
} from "../naming.js";
import { renderTemplate } from "../template.js";
import { formatCsDocSummary } from "../helpers/format.js";
import { buildCsSourceLiteral, buildCsSourceTransformsLiteral } from "../helpers/source.js";
import { removeIfExists } from "../helpers/fs.js";
import {
  graphApiVersionForOperation,
  toCsParseFunction,
  toCsPropertyValueExpression,
  toGraphPropertyTypeEnumName,
  toOdataCollectionType,
} from "../helpers/schema.js";
import {
  GRAPH_STRING_TYPES,
  buildGraphEnumTemplates,
  buildPeopleGraphTypes,
  resolveGraphTypeName,
} from "../people/graph-types.js";
import { CoreGenerator, type GeneratorContext } from "../generators/core.js";
import { buildCsPrincipalCollectionExpression, buildCsPrincipalExpression } from "./principal.js";
import {
  buildCsPersonEntityCollectionExpression,
  buildCsPersonEntityExpression,
  type CsPersonEntityTypeInfo,
} from "./people-entity.js";
import { applyCsValidationExpression, buildCsStringConstraintsLiteral } from "./validation.js";

export type DotnetGeneratorSettings = {
  projectName: string;
  tspPath: string;
};

function formatCsTransformExpression(expression: string, continuationIndent: number): string {
  const lines = expression.split("\n");
  if (lines.length === 1) {
    return expression;
  }

  const trailingLines = lines.slice(1);
  const nonEmptyTrailingLines = trailingLines.filter((line) => line.trim().length > 0);
  const minIndent = nonEmptyTrailingLines.length === 0
    ? 0
    : Math.min(...nonEmptyTrailingLines.map((line) => line.match(/^\s*/)?.[0].length ?? 0));
  const indentPrefix = " ".repeat(continuationIndent);

  return [
    lines[0],
    ...trailingLines.map((line) => {
      if (line.trim().length === 0) {
        return line;
      }

      return `${indentPrefix}${line.slice(minIndent)}`;
    }),
  ].join("\n");
}

/** Generates .NET connector scaffolds and generated files. */
export class DotnetGenerator extends CoreGenerator<DotnetGeneratorSettings> {
  protected lang = "dotnet" as const;

  constructor(context: GeneratorContext<DotnetGeneratorSettings>) {
    super(context);
  }

  /** Resolve the root C# namespace for output. */
  private get namespaceName(): string {
    return toCsNamespace(this.settings.projectName);
  }

  /** Resolve the schema folder name for .NET output. */
  private get schemaFolderName(): string {
    return toSchemaFolderName(this.ir.connection.connectionName);
  }

  /** Build the schema namespace for generated types. */
  private get schemaNamespace(): string {
    return `${this.namespaceName}.${this.schemaFolderName}`;
  }

  /** Write non-generated scaffolding files for a .NET project. */
  async writeScaffold(): Promise<void> {
    const { namespaceName, schemaFolderName, schemaNamespace } = this;

    await mkdir(path.join(this.outDir, "Datasource"), { recursive: true });
    await mkdir(path.join(this.outDir, schemaFolderName), { recursive: true });

    await writeFile(
      path.join(this.outDir, `${this.settings.projectName}.csproj`),
      await renderTemplate("dotnet/project.csproj.ejs", {
        graphApiVersion: this.ir.connection.graphApiVersion,
        isPeopleConnector: this.ir.connection.contentCategory === "people",
        userSecretsId: randomUUID(),
        inputFormat: this.ir.connection.inputFormat,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "package.json"),
      await renderTemplate("dotnet/package.json.ejs", {
        projectName: this.settings.projectName,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "tspconfig.yaml"),
      await renderTemplate("dotnet/tspconfig.yaml.ejs", {}),
      "utf8"
    );

    await this.writeProgramFile();

    await writeFile(
      path.join(this.outDir, "Datasource", "IItemSource.cs"),
      await renderTemplate("dotnet/Datasource/IItemSource.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: this.ir.item.typeName,
      }),
      "utf8"
    );

    if (this.ir.connection.inputFormat === "json") {
      await writeFile(
        path.join(this.outDir, "Datasource", "JsonItemSource.cs"),
        await renderTemplate("dotnet/Datasource/JsonItemSource.cs.ejs", {
          namespaceName,
          schemaNamespace,
          itemTypeName: this.ir.item.typeName,
        }),
        "utf8"
      );
    } else if (this.ir.connection.inputFormat === "yaml") {
      await writeFile(
        path.join(this.outDir, "Datasource", "YamlItemSource.cs"),
        await renderTemplate("dotnet/Datasource/YamlItemSource.cs.ejs", {
          namespaceName,
          schemaNamespace,
          itemTypeName: this.ir.item.typeName,
        }),
        "utf8"
      );
    } else if (this.ir.connection.inputFormat === "rest") {
      await writeFile(
        path.join(this.outDir, "Datasource", "RestItemSource.cs"),
        await renderTemplate("dotnet/Datasource/RestItemSource.cs.ejs", {
          namespaceName,
          schemaNamespace,
          itemTypeName: this.ir.item.typeName,
        }),
        "utf8"
      );
    } else if (this.ir.connection.inputFormat === "custom") {
      await writeFile(
        path.join(this.outDir, "Datasource", "CustomItemSource.cs"),
        await renderTemplate("dotnet/Datasource/CustomItemSource.cs.ejs", {
          namespaceName,
          schemaNamespace,
          itemTypeName: this.ir.item.typeName,
        }),
        "utf8"
      );
    } else {
      await writeFile(
        path.join(this.outDir, "Datasource", "CsvItemSource.cs"),
        await renderTemplate("dotnet/Datasource/CsvItemSource.cs.ejs", {
          namespaceName,
          schemaNamespace,
          itemTypeName: this.ir.item.typeName,
        }),
        "utf8"
      );
    }

    await writeFile(
      path.join(this.outDir, "appsettings.json"),
      await renderTemplate("dotnet/appsettings.json.ejs", {
        itemTypeName: this.ir.item.typeName,
        isPeopleConnector: this.ir.connection.contentCategory === "people",
        inputFormat: this.ir.connection.inputFormat,
        connectionName: this.ir.connection.connectionName ?? null,
        connectionId: this.ir.connection.connectionId ?? null,
        connectionDescription: this.ir.connection.connectionDescription ?? null,
        profileSourceWebUrl: this.ir.connection.profileSource?.webUrl ?? null,
        profileSourceDisplayName: this.ir.connection.profileSource?.displayName ?? null,
        profileSourcePriority: this.ir.connection.profileSource?.priority ?? null,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, ".gitignore"),
      await renderTemplate("dotnet/.gitignore.ejs", {}),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "README.md"),
      await renderTemplate("dotnet/README.md.ejs", {
        isPeopleConnector: this.ir.connection.contentCategory === "people",
        itemTypeName: this.ir.item.typeName,
        schemaFolderName,
        inputFormat: this.ir.connection.inputFormat,
      }),
      "utf8"
    );

    await this.writeProjectConfig(this.settings.tspPath);
  }

  /** Write the generated Program.cs entrypoint. */
  async writeProgramFile(): Promise<void> {
    const { namespaceName, schemaNamespace } = this;

    await writeFile(
      path.join(this.outDir, "Program.cs"),
      await renderTemplate("dotnet/Program.commandline.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: this.ir.item.typeName,
        isPeopleConnector: this.ir.connection.contentCategory === "people",
        graphApiVersion: this.ir.connection.graphApiVersion,
        inputFormat: this.ir.connection.inputFormat,
      }),
      "utf8"
    );
  }

  /** Write generated .NET files based on the IR. */
  async writeGenerated(): Promise<void> {
    const { namespaceName, schemaFolderName, schemaNamespace } = this;

    await mkdir(path.join(this.outDir, schemaFolderName), { recursive: true });
    await mkdir(path.join(this.outDir, "Datasource"), { recursive: true });
    await mkdir(path.join(this.outDir, "Core"), { recursive: true });

    await removeIfExists(path.join(this.outDir, schemaFolderName, "FromCsvRow.cs"));
    await removeIfExists(path.join(this.outDir, "Datasource", "CsvParser.cs"));

    const usedPropertyNames = new Set<string>();
    const peopleLabelDefinitions = supportedPeopleLabels().map((label) => {
      const info = getPeopleLabelInfo(label);
      const definition = getPeopleLabelDefinition(label);
      if (!definition) {
        throw new Error(`Missing people label definition for '${label}'.`);
      }
      return {
        label: info.label,
        payloadType: info.payloadType,
        graphTypeName: info.graphTypeName,
        requiredFields: info.requiredFields,
        collectionLimit: info.collectionLimit ?? null,
        inheritsItemFacet: definition.schema.name === "itemFacet" || (definition.schema.baseType ?? null) === "itemFacet",
      };
    });
    const peopleGraphTypesBundle = buildPeopleGraphTypes(this.ir);
    const graphAliases = peopleGraphTypesBundle.aliases;
    const peopleGraphTypeByTsAlias = new Map(peopleGraphTypesBundle.templates.map((type) => [type.alias, type]));
    const graphSchemaTypeNames = new Set(graphProfileSchema.types.map((type) => type.name));
    const defaultGraphPackage = this.ir.connection.graphApiVersion === "beta" ? "beta" : "v1";

    const qualifyGraphModelType = (csName: string, sourcePackage: "v1" | "beta"): string =>
      sourcePackage === "v1" ? `Microsoft.Graph.Models.${csName}` : `Microsoft.Graph.Beta.Models.${csName}`;

    const resolveGraphModelCsType = (graphName: string): string | null => {
      const alias = graphAliases.get(graphName);
      if (!alias) return null;
      const template = peopleGraphTypeByTsAlias.get(alias.tsAlias);
      if (template?.sourcePackage) {
        return qualifyGraphModelType(alias.csName, template.sourcePackage);
      }
      if (graphSchemaTypeNames.has(graphName)) {
        return qualifyGraphModelType(alias.csName, defaultGraphPackage);
      }
      return alias.csName;
    };

    const resolveGraphEnumCsType = (enumName: string): string => qualifyGraphModelType(toCsPascal(enumName), "beta");

    const resolveCsType = (rawType: string): { csType: string; isCollection: boolean } => {
      const collectionMatch = /^Collection\((.+)\)$/.exec(rawType);
      if (collectionMatch) {
        const elementType = collectionMatch[1]!;
        if (GRAPH_STRING_TYPES.has(elementType)) {
          const graphName = resolveGraphTypeName(elementType);
          if (graphName) {
            return { csType: `List<${resolveGraphModelCsType(graphName) ?? "string"}>`, isCollection: true };
          }
          return { csType: "List<string>", isCollection: true };
        }
        const enumGraphName = resolveGraphTypeName(elementType);
        const profileEnum = enumGraphName ? getProfileEnum(enumGraphName) : undefined;
        if (profileEnum) {
          return { csType: `List<${resolveGraphEnumCsType(profileEnum.name)}>`, isCollection: true };
        }
        const graphName = resolveGraphTypeName(elementType);
        if (graphName && graphAliases.has(graphName)) {
          return { csType: `List<${resolveGraphModelCsType(graphName)!}>`, isCollection: true };
        }
        const element = (() => {
          switch (elementType) {
            case "Edm.String":
              return "string";
            case "Edm.Date":
              return "Date";
            case "Edm.Int32":
              return "int";
            case "Edm.Int64":
              return "long";
            case "Edm.Double":
              return "double";
            case "Edm.Boolean":
              return "bool";
            case "Edm.DateTimeOffset":
              return "DateTimeOffset";
            default:
              throw new Error(`Unsupported Graph scalar type '${elementType}'. Update resolveCsType to map this type.`);
          }
        })();
        return { csType: `List<${element}>`, isCollection: true };
      }

      if (GRAPH_STRING_TYPES.has(rawType)) {
        const graphName = resolveGraphTypeName(rawType);
        if (graphName) {
          return { csType: resolveGraphModelCsType(graphName) ?? "string", isCollection: false };
        }
        return { csType: "string", isCollection: false };
      }

      const enumGraphName = resolveGraphTypeName(rawType);
      const profileEnum = enumGraphName ? getProfileEnum(enumGraphName) : undefined;
      if (profileEnum) {
        return { csType: resolveGraphEnumCsType(profileEnum.name), isCollection: false };
      }

      const graphName = resolveGraphTypeName(rawType);
      if (graphName && graphAliases.has(graphName)) {
        return { csType: resolveGraphModelCsType(graphName)!, isCollection: false };
      }

      switch (rawType) {
        case "Edm.String":
          return { csType: "string", isCollection: false };
        case "Edm.Date":
          return { csType: "Date", isCollection: false };
        case "Edm.Int32":
          return { csType: "int", isCollection: false };
        case "Edm.Int64":
          return { csType: "long", isCollection: false };
        case "Edm.Double":
          return { csType: "double", isCollection: false };
        case "Edm.Boolean":
          return { csType: "bool", isCollection: false };
        case "Edm.DateTimeOffset":
          return { csType: "DateTimeOffset", isCollection: false };
        default:
          throw new Error(`Unsupported Graph scalar type '${rawType}'. Update resolveCsType to map this type.`);
      }
    };

    const baseProfileTypes = graphProfileSchema.types.map((type) => {
      const template = peopleGraphTypeByTsAlias.get(toTsIdentifier(type.name));
      const properties = type.properties.map((prop) => {
        const resolved = resolveCsType(prop.type);
        const resolvedType = resolved.csType;
        const isValueType = ["int", "long", "double", "bool", "Date", "DateTimeOffset"].includes(resolvedType);
        const nullable = prop.nullable || !isValueType;
        const nullableSuffix = nullable ? "?" : "";
        return {
          name: prop.name,
          csName: toCsPascal(prop.name),
          csType: `${resolvedType}${nullableSuffix}`,
          nullable,
        };
      });
      return {
        name: type.name,
        csName: toCsPascal(type.name),
        typeName: template?.sourcePackage ? qualifyGraphModelType(toCsPascal(type.name), template.sourcePackage) : toCsPascal(type.name),
        baseType: type.baseType ? resolveGraphModelCsType(type.baseType) ?? toCsPascal(type.baseType) : null,
        sourcePackage: template?.sourcePackage,
        properties,
      };
    });
    const derivedProfileTypes = peopleGraphTypesBundle.derived.map((type) => ({
      name: type.name,
      csName: type.csName,
      typeName: type.csName,
      baseType: null,
      sourcePackage: undefined,
      properties: type.csProperties.map((prop) => ({
        name: prop.name,
        csName: prop.csName,
        csType: prop.csType,
        nullable: prop.nullable,
      })),
    }));
    const peopleProfileTypes = [...baseProfileTypes, ...derivedProfileTypes].sort((a, b) => {
      if (a.csName === "ItemFacet") return -1;
      if (b.csName === "ItemFacet") return 1;
      return a.csName.localeCompare(b.csName);
    });
    const baseTypeNames = new Set(
      peopleProfileTypes
        .filter((type) => !type.sourcePackage)
        .map((type) => type.baseType)
        .filter((name): name is string => Boolean(name))
    );
    const schemaBaseTypeByName = new Map(
      graphProfileSchema.types.map((type) => [type.name, type.baseType])
    );
    const isItemFacetType = (typeName: string): boolean => {
      if (typeName === "itemFacet") return true;
      let current = schemaBaseTypeByName.get(typeName);
      while (current) {
        if (current === "itemFacet") return true;
        current = schemaBaseTypeByName.get(current);
      }
      return false;
    };
    const peopleProfileTypeInfoByName = new Map(
      peopleProfileTypes.map((type) => [
        type.csName,
        {
          typeName: type.typeName,
          properties: new Map(type.properties.map((prop) => [prop.name, { csName: prop.csName, csType: prop.csType }])),
        } satisfies CsPersonEntityTypeInfo,
      ])
    );
    const peopleProfileTypeByName = new Map(
      peopleProfileTypes.map((type) => [type.name, type])
    );
    const itemTypeName = toCsIdentifier(this.ir.item.typeName);
    const properties = this.ir.properties.map((p) => {
      const parseFn = toCsParseFunction(p.type);
      const sourceLiteral = buildCsSourceLiteral(p.source);
      const isCollection = p.type === "stringCollection";
      const nameLiteral = JSON.stringify(p.name);
      const csStringConstraints = buildCsStringConstraintsLiteral(p);
      const sourceDefaultLiteral = p.source.default !== undefined ? JSON.stringify(p.source.default) : null;
      const sourceTransformsLiteral = buildCsSourceTransformsLiteral(p.source);
      const personEntity = p.personEntity
        ? {
            entity: p.personEntity.entity,
            fields: p.personEntity.fields.map((field) => ({
              path: field.path,
              source: field.source,
            })),
          }
        : null;
      const personEntityType = personEntity ? peopleProfileTypeByName.get(personEntity.entity) : null;
      const personEntityTypeInfo = personEntityType
        ? {
            typeName: personEntityType.typeName,
            properties: new Map(
              personEntityType.properties.map((prop) => [prop.name, { csName: prop.csName, csType: prop.csType }])
            ),
          }
        : null;
      const mappedObject = p.mappedObject
        ? {
            fields: p.mappedObject.fields.map((field) => ({
              path: field.path,
              source: field.source,
            })),
          }
        : null;
      const isPeopleLabel = p.labels.some((label) => label.startsWith("person"));
      const needsManualEntity = isPeopleLabel && !p.personEntity;
      const noSource = Boolean(p.source.noSource);
      const isContentProperty = p.name === this.ir.item.contentPropertyName;
      const contentSources = isContentProperty ? this.ir.item.contentSources ?? [] : [];
      const contentType = this.ir.item.contentType ?? "text";
      const contentExpression = contentSources.length > 0
        ? (() => {
            const lineExpressions = contentSources
              .map((entry) => {
                const labelLiteral = JSON.stringify(entry.label);
                const sourceLiteral = buildCsSourceLiteral(entry.source);
                const parsedValueExpression = entry.source.default !== undefined
                  ? `RowParser.ApplyDefault(RowParser.ParseString(row, ${sourceLiteral}), ${JSON.stringify(entry.source.default)})`
                  : `RowParser.ParseString(row, ${sourceLiteral})`;
                const entryTransformsLiteral = buildCsSourceTransformsLiteral(entry.source);
                const valueExpression = entryTransformsLiteral
                  ? `RowParser.ApplyTransforms(${parsedValueExpression}, ${entryTransformsLiteral})`
                  : parsedValueExpression;
                if (contentType === "html") {
                  return `string.Concat("<li><b>", ${labelLiteral}, "</b>: ", ${valueExpression}, "</li>")`;
                }
                return `string.Concat(${labelLiteral}, ": ", ${valueExpression})`;
              })
              .join(", ");
            if (contentType === "html") {
              return `string.Concat("<ul>", string.Join("", new[] { ${lineExpressions} }), "</ul>")`;
            }
            return `string.Join("\\n", new[] { ${lineExpressions} })`;
          })()
        : null;
      const principalExpression =
        p.type === "principal"
          ? buildCsPrincipalExpression(p.personEntity?.fields ?? null, p.source)
          : p.type === "principalCollection"
          ? buildCsPrincipalCollectionExpression(p.personEntity?.fields ?? null, p.source)
          : null;
      const transformExpression = needsManualEntity
        ? `throw new NotImplementedException("Missing @coco.source(..., to) mappings for people entity '${p.name}'. Implement in PropertyTransform.cs.")`
        : noSource
        ? "default!"
        : contentExpression
        ? contentExpression
        : (p.type === "principal" || p.type === "principalCollection") && principalExpression
        ? principalExpression
        : personEntity
        ? isCollection
          ? buildCsPersonEntityCollectionExpression(
              personEntity.fields,
              (headersLiteral) => {
                const base = `RowParser.ParseStringCollection(row, ${headersLiteral})`;
                return csStringConstraints.hasAny
                  ? `Validation.ValidateStringCollection(${nameLiteral}, ${base}, ${csStringConstraints.minLength}, ${csStringConstraints.maxLength}, ${csStringConstraints.pattern}, ${csStringConstraints.format})`
                  : base;
              },
              personEntityTypeInfo,
              peopleProfileTypeInfoByName,
              this.ir.connection.inputFormat
            )
          : buildCsPersonEntityExpression(
              personEntity.fields,
              (headersLiteral) => {
                const base = `RowParser.ParseString(row, ${headersLiteral})`;
                return csStringConstraints.hasAny
                  ? `Validation.ValidateString(${nameLiteral}, ${base}, ${csStringConstraints.minLength}, ${csStringConstraints.maxLength}, ${csStringConstraints.pattern}, ${csStringConstraints.format})`
                  : base;
              },
              personEntityTypeInfo,
              peopleProfileTypeInfoByName
            )
        : mappedObject
        ? isCollection
          ? buildCsPersonEntityCollectionExpression(
              mappedObject.fields,
              (headersLiteral) => {
                const base = `RowParser.ParseStringCollection(row, ${headersLiteral})`;
                return csStringConstraints.hasAny
                  ? `Validation.ValidateStringCollection(${nameLiteral}, ${base}, ${csStringConstraints.minLength}, ${csStringConstraints.maxLength}, ${csStringConstraints.pattern}, ${csStringConstraints.format})`
                  : base;
              },
              null,
              new Map(),
              this.ir.connection.inputFormat
            )
          : buildCsPersonEntityExpression(
              mappedObject.fields,
              (headersLiteral) => {
                const base = `RowParser.ParseString(row, ${headersLiteral})`;
                return csStringConstraints.hasAny
                  ? `Validation.ValidateString(${nameLiteral}, ${base}, ${csStringConstraints.minLength}, ${csStringConstraints.maxLength}, ${csStringConstraints.pattern}, ${csStringConstraints.format})`
                  : base;
              },
              null,
              new Map()
            )
        : p.type === "string"
        ? (() => {
          const parsedExpression = sourceDefaultLiteral
            ? `RowParser.ApplyDefault(${parseFn}(row, ${sourceLiteral}), ${sourceDefaultLiteral})`
            : `${parseFn}(row, ${sourceLiteral})`;
          return sourceTransformsLiteral
            ? `RowParser.ApplyTransforms(${parsedExpression}, ${sourceTransformsLiteral})`
            : parsedExpression;
        })()
        : p.type === "stringCollection"
        ? (() => {
          const parsedExpression = sourceDefaultLiteral
            ? `RowParser.ApplyDefaultCollection(${parseFn}(row, ${sourceLiteral}), ${sourceDefaultLiteral})`
            : `${parseFn}(row, ${sourceLiteral})`;
          return sourceTransformsLiteral
            ? `RowParser.ApplyCollectionTransforms(${parsedExpression}, ${sourceTransformsLiteral})`
            : parsedExpression;
        })()
        : `${parseFn}(row, ${sourceLiteral})`;

      const validationMetadata = {
        name: p.name,
        type: p.type,
        ...(p.minLength !== undefined ? { minLength: p.minLength } : {}),
        ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
        ...(p.pattern ? { pattern: p.pattern } : {}),
        ...(p.format ? { format: p.format } : {}),
        ...(p.minValue !== undefined ? { minValue: p.minValue } : {}),
        ...(p.maxValue !== undefined ? { maxValue: p.maxValue } : {}),
      };

      const validatedExpression = needsManualEntity || noSource || personEntity || mappedObject || p.type === "principal" || p.type === "principalCollection"
        ? transformExpression
        : applyCsValidationExpression(validationMetadata, transformExpression, sourceLiteral);

      return {
        name: p.name,
        csName: toCsPropertyName(p.name, itemTypeName, usedPropertyNames),
        csType: toCsType(p.type),
        csvHeaders: p.source.csvHeaders,
        csvHeadersLiteral: sourceLiteral,
        isCollection,
        source: p.source,
        personEntity,
        parseFn,
        transformExpression: formatCsTransformExpression(validatedExpression, needsManualEntity ? 8 : 12),
        transformThrows: needsManualEntity,
        graphTypeEnumName: toGraphPropertyTypeEnumName(p.type),
        description: p.description,
        doc: p.doc,
        labels: p.labels,
        peopleLabel: p.labels.find((label) => label.startsWith("person")) ?? null,
        aliases: p.aliases,
        search: p.search,
        type: p.type,
        format: p.format,
        pattern: p.pattern,
        minLength: p.minLength,
        maxLength: p.maxLength,
        minValue: p.minValue,
        maxValue: p.maxValue,
      };
    });

    const modelDocLines = this.ir.item.doc ? formatCsDocSummary(this.ir.item.doc) : [];

    const schemaPropertyLines = properties
      .filter((p) => p.name !== this.ir.item.contentPropertyName)
      .map((p) => {
        const isPrincipalType = p.type === "principal" || p.type === "principalCollection";
        const labels =
          p.labels.length > 0
            ? `new List<string> { ${p.labels.map((l) => JSON.stringify(l)).join(", ")} }`
            : null;
        const aliases =
          p.aliases.length > 0
            ? `new List<string> { ${p.aliases.map((a) => JSON.stringify(a)).join(", ")} }`
            : "null";

        const additionalDataEntries: string[] = [];
        if (p.description) additionalDataEntries.push(`                        ["description"] = ${JSON.stringify(p.description)},`);
        if (labels) additionalDataEntries.push(`                        ["labels"] = ${labels},`);
        if (isPrincipalType) additionalDataEntries.push(`                        ["type"] = ${JSON.stringify(p.type)},`);

        const additionalDataBlock =
          additionalDataEntries.length > 0
            ? [
                "                    AdditionalData = new Dictionary<string, object>",
                "                    {",
                ...additionalDataEntries,
                "                    },",
              ]
            : [];

        const lines: string[] = [
          "                new Property",
          "                {",
          `                    Name = ${JSON.stringify(p.name)},`,
          ...(isPrincipalType ? [] : [`                    Type = PropertyType.${p.graphTypeEnumName},`]),
        ];

        if (p.search.searchable !== undefined) lines.push(`                    IsSearchable = ${p.search.searchable ? "true" : "false"},`);
        if (p.search.queryable !== undefined) lines.push(`                    IsQueryable = ${p.search.queryable ? "true" : "false"},`);
        if (p.search.retrievable !== undefined) lines.push(`                    IsRetrievable = ${p.search.retrievable ? "true" : "false"},`);
        if (p.search.refinable !== undefined) lines.push(`                    IsRefinable = ${p.search.refinable ? "true" : "false"},`);
        if (p.search.exactMatchRequired !== undefined)
          lines.push(`                    IsExactMatchRequired = ${p.search.exactMatchRequired ? "true" : "false"},`);
        if (aliases !== "null") lines.push(`                    Aliases = ${aliases},`);
        lines.push(...additionalDataBlock);

        lines.push("                },");
        return lines.join("\n");
      })
      .join("\n");

    const itemIdProperty = properties.find((p) => p.name === this.ir.item.idPropertyName);
    const idRawSourceDotnet =
      itemIdProperty?.personEntity?.fields[0]?.source ?? itemIdProperty?.source;
    const idDefaultLiteral = idRawSourceDotnet?.default !== undefined ? JSON.stringify(idRawSourceDotnet.default) : null;
    const idRawExpressionDotnet = idRawSourceDotnet
      ? (idDefaultLiteral
        ? `RowParser.ApplyDefault(RowParser.ParseString(row, ${buildCsSourceLiteral(idRawSourceDotnet)}), ${idDefaultLiteral})`
        : `RowParser.ParseString(row, ${buildCsSourceLiteral(idRawSourceDotnet)})`)
      : "string.Empty";
    const propertyInitializerLines = [
      ...properties.map(
        (p) =>
          `            ${p.csName} = transforms.TransformProperty<${p.csType}>(${JSON.stringify(p.name)}, row),`
      ),
      `            InternalId = ${idRawExpressionDotnet},`,
    ].join("\n");

    const propertiesObjectLines = properties
      .filter((p) => p.name !== this.ir.item.contentPropertyName)
      .flatMap((p) => {
        const lines: string[] = [];
        const odataType = toOdataCollectionType(p.type);
        if (odataType) {
          lines.push(`                { ${JSON.stringify(`${p.name}@odata.type`)}, ${JSON.stringify(odataType)} },`);
        }
        let valueExpression = toCsPropertyValueExpression(p.type, p.csName);
        if (p.peopleLabel) {
          const propertyLiteral = JSON.stringify(p.name);
          const peopleLabelDefinition = peopleLabelDefinitions.find((entry) => entry.label === p.peopleLabel);
          if (!peopleLabelDefinition) {
            throw new Error(`Missing people label definition for '${p.peopleLabel}'.`);
          }
          const peopleOptionsLiteral = `new PeopleLabelSerializationOptions(${peopleLabelDefinition.collectionLimit ?? "null"})`;
          if (p.type === "string") {
            valueExpression = `PeoplePayload.SerializeStringLabel(item.${p.csName}, ${propertyLiteral}, ${peopleOptionsLiteral})`;
          } else if (p.type === "stringCollection") {
            valueExpression = `PeoplePayload.SerializeCollectionLabel(item.${p.csName}, ${propertyLiteral}, ${peopleOptionsLiteral})`;
          }
        }
        lines.push(`                { ${JSON.stringify(p.name)}, ${valueExpression} },`);
        return lines;
      })
      .join("\n");

    const itemIdExpression = itemIdProperty
      ? `!string.IsNullOrEmpty(item.InternalId) ? item.InternalId : (item.${itemIdProperty.csName} ?? string.Empty)`
      : "\"\"";

    const contentValueExpression = this.ir.item.contentPropertyName
      ? `Convert.ToString(item.${toCsIdentifier(this.ir.item.contentPropertyName)}) ?? string.Empty`
      : "string.Empty";
    const contentTypeEnum = this.ir.item.contentType === "html"
      ? "ExternalItemContentType.Html"
      : "ExternalItemContentType.Text";
    const contentBlock = [
      "        externalItem.Content = new ExternalItemContent",
      "        {",
      `            Type = ${contentTypeEnum},`,
      `            Value = ${contentValueExpression},`,
      "        };",
    ].join("\n");

    const usesPrincipal = properties.some(
      (p) => p.type === "principal" || p.type === "principalCollection"
    );
    const usesPeopleLabels = properties.some((p) => p.peopleLabel);

    await writeFile(
      path.join(this.outDir, schemaFolderName, "Model.cs"),
      await renderTemplate("dotnet/Generated/Model.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: this.ir.item.typeName,
        properties: properties.map((p) => ({
          csName: p.csName,
          csType: p.csType,
          docLines: p.doc ? formatCsDocSummary(p.doc) : [],
        })),
        modelDocLines,
        graphApiVersion: this.ir.connection.graphApiVersion,
        usesPrincipal,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, schemaFolderName, "Constants.cs"),
      await renderTemplate("dotnet/Generated/Constants.cs.ejs", {
        schemaNamespace,
        graphApiVersion: this.ir.connection.graphApiVersion,
        graphOperationVersions: {
          connectionProvisioning: graphApiVersionForOperation(this.ir, "connectionProvisioning"),
          schemaRegistration: graphApiVersionForOperation(this.ir, "schemaRegistration"),
          itemIngestion: graphApiVersionForOperation(this.ir, "itemIngestion"),
          profileSourceRegistration: graphApiVersionForOperation(this.ir, "profileSourceRegistration"),
        },
        contentCategory: this.ir.connection.contentCategory ?? null,
        connectionId: this.ir.connection.connectionId ?? null,
        connectionName: this.ir.connection.connectionName ?? null,
        connectionDescription: this.ir.connection.connectionDescription ?? null,
        inputFormat: this.ir.connection.inputFormat,
        profileSourceWebUrl: this.ir.connection.profileSource?.webUrl ?? null,
        profileSourceDisplayName: this.ir.connection.profileSource?.displayName ?? null,
        profileSourcePriority: this.ir.connection.profileSource?.priority ?? null,
        itemTypeName: this.ir.item.typeName,
        idPropertyName: this.ir.item.idPropertyName,
        contentPropertyName: this.ir.item.contentPropertyName ?? null,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, schemaFolderName, "SchemaPayload.cs"),
      await renderTemplate("dotnet/Generated/SchemaPayload.cs.ejs", {
        schemaNamespace,
        schemaPropertyLines,
        graphApiVersion: this.ir.connection.graphApiVersion,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "Datasource", "RowParser.cs"),
      await renderTemplate("dotnet/Generated/RowParser.cs.ejs", {
        namespaceName,
        inputFormat: this.ir.connection.inputFormat,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, schemaFolderName, "PropertyTransformBase.cs"),
      await renderTemplate("dotnet/Generated/PropertyTransformBase.cs.ejs", {
        namespaceName,
        schemaNamespace,
        properties,
        usesPersonEntity: this.ir.properties.some((p) => p.personEntity || p.mappedObject),
        usesLinq: properties.some(
          (p) =>
            p.type === "dateTimeCollection" &&
            (p.minLength !== undefined ||
              p.maxLength !== undefined ||
              Boolean(p.pattern?.regex) ||
              Boolean(p.format))
        ),
      }),
      "utf8"
    );

    const transformOverridesPath = path.join(this.outDir, schemaFolderName, "PropertyTransform.cs");
    try {
      await access(transformOverridesPath);
    } catch {
      await writeFile(
        transformOverridesPath,
        await renderTemplate("dotnet/PropertyTransform.cs.ejs", {
          schemaNamespace,
        }),
        "utf8"
      );
    }

    await writeFile(
      path.join(this.outDir, schemaFolderName, "FromRow.cs"),
      await renderTemplate("dotnet/Generated/FromRow.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: this.ir.item.typeName,
        propertyInitializerLines,
        usesPrincipal,
        graphApiVersion: this.ir.connection.graphApiVersion,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, schemaFolderName, "ItemPayload.cs"),
      await renderTemplate("dotnet/Generated/ItemPayload.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: this.ir.item.typeName,
        itemIdExpression,
        propertiesObjectLines,
        contentBlock,
        graphApiVersion: this.ir.connection.graphApiVersion,
        idEncoding: this.ir.item.idEncoding,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "Core", "ConnectorCore.cs"),
      await renderTemplate("dotnet/Core/ConnectorCore.cs.ejs", {
        namespaceName,
        schemaNamespace,
        itemTypeName: this.ir.item.typeName,
        isPeopleConnector: this.ir.connection.contentCategory === "people",
        graphApiVersion: this.ir.connection.graphApiVersion,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "Core", "IItemPayload.cs"),
      await renderTemplate("dotnet/Core/IItemPayload.cs.ejs", {
        namespaceName,
        graphApiVersion: this.ir.connection.graphApiVersion,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "Core", "Validation.cs"),
      await renderTemplate("dotnet/Core/Validation.cs.ejs", {
        namespaceName,
      }),
      "utf8"
    );

    if (usesPeopleLabels) {
      await writeFile(
        path.join(this.outDir, "Core", "PeoplePayload.cs"),
        await renderTemplate("dotnet/Core/PeoplePayload.cs.ejs", {
          namespaceName,
          peopleLabelDefinitions,
          peopleProfileTypes,
          baseTypeNames,
          graphEnums: buildGraphEnumTemplates(),
        }),
        "utf8"
      );
    }

    await writeFile(
      path.join(this.outDir, "Core", "ItemId.cs"),
      await renderTemplate("dotnet/Core/ItemId.cs.ejs", {
        namespaceName,
      }),
      "utf8"
    );

    if (usesPrincipal) {
      await writeFile(
        path.join(this.outDir, "Core", "Principal.cs"),
        await renderTemplate("dotnet/Core/Principal.cs.ejs", {
          namespaceName,
        }),
        "utf8"
      );
    }
  }
}
