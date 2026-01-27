import { describe, expect, test, vi } from "vitest";

import {
  PEOPLE_LABEL_DEFINITIONS,
  getBlockedPeopleLabel,
  getPeopleLabelDefinition,
  getPeopleLabelInfo,
  isSupportedPeopleLabel,
  supportedPeopleLabels,
  SUPPORTED_PEOPLE_LABELS,
} from "../../src/people/label-registry.js";

describe("people label registry", () => {
  test("personEmails enforces collection limit", () => {
    const info = getPeopleLabelInfo("personEmails");
    expect(info.collectionLimit).toBe(3);
  });

  test("personEmails requires type", () => {
    const def = getPeopleLabelDefinition("personEmails");
    expect(def?.requiredFields).toContain("type");
  });

  test("personWebSite resolves to personWebsite", () => {
    const def = getPeopleLabelDefinition("personWebSite");
    expect(def?.graphTypeName).toBe("personWebsite");
  });

  test("blocked labels include actionable messaging", () => {
    const blocked = getBlockedPeopleLabel("personManager");
    expect(blocked?.message).toContain("blocked");
  });

  test("supported labels set is populated", () => {
    expect(SUPPORTED_PEOPLE_LABELS.has("personAccount")).toBe(true);
  });

  test("supportedPeopleLabels lists raw labels", () => {
    const labels = supportedPeopleLabels();
    expect(labels).toContain("personAccount");
    expect(labels).toContain("personNote");
  });

  test("isSupportedPeopleLabel rejects unknown", () => {
    expect(isSupportedPeopleLabel("notALabel")).toBe(false);
  });

  test("isSupportedPeopleLabel accepts known labels", () => {
    expect(isSupportedPeopleLabel("personAccount")).toBe(true);
    expect(isSupportedPeopleLabel("personSkills")).toBe(true);
  });

  test("getPeopleLabelInfo throws for missing labels", () => {
    expect(() => getPeopleLabelInfo("missingLabel")).toThrow("Missing Graph type mapping");
  });

  test("getPeopleLabelInfo returns correct payload type", () => {
    const singleInfo = getPeopleLabelInfo("personAccount");
    expect(singleInfo.payloadType).toBe("string");

    const collectionInfo = getPeopleLabelInfo("personSkills");
    expect(collectionInfo.payloadType).toBe("stringCollection");
  });

  test("getPeopleLabelInfo includes required fields", () => {
    const info = getPeopleLabelInfo("personAccount");
    expect(info.requiredFields).toBeInstanceOf(Array);
  });

  test("getPeopleLabelInfo omits collectionLimit when not defined", () => {
    const info = getPeopleLabelInfo("personAccount");
    expect(info.collectionLimit).toBeUndefined();
  });

  test("getPeopleLabelDefinition returns undefined for unknown labels", () => {
    const def = getPeopleLabelDefinition("unknownLabel");
    expect(def).toBeUndefined();
  });

  test("getBlockedPeopleLabel returns undefined for non-blocked labels", () => {
    const blocked = getBlockedPeopleLabel("personAccount");
    expect(blocked).toBeUndefined();
  });

  test("getBlockedPeopleLabel returns all blocked labels", () => {
    expect(getBlockedPeopleLabel("personManager")).toBeTruthy();
    expect(getBlockedPeopleLabel("personAssistants")).toBeTruthy();
    expect(getBlockedPeopleLabel("personColleagues")).toBeTruthy();
    expect(getBlockedPeopleLabel("personAlternateContacts")).toBeTruthy();
    expect(getBlockedPeopleLabel("personEmergencyContacts")).toBeTruthy();
  });

  test("getPeopleLabelInfo omits collection limit when constraint not present", () => {
    const info = getPeopleLabelInfo("personNote");
    expect(info.collectionLimit).toBeUndefined();
  });

  test("getPeopleLabelInfo defaults payload type when missing", () => {
    const label = "customLabel";
    const def = {
      label,
      payloadTypes: [],
      graphTypeName: "userAccountInformation" as const,
      planTypeName: "userAccountInformation",
      schemaTypeName: "userAccountInformation",
      schema: getPeopleLabelDefinition("personAccount")!.schema,
      requiredFields: [],
      constraints: {},
    };
    PEOPLE_LABEL_DEFINITIONS.set(label, def);
    SUPPORTED_PEOPLE_LABELS.add(label);

    const info = getPeopleLabelInfo(label);
    expect(info.payloadType).toBe("string");

    PEOPLE_LABEL_DEFINITIONS.delete(label);
    SUPPORTED_PEOPLE_LABELS.delete(label);
  });

  test("module initialization throws when profile schema is missing", async () => {
    vi.resetModules();
    vi.doMock("../../src/people/profile-schema.js", () => ({
      getProfilePlanTypeNameByLabel: () => undefined,
      resolveProfileTypeName: () => undefined,
      getProfileType: () => undefined,
    }));

    await expect(import("../../src/people/label-registry.js")).rejects.toThrow(/missing type/i);

    vi.resetModules();
  });
});
