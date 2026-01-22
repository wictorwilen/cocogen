import { describe, expect, test } from "vitest";

import {
  getProfilePlanTypeNameByLabel,
  getProfileType,
  getProfileTypeByLabel,
  getProfileTypeNameByLabel,
  resolveProfileTypeName,
} from "../../src/people/profile-schema.js";

describe("graph profile schema", () => {
  test("resolveProfileTypeName maps aliases", () => {
    expect(resolveProfileTypeName("webSite")).toBe("personWebsite");
  });

  test("getProfileType returns known types", () => {
    const type = getProfileType("itemEmail");
    expect(type?.name).toBe("itemEmail");
    expect(type?.properties.length).toBeGreaterThan(0);
  });

  test("getProfileTypeByLabel resolves mapped types", () => {
    const type = getProfileTypeByLabel("personEmails");
    expect(type?.name).toBe("itemEmail");
  });

  test("getProfilePlanTypeNameByLabel returns raw label mapping", () => {
    expect(getProfilePlanTypeNameByLabel("personAnniversaries")).toBe("personAnniversary");
  });

  test("getProfileTypeNameByLabel resolves aliases", () => {
    expect(getProfileTypeNameByLabel("personAnniversaries")).toBe("personAnnualEvent");
  });
});
