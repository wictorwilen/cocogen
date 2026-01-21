import { describe, expect, test } from "vitest";

import {
  getBlockedPeopleLabel,
  getPeopleLabelDefinition,
  getPeopleLabelInfo,
  SUPPORTED_PEOPLE_LABELS,
} from "../../src/people/label-registry.js";

describe("people label registry", () => {
  test("personEmails enforces collection limit", () => {
    const info = getPeopleLabelInfo("personEmails");
    expect(info.collectionLimit).toBe(3);
  });

  test("personAnniversaries maps to personAnnualEvent and requires type", () => {
    const def = getPeopleLabelDefinition("personAnniversaries");
    expect(def?.graphTypeName).toBe("personAnnualEvent");
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
});
