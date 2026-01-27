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

  test("resolveProfileTypeName returns original name when no alias exists", () => {
    expect(resolveProfileTypeName("itemEmail")).toBe("itemEmail");
    expect(resolveProfileTypeName("unknownType")).toBe("unknownType");
  });

  test("getProfileType returns known types", () => {
    const type = getProfileType("itemEmail");
    expect(type?.name).toBe("itemEmail");
    expect(type?.properties.length).toBeGreaterThan(0);
  });

  test("getProfileType resolves aliases", () => {
    const type = getProfileType("webSite");
    expect(type?.name).toBe("personWebsite");
  });

  test("getProfileType returns undefined for unknown types", () => {
    const type = getProfileType("nonExistentType");
    expect(type).toBeUndefined();
  });

  test("getProfileTypeByLabel resolves mapped types", () => {
    const type = getProfileTypeByLabel("personEmails");
    expect(type?.name).toBe("itemEmail");
  });

  test("getProfileTypeByLabel returns undefined for unknown labels", () => {
    const type = getProfileTypeByLabel("unknownLabel");
    expect(type).toBeUndefined();
  });

  test("getProfilePlanTypeNameByLabel returns raw label mapping", () => {
    expect(getProfilePlanTypeNameByLabel("personAnniversaries")).toBe("personAnniversary");
  });

  test("getProfilePlanTypeNameByLabel returns undefined for unknown labels", () => {
    expect(getProfilePlanTypeNameByLabel("unknownLabel")).toBeUndefined();
  });

  test("getProfileTypeNameByLabel resolves aliases", () => {
    expect(getProfileTypeNameByLabel("personAnniversaries")).toBe("personAnnualEvent");
  });

  test("getProfileTypeNameByLabel returns undefined for unknown labels", () => {
    expect(getProfileTypeNameByLabel("unknownLabel")).toBeUndefined();
  });
});
