import { describe, expect, test } from "vitest";

import { getProfileEnum, graphProfileSchema, isProfileEnum } from "../../src/people/profile-schema.js";

describe("people/profile-schema snapshot", () => {
  test("includes extracted Graph enums with members", () => {
    expect(graphProfileSchema.enums.length).toBeGreaterThan(0);

    const emailType = getProfileEnum("emailType");
    const personRelationship = getProfileEnum("personRelationship");
    const physicalAddressType = getProfileEnum("physicalAddressType");

    expect(emailType?.members.map((member) => member.name)).toContain("work");
    expect(personRelationship?.members.map((member) => member.name)).toContain("manager");
    expect(physicalAddressType?.members.map((member) => member.name)).toContain("business");
    expect(isProfileEnum("emailType")).toBe(true);
    expect(isProfileEnum("personRelationship")).toBe(true);
    expect(isProfileEnum("userAccountInformation")).toBe(false);
  });
});