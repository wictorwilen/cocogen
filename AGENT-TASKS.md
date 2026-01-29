# AGENT-TASKS.md

This is the living task list for the `cocogen` repo. Keep it current as work progresses.

## Now
- Implement `cocogen emit` (write IR JSON) ✅
- Start `cocogen generate` for runnable TS connector output ✅ (initial scaffold)
- Refine `cocogen generate` output (datasource interface, runnable TS output) ✅
- Separate static runtime vs generated code ✅
- Add `cocogen update` to regenerate `src/<ConnectionName>/**` ✅

## Next
- Add docs updates for `cocogen update` and generated/static layout ✅
- Add unit tests for TypeSpec→IR loader and validation ✅
- Add e2e tests for `cocogen validate` ✅
- Add snapshot/e2e tests for `cocogen emit` and `cocogen generate/update` output ✅ (smoke)
- Add full e2e test: init + install + build ✅
- Add C#/.NET project emitter (Graph SDK) ✅ (scaffold + update + generated code)
- Add dotnet e2e test: init + dotnet build ✅
- V2: add source transformations (multi-column merge/compose)
- V2: support multiple connections per generated CLI

## Later
- Add snapshot tests for emitted file trees
- Add "continue on fail" for generated ingestion logic (abort on fail as option instead) ✅
- Add richer schema features (display templates, activities) if needed
- Rust export to complement dotnet and node

## Decisions / Notes
- Generator code: TypeScript only
- Merged source mapping into @coco.source + people search warning ✅
- Removed multi-column source merge (defer to V2) ✅
- Added CLI delete + people profile source registration ✅
- Renamed generated outputs to schema ✅
- Switched CLIs to commander/System.CommandLine ✅
- Moved .NET config to appsettings.json ✅

## Recently done
- Add multi-source @coco.content formatting + html content type ✅
- Add warning for content connectors missing @coco.content ✅
- Refactor people-entity collection renderers to shared base (TS + .NET) ✅
- Refactor init helpers + people graph types modules ✅
- Simplify .NET JSON/YAML people collection transforms ✅
- Fix nested string collections inside people arrays (TS + .NET) ✅
- Add JSONPath wildcard array fallback in .NET RowParser ✅
- Remove CS8601 warnings in .NET JSONPath match handling ✅
- Add RowParser helper for JSON/YAML people array iteration ✅
- Fix sample data JSONPath root '$' emission ✅
- Remove .NET nullable warnings in JSONPath helper ✅
- Add serialized source targets for custom JSON payloads ✅
- Fix missing RelatedPerson imports in TS people transforms ✅
- Add tests for @coco.source special JSONPath cases ✅
- Fix people sample data arrays for nested JSONPath fields ✅
- Stringify JSON/YAML object/array values in row parsing (TS + .NET) ✅
- Fix people entity collection nesting + add PersonRelationship enums (TS + .NET) ✅
- Improve .NET Graph error logging with HTTP status ✅
- Improve TS Graph error logging with status + details ✅
- Add start-of-operation logs for provision/delete flows ✅
- Cache CLI package info + use real version ✅
- Centralize input format parsing ✅
- Extract JSONPath helpers into shared module ✅
- Extract sample data helpers for init ✅
- Extract shared init types + object tree ✅
- Add shared CLI command runner helper ✅
- Add sample-data unit tests ✅
- Add JSONPath unit tests ✅
- Skip update checks for custom npm registries ✅
- Extract init naming helpers ✅
- Extract project config helpers ✅
- Bump System.CommandLine to 2.0.2 in .NET templates ✅
- Align .NET CLI template with System.CommandLine 2.x APIs ✅
- Fix JsonPath.Net 2.x array match handling in .NET JSON/YAML ingestion ✅
- Stop JSON/YAML collection parsing from using CSV-style splitting ✅
- Add JSONPath validation and regression tests ✅
- Bump JsonPath.Net dependency for generated .NET projects ✅
- Added REST output (.http files) for connection/schema/profile source/ingest ✅
- Decoupled .NET core from concrete item models via generic payload adapter ✅
- Decoupled TS datasource contracts from concrete item models via generics ✅
- Added .NET people payload core types + validators ✅
- Added people label serialization enforcement tests ✅
- Updated people label docs + changelog ✅
- Fixed e2e TypeSpec import for local package ✅
- Emit typed people entity objects in transforms ✅
- Omit nulls in .NET people payload JSON ✅
- Fix TS people validator field checks ✅
- Detect error markers in examples report ✅
- Map graph enum/body types to TS strings ✅
- Use JsonIgnore attributes for .NET people payload nulls ✅
- Move TS principal cleaners into core ✅
- Add all-labels people example ✅
- Fix JsonIgnore for non-nullable properties ✅
- Add complex non-people validations example ✅
- Fix content-all-validations example errors ✅
- Derive missing people graph types from mappings ✅
- Remove JsonElement/Record fallbacks in people graph types ✅
- Add nested TS people entity casts ✅
- Enforce per-file coverage thresholds ✅
- Fix TS people transform indentation ✅
- Populate complex people graph types from metadata ✅
- Add JSON/YAML input formats with JSONPath ✅
- Move input format selection to CLI and emit only the chosen datasource ✅
- Preserve JSONPath array/wildcard segments in .NET output ✅
- Fix JSON/YAML sample data for JSONPath arrays ✅
- Annotate .NET JSON/YAML async iterators to avoid CS8425 ✅
- Add custom input format with stub datasource ✅
- Add REST input format with paginated datasource scaffolds ✅
- Fix REST TS templates for strict type checking ✅
- Cast TS people entity payloads to graph types ✅
- Cast C# people entity payloads to graph types ✅
- Align REST TS/.NET templates with nextLink pagination ✅
- Add profileSource to people init scaffold ✅
- Support TypeSpec enum properties ✅
- Add REST format to example scripts ✅
