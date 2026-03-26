import { describe, expect, test } from "vitest";

import {
  getConnectionPropertyCapability,
  getLabelCapability,
  getPeopleLabelCapability,
  getPropertyTypeCapability,
  graphCapabilities,
  maxGraphApiVersion,
} from "../../src/graph/capabilities.js";

describe("graph capabilities snapshot", () => {
  test("loads the capability snapshot", () => {
    expect(graphCapabilities.generatedAt).toBeTruthy();
  });

  test("exposes connection property capability metadata", () => {
    expect(getConnectionPropertyCapability("contentCategory")?.minGraphApiVersion).toBe("beta");
  });

  test("exposes property type capability metadata", () => {
    expect(getPropertyTypeCapability("principal")?.minGraphApiVersion).toBe("beta");
  });

  test("exposes people label capability metadata", () => {
    expect(getPeopleLabelCapability("personAccount")?.graphTypeName).toBe("userAccountInformation");
  });

  test("exposes dynamic label capability metadata", () => {
    expect(getLabelCapability("personWebSite")?.kind).toBe("people");
  });

  test("maxGraphApiVersion prefers beta when any requirement is beta", () => {
    expect(maxGraphApiVersion("v1.0", "beta")).toBe("beta");
    expect(maxGraphApiVersion("v1.0", undefined)).toBe("v1.0");
  });
});