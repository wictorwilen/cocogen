import type { ConnectorIr, PropertyType } from "../ir.js";
import {
  getProfilePlanTypeNameByLabel,
  getProfileType,
  resolveProfileTypeName
} from "./profile-schema.js";
import type { GraphProfileType } from "./profile-schema.js";

export type PersonEntityName = NonNullable<ConnectorIr["properties"][number]["personEntity"]>["entity"];

type PeopleLabelPayloadType = Extract<PropertyType, "string" | "stringCollection">;

export type PeopleLabelConstraint = {
  collectionLimit?: number;
};

export type PeopleLabelDefinition = {
  label: string;
  payloadTypes: PeopleLabelPayloadType[];
  graphTypeName: PersonEntityName;
  planTypeName: string;
  schemaTypeName: string;
  schema: GraphProfileType;
  requiredFields: string[];
  constraints: PeopleLabelConstraint;
};

export type PeopleLabelInfo = {
  label: string;
  payloadType: PeopleLabelPayloadType;
  planTypeName: string;
  graphTypeName: PersonEntityName;
  requiredFields: string[];
  collectionLimit?: number;
};

type RawPeopleLabel = {
  label: string;
  payloadTypes: PeopleLabelPayloadType[];
  graphType: PersonEntityName;
  constraints?: PeopleLabelConstraint;
};

const RAW_LABELS: RawPeopleLabel[] = [
  { label: "personAccount", payloadTypes: ["string"], graphType: "userAccountInformation" },
  { label: "personName", payloadTypes: ["string"], graphType: "personName" },
  { label: "personCurrentPosition", payloadTypes: ["string"], graphType: "workPosition" },
  { label: "personAddresses", payloadTypes: ["stringCollection"], graphType: "itemAddress", constraints: { collectionLimit: 3 } },
  { label: "personEmails", payloadTypes: ["stringCollection"], graphType: "itemEmail", constraints: { collectionLimit: 3 } },
  { label: "personPhones", payloadTypes: ["stringCollection"], graphType: "itemPhone" },
  { label: "personAwards", payloadTypes: ["stringCollection"], graphType: "personAward" },
  { label: "personCertifications", payloadTypes: ["stringCollection"], graphType: "personCertification" },
  { label: "personProjects", payloadTypes: ["stringCollection"], graphType: "projectParticipation" },
  { label: "personSkills", payloadTypes: ["stringCollection"], graphType: "skillProficiency" },
  { label: "personWebAccounts", payloadTypes: ["stringCollection"], graphType: "webAccount" },
  { label: "personWebSite", payloadTypes: ["string"], graphType: "personWebsite" },
  { label: "personAnniversaries", payloadTypes: ["stringCollection"], graphType: "personAnnualEvent" },
  { label: "personNote", payloadTypes: ["string"], graphType: "personAnnotation" },
];

const labelDefinitions = new Map<string, PeopleLabelDefinition>();

for (const entry of RAW_LABELS) {
  const planTypeName = getProfilePlanTypeNameByLabel(entry.label) ?? entry.graphType;
  const schemaTypeName = resolveProfileTypeName(planTypeName);
  const schema = schemaTypeName ? getProfileType(schemaTypeName) : undefined;

  if (!schema || !schemaTypeName) {
    throw new Error(`Graph profile schema is missing type '${entry.graphType}'. Run npm run update-graph-profile-schema.`);
  }

  labelDefinitions.set(entry.label, {
    label: entry.label,
    payloadTypes: entry.payloadTypes,
    graphTypeName: entry.graphType,
    planTypeName,
    schemaTypeName,
    schema,
    requiredFields: schema.required ?? [],
    constraints: entry.constraints ?? {},
  });
}

export const PEOPLE_LABEL_DEFINITIONS = labelDefinitions;

export const SUPPORTED_PEOPLE_LABELS = new Set(labelDefinitions.keys());

export function supportedPeopleLabels(): string[] {
  return RAW_LABELS.map((label) => label.label);
}

export function isSupportedPeopleLabel(label: string): boolean {
  return SUPPORTED_PEOPLE_LABELS.has(label);
}

export function getPeopleLabelDefinition(label: string): PeopleLabelDefinition | undefined {
  return labelDefinitions.get(label);
}

export type BlockedPeopleLabel = {
  message: string;
  hint: string;
};

export const BLOCKED_PEOPLE_LABELS = new Map<string, BlockedPeopleLabel>([
  [
    "personManager",
    {
      message: "People connector label 'personManager' is blocked for custom connectors.",
      hint: "Remove this label. If you need to describe reporting structure, include manager details inside personCurrentPosition.detail.manager.",
    },
  ],
  [
    "personAssistants",
    {
      message: "People connector label 'personAssistants' is blocked for custom connectors.",
      hint: "Remove the label and surface assistant information inside personPhones or personEmails metadata instead.",
    },
  ],
  [
    "personColleagues",
    {
      message: "People connector label 'personColleagues' is blocked for custom connectors.",
      hint: "Consider using personProjects or personSkills to describe collaboration context rather than emitting colleagues directly.",
    },
  ],
  [
    "personAlternateContacts",
    {
      message: "People connector label 'personAlternateContacts' is blocked for custom connectors.",
      hint: "Provide alternate contact details by enriching personPhones or personEmails instead of using this label.",
    },
  ],
  [
    "personEmergencyContacts",
    {
      message: "People connector label 'personEmergencyContacts' is blocked for custom connectors.",
      hint: "Provide emergency contact details inside personPhones or personEmails instead of using this label.",
    },
  ],
]);

export const getBlockedPeopleLabel = (label: string): BlockedPeopleLabel | undefined =>
  BLOCKED_PEOPLE_LABELS.get(label);

export const getPeopleLabelInfo = (label: string): PeopleLabelInfo => {
  const definition = getPeopleLabelDefinition(label);
  if (!definition) {
    throw new Error(`Missing Graph type mapping for people label '${label}'.`);
  }
  const payloadType = definition.payloadTypes[0] ?? "string";
  const info: PeopleLabelInfo = {
    label: definition.label,
    payloadType,
    planTypeName: definition.planTypeName,
    graphTypeName: definition.graphTypeName,
    requiredFields: definition.requiredFields,
  };
  if (definition.constraints.collectionLimit !== undefined) {
    info.collectionLimit = definition.constraints.collectionLimit;
  }
  return info;
};
