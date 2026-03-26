import type { ConnectorIr, GraphApiVersion } from "../ir.js";
import {
  getConnectionPropertyCapability,
  getLabelCapability,
  getPropertyTypeCapability,
  maxGraphApiVersion,
  type GraphConnectionCapabilityName,
} from "./capabilities.js";

export type GraphOperation =
  | "connectionProvisioning"
  | "schemaRegistration"
  | "itemIngestion"
  | "profileSourceRegistration";

export type GraphRequirementReason = {
  kind: "connectionProperty" | "propertyType" | "label";
  minGraphApiVersion: GraphApiVersion;
  operations: GraphOperation[];
  message: string;
  capabilityName?: GraphConnectionCapabilityName;
  propertyName?: string;
  propertyType?: ConnectorIr["properties"][number]["type"];
  label?: string;
};

export type GraphOperationRequirement = {
  operation: GraphOperation;
  minGraphApiVersion: GraphApiVersion;
  reasons: GraphRequirementReason[];
};

const GRAPH_OPERATION_LABELS: Record<GraphOperation, string> = {
  connectionProvisioning: "connection provisioning",
  schemaRegistration: "schema registration",
  itemIngestion: "item ingestion",
  profileSourceRegistration: "profile source registration",
};

function formatOperations(operations: GraphOperation[]): string {
  return operations.map((operation) => GRAPH_OPERATION_LABELS[operation]).join(" + ");
}

function isBetaRequirement(version: GraphApiVersion | undefined): version is "beta" {
  return version === "beta";
}

export function collectGraphRequirementReasons(ir: ConnectorIr): GraphRequirementReason[] {
  const reasons: GraphRequirementReason[] = [];

  if (ir.connection.contentCategory) {
    const capability = getConnectionPropertyCapability("contentCategory");
    if (isBetaRequirement(capability?.minGraphApiVersion)) {
      reasons.push({
        kind: "connectionProperty",
        capabilityName: "contentCategory",
        minGraphApiVersion: "beta",
        operations: ["connectionProvisioning"],
        message: "connection.contentCategory uses Graph /beta property 'contentCategory' during connection provisioning",
      });
    }
  }

  if (ir.connection.profileSource) {
    const capability = getConnectionPropertyCapability("profileSourceRegistration");
    if (isBetaRequirement(capability?.minGraphApiVersion)) {
      reasons.push({
        kind: "connectionProperty",
        capabilityName: "profileSourceRegistration",
        minGraphApiVersion: "beta",
        operations: ["profileSourceRegistration"],
        message: "connection.profileSource uses Graph /beta profile source registration",
      });
    }
  }

  for (const property of ir.properties) {
    const propertyTypeCapability = getPropertyTypeCapability(property.type);
    if (isBetaRequirement(propertyTypeCapability?.minGraphApiVersion)) {
      reasons.push({
        kind: "propertyType",
        propertyName: property.name,
        propertyType: property.type,
        minGraphApiVersion: "beta",
        operations: ["schemaRegistration", "itemIngestion"],
        message: `property '${property.name}' uses Graph /beta property type '${property.type}' for schema registration and item ingestion`,
      });
    }

    for (const label of property.labels) {
      const labelCapability = getLabelCapability(label);
      if (isBetaRequirement(labelCapability?.minGraphApiVersion)) {
        reasons.push({
          kind: "label",
          propertyName: property.name,
          label,
          minGraphApiVersion: "beta",
          operations: ["schemaRegistration", "itemIngestion"],
          message: `property '${property.name}' uses Graph /beta label '${label}' for schema registration and item ingestion`,
        });
      }
    }
  }

  return reasons;
}

export function getGraphOperationRequirements(ir: ConnectorIr): GraphOperationRequirement[] {
  const reasons = collectGraphRequirementReasons(ir);
  const operations: GraphOperation[] = [
    "connectionProvisioning",
    "schemaRegistration",
    "itemIngestion",
    "profileSourceRegistration",
  ];

  return operations.map((operation) => {
    const matchingReasons = reasons.filter((reason) => reason.operations.includes(operation));
    return {
      operation,
      minGraphApiVersion: maxGraphApiVersion(...matchingReasons.map((reason) => reason.minGraphApiVersion)),
      reasons: matchingReasons,
    };
  });
}

export function formatPreviewFeatureRequirement(ir: ConnectorIr): string {
  const reasons = collectGraphRequirementReasons(ir).filter((reason) => reason.minGraphApiVersion === "beta");
  if (reasons.length === 0) {
    return "This schema requires Graph beta. Re-run with --use-preview-features.";
  }

  return [
    "This schema requires Graph beta.",
    "Reasons:",
    ...reasons.map((reason) => `- ${reason.message}`),
    "Re-run with --use-preview-features.",
  ].join("\n");
}

export function getGraphBetaNoteLines(ir: ConnectorIr): string[] {
  return collectGraphRequirementReasons(ir)
    .filter((reason) => reason.minGraphApiVersion === "beta")
    .map((reason) => `${reason.message}; ${formatOperations(reason.operations)} will use /beta`);
}