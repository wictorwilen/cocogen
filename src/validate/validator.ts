import type { ConnectorIr, PropertyType } from "../ir.js";

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

const PEOPLE_LABELS = new Set([
  "personAccount",
  "personName",
  "personCurrentPosition",
  "personAddresses",
  "personEmails",
  "personPhones",
  "personAwards",
  "personCertifications",
  "personProjects",
  "personSkills",
  "personWebAccounts",
  "personWebSite",
  "personAnniversaries",
  "personNote",
]);

const PEOPLE_ENTITY_BY_LABEL = new Map<string, string>([
  ["personAccount", "userAccountInformation"],
  ["personName", "personName"],
  ["personCurrentPosition", "workPosition"],
  ["personAddresses", "itemAddress"],
  ["personEmails", "itemEmail"],
  ["personPhones", "itemPhone"],
  ["personAwards", "personAward"],
  ["personCertifications", "personCertification"],
  ["personProjects", "projectParticipation"],
  ["personSkills", "skillProficiency"],
  ["personWebAccounts", "webAccount"],
  ["personWebSite", "personWebsite"],
  ["personAnniversaries", "personAnniversary"],
  ["personNote", "personAnnotation"],
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

    if (prop.type === "principal" && prop.search.searchable) {
      issues.push({
        severity: "error",
        message: `Property '${prop.name}' has type 'principal' and cannot be marked searchable.`,
        hint: "Remove searchable=true for this property.",
      });
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
      if (hasSearchFlags(prop.search)) {
        issues.push({
          severity: "warning",
            message: `People connectors ignore @coco.search flags (property '${prop.name}').`,
            hint: "Remove @coco.search from people connector schemas to avoid confusion.",
        });
      }
      if (!isPeopleLabeled(prop.labels)) continue;
      for (const label of prop.labels) {
        if (label.startsWith("person") && !PEOPLE_LABELS.has(label)) {
          issues.push({
            severity: "error",
            message: `People connector label '${label}' is not supported.`,
            hint: "Use a supported people label like personCurrentPosition or personEmails.",
          });
        }
      }
      if (prop.type !== "string" && prop.type !== "stringCollection") {
        issues.push({
          severity: "error",
          message: `People-labeled property '${prop.name}' must be string or stringCollection. Found '${prop.type}'.`,
          hint: "For People connectors, people-domain labeled properties must contain JSON-serialized profile entity objects in strings.",
        });
      }
      if (!prop.personEntity) {
        issues.push({
          severity: "warning",
          message: `People-labeled property '${prop.name}' is missing @coco.source(..., to) mappings.`,
          hint: "Without entity mappings, cocogen will not generate defaults; implement JSON payloads manually in property transforms (TS) or overrides (C#).",
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
