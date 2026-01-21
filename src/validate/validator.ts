import type { ConnectorIr, PropertyType } from "../ir.js";
import {
  getBlockedPeopleLabel,
  getPeopleLabelDefinition,
  getPeopleLabelInfo,
  isSupportedPeopleLabel
} from "../people/label-registry.js";

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  severity: ValidationSeverity;
  message: string;
  hint?: string;
};

function isSearchableType(type: PropertyType): boolean {
  return type === "string" || type === "stringCollection";
}

function isPeopleLabeled(labels: string[]): boolean {
  return labels.some((l) => l.startsWith("person"));
}

function hasSearchFlags(flags: { [key: string]: unknown }): boolean {
  return Object.values(flags).some((value) => Boolean(value));
}

function matchesRequiredField(path: string, fieldName: string): boolean {
  if (!path) return false;
  return path === fieldName || path.startsWith(`${fieldName}.`);
}
const SEMANTIC_LABEL_TYPE_RULES = new Map<string, PropertyType[]>([
  ["title", ["string"]],
  ["url", ["string"]],
  ["createdBy", ["string"]],
  ["lastModifiedBy", ["string"]],
  ["authors", ["string", "stringCollection"]],
  ["createdDateTime", ["dateTime"]],
  ["lastModifiedDateTime", ["dateTime"]],
  ["fileName", ["string"]],
  ["fileExtension", ["string"]],
  ["iconUrl", ["string"]],
  ["containerName", ["string"]],
  ["containerUrl", ["string"]],
  ["createdByUpn", ["string"]],
  ["lastModifiedByUpn", ["string"]],
  ["authorsUpn", ["string", "stringCollection"]],
]);

