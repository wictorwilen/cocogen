import { describe, expect, test } from "vitest";

import type { DecoratorContext, Model, ModelProperty, Program } from "@typespec/compiler";
import {
  $aliases,
  $connection,
  $content,
  $description,
  $schemaDescription,
  $id,
  $item,
  $label,
  $name,
  $profileSource,
  $search,
  $source,
} from "../../src/typespec/decorators.js";
import {
  COCOGEN_STATE_CONNECTION_SETTINGS,
  COCOGEN_STATE_CONTENT_PROPERTIES,
  COCOGEN_STATE_ID_PROPERTIES,
  COCOGEN_STATE_ITEM_MODELS,
  COCOGEN_STATE_PROFILE_SOURCE_SETTINGS,
  COCOGEN_STATE_PROPERTY_ALIASES,
  COCOGEN_STATE_PROPERTY_SCHEMA_DESCRIPTIONS,
  COCOGEN_STATE_PROPERTY_LEGACY_DESCRIPTIONS,
  COCOGEN_STATE_PROPERTY_LABELS,
  COCOGEN_STATE_PROPERTY_NAME_OVERRIDES,
  COCOGEN_STATE_PROPERTY_PERSON_FIELDS,
  COCOGEN_STATE_PROPERTY_SEARCH,
  COCOGEN_STATE_PROPERTY_SOURCE,
} from "../../src/typespec/state.js";

function createProgram(): Program {
  const setMap = new Map<symbol, Set<unknown>>();
  const mapMap = new Map<symbol, Map<unknown, unknown>>();

  return {
    stateSet(symbol: symbol) {
      let set = setMap.get(symbol);
      if (!set) {
        set = new Set();
        setMap.set(symbol, set);
      }
      return set as Set<any>;
    },
    stateMap(symbol: symbol) {
      let map = mapMap.get(symbol);
      if (!map) {
        map = new Map();
        mapMap.set(symbol, map);
      }
      return map as Map<any, any>;
    },
  } as Program;
}

function createContext(program: Program): DecoratorContext {
  return { program } as DecoratorContext;
}

const model = { kind: "Model" } as Model;
const prop = { kind: "ModelProperty", name: "title" } as ModelProperty;

function getSet(program: Program, key: symbol): Set<unknown> {
  return program.stateSet(key) as Set<unknown>;
}

function getMap(program: Program, key: symbol): Map<unknown, unknown> {
  return program.stateMap(key) as Map<unknown, unknown>;
}

describe("TypeSpec decorators", () => {
  test("stores item and id markers", () => {
    const program = createProgram();
    const context = createContext(program);

    $item(context, model);
    $id(context, prop);
    $item(context, null as unknown as Model);
    $id(context, {} as unknown as ModelProperty);

    expect(getSet(program, COCOGEN_STATE_ITEM_MODELS).has(model)).toBe(true);
    expect(getMap(program, COCOGEN_STATE_ID_PROPERTIES).get(prop)).toBe(true);
  });

  test("stores labels, aliases, schema descriptions, legacy descriptions, and name overrides", () => {
    const program = createProgram();
    const context = createContext(program);

    $label(context, prop, "title");
    $aliases(context, prop, { value: "heading" } as unknown as string);
    $schemaDescription(context, prop, "A schema title");
    $description(context, prop, "A legacy title");
    $name(context, prop, "shortTitle");
    $label(context, prop, null as unknown as string);
    $label(context, {} as ModelProperty, "ignored");

    expect(getMap(program, COCOGEN_STATE_PROPERTY_LABELS).get(prop)).toEqual(["title"]);
    expect(getMap(program, COCOGEN_STATE_PROPERTY_ALIASES).get(prop)).toEqual(["heading"]);
    expect(getMap(program, COCOGEN_STATE_PROPERTY_SCHEMA_DESCRIPTIONS).get(prop)).toBe("A schema title");
    expect(getMap(program, COCOGEN_STATE_PROPERTY_LEGACY_DESCRIPTIONS).get(prop)).toBe("A legacy title");
    expect(getMap(program, COCOGEN_STATE_PROPERTY_NAME_OVERRIDES).get(prop)).toBe("shortTitle");
  });

  test("stores connection, profile source, search, and content flags", () => {
    const program = createProgram();
    const context = createContext(program);

    const settingsModel = {
      kind: "Model",
      properties: new Map([
        ["contentCategory", { type: { value: "people" } }],
        ["connectionId", { type: { value: "conn" } }],
      ]),
    } as unknown as Model;

    $connection(context, model, settingsModel as unknown as { contentCategory: string; connectionId: string });
    $profileSource(context, model, { webUrl: "https://contoso.com" });
    $search(context, prop, { searchable: true, retrievable: true });
    $content(context, prop);

    expect(getMap(program, COCOGEN_STATE_CONNECTION_SETTINGS).get(model)).toEqual({
      contentCategory: "people",
      connectionId: "conn",
    });
    expect(getMap(program, COCOGEN_STATE_PROFILE_SOURCE_SETTINGS).get(model)).toEqual({
      webUrl: "https://contoso.com",
    });
    expect(getMap(program, COCOGEN_STATE_PROPERTY_SEARCH).get(prop)).toEqual({
      searchable: true,
      retrievable: true,
    });
    expect(getMap(program, COCOGEN_STATE_CONTENT_PROPERTIES).get(prop)).toBe(true);

    const program2 = createProgram();
    const context2 = createContext(program2);
    $connection(context2, model, { connectionId: undefined } as unknown as { connectionId?: string });
    expect(getMap(program2, COCOGEN_STATE_CONNECTION_SETTINGS).get(model)).toEqual({});
  });

  test("stores source mappings and person entity fields", () => {
    const program = createProgram();
    const context = createContext(program);

    $source(context, prop, "Title");
    const source = getMap(program, COCOGEN_STATE_PROPERTY_SOURCE).get(prop);
    expect(source).toBe("Title");

    $source(context, prop, { csv: "Updated" });
    const source2 = getMap(program, COCOGEN_STATE_PROPERTY_SOURCE).get(prop);
    expect(source2).toEqual({ csv: "Updated" });

    $source(context, prop, "upn", "userPrincipalName");
    const fields = getMap(program, COCOGEN_STATE_PROPERTY_PERSON_FIELDS).get(prop) as Array<{
      path: string;
      source: { csv: string } | string;
    }>;
    expect(fields[0]).toEqual({ path: "userPrincipalName", source: "upn" });

    $source(context, {} as ModelProperty, "ignored");
  });

  test("$source rejects serialized targets with person entity mapping", () => {
    const program = createProgram();
    const context = createContext(program);
    const target = { kind: "ModelProperty", name: "title" } as ModelProperty;
    const serializedModel = { kind: "Model" } as Model;

    expect(() => $source(context, target, "source", { serialized: serializedModel, to: "path" })).toThrow(
      /serialized targets cannot include a 'to' path/i
    );
  });
});
