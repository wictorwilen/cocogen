import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PEOPLE_LABEL_DEFINITIONS } from "../../people/label-registry.js";
import { graphProfileSchema } from "../../people/profile-schema.js";
import {
  toTsIdentifier,
  toTsSchemaFolderName,
  toTsType,
} from "../naming.js";
import { buildObjectTree } from "../object-tree.js";
import type { PersonEntityField } from "../shared-types.js";
import { renderTemplate } from "../template.js";
import { formatDocComment } from "../helpers/format.js";
import { buildSourceLiteral } from "../helpers/source.js";
import { graphBaseUrl, schemaPayload, toOdataCollectionType } from "../helpers/schema.js";
import {
  buildGraphEnumTemplates,
  buildPeopleGraphTypes,
  buildPeopleLabelSerializers,
  parseGraphTypeDescriptor,
  type PeopleGraphTypeAlias,
} from "../people/graph-types.js";
import { CoreGenerator, type GeneratorContext } from "../generators/core.js";
import { removeIfExists } from "../helpers/fs.js";
import { buildTsPersonEntityCollectionExpression, buildTsPersonEntityExpression, type TsPersonEntityTypeInfo } from "./people-entity.js";
import { buildTsPrincipalCollectionExpression, buildTsPrincipalExpression } from "./principal.js";
import { applyTsValidationExpression, buildTsStringConstraintsLiteral } from "./validation.js";

export type TsGeneratorSettings = {
  projectName: string;
  tspPath: string;
};

/** Generates TypeScript connector scaffolds and generated files. */
export class TsGenerator extends CoreGenerator<TsGeneratorSettings> {
  protected lang = "ts" as const;

  constructor(context: GeneratorContext<TsGeneratorSettings>) {
    super(context);
  }

  /** Resolve the schema folder name for TS output. */
  private get schemaFolderName(): string {
    return toTsSchemaFolderName(this.ir.connection.connectionName);
  }

