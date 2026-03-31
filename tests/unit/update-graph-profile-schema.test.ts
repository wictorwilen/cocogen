import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildGraphCapabilitySnapshot,
  parseExternalConnectorLabelSets,
  parseGraphMetadataSnapshot,
  writeGraphCapabilitySnapshot,
  writeGraphProfileSnapshot,
} from "../../scripts/update-graph-profile-schema.ts";

const metadataXml = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema Namespace="microsoft.graph" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EnumType Name="emailType">
        <Member Name="work" Value="0" />
        <Member Name="personal" Value="1" />
      </EnumType>
      <EnumType Name="phoneType">
        <Member Name="mobile" Value="0" />
        <Member Name="business" Value="1" />
      </EnumType>
      <EnumType Name="personRelationship">
        <Member Name="manager" Value="0" />
        <Member Name="colleague" Value="1" />
      </EnumType>
      <EnumType Name="skillProficiencyLevel">
        <Member Name="beginner" Value="0" />
        <Member Name="advanced" Value="1" />
      </EnumType>
      <EnumType Name="personAnnualEventType">
        <Member Name="birthday" Value="0" />
        <Member Name="workAnniversary" Value="1" />
      </EnumType>
      <EnumType Name="physicalAddressType">
        <Member Name="business" Value="0" />
        <Member Name="home" Value="1" />
      </EnumType>
      <EnumType Name="bodyType">
        <Member Name="text" Value="0" />
        <Member Name="html" Value="1" />
      </EnumType>
      <EntityType Name="itemFacet">
        <Property Name="createdDateTime" Type="Edm.DateTimeOffset" Nullable="true" />
      </EntityType>
      <EntityType Name="userAccountInformation" BaseType="microsoft.graph.itemFacet">
        <Property Name="userPrincipalName" Type="Edm.String" Nullable="true" />
      </EntityType>
      <EntityType Name="personName" BaseType="microsoft.graph.itemFacet">
        <Property Name="displayName" Type="Edm.String" Nullable="true" />
      </EntityType>
      <EntityType Name="workPosition" BaseType="microsoft.graph.itemFacet">
        <Property Name="detail" Type="microsoft.graph.positionDetail" Nullable="true" />
        <Property Name="manager" Type="microsoft.graph.relatedPerson" Nullable="true" />
      </EntityType>
      <EntityType Name="itemAddress" BaseType="microsoft.graph.itemFacet">
        <Property Name="detail" Type="microsoft.graph.physicalAddress" Nullable="true" />
      </EntityType>
      <EntityType Name="itemEmail" BaseType="microsoft.graph.itemFacet">
        <Property Name="type" Type="microsoft.graph.emailType" Nullable="false" />
      </EntityType>
      <EntityType Name="itemPhone" BaseType="microsoft.graph.itemFacet">
        <Property Name="type" Type="microsoft.graph.phoneType" Nullable="false" />
      </EntityType>
      <EntityType Name="personAward" BaseType="microsoft.graph.itemFacet">
        <Property Name="displayName" Type="Edm.String" Nullable="true" />
      </EntityType>
      <EntityType Name="personCertification" BaseType="microsoft.graph.itemFacet">
        <Property Name="displayName" Type="Edm.String" Nullable="true" />
      </EntityType>
      <EntityType Name="projectParticipation" BaseType="microsoft.graph.itemFacet">
        <Property Name="detail" Type="microsoft.graph.positionDetail" Nullable="true" />
      </EntityType>
      <EntityType Name="skillProficiency" BaseType="microsoft.graph.itemFacet">
        <Property Name="proficiency" Type="microsoft.graph.skillProficiencyLevel" Nullable="true" />
      </EntityType>
      <EntityType Name="webAccount" BaseType="microsoft.graph.itemFacet">
        <Property Name="userId" Type="Edm.String" Nullable="true" />
      </EntityType>
      <EntityType Name="personWebsite" BaseType="microsoft.graph.itemFacet">
        <Property Name="displayName" Type="Edm.String" Nullable="true" />
      </EntityType>
      <EntityType Name="personAnnualEvent" BaseType="microsoft.graph.itemFacet">
        <Property Name="type" Type="microsoft.graph.personAnnualEventType" Nullable="true" />
      </EntityType>
      <EntityType Name="personAnnotation" BaseType="microsoft.graph.itemFacet">
        <Property Name="detail" Type="microsoft.graph.itemBody" Nullable="true" />
      </EntityType>
      <ComplexType Name="positionDetail">
        <Property Name="company" Type="microsoft.graph.companyDetail" Nullable="true" />
        <Property Name="layer" Type="Edm.Int32" Nullable="true" />
      </ComplexType>
      <ComplexType Name="companyDetail">
        <Property Name="address" Type="microsoft.graph.physicalAddress" Nullable="true" />
      </ComplexType>
      <ComplexType Name="physicalAddress">
        <Property Name="street" Type="Edm.String" Nullable="true" />
        <Property Name="type" Type="microsoft.graph.physicalAddressType" Nullable="true" />
      </ComplexType>
      <ComplexType Name="relatedPerson">
        <Property Name="relationship" Type="microsoft.graph.personRelationship" Nullable="true" />
      </ComplexType>
      <ComplexType Name="itemBody">
        <Property Name="contentType" Type="microsoft.graph.bodyType" Nullable="true" />
      </ComplexType>
    </Schema>
    <Schema Namespace="other.graph" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EnumType Name="emailType">
        <Member Name="other" Value="99" />
      </EnumType>
      <ComplexType Name="physicalAddress">
        <Property Name="bogus" Type="Edm.String" Nullable="true" />
      </ComplexType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

