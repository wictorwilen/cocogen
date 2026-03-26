import { createRequire } from "node:module";

import type { GraphApiVersion, PropertyType } from "../ir.js";

export type GraphVersionAvailability = {
  availableIn: GraphApiVersion[];
  minGraphApiVersion: GraphApiVersion;
};

export type GraphConnectionCapabilityName = "contentCategory" | "profileSourceRegistration";

export type GraphLabelCapability = GraphVersionAvailability & {
  kind: "semantic" | "people";
};

export type PeopleLabelCapability = GraphVersionAvailability & {
  planTypeName: string;
  graphTypeName: string;
};

export type GraphCapabilitySnapshot = {
  generatedAt: string;
  connectionProperties: Partial<Record<GraphConnectionCapabilityName, GraphVersionAvailability>>;
  propertyTypes: Partial<Record<PropertyType, GraphVersionAvailability>>;
  labels: Record<string, GraphLabelCapability>;
  peopleLabels: Record<string, PeopleLabelCapability>;
  profileTypes: Record<string, GraphVersionAvailability>;
};

const require = createRequire(import.meta.url);
const snapshot = require("../../data/graph-capabilities.json") as GraphCapabilitySnapshot;

export const graphCapabilities = snapshot;

const compareGraphApiVersions = (left: GraphApiVersion, right: GraphApiVersion): number => {
  if (left === right) return 0;
  return left === "beta" ? 1 : -1;
};

export const maxGraphApiVersion = (...versions: Array<GraphApiVersion | undefined>): GraphApiVersion =>
  versions.filter((value): value is GraphApiVersion => Boolean(value)).sort(compareGraphApiVersions).at(-1) ?? "v1.0";

export const getConnectionPropertyCapability = (
  name: GraphConnectionCapabilityName
): GraphVersionAvailability | undefined => snapshot.connectionProperties[name];

export const getPropertyTypeCapability = (type: PropertyType): GraphVersionAvailability | undefined =>
  snapshot.propertyTypes[type];

export const getLabelCapability = (label: string): GraphLabelCapability | undefined => snapshot.labels[label];

export const getPeopleLabelCapability = (label: string): PeopleLabelCapability | undefined => snapshot.peopleLabels[label];

export const getProfileTypeCapability = (typeName: string): GraphVersionAvailability | undefined => snapshot.profileTypes[typeName];
