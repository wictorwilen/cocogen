# AGENT-TASKS.md

This is the living task list for the `cocogen` repo. Keep it current as work progresses.

## Now
- Implement `cocogen emit` (write IR JSON) ✅
- Start `cocogen init` for runnable TS connector output ✅ (initial scaffold)
- Refine `cocogen init` output (datasource interface, runnable TS output) ✅
- Separate static runtime vs generated code ✅
- Add `cocogen update` to regenerate `src/schema/**` ✅

## Next
- Add docs updates for `cocogen update` and generated/static layout ✅
- Add unit tests for TypeSpec→IR loader and validation ✅
- Add e2e tests for `cocogen validate` ✅
- Add snapshot/e2e tests for `cocogen emit` and `cocogen init/update` output ✅ (smoke)
- Add full e2e test: init + install + build ✅
- Add C#/.NET project emitter (Graph SDK) ✅ (scaffold + update + generated code)
- Add dotnet e2e test: init + dotnet build ✅
- V2: add source transformations (multi-column merge/compose)
- V2: support multiple connections per generated CLI

## Later
- Add snapshot tests for emitted file trees
- Add richer schema features (display templates, activities) if needed

## Decisions / Notes
- Generator code: TypeScript only
- Runtime: Node 22 LTS + npm
- Module system: ESM
- CLI: commander + colorful UX + spinners (must degrade in CI/non-TTY, respect NO_COLOR)
- People connectors: contentCategory configured in TSP; `principalCollection` hard-fails validation

## Recently done
- Rebranded generator/package to cocogen + coco namespace ✅
- Dropped gcgen legacy config support ✅
- Renamed generated .NET constants class ✅
- Added coverage reporting + unit tests ✅
- Reached 90%+ coverage thresholds ✅
- Added TypeSpec editor support for generated projects ✅
- Added connection defaults to TS schema constants ✅
- Documented datasource swap contract ✅
- Copy schema.tsp into generated projects ✅
- Added people multi-value entity mapping support ✅
- Enforced people-label mapping requirement ✅
- Removed legacy Program.cs template ✅
- Improved .NET config errors and dry-run behavior ✅
- Updated generated .NET target framework to net10.0 ✅
- Added e2e fail-path test for principal preview requirement ✅
- Prepared npm publish metadata and licensing ✅
- Added init-tsp prompt for starter schemas ✅
- Added package.json + tspconfig.yaml in init-tsp ✅
- Allowed people labels without entity mappings (warning + manual transform) ✅
- Added end-user documentation guide ✅
- Documented TypeSpec schema format (decorators, rules, examples) ✅
- Added `@coco.profileSource` defaults + priority wiring ✅
- Added @coco.connection defaults for id/description ✅
- Enforced enum values for contentCategory/labels ✅
- Removed `@coco.personEntity` decorator (entity inferred from label) ✅
- Added `@coco.source` for CSV mapping/merge ✅
- Added people-connector jobTitle mapping test ✅
- Added people workPosition entity mapping ✅
- Expanded people label/entity mappings ✅
- Fixed people `personEntity` entity mapping from labels ✅
- Added personEntity override hooks ✅
- Added sample CSV generation ✅
- Added people skills sample ✅
- Merged source mapping into @coco.source + people search warning ✅
- Removed multi-column source merge (defer to V2) ✅
- Added CLI delete + people profile source registration ✅
- Renamed generated outputs to schema ✅
- Switched CLIs to commander/System.CommandLine ✅
- Moved .NET config to appsettings.json ✅
