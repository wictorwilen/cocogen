import { describe, expect, test } from "vitest";

import type { DecoratorContext, Model, ModelProperty } from "@typespec/compiler";

import {
  $aliases,
  $connection,
  $content,
  $description,
  $id,
  $item,
  $label,
  $name,
  $noSource,
  $profileSource,
  $search,
  $source,
} from "../../src/typespec/decorators.js";
import {
  COCOGEN_STATE_CONNECTION_SETTINGS,
  COCOGEN_STATE_CONTENT_PROPERTIES,
  COCOGEN_STATE_ID_SETTINGS,
  COCOGEN_STATE_ID_PROPERTIES,
  COCOGEN_STATE_ITEM_MODELS,
  COCOGEN_STATE_PROFILE_SOURCE_SETTINGS,
  COCOGEN_STATE_PROPERTY_ALIASES,
  COCOGEN_STATE_PROPERTY_DESCRIPTIONS,
  COCOGEN_STATE_PROPERTY_LABELS,
  COCOGEN_STATE_PROPERTY_NAME_OVERRIDES,
  COCOGEN_STATE_PROPERTY_NO_SOURCE,
  COCOGEN_STATE_PROPERTY_PERSON_FIELDS,
  COCOGEN_STATE_PROPERTY_SEARCH,
  COCOGEN_STATE_PROPERTY_SOURCE,
} from "../../src/typespec/state.js";

type ProgramMock = {
  stateMap: (key: symbol) => Map<any, any>;
  stateSet: (key: symbol) => Set<any>;
  _stateMaps: Map<symbol, Map<any, any>>;
  _stateSets: Map<symbol, Set<any>>;
};

function createProgramMock(): ProgramMock {
  const stateMaps = new Map<symbol, Map<any, any>>();
  const stateSets = new Map<symbol, Set<any>>();
  return {
    stateMap(key: symbol): Map<any, any> {
      const existing = stateMaps.get(key);
      if (existing) return existing;
      const created = new Map<any, any>();
      stateMaps.set(key, created);
      return created;
    },
    stateSet(key: symbol): Set<any> {
      const existing = stateSets.get(key);
      if (existing) return existing;
      const created = new Set<any>();
      stateSets.set(key, created);
      return created;
    },
    _stateMaps: stateMaps,
    _stateSets: stateSets,
  };
}

function createContext(): DecoratorContext {
  const program = createProgramMock();
  return { program } as unknown as DecoratorContext;
}

function createModel(properties: Record<string, unknown> = {}): Model {
  const entries = new Map<string, any>();
  for (const [key, value] of Object.entries(properties)) {
    entries.set(key, { type: { value } });
  }
  return { kind: "Model", properties: entries } as unknown as Model;
}

function createProperty(name: string): ModelProperty {
  return { kind: "ModelProperty", name } as unknown as ModelProperty;
}

