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
- Added REST output (.http files) for connection/schema/profile source/ingest ✅
- Decoupled .NET core from concrete item models via generic payload adapter ✅
- Decoupled TS datasource contracts from concrete item models via generics ✅
- Added .NET people payload core types + validators ✅
- Added people label serialization enforcement tests ✅