const v1MetadataXml = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema Namespace="microsoft.graph" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="itemFacet" />
      <EntityType Name="userAccountInformation" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="personName" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="workPosition" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="itemAddress" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="itemEmail" BaseType="microsoft.graph.itemFacet">
        <Property Name="type" Type="Edm.String" Nullable="false" />
      </EntityType>
      <EntityType Name="itemPhone" BaseType="microsoft.graph.itemFacet">
        <Property Name="type" Type="Edm.String" Nullable="false" />
      </EntityType>
      <EntityType Name="personAward" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="personCertification" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="projectParticipation" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="skillProficiency" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="webAccount" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="personWebsite" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="personAnnualEvent" BaseType="microsoft.graph.itemFacet" />
      <EntityType Name="personAnnotation" BaseType="microsoft.graph.itemFacet" />
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

const v1OpenApiYaml = `components:
  schemas:
    microsoft.graph.externalConnectors.label:
      title: label
      enum:
        - title
        - url
        - iconUrl
      type: string
    microsoft.graph.externalConnectors.property:
      properties:
        labels:
          description: 'Specifies one or more well-known tags added against a property. The possible values are: title, url, createdBy, containerName. Use the Prefer: include-unknown-enum-members request header to retrieve additional values defined in this evolvable enum, For People Connectors you can include : personAccount, personWebSite, personAnniversaries.'
`;

const betaOpenApiYaml = `components:
  schemas:
    microsoft.graph.externalConnectors.label:
      title: label
      enum:
        - title
        - url
        - iconUrl
      type: string
    microsoft.graph.externalConnectors.property:
      properties:
        labels:
          description: 'Specifies one or more well-known tags added against a property. The possible values are: title, url, createdBy, containerName, itemPath. Use the Prefer: include-unknown-enum-members request header to retrieve additional values defined in this evolvable enum, For People Connectors you can include : personAccount, personWebSite, personAnniversaries, personManager.'
`;

