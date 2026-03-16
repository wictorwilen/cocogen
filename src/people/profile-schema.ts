import { createRequire } from "node:module";

export type GraphProfileProperty = {
  name: string;
  type: string;
  nullable: boolean;
};

export type GraphProfileType = {
  name: string;
  fullName: string;
  namespace: string;
  baseType?: string;
  properties: GraphProfileProperty[];
  required: string[];
};

export type GraphProfileEnumMember = {
  name: string;
  value?: string;
};

export type GraphProfileEnum = {
  name: string;
  fullName: string;
  namespace: string;
  members: GraphProfileEnumMember[];
};

export type GraphProfileSchemaSnapshot = {
  generatedAt: string;
  graphVersion: string;
  types: GraphProfileType[];
  enums: GraphProfileEnum[];
  aliases: Record<string, string>;
  labelTypeMap: Record<string, string>;
};

const require = createRequire(import.meta.url);
const snapshot = require("../../data/graph-profile-schema.json") as GraphProfileSchemaSnapshot;

export const graphProfileSchema = snapshot;

const typeMap = new Map(snapshot.types.map((type) => [type.name, type]));
const enumMap = new Map(snapshot.enums.map((entry) => [entry.name, entry]));

export const resolveProfileTypeName = (typeName: string): string => snapshot.aliases[typeName] ?? typeName;

export const getProfileType = (typeName: string): GraphProfileType | undefined => {
  const resolved = resolveProfileTypeName(typeName);
  return typeMap.get(resolved);
};

export const getProfileEnum = (typeName: string): GraphProfileEnum | undefined => {
  const resolved = resolveProfileTypeName(typeName);
  return enumMap.get(resolved);
};

export const isProfileEnum = (typeName: string): boolean => getProfileEnum(typeName) !== undefined;

export const getProfileTypeByLabel = (label: string): GraphProfileType | undefined => {
  const mapped = snapshot.labelTypeMap[label];
  if (!mapped) return undefined;
  return getProfileType(mapped);
};

export const getProfilePlanTypeNameByLabel = (label: string): string | undefined =>
  snapshot.labelTypeMap[label];

export const getProfileTypeNameByLabel = (label: string): string | undefined => {
  const mapped = snapshot.labelTypeMap[label];
  return mapped ? resolveProfileTypeName(mapped) : undefined;
};
