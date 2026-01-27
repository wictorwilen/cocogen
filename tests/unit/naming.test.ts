import { describe, expect, test } from "vitest";

import {
  toCsIdentifier,
  toCsNamespace,
  toCsPascal,
  toCsPropertyName,
  toCsType,
  toSchemaFolderName,
  toTsIdentifier,
  toTsSchemaFolderName,
  toTsType,
} from "../../src/init/naming.js";

describe("naming", () => {
  describe("toTsType", () => {
    test("converts string types", () => {
      expect(toTsType("string")).toBe("string");
      expect(toTsType("dateTime")).toBe("string");
    });

    test("converts boolean types", () => {
      expect(toTsType("boolean")).toBe("boolean");
    });

    test("converts number types", () => {
      expect(toTsType("int64")).toBe("number");
      expect(toTsType("double")).toBe("number");
    });

    test("converts collection types", () => {
      expect(toTsType("stringCollection")).toBe("string[]");
      expect(toTsType("int64Collection")).toBe("number[]");
      expect(toTsType("doubleCollection")).toBe("number[]");
      expect(toTsType("dateTimeCollection")).toBe("string[]");
    });

    test("converts principal types", () => {
      expect(toTsType("principal")).toBe("Principal");
      expect(toTsType("principalCollection")).toBe("Principal[]");
    });

    test("returns unknown for unrecognized types", () => {
      expect(toTsType("unknown" as any)).toBe("unknown");
    });
  });

  describe("toCsType", () => {
    test("converts string types", () => {
      expect(toCsType("string")).toBe("string");
    });

    test("converts boolean types", () => {
      expect(toCsType("boolean")).toBe("bool");
    });

    test("converts number types", () => {
      expect(toCsType("int64")).toBe("long");
      expect(toCsType("double")).toBe("double");
    });

    test("converts dateTime types", () => {
      expect(toCsType("dateTime")).toBe("DateTimeOffset");
    });

    test("converts collection types", () => {
      expect(toCsType("stringCollection")).toBe("List<string>");
      expect(toCsType("int64Collection")).toBe("List<long>");
      expect(toCsType("doubleCollection")).toBe("List<double>");
      expect(toCsType("dateTimeCollection")).toBe("List<DateTimeOffset>");
    });

    test("converts principal types", () => {
      expect(toCsType("principal")).toBe("Principal");
      expect(toCsType("principalCollection")).toBe("List<Principal>");
    });

    test("returns object for unrecognized types", () => {
      expect(toCsType("unknown" as any)).toBe("object");
    });
  });

  describe("toCsIdentifier", () => {
    test("converts simple names to PascalCase", () => {
      expect(toCsIdentifier("test")).toBe("Test");
      expect(toCsIdentifier("myProperty")).toBe("MyProperty");
    });

    test("handles snake_case", () => {
      expect(toCsIdentifier("my_property")).toBe("MyProperty");
      expect(toCsIdentifier("test_value_name")).toBe("TestValueName");
    });

    test("handles kebab-case", () => {
      expect(toCsIdentifier("my-property")).toBe("MyProperty");
      expect(toCsIdentifier("test-value-name")).toBe("TestValueName");
    });

    test("handles spaces", () => {
      expect(toCsIdentifier("my property")).toBe("MyProperty");
      expect(toCsIdentifier("test value name")).toBe("TestValueName");
    });

    test("returns Item for empty input", () => {
      expect(toCsIdentifier("")).toBe("Item");
      expect(toCsIdentifier("---")).toBe("Item");
      expect(toCsIdentifier("   ")).toBe("Item");
    });
  });

  describe("toCsPascal", () => {
    test("capitalizes first letter", () => {
      expect(toCsPascal("test")).toBe("Test");
      expect(toCsPascal("value")).toBe("Value");
    });

    test("handles already capitalized input", () => {
      expect(toCsPascal("Test")).toBe("Test");
      expect(toCsPascal("Value")).toBe("Value");
    });

    test("returns Value for empty input", () => {
      expect(toCsPascal("")).toBe("Value");
    });
  });

  describe("toCsPropertyName", () => {
    test("converts to PascalCase", () => {
      const used = new Set<string>();
      expect(toCsPropertyName("test", "Item", used)).toBe("Test");
      expect(used.has("test")).toBe(true);
    });

    test("avoids collision with item type name", () => {
      const used = new Set<string>();
      expect(toCsPropertyName("item", "Item", used)).toBe("ItemValue");
      expect(used.has("itemvalue")).toBe(true);
    });

    test("handles name conflicts with suffix", () => {
      const used = new Set<string>(["test"]);
      expect(toCsPropertyName("test", "Item", used)).toBe("Test1");
      expect(used.has("test1")).toBe(true);
    });

    test("increments suffix for multiple conflicts", () => {
      const used = new Set<string>(["test", "test1", "test2"]);
      expect(toCsPropertyName("test", "Item", used)).toBe("Test3");
      expect(used.has("test3")).toBe(true);
    });
  });

  describe("toTsIdentifier", () => {
    test("converts to PascalCase", () => {
      expect(toTsIdentifier("test")).toBe("Test");
      expect(toTsIdentifier("myProperty")).toBe("MyProperty");
    });

    test("handles special characters", () => {
      expect(toTsIdentifier("test@property")).toBe("TestProperty");
      expect(toTsIdentifier("value#name")).toBe("ValueName");
    });

    test("sanitizes invalid identifiers", () => {
      expect(toTsIdentifier("123test")).toBe("_123test");
      expect(toTsIdentifier("test")).toBe("Test");
    });

    test("returns Item for empty input", () => {
      expect(toTsIdentifier("")).toBe("Item");
      expect(toTsIdentifier("!!!")).toBe("Item");
    });
  });

  describe("toSchemaFolderName", () => {
    test("converts connection name to folder name", () => {
      expect(toSchemaFolderName("my connection")).toBe("MyConnection");
      expect(toSchemaFolderName("test-connector")).toBe("TestConnector");
    });

    test("returns Schema for empty/undefined input", () => {
      expect(toSchemaFolderName(undefined)).toBe("Schema");
      expect(toSchemaFolderName("")).toBe("Schema");
      expect(toSchemaFolderName("   ")).toBe("Schema");
    });
  });

  describe("toTsSchemaFolderName", () => {
    test("converts connection name to lowercase folder name", () => {
      expect(toTsSchemaFolderName("my connection")).toBe("MyConnection");
      expect(toTsSchemaFolderName("test-connector")).toBe("TestConnector");
    });

    test("returns schema for empty/undefined input", () => {
      expect(toTsSchemaFolderName(undefined)).toBe("schema");
      expect(toTsSchemaFolderName("")).toBe("schema");
      expect(toTsSchemaFolderName("   ")).toBe("schema");
    });
  });

  describe("toCsNamespace", () => {
    test("converts simple project names", () => {
      expect(toCsNamespace("MyProject")).toBe("MyProject");
      expect(toCsNamespace("test")).toBe("Test");
    });

    test("handles dotted namespaces", () => {
      expect(toCsNamespace("Company.Project")).toBe("Company.Project");
      expect(toCsNamespace("My.Company.Project")).toBe("My.Company.Project");
    });

    test("converts spaces and hyphens to underscores", () => {
      expect(toCsNamespace("my project")).toBe("MyProject");
      expect(toCsNamespace("test-connector")).toBe("TestConnector");
    });

    test("removes invalid characters", () => {
      expect(toCsNamespace("my@project#name")).toBe("Myprojectname");
    });

    test("returns Connector for invalid input", () => {
      expect(toCsNamespace("")).toBe("Connector");
      expect(toCsNamespace("...")).toBe("Connector");
      expect(toCsNamespace("@#$")).toBe("Connector");
    });
  });
});
