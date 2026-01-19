import { describe, expect, test } from "vitest";

import type { ConnectorIr } from "../../src/ir.js";
import { validateIr } from "../../src/validate/validator.js";

function baseIr(): ConnectorIr {
  return {
    connection: {
      graphApiVersion: "v1.0",
    },
    item: {
      typeName: "Item",
      idPropertyName: "id",
    },
    properties: [
      {
        name: "id",
        type: "string",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"] },
      },
    ],
  };
}

describe("validateIr", () => {
  test("accepts a minimal valid IR", () => {
    const issues = validateIr(baseIr());
    expect(issues).toEqual([]);
  });

  test("errors when @coco.id is not a string", () => {
    const ir = baseIr();
    ir.properties = [
      {
        name: "id",
        type: "int64",
        labels: [],
        aliases: [],
        search: {},
        source: { csvHeaders: ["id"] },
      },
    ];

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("must be a string"))).toBe(true);
  });

  test("errors on duplicate property names", () => {
    const ir = baseIr();
    ir.properties.push({
      name: "id",
      type: "string",
      labels: [],
      aliases: [],
      search: {},
      source: { csvHeaders: ["id"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("Duplicate property name"))).toBe(true);
  });

  test("errors when connectionId contains non-alphanumeric characters", () => {
    const ir = baseIr();
    ir.connection = { graphApiVersion: "v1.0", connectionId: "bad-id" };

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("connectionId"))).toBe(true);
  });

  test("errors on overly long property names", () => {
    const ir = baseIr();
    ir.properties.push({
      name: "a".repeat(33),
      type: "string",
      labels: [],
      aliases: [],
      search: {},
      source: { csvHeaders: ["long"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("too long"))).toBe(true);
  });

  test("errors on non-alphanumeric property names", () => {
    const ir = baseIr();
    ir.properties.push({
      name: "bad-name",
      type: "string",
      labels: [],
      aliases: [],
      search: {},
      source: { csvHeaders: ["bad"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("alphanumeric"))).toBe(true);
  });

  test("errors on invalid schema property names", () => {
    const ir = baseIr();
    ir.properties.push({
      name: "bad-name",
      type: "string",
      labels: [],
      aliases: [],
      search: {},
      source: { csvHeaders: ["bad-name"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("alphanumeric"))).toBe(true);
  });

  test("errors when searchable is applied to non-string", () => {
    const ir = baseIr();
    ir.properties.push({
      name: "count",
      type: "int64",
      labels: [],
      aliases: [],
      search: { searchable: true },
      source: { csvHeaders: ["count"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("marked searchable"))).toBe(true);
  });

  test("errors when principal is marked searchable", () => {
    const ir = baseIr();
    ir.properties.push({
      name: "owner",
      type: "principal",
      labels: [],
      aliases: [],
      search: { searchable: true },
      source: { csvHeaders: ["owner"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("principal"))).toBe(true);
  });

  test("errors when property count exceeds 128", () => {
    const ir = baseIr();
    ir.properties = Array.from({ length: 129 }, (_, index) => ({
      name: `p${index}`,
      type: "string",
      labels: [],
      aliases: [],
      search: {},
      source: { csvHeaders: [`p${index}`] },
    }));

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("Too many schema properties"))).toBe(true);
  });

  test("errors when both searchable and refinable", () => {
    const ir = baseIr();
    ir.properties.push({
      name: "title",
      type: "string",
      labels: [],
      aliases: [],
      search: { searchable: true, refinable: true },
      source: { csvHeaders: ["title"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("both searchable and refinable"))).toBe(true);
  });

  test("people connectors require exactly one personAccount label", () => {
    const ir = baseIr();
    ir.connection = { graphApiVersion: "beta", contentCategory: "people" };

    const issues = validateIr(ir);
    expect(
      issues.some(
        (i) => i.severity === "error" && i.message.includes("require exactly one property labeled 'personAccount'")
      )
    ).toBe(true);

    ir.properties.push({
      name: "account",
      type: "string",
      labels: ["personAccount"],
      aliases: [],
      search: {},
      source: { csvHeaders: ["account"] },
      personEntity: {
        entity: "userAccountInformation",
        fields: [
          {
            path: "userPrincipalName",
            source: { csvHeaders: ["account"], explicit: true },
          },
        ],
      },
    });

    const issues2 = validateIr(ir);
    expect(issues2.some((i) => i.severity === "error" && i.message.includes("personAccount"))).toBe(false);
  });

  test("people connectors warn when search flags are used on people labels", () => {
    const ir = baseIr();
    ir.connection = { graphApiVersion: "beta", contentCategory: "people" };
    ir.properties.push({
      name: "account",
      type: "string",
      labels: ["personAccount"],
      aliases: [],
      search: { queryable: true },
      source: { csvHeaders: ["account"] },
      personEntity: {
        entity: "userAccountInformation",
        fields: [
          {
            path: "userPrincipalName",
            source: { csvHeaders: ["account"], explicit: true },
          },
        ],
      },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("@coco.search"))).toBe(true);
  });

  test("people connectors do not warn for search flags on unlabeled properties", () => {
    const ir = baseIr();
    ir.connection = { graphApiVersion: "beta", contentCategory: "people" };
    ir.properties.push({
      name: "customField",
      type: "string",
      labels: [],
      aliases: [],
      search: { queryable: true },
      source: { csvHeaders: ["customField"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("@coco.search"))).toBe(false);
  });

  test("people connectors warn when entity mappings are missing", () => {
    const ir = baseIr();
    ir.connection = { graphApiVersion: "beta", contentCategory: "people" };
    ir.properties.push({
      name: "awards",
      type: "stringCollection",
      labels: ["personAwards"],
      aliases: [],
      search: {},
      source: { csvHeaders: ["Awards"], explicit: true },
    });

    const issues = validateIr(ir);
    expect(
      issues.some((i) => i.severity === "warning" && i.message.includes("missing @coco.source"))
    ).toBe(true);
  });

  test("people connectors do not warn when entity mappings exist", () => {
    const ir = baseIr();
    ir.connection = { graphApiVersion: "beta", contentCategory: "people" };
    ir.properties.push({
      name: "awards",
      type: "stringCollection",
      labels: ["personAwards"],
      aliases: [],
      search: {},
      source: { csvHeaders: ["Awards"], explicit: true },
      personEntity: {
        entity: "personAward",
        fields: [
          {
            path: "displayName",
            source: { csvHeaders: ["Awards"], explicit: true },
          },
        ],
      },
    });

    const issues = validateIr(ir);
    expect(
      issues.some((i) => i.severity === "warning" && i.message.includes("missing @coco.source"))
    ).toBe(false);
  });

  test("errors when id property is missing from properties list", () => {
    const ir = baseIr();
    ir.item.idPropertyName = "missing";

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("id property"))).toBe(true);
  });

  test("errors when content property is missing or not string", () => {
    const ir = baseIr();
    ir.item = { ...ir.item, contentPropertyName: "body" };

    const issuesMissing = validateIr(ir);
    expect(issuesMissing.some((i) => i.severity === "error" && i.message.includes("content property"))).toBe(true);

    ir.properties.push({
      name: "body",
      type: "int64",
      labels: [],
      aliases: [],
      search: {},
      source: { csvHeaders: ["body"] },
    });

    const issuesType = validateIr(ir);
    expect(issuesType.some((i) => i.severity === "error" && i.message.includes("@coco.content"))).toBe(true);
  });

  test("errors when content property has labels, aliases, or search flags", () => {
    const ir = baseIr();
    ir.item = { ...ir.item, contentPropertyName: "body" };
    ir.properties.push({
      name: "body",
      type: "string",
      labels: ["title"],
      aliases: ["fullText"],
      search: { searchable: true },
      source: { csvHeaders: ["body"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("cannot have labels"))).toBe(true);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("cannot have aliases"))).toBe(true);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("cannot use @coco.search"))).toBe(true);
  });

  test("errors when semantic labels are not retrievable", () => {
    const ir = baseIr();
    ir.properties.push({
      name: "productName",
      type: "string",
      labels: ["title"],
      aliases: [],
      search: { searchable: true },
      source: { csvHeaders: ["productName"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("not retrievable"))).toBe(true);
  });

  test("errors when semantic label types do not match", () => {
    const ir = baseIr();
    ir.properties.push({
      name: "createdAt",
      type: "string",
      labels: ["createdDateTime"],
      aliases: [],
      search: { retrievable: true },
      source: { csvHeaders: ["createdAt"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("requires type"))).toBe(true);
  });

  test("people connectors do not support externalItem.content", () => {
    const ir = baseIr();
    ir.connection = { graphApiVersion: "beta", contentCategory: "people" };
    ir.item = { ...ir.item, contentPropertyName: "bio" };

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("do not support externalItem.content"))).toBe(true);
  });

  test("people connectors require non-empty profileSource webUrl", () => {
    const ir = baseIr();
    ir.connection = {
      graphApiVersion: "beta",
      contentCategory: "people",
      profileSource: { webUrl: " " },
    };

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("profileSource"))).toBe(true);
  });

  test("people labels require specific types", () => {
    const ir = baseIr();
    ir.connection = { graphApiVersion: "beta", contentCategory: "people" };
    ir.properties.push({
      name: "account",
      type: "string",
      labels: ["personAccount"],
      aliases: [],
      search: {},
      source: { csvHeaders: ["account"] },
      personEntity: {
        entity: "userAccountInformation",
        fields: [
          {
            path: "userPrincipalName",
            source: { csvHeaders: ["account"], explicit: true },
          },
        ],
      },
    });

    ir.properties.push({
      name: "emails",
      type: "string",
      labels: ["personEmails"],
      aliases: [],
      search: {},
      source: { csvHeaders: ["emails"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("requires type"))).toBe(true);
  });

  test("people connectors reject unsupported people labels", () => {
    const ir = baseIr();
    ir.connection = { graphApiVersion: "beta", contentCategory: "people" };
    ir.properties.push({
      name: "manager",
      type: "string",
      labels: ["personManager"],
      aliases: [],
      search: {},
      source: { csvHeaders: ["manager"] },
    });

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("not supported"))).toBe(true);
  });

  test("profileSource is invalid for non-people connectors", () => {
    const ir = baseIr();
    ir.connection = {
      graphApiVersion: "v1.0",
      profileSource: { webUrl: "https://contoso.com" },
    };

    const issues = validateIr(ir);
    expect(issues.some((i) => i.severity === "error" && i.message.includes("profileSource"))).toBe(true);
  });
});