describe("scripts/update-graph-profile-schema", () => {
  test("extracts referenced enums and nested graph types from metadata", () => {
    const snapshot = parseGraphMetadataSnapshot(metadataXml, "2026-03-16T00:00:00.000Z");

    expect(snapshot.generatedAt).toBe("2026-03-16T00:00:00.000Z");
    expect(snapshot.graphVersion).toBe("beta");

    const enumNames = snapshot.enums.map((entry) => entry.name);
    expect(enumNames).toEqual(
      expect.arrayContaining([
        "emailType",
        "phoneType",
        "personRelationship",
        "skillProficiencyLevel",
        "personAnnualEventType",
        "physicalAddressType",
        "bodyType",
      ])
    );

    const emailType = snapshot.enums.find((entry) => entry.name === "emailType");
    expect(emailType?.namespace).toBe("microsoft.graph");
    expect(emailType?.members.map((member) => member.name)).toEqual(["work", "personal"]);

    const physicalAddress = snapshot.types.find((entry) => entry.name === "physicalAddress");
    expect(physicalAddress?.namespace).toBe("microsoft.graph");
    expect(physicalAddress?.properties.some((prop) => prop.name === "type" && prop.type === "microsoft.graph.physicalAddressType")).toBe(true);

    const workPosition = snapshot.types.find((entry) => entry.name === "workPosition");
    expect(workPosition?.baseType).toBe("itemFacet");
    expect(snapshot.types.some((entry) => entry.name === "positionDetail")).toBe(true);
    expect(snapshot.types.some((entry) => entry.name === "companyDetail")).toBe(true);
  });

  test("marks non-nullable properties as required", () => {
    const snapshot = parseGraphMetadataSnapshot(metadataXml, "2026-03-16T00:00:00.000Z");
    const itemEmail = snapshot.types.find((entry) => entry.name === "itemEmail");
    const itemPhone = snapshot.types.find((entry) => entry.name === "itemPhone");
    expect(itemEmail?.required).toEqual(["type"]);
    expect(itemPhone?.required).toEqual(["type"]);
  });

  test("throws when metadata contains no schemas", () => {
    expect(() => parseGraphMetadataSnapshot("<root />", "2026-03-16T00:00:00.000Z")).toThrow(/No schemas found/);
  });

  test("writes the parsed snapshot to the data folder", async () => {
    const snapshot = parseGraphMetadataSnapshot(metadataXml, "2026-03-16T00:00:00.000Z");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "cocogen-graph-profile-"));

    const outPath = await writeGraphProfileSnapshot(snapshot, cwd);
    const disk = JSON.parse(await readFile(outPath, "utf8")) as typeof snapshot;

    expect(outPath).toBe(path.join(cwd, "data", "graph-profile-schema.json"));
    expect(disk.generatedAt).toBe("2026-03-16T00:00:00.000Z");
    expect(disk.enums.find((entry) => entry.name === "personRelationship")?.members.map((member) => member.name)).toContain("manager");
  });

  test("extracts dynamic external connector labels from OpenAPI", () => {
    const labels = parseExternalConnectorLabelSets(v1OpenApiYaml);

    expect(labels.allLabels).toEqual(
      expect.arrayContaining(["title", "url", "createdBy", "containerName", "personAccount", "personWebSite"])
    );
    expect(labels.peopleLabels).toEqual(
      expect.arrayContaining(["personAccount", "personWebSite", "personAnniversaries"])
    );
  });

  test("builds a capability snapshot by comparing v1.0 and beta metadata", () => {
    const v1Snapshot = parseGraphMetadataSnapshot(v1MetadataXml, "2026-03-16T00:00:00.000Z", "v1.0");
    const betaSnapshot = parseGraphMetadataSnapshot(metadataXml, "2026-03-16T00:00:00.000Z", "beta");

    const capabilities = buildGraphCapabilitySnapshot(
      v1Snapshot,
      betaSnapshot,
      parseExternalConnectorLabelSets(v1OpenApiYaml),
      parseExternalConnectorLabelSets(betaOpenApiYaml),
      "2026-03-16T00:00:00.000Z"
    );

    expect(capabilities.peopleLabels.personAccount.minGraphApiVersion).toBe("v1.0");
    expect(capabilities.peopleLabels.personWebSite.minGraphApiVersion).toBe("v1.0");
    expect(capabilities.labels.personManager.minGraphApiVersion).toBe("beta");
    expect(capabilities.profileTypes.userAccountInformation.minGraphApiVersion).toBe("v1.0");
    expect(capabilities.connectionProperties.contentCategory?.minGraphApiVersion).toBe("beta");
    expect(capabilities.propertyTypes.principal?.minGraphApiVersion).toBe("v1.0");
  });

  test("writes the capability snapshot to the data folder", async () => {
    const v1Snapshot = parseGraphMetadataSnapshot(v1MetadataXml, "2026-03-16T00:00:00.000Z", "v1.0");
    const betaSnapshot = parseGraphMetadataSnapshot(metadataXml, "2026-03-16T00:00:00.000Z", "beta");
    const capabilities = buildGraphCapabilitySnapshot(
      v1Snapshot,
      betaSnapshot,
      parseExternalConnectorLabelSets(v1OpenApiYaml),
      parseExternalConnectorLabelSets(betaOpenApiYaml),
      "2026-03-16T00:00:00.000Z"
    );
    const cwd = await mkdtemp(path.join(os.tmpdir(), "cocogen-graph-capabilities-"));

    const outPath = await writeGraphCapabilitySnapshot(capabilities, cwd);
    const disk = JSON.parse(await readFile(outPath, "utf8")) as typeof capabilities;

    expect(outPath).toBe(path.join(cwd, "data", "graph-capabilities.json"));
    expect(disk.peopleLabels.personWebSite.minGraphApiVersion).toBe("v1.0");
    expect(disk.labels.personManager.minGraphApiVersion).toBe("beta");
    expect(disk.connectionProperties.contentCategory?.minGraphApiVersion).toBe("beta");
  });
});