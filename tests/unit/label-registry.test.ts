import { describe, expect, test } from "vitest";

import {
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

  test("getPeopleLabelInfo throws for missing labels", () => {
    expect(() => getPeopleLabelInfo("missingLabel")).toThrow("Missing Graph type mapping");
  });
});