export function validateIr(ir: ConnectorIr): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Graph constraints
  if (ir.properties.length > 128) {
    issues.push({
      severity: "error",
      message: `Too many schema properties (${ir.properties.length}). Microsoft Graph external connections allow max 128.`,
      hint: "Remove or consolidate properties in the item model.",
    });
  }

  const seenNames = new Set<string>();
  for (const prop of ir.properties) {
    if (seenNames.has(prop.name)) {
      issues.push({
        severity: "error",
          message: `Duplicate property name '${prop.name}' after applying @coco.name overrides.`,
          hint: "Use @coco.name(\"...\") to provide a shorter name.",
      });
    }
    seenNames.add(prop.name);

    if (prop.name.length > 32) {
      issues.push({
        severity: "error",
        message: `Property '${prop.name}' is too long (${prop.name.length}). Graph schema names must be <= 32 characters.`,
        hint: "Use @coco.name(\"...\") to provide a shorter name.",
      });
    }

    if (!/^[A-Za-z0-9]+$/.test(prop.name)) {
      issues.push({
        severity: "error",
        message: `Property '${prop.name}' contains invalid characters. Graph schema names must be alphanumeric only.`,
          hint: "Use @coco.name(\"...\") to provide an alphanumeric name.",
      });
    }

    if (prop.search.searchable) {
      if (!isSearchableType(prop.type)) {
        issues.push({
          severity: "error",
          message: `Property '${prop.name}' is marked searchable but has type '${prop.type}'. Only string/stringCollection can be searchable.`,
          hint: "Remove searchable=true or change the property to string/stringCollection.",
        });
      }
      if (prop.search.refinable) {
        issues.push({
          severity: "error",
          message: `Property '${prop.name}' is both searchable and refinable. This combination is not supported.`,
          hint: "Remove refinable=true or searchable=true.",
        });
      }
    }

    if ((prop.type === "principal" || prop.type === "principalCollection") && prop.search.searchable) {
      issues.push({
        severity: "error",
        message: `Property '${prop.name}' has type '${prop.type}' and cannot be marked searchable.`,
        hint: "Remove searchable=true for this property.",
      });
    }

    const nonPeopleLabels = prop.labels.filter((label) => !label.startsWith("person"));
    if (nonPeopleLabels.length > 0 && !prop.search.retrievable) {
      issues.push({
        severity: "error",
        message: `Property '${prop.name}' has semantic labels (${nonPeopleLabels.join(", ")}) but is not retrievable.`,
        hint: "Add @coco.search({ retrievable: true }) to labeled properties.",
      });
    }

    for (const label of nonPeopleLabels) {
      const allowedTypes = SEMANTIC_LABEL_TYPE_RULES.get(label);
      if (!allowedTypes) continue;
      if (!allowedTypes.includes(prop.type)) {
        issues.push({
          severity: "error",
          message: `Semantic label '${label}' on property '${prop.name}' requires type ${allowedTypes.join(" or ")}, but found '${prop.type}'.`,
          hint: "Change the property type or remove the semantic label.",
        });
      }
    }
  }

  const idProp = ir.properties.find((p) => p.name === ir.item.idPropertyName);
  if (!idProp) {
    issues.push({
      severity: "error",
      message: `Internal mismatch: id property '${ir.item.idPropertyName}' is not present in properties list.`,
        hint: "This is a cocogen bug. Please file an issue with your schema.",
    });
  } else if (idProp.type !== "string") {
    issues.push({
      severity: "error",
        message: `@coco.id property '${idProp.name}' must be a string (external item ids are strings). Found '${idProp.type}'.`,
      hint: "Change the TypeSpec property type to 'string'.",
    });
  }

  if (!ir.connection.connectionName || ir.connection.connectionName.trim().length === 0) {
    issues.push({
      severity: "error",
      message: "Missing @coco.connection name.",
      hint: "Add @coco.connection({ name: \"Your connector\", connectionId: \"yourconnectionid\", connectionDescription: \"Your connector\" }) to the @coco.item model.",
    });
  }

  if (!ir.connection.connectionId || ir.connection.connectionId.trim().length === 0) {
    issues.push({
      severity: "error",
      message: "Missing @coco.connection connectionId.",
      hint: "Add @coco.connection({ name: \"Your connector\", connectionId: \"yourconnectionid\", connectionDescription: \"Your connector\" }) to the @coco.item model.",
    });
  }

  if (!ir.connection.connectionDescription || ir.connection.connectionDescription.trim().length === 0) {
    issues.push({
      severity: "warning",
      message: "Missing @coco.connection connectionDescription.",
      hint: "Add @coco.connection({ name: \"Your connector\", connectionId: \"yourconnectionid\", connectionDescription: \"Your connector\" }) to improve Copilot reasoning quality.",
    });
  }

  const hasPersonAccount = ir.properties.some((p) => p.labels.includes("personAccount"));
  const hasProfileSource = Boolean(ir.connection.profileSource);
  if (hasProfileSource && !hasPersonAccount) {
    issues.push({
      severity: "error",
      message: "@coco.profileSource is set but no property is labeled personAccount.",
      hint: "Add @coco.label(\"personAccount\") to a string property (usually the user principal name).",
    });
  }

  if (hasProfileSource && (!ir.connection.profileSource?.displayName || ir.connection.profileSource.displayName.trim().length === 0)) {
    issues.push({
      severity: "error",
      message: "@coco.profileSource displayName is required.",
      hint: "Add displayName to @coco.profileSource({ webUrl: \"https://example.com\", displayName: \"Your source\" }).",
    });
  }

  if (hasPersonAccount && !hasProfileSource) {
    issues.push({
      severity: "error",
      message: "personAccount label requires @coco.profileSource on the model.",
      hint: "Add @coco.profileSource({ webUrl: \"https://example.com\", displayName: \"Your source\" }) to the @coco.item model.",
    });
  }

  if (ir.connection.connectionId && !/^[A-Za-z0-9]+$/.test(ir.connection.connectionId)) {
    issues.push({
      severity: "error",
      message: `@coco.connection connectionId '${ir.connection.connectionId}' contains invalid characters. Connection IDs must be alphanumeric only.`,
      hint: "Remove non-alphanumeric characters from connectionId.",
    });
  }

  if (ir.item.contentPropertyName) {
    const contentProp = ir.properties.find((p) => p.name === ir.item.contentPropertyName);
    if (!contentProp) {
      issues.push({
        severity: "error",
        message: `Internal mismatch: content property '${ir.item.contentPropertyName}' is not present in properties list.`,
          hint: "This is a cocogen bug. Please file an issue with your schema.",
      });
    } else if (contentProp.type !== "string") {
      issues.push({
        severity: "error",
          message: `@coco.content property '${contentProp.name}' must be a string (full-text content value). Found '${contentProp.type}'.`,
        hint: "Change the TypeSpec property type to 'string'.",
      });
    } else {
      if (contentProp.labels.length > 0) {
        issues.push({
          severity: "error",
          message: `@coco.content property '${contentProp.name}' cannot have labels.`,
          hint: "Remove @coco.label from the content property.",
        });
      }
      if (contentProp.aliases.length > 0) {
        issues.push({
          severity: "error",
          message: `@coco.content property '${contentProp.name}' cannot have aliases.`,
          hint: "Remove @coco.aliases from the content property.",
        });
      }
      if (contentProp.description && contentProp.description.trim().length > 0) {
        issues.push({
          severity: "error",
          message: `@coco.content property '${contentProp.name}' cannot have a description.`,
          hint: "Remove @coco.description from the content property.",
        });
      }
      if (hasSearchFlags(contentProp.search)) {
        issues.push({
          severity: "error",
          message: `@coco.content property '${contentProp.name}' cannot use @coco.search flags.`,
          hint: "Remove @coco.search from the content property.",
        });
      }
    }
  }

  // People connectors rules (preview)
  if (ir.connection.contentCategory === "people") {
    if (ir.connection.profileSource && ir.connection.profileSource.webUrl.trim().length === 0) {
      issues.push({
        severity: "error",
          message: "@coco.profileSource requires a non-empty webUrl.",
        hint: "Set webUrl to an HTTPS link to the source system or info page.",
      });
    }
    if (ir.item.contentPropertyName) {
      issues.push({
        severity: "error",
          message: `People connectors do not support externalItem.content. Remove @coco.content from '${ir.item.contentPropertyName}'.`,
        hint: "For people connectors, represent all searchable/retrievable data as schema properties instead of externalItem.content.",
      });
    }

    const personAccountProps = ir.properties.filter((p) => p.labels.includes("personAccount"));
    if (personAccountProps.length !== 1) {
      issues.push({
        severity: "error",
        message:
          personAccountProps.length === 0
            ? "People connectors require exactly one property labeled 'personAccount', but none was found."
            : `People connectors require exactly one property labeled 'personAccount', but found ${personAccountProps.length} (${personAccountProps
                .map((p) => p.name)
                .join(", ")}).`,
        hint: "Add @coco.label(\"personAccount\") to the property that identifies the person account.",
      });
    }

    for (const prop of ir.properties) {
      if (!isPeopleLabeled(prop.labels)) continue;

      if (hasSearchFlags(prop.search)) {
        issues.push({
          severity: "warning",
          message: `People-labeled property '${prop.name}' should not use @coco.search flags.`,
          hint: "Remove @coco.search from people-labeled properties to avoid confusion.",
        });
      }

      let shouldWarnMissingMapping = false;

      for (const label of prop.labels) {
        if (!label.startsWith("person")) continue;

        const blocked = getBlockedPeopleLabel(label);
        if (blocked) {
          issues.push({
            severity: "error",
            message: `${blocked.message} (property '${prop.name}')`,
            hint: blocked.hint,
          });
          continue;
        }

        if (!isSupportedPeopleLabel(label)) {
          issues.push({
            severity: "error",
            message: `People connector label '${label}' on property '${prop.name}' is not supported.`,
            hint: "Use a supported people label like personCurrentPosition or personEmails.",
          });
          continue;
        }

        const labelDefinition = getPeopleLabelDefinition(label);
        if (!labelDefinition) {
          issues.push({
            severity: "error",
            message: `People connector label '${label}' on property '${prop.name}' is not supported.`,
            hint: "Use a supported people label like personCurrentPosition or personEmails.",
          });
          continue;
        }

        const info = getPeopleLabelInfo(label);
        if (info.payloadType !== prop.type) {
          issues.push({
            severity: "error",
            message: `People label '${label}' requires type ${info.payloadType}, but '${prop.name}' is '${prop.type}'.`,
            hint: "Change the property type to match the people label requirements.",
          });
        }

        const requiredFields = labelDefinition.requiredFields ?? [];

        if (!prop.personEntity) {
          if (requiredFields.length > 0) {
            issues.push({
              severity: "error",
              message: `People label '${label}' on property '${prop.name}' must map required Graph field(s) ${requiredFields.join(
                ", "
              )}, but no @coco.source(..., to) entries were found.`,
              hint: "Add @coco.source({ from: ..., to: \"field\" }) for each required Graph field.",
            });
          } else {
            shouldWarnMissingMapping = true;
          }
          continue;
        }

        if (labelDefinition && prop.personEntity.entity !== labelDefinition.graphTypeName) {
          issues.push({
            severity: "error",
            message: `People label '${label}' expects entity '${labelDefinition.graphTypeName}', but property '${prop.name}' maps '${prop.personEntity.entity}'.`,
            hint: "Remove conflicting labels or adjust @coco.source(..., to) mappings to the correct Graph entity.",
          });
          continue;
        }

        if (requiredFields.length > 0) {
          const providedPaths =
            prop.personEntity.fields?.map((field) => field.path).filter((path): path is string => Boolean(path)) ?? [];
          const missingFields = requiredFields.filter(
            (required) => !providedPaths.some((path) => matchesRequiredField(path, required))
          );
          if (missingFields.length > 0) {
            issues.push({
              severity: "error",
              message: `People label '${label}' on property '${prop.name}' must provide Graph field(s) ${missingFields.join(
                ", "
              )}.`,
              hint: "Add @coco.source({ from, to }) entries for each required field.",
            });
          }
        }
      }

      if (!prop.personEntity && shouldWarnMissingMapping) {
        issues.push({
          severity: "warning",
          message: `People-labeled property '${prop.name}' is missing @coco.source(..., to) mappings.`,
          hint: "A throwing transform stub is generated. Implement the mapping in PropertyTransform (TS/.NET).",
        });
      }
    }
  }

  if (ir.connection.profileSource && ir.connection.contentCategory !== "people") {
    issues.push({
      severity: "error",
        message: "@coco.profileSource can only be used with people connectors.",
      hint: "Set @coco.connection({ contentCategory: \"people\" }) or remove @coco.profileSource.",
    });
  }

  return issues;
}