  /** Write non-generated scaffolding files for a TS project. */
  async writeScaffold(): Promise<void> {
    const schemaFolderName = this.schemaFolderName;
    await mkdir(path.join(this.outDir, "src"), { recursive: true });
    await mkdir(path.join(this.outDir, "src", "datasource"), { recursive: true });
    await mkdir(path.join(this.outDir, "src", schemaFolderName), { recursive: true });

    await writeFile(
      path.join(this.outDir, "package.json"),
      await renderTemplate("ts/package.json.ejs", {
        projectName: this.settings.projectName,
        isPeopleConnector: this.ir.connection.contentCategory === "people",
        inputFormat: this.ir.connection.inputFormat,
      }),
      "utf8"
    );
    await writeFile(
      path.join(this.outDir, "tspconfig.yaml"),
      await renderTemplate("ts/tspconfig.yaml.ejs", {}),
      "utf8"
    );
    await writeFile(
      path.join(this.outDir, "tsconfig.json"),
      await renderTemplate("ts/tsconfig.json.ejs", {}),
      "utf8"
    );
    await writeFile(
      path.join(this.outDir, ".env.example"),
      await renderTemplate("ts/.env.example.ejs", {
        itemTypeName: this.ir.item.typeName,
        isPeopleConnector: this.ir.connection.contentCategory === "people",
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
      path.join(this.outDir, "README.md"),
      await renderTemplate("ts/README.md.ejs", {
        isPeopleConnector: this.ir.connection.contentCategory === "people",
        itemTypeName: this.ir.item.typeName,
        schemaFolderName,
        inputFormat: this.ir.connection.inputFormat,
      }),
      "utf8"
    );

    await this.writeProjectConfig(this.settings.tspPath);

    await writeFile(
      path.join(this.outDir, "src", "cli.ts"),
      await renderTemplate("ts/src/cli.ts.ejs", {
        graphBaseUrl: graphBaseUrl(this.ir),
        isPeopleConnector: this.ir.connection.contentCategory === "people",
        itemTypeName: this.ir.item.typeName,
        schemaFolderName,
        inputFormat: this.ir.connection.inputFormat,
      }),
      "utf8"
    );
    await writeFile(
      path.join(this.outDir, "src", "datasource", "itemSource.ts"),
      await renderTemplate("ts/src/datasource/itemSource.ts.ejs", {
        itemTypeName: this.ir.item.typeName,
        schemaFolderName,
      }),
      "utf8"
    );

    if (this.ir.connection.inputFormat === "json") {
      await writeFile(
        path.join(this.outDir, "src", "datasource", "jsonItemSource.ts"),
        await renderTemplate("ts/src/datasource/jsonItemSource.ts.ejs", {
          itemTypeName: this.ir.item.typeName,
          schemaFolderName,
        }),
        "utf8"
      );
    } else if (this.ir.connection.inputFormat === "yaml") {
      await writeFile(
        path.join(this.outDir, "src", "datasource", "yamlItemSource.ts"),
        await renderTemplate("ts/src/datasource/yamlItemSource.ts.ejs", {
          itemTypeName: this.ir.item.typeName,
          schemaFolderName,
        }),
        "utf8"
      );
    } else if (this.ir.connection.inputFormat === "custom") {
      await writeFile(
        path.join(this.outDir, "src", "datasource", "customItemSource.ts"),
        await renderTemplate("ts/src/datasource/customItemSource.ts.ejs", {
          itemTypeName: this.ir.item.typeName,
          schemaFolderName,
        }),
        "utf8"
      );
    } else {
      await writeFile(
        path.join(this.outDir, "src", "datasource", "csvItemSource.ts"),
        await renderTemplate("ts/src/datasource/csvItemSource.ts.ejs", {
          itemTypeName: this.ir.item.typeName,
          schemaFolderName,
        }),
        "utf8"
      );
    }

    await writeFile(
      path.join(this.outDir, "src", "index.ts"),
      await renderTemplate("ts/src/index.ts.ejs", { schemaFolderName }),
      "utf8"
    );
  }

  /** Write generated TS files based on the IR. */
  async writeGenerated(): Promise<void> {
    const schemaFolderName = this.schemaFolderName;

    await mkdir(path.join(this.outDir, "src", "datasource"), { recursive: true });
    await mkdir(path.join(this.outDir, "src", schemaFolderName), { recursive: true });
    await mkdir(path.join(this.outDir, "src", "core"), { recursive: true });

    await removeIfExists(path.join(this.outDir, "src", schemaFolderName, "fromCsvRow.ts"));
    await removeIfExists(path.join(this.outDir, "src", "datasource", "csv.ts"));

    const modelProperties = this.ir.properties.map((p) => ({
      name: p.name,
      tsType: toTsType(p.type),
      docComment: p.doc ? formatDocComment(p.doc, "  ") : undefined,
    }));

    const hasPeopleSupport =
      this.ir.connection.contentCategory === "people" ||
      this.ir.properties.some((p) => p.labels.some((label) => label.startsWith("person")));
    const peopleGraphTypesBundle = hasPeopleSupport ? buildPeopleGraphTypes(this.ir) : null;
    const peopleGraphTypes = peopleGraphTypesBundle ? peopleGraphTypesBundle.templates : [];
    const graphAliases = peopleGraphTypesBundle ? peopleGraphTypesBundle.aliases : new Map<string, PeopleGraphTypeAlias>();
    const peopleProfileTypeInfoByAlias = new Map<string, TsPersonEntityTypeInfo>();
    if (hasPeopleSupport && peopleGraphTypesBundle) {
      for (const type of graphProfileSchema.types) {
        const alias = toTsIdentifier(type.name);
        const properties = new Map<string, string>();
        for (const prop of type.properties ?? []) {
          const descriptor = parseGraphTypeDescriptor(prop.type, graphAliases);
          properties.set(prop.name, descriptor.tsType);
        }
        peopleProfileTypeInfoByAlias.set(alias, { alias, properties });
      }
      for (const type of peopleGraphTypesBundle.derived) {
        const alias = type.alias;
        const properties = new Map<string, string>(type.fields.map((field) => [field.name, field.tsType]));
        peopleProfileTypeInfoByAlias.set(alias, { alias, properties });
      }
    }

    const collectPeopleEntityTypes = (fields: PersonEntityField[], typeInfo: TsPersonEntityTypeInfo | null): Set<string> => {
      const used = new Set<string>();
      if (!typeInfo) return used;

      const tree = buildObjectTree(fields);
      const visit = (node: Record<string, unknown>, info: TsPersonEntityTypeInfo | null): void => {
        if (!info) return;
        used.add(info.alias);
        for (const [key, value] of Object.entries(node)) {
          if (typeof value === "object" && value && !Array.isArray(value) && !("path" in (value as PersonEntityField))) {
            const propType = info.properties.get(key) ?? null;
            if (propType?.endsWith("[]")) {
              const elementType = propType.slice(0, -2);
              const nestedInfo = peopleProfileTypeInfoByAlias.get(elementType) ?? null;
              if (nestedInfo) {
                visit(value as Record<string, unknown>, nestedInfo);
              }
              continue;
            }
            const nestedInfo = propType ? peopleProfileTypeInfoByAlias.get(propType) ?? null : null;
            if (nestedInfo) {
              visit(value as Record<string, unknown>, nestedInfo);
            }
          }
        }
      };
      visit(tree, typeInfo);
      return used;
    };

    const peopleEntityTypes = new Set<string>();
    const transformProperties = this.ir.properties.map((p) => {
      const parser = (() => {
        switch (p.type) {
          case "stringCollection":
            return "parseStringCollection";
          case "int64Collection":
          case "doubleCollection":
            return "parseNumberCollection";
          case "dateTimeCollection":
            return "parseStringCollection";
          case "principalCollection":
            return "parseStringCollection";
          case "boolean":
            return "parseBoolean";
          case "int64":
          case "double":
            return "parseNumber";
          case "principal":
          case "dateTime":
          case "string":
          default:
            return "parseString";
        }
      })();

      const nameLiteral = JSON.stringify(p.name);
      const stringConstraints = buildTsStringConstraintsLiteral(p);
      const personEntityType = p.personEntity ? toTsIdentifier(p.personEntity.entity) : null;
      const personEntityTypeInfo = personEntityType ? peopleProfileTypeInfoByAlias.get(personEntityType) ?? null : null;
      if (personEntityTypeInfo) {
        for (const typeName of collectPeopleEntityTypes(
          p.personEntity?.fields.map((field) => ({ path: field.path, source: field.source })) ?? [],
          personEntityTypeInfo
        )) {
          peopleEntityTypes.add(typeName);
        }
      }
      const personEntity = p.personEntity
        ? (p.type === "stringCollection"
            ? buildTsPersonEntityCollectionExpression(
                p.personEntity.fields.map((field) => ({
                  path: field.path,
                  source: field.source,
                })),
                (headersLiteral) => {
                  const base = `parseStringCollection(readSourceValue(row, ${headersLiteral}))`;
                  return stringConstraints
                    ? `validateStringCollection(${nameLiteral}, ${base}, ${stringConstraints})`
                    : base;
                },
                personEntityTypeInfo,
                peopleProfileTypeInfoByAlias
              )
            : buildTsPersonEntityExpression(
                p.personEntity.fields.map((field) => ({
                  path: field.path,
                  source: field.source,
                })),
                (headersLiteral) => {
                  const base = `parseString(readSourceValue(row, ${headersLiteral}))`;
                  return stringConstraints
                    ? `validateString(${nameLiteral}, ${base}, ${stringConstraints})`
                    : base;
                },
                personEntityTypeInfo,
                peopleProfileTypeInfoByAlias
              ))
        : null;

      const principalExpression =
        p.type === "principal"
          ? buildTsPrincipalExpression(p.personEntity?.fields ?? null, p.source)
          : p.type === "principalCollection"
          ? buildTsPrincipalCollectionExpression(p.personEntity?.fields ?? null, p.source)
          : null;

      const isPeopleLabel = p.labels.some((label) => label.startsWith("person"));
      const needsManualEntity = isPeopleLabel && !p.personEntity;
      const noSource = Boolean(p.source.noSource);
      const expression = needsManualEntity
        ? `(() => { throw new Error("Missing @coco.source(..., to) mappings for people entity '${p.name}'. Implement transform in propertyTransform.ts."); })()`
        : noSource
        ? `undefined as unknown as ${toTsType(p.type)}`
        : (p.type === "principal" || p.type === "principalCollection") && principalExpression
        ? principalExpression
        : personEntity
        ? personEntity
        : `${parser}(readSourceValue(row, ${buildSourceLiteral(p.source)}))`;

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

      const validatedExpression = needsManualEntity || noSource || personEntity || p.type === "principal" || p.type === "principalCollection"
        ? expression
        : applyTsValidationExpression(validationMetadata, expression);

      return {
        name: p.name,
        parser,
        expression: validatedExpression,
        isCollection: p.type === "stringCollection",
        transformName: toTsIdentifier(p.name),
        tsType: toTsType(p.type),
      };
    });

    const idProperty = this.ir.properties.find((p) => p.name === this.ir.item.idPropertyName);
    const idRawSource = idProperty?.personEntity?.fields[0]?.source ?? idProperty?.source;
    const idRawExpression = idRawSource
      ? `parseString(readSourceValue(row, ${buildSourceLiteral(idRawSource)}))`
      : '""';

    const usesPrincipal = this.ir.properties.some(
      (p) => p.type === "principal" || p.type === "principalCollection"
    );
    const peopleLabelSerializers = hasPeopleSupport ? buildPeopleLabelSerializers() : [];
    const serializerImports = new Set<string>();
    const payloadProperties = this.ir.properties
      .filter((p) => p.name !== this.ir.item.contentPropertyName)
      .map((p) => {
        const odataType = toOdataCollectionType(p.type);
        const personLabel = p.labels.find((label) => label.startsWith("person"));
        const serializerName =
          personLabel && PEOPLE_LABEL_DEFINITIONS.has(personLabel)
            ? `serialize${toTsIdentifier(personLabel)}`
            : null;
        if (serializerName) {
          serializerImports.add(serializerName);
        }
        const baseValue =
          p.type === "principal"
            ? `cleanPrincipal(item.${p.name} as Record<string, unknown> | null | undefined)`
            : p.type === "principalCollection"
            ? `cleanPrincipalCollection(item.${p.name} as Array<Record<string, unknown>> | null | undefined)`
            : `item.${p.name}`;
        const valueExpression = serializerName
          ? `${serializerName}(${baseValue}, ${JSON.stringify(p.name)})`
          : baseValue;
        return {
          name: p.name,
          odataType,
          valueExpression,
        };
      });

    await writeFile(
      path.join(this.outDir, "src", schemaFolderName, "model.ts"),
      await renderTemplate("ts/src/generated/model.ts.ejs", {
        itemTypeName: this.ir.item.typeName,
        properties: modelProperties,
        itemDocComment: this.ir.item.doc ? formatDocComment(this.ir.item.doc) : undefined,
        usesPrincipal,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "src", "datasource", "row.ts"),
      await renderTemplate("ts/src/generated/row.ts.ejs", {
        inputFormat: this.ir.connection.inputFormat,
      }),
      "utf8"
    );

    if (this.ir.connection.inputFormat !== "csv") {
      await writeFile(
        path.join(this.outDir, "src", "datasource", "inputPath.ts"),
        await renderTemplate("ts/src/datasource/inputPath.ts.ejs", {}),
        "utf8"
      );
    }

    await writeFile(
      path.join(this.outDir, "src", schemaFolderName, "constants.ts"),
      await renderTemplate("ts/src/generated/constants.ts.ejs", {
        graphApiVersion: this.ir.connection.graphApiVersion,
        contentCategory: this.ir.connection.contentCategory ?? null,
        connectionName: this.ir.connection.connectionName ?? null,
        connectionId: this.ir.connection.connectionId ?? null,
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
      path.join(this.outDir, "src", schemaFolderName, "schemaPayload.ts"),
      await renderTemplate("ts/src/generated/schemaPayload.ts.ejs", {
        schemaPayloadJson: JSON.stringify(schemaPayload(this.ir), null, 2),
      }),
      "utf8"
    );

    if (hasPeopleSupport) {
      await writeFile(
        path.join(this.outDir, "src", "core", "people.ts"),
        await renderTemplate("ts/src/core/people.ts.ejs", {
          graphTypes: peopleGraphTypes,
          labels: peopleLabelSerializers,
          graphEnums: buildGraphEnumTemplates(),
        }),
        "utf8"
      );
    }

    await writeFile(
      path.join(this.outDir, "src", schemaFolderName, "propertyTransformBase.ts"),
      await renderTemplate("ts/src/generated/propertyTransformBase.ts.ejs", {
        properties: transformProperties,
        usesPrincipal,
        peopleEntityTypes: Array.from(peopleEntityTypes),
      }),
      "utf8"
    );

    const transformOverridesPath = path.join(this.outDir, "src", schemaFolderName, "propertyTransform.ts");
    try {
      await access(transformOverridesPath);
    } catch {
      await writeFile(
        transformOverridesPath,
        await renderTemplate("ts/src/propertyTransform.ts.ejs", {}),
        "utf8"
      );
    }

    await writeFile(
      path.join(this.outDir, "src", schemaFolderName, "fromRow.ts"),
      await renderTemplate("ts/src/generated/fromRow.ts.ejs", {
        properties: transformProperties,
        itemTypeName: this.ir.item.typeName,
        idRawExpression,
        usesPrincipal,
      }),
      "utf8"
    );

    const contentValueExpression = this.ir.item.contentPropertyName
      ? "String((item as any)[contentPropertyName ?? \"\"] ?? \"\")"
      : "\"\"";
    await writeFile(
      path.join(this.outDir, "src", schemaFolderName, "itemPayload.ts"),
      await renderTemplate("ts/src/generated/itemPayload.ts.ejs", {
        properties: payloadProperties,
        peopleSerializers: Array.from(serializerImports),
        contentValueExpression,
        itemTypeName: this.ir.item.typeName,
        idEncoding: this.ir.item.idEncoding,
        usesPrincipal,
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "src", schemaFolderName, "index.ts"),
      await renderTemplate("ts/src/generated/index.ts.ejs", {}),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "src", "core", "connectorCore.ts"),
      await renderTemplate("ts/src/core/connectorCore.ts.ejs", {
        itemTypeName: this.ir.item.typeName,
        isPeopleConnector: this.ir.connection.contentCategory === "people",
      }),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "src", "core", "validation.ts"),
      await renderTemplate("ts/src/core/validation.ts.ejs", {}),
      "utf8"
    );

    await writeFile(
      path.join(this.outDir, "src", "core", "itemId.ts"),
      await renderTemplate("ts/src/core/itemId.ts.ejs", {}),
      "utf8"
    );

    if (usesPrincipal) {
      await writeFile(
        path.join(this.outDir, "src", "core", "principal.ts"),
        await renderTemplate("ts/src/core/principal.ts.ejs", {}),
        "utf8"
      );
    }
  }
}
