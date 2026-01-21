import { getProfilePlanTypeNameByLabel, getProfileTypeByLabel, getProfileTypeNameByLabel } from "./profile-schema.js";

export type PeopleLabel =
  | "personAccount"
  | "personName"
  | "personCurrentPosition"
  | "personAddresses"
  | "personEmails"
  | "personPhones"
  | "personAwards"
  | "personCertifications"
  | "personProjects"
  | "personSkills"
  | "personWebAccounts"
  | "personWebSite"
  | "personAnniversaries"
  | "personNote";

export type PeoplePayloadType = "string" | "stringCollection";

export type PeopleLabelInfo = {
  label: PeopleLabel;
  payloadType: PeoplePayloadType;
  planTypeName: string;
  graphTypeName: string;
  requiredFields: string[];
  collectionLimit?: number;
};

const SUPPORTED_LABELS: PeopleLabel[] = [
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
  "personNote"
];

const LABEL_PAYLOAD_TYPES: Record<PeopleLabel, PeoplePayloadType> = {
  personAccount: "string",
  personName: "string",
  personCurrentPosition: "string",
  personAddresses: "stringCollection",
  personEmails: "stringCollection",
  personPhones: "stringCollection",
  personAwards: "stringCollection",
  personCertifications: "stringCollection",
  personProjects: "stringCollection",
  personSkills: "stringCollection",
  personWebAccounts: "stringCollection",
  personWebSite: "string",
  personAnniversaries: "stringCollection",
  personNote: "string"
};

const COLLECTION_LIMITS: Partial<Record<PeopleLabel, number>> = {
  personAddresses: 3,
  personEmails: 3
};

const BLOCKED_LABELS = new Map<string, { message: string; hint: string }>([
  [
    "personManager",
    {
      message: "People label 'personManager' is not supported by cocogen.",
      hint: "Remove the label or choose a supported people label from https://aka.ms/peopleconnectors/build."
    }
  ],
  [
    "personAssistants",
    {
      message: "People label 'personAssistants' is not supported by cocogen.",
      hint: "Remove the label or choose a supported people label from https://aka.ms/peopleconnectors/build."
    }
  ],
  [
    "personColleagues",
    {
      message: "People label 'personColleagues' is not supported by cocogen.",
      hint: "Remove the label or choose a supported people label from https://aka.ms/peopleconnectors/build."
    }
  ],
  [
    "personAlternateContacts",
    {
      message: "People label 'personAlternateContacts' is not supported by cocogen.",
      hint: "Remove the label or choose a supported people label from https://aka.ms/peopleconnectors/build."
    }
  ],
  [
    "personEmergencyContacts",
    {
      message: "People label 'personEmergencyContacts' is not supported by cocogen.",
      hint: "Remove the label or choose a supported people label from https://aka.ms/peopleconnectors/build."
    }
  ]
]);

export const supportedPeopleLabels = (): PeopleLabel[] => [...SUPPORTED_LABELS];

export const isSupportedPeopleLabel = (label: string): label is PeopleLabel =>
  SUPPORTED_LABELS.includes(label as PeopleLabel);

export const getBlockedPeopleLabel = (label: string): { message: string; hint: string } | undefined =>
  BLOCKED_LABELS.get(label);

export const getPeopleLabelInfo = (label: PeopleLabel): PeopleLabelInfo => {
  const payloadType = LABEL_PAYLOAD_TYPES[label];
  const planTypeName = getProfilePlanTypeNameByLabel(label);
  const graphTypeName = getProfileTypeNameByLabel(label);
  if (!planTypeName || !graphTypeName) {
    throw new Error(`Missing Graph type mapping for people label '${label}'.`);
  }
  const type = getProfileTypeByLabel(label);
  const info: PeopleLabelInfo = {
    label,
    payloadType,
    planTypeName,
    graphTypeName,
    requiredFields: type?.required ?? []
  };
  const limit = COLLECTION_LIMITS[label];
  if (limit !== undefined) {
    info.collectionLimit = limit;
  }
  return info;
};