describe("TypeSpec decorators", () => {
  test("registers item, id, content, and search flags", () => {
    const context = createContext();
    const program = (context.program as unknown as ProgramMock);
    const model = createModel();
    const prop = createProperty("id");

    $item(context, model);
    $id(context, prop);
    $content(context, prop);
    $search(context, prop, { searchable: true });

    expect(program.stateSet(COCOGEN_STATE_ITEM_MODELS).has(model)).toBe(true);
    expect(program.stateMap(COCOGEN_STATE_ID_PROPERTIES).get(prop)).toBe(true);
    expect(program.stateMap(COCOGEN_STATE_CONTENT_PROPERTIES).get(prop)).toBe(true);
    expect(program.stateMap(COCOGEN_STATE_PROPERTY_SEARCH).get(prop)).toEqual({ searchable: true });
  });

  test("captures id settings", () => {
    const context = createContext();
    const program = (context.program as unknown as ProgramMock);
    const prop = createProperty("id");

    $id(context, prop, { encoding: "hash" });

    expect(program.stateMap(COCOGEN_STATE_ID_SETTINGS).get(prop)).toEqual({ encoding: "hash" });
  });
  test("captures labels, aliases, description, and name overrides", () => {
    const context = createContext();
    const program = (context.program as unknown as ProgramMock);
    const prop = createProperty("title");

    $label(context, prop, { value: "title" } as unknown as string);
    $label(context, prop, "subtitle");
    $aliases(context, prop, "headline");
    $aliases(context, prop, "display");
    $description(context, prop, { value: "A title" } as unknown as string);
    $name(context, prop, { value: "Title" } as unknown as string);

    expect(program.stateMap(COCOGEN_STATE_PROPERTY_LABELS).get(prop)).toEqual(["title", "subtitle"]);
    expect(program.stateMap(COCOGEN_STATE_PROPERTY_ALIASES).get(prop)).toEqual(["headline", "display"]);
    expect(program.stateMap(COCOGEN_STATE_PROPERTY_DESCRIPTIONS).get(prop)).toBe("A title");
    expect(program.stateMap(COCOGEN_STATE_PROPERTY_NAME_OVERRIDES).get(prop)).toBe("Title");
  });

  test("ignores invalid targets and non-string values", () => {
    const context = createContext();
    const program = (context.program as unknown as ProgramMock);
    const nonProperty = createModel();
    const nonModel = createProperty("notModel") as unknown as Model;
    const prop = createProperty("title");

    $item(context, nonModel);
    $label(context, nonProperty as unknown as ModelProperty, "title");
    $label(context, prop, { value: 42 } as unknown as string);
    $label(context, prop, { text: "ignored" } as unknown as string);
    $aliases(context, prop, { value: 123 } as unknown as string);
    $description(context, prop, null as unknown as string);
    $name(context, prop, { value: 99 } as unknown as string);
    $connection(context, nonModel, { name: "Ignored" } as unknown as any);
    $profileSource(context, nonModel, { webUrl: "https://ignored" } as unknown as any);

    expect(program.stateMap(COCOGEN_STATE_PROPERTY_LABELS).get(prop)).toBeUndefined();
  });

  test("normalizes connection settings from model literals", () => {
    const context = createContext();
    const program = (context.program as unknown as ProgramMock);
    const target = createModel();
    const settings = createModel({
      name: "Connector Name",
      connectionId: "connectorid",
      connectionDescription: "Connector description",
      contentCategory: "crm",
      ignored: undefined,
    });

    $connection(context, target, settings as unknown as any);

    expect(program.stateMap(COCOGEN_STATE_CONNECTION_SETTINGS).get(target)).toEqual({
      name: "Connector Name",
      connectionId: "connectorid",
      connectionDescription: "Connector description",
      contentCategory: "crm",
    });
  });

  test("skips decorators when target is not a ModelProperty", () => {
    const context = createContext();
    const program = (context.program as unknown as ProgramMock);
    const nonProperty = createModel();

    $id(context, nonProperty as unknown as ModelProperty);
    $aliases(context, nonProperty as unknown as ModelProperty, "alias");
    $description(context, nonProperty as unknown as ModelProperty, "desc");
    $name(context, nonProperty as unknown as ModelProperty, "Name");
    $search(context, nonProperty as unknown as ModelProperty, { queryable: true });
    $content(context, nonProperty as unknown as ModelProperty);
    $source(context, nonProperty as unknown as ModelProperty, "col");
    $noSource(context, nonProperty as unknown as ModelProperty);

    expect(program._stateMaps.size).toBe(0);
    expect(program._stateSets.size).toBe(0);
  });

  test("normalizes profile source settings from object literals", () => {
    const context = createContext();
    const program = (context.program as unknown as ProgramMock);
    const target = createModel();

    $profileSource(context, target, {
      webUrl: { value: "https://example.com" },
      displayName: { value: "Directory" },
      priority: { value: "last" },
    } as unknown as any);

    expect(program.stateMap(COCOGEN_STATE_PROFILE_SOURCE_SETTINGS).get(target)).toEqual({
      webUrl: "https://example.com",
      displayName: "Directory",
      priority: "last",
    });
  });

  test("handles source mappings for people entities and CSV overrides", () => {
    const context = createContext();
    const program = (context.program as unknown as ProgramMock);

    const personProp = createProperty("workPosition");
    $source(context, personProp, "job title", "detail.jobTitle");
    $source(context, personProp, "company", "detail.company.displayName");

    const personFields = program.stateMap(COCOGEN_STATE_PROPERTY_PERSON_FIELDS).get(personProp) as Array<{
      path: string;
      source: unknown;
    }>;
    expect(personFields).toEqual([
      { path: "detail.jobTitle", source: "job title" },
      { path: "detail.company.displayName", source: "company" },
    ]);

    const entityProp = createProperty("company");
    $source(context, entityProp, { csv: "company" }, { value: "detail.company.displayName" } as unknown as string);
    const entityFields = program.stateMap(COCOGEN_STATE_PROPERTY_PERSON_FIELDS).get(entityProp) as Array<{
      path: string;
      source: unknown;
    }>;
    expect(entityFields[0]).toEqual({ path: "detail.company.displayName", source: { csv: "company" } });

    const csvProp = createProperty("title");
    $source(context, csvProp, "headline");
    expect(program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE).get(csvProp)).toEqual({ csv: "headline" });

    const csvObjectProp = createProperty("summary");
    $source(context, csvObjectProp, { csv: "summary" });
    expect(program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE).get(csvObjectProp)).toEqual({ csv: "summary" });

    const emptyProp = createProperty("empty");
    $source(context, emptyProp, "   ");
    expect(program.stateMap(COCOGEN_STATE_PROPERTY_SOURCE).get(emptyProp)).toBeUndefined();
  });

  test("supports noSource decorator", () => {
    const context = createContext();
    const program = (context.program as unknown as ProgramMock);
    const prop = createProperty("computed");

    $noSource(context, prop);

    expect(program.stateMap(COCOGEN_STATE_PROPERTY_NO_SOURCE).get(prop)).toBe(true);
  });
});
