# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Generated .NET `PropertyTransformBase` files now indent multi-line people transform expressions consistently, including nested serializer calls and collection object initializers.

### Changed
- Generated TS and .NET connector CLIs now support `--batch-size` for bounded parallel ingestion, with a default of `1` and a maximum of `20` concurrent item PUT requests per batch.

### Fixed
- Generated TS and .NET Graph transport layers now retry transient 408/429/5xx responses with exponential backoff, jitter, and `Retry-After`/`x-ms-retry-after-ms` handling, including raw profile-source admin HTTP calls.
- Generated TypeScript people connectors now reference official stable and beta Microsoft Graph type packages for Graph profile payload models instead of fully redefining those models in generated code.
- Generated TypeScript people helpers no longer emit redundant field-by-field runtime validation for SDK-backed Graph profile models; they keep only minimal object and read-only checks and still fully validate locally derived helper shapes.
- Generated TypeScript people payload and transform files now import official stable and beta Microsoft Graph profile types directly instead of routing them through re-exports from `src/core/people.ts`.
- Generated TypeScript people label serializers now route SDK-backed Graph profile payloads through shared generic SDK serialization helpers instead of emitting per-type validation wrappers.
- Generated TypeScript connector runtimes now send Graph requests through the official Microsoft Graph client instead of a custom fetch-based transport layer.
- Generated .NET people property transforms now instantiate official Microsoft Graph SDK profile model types for SDK-backed people payload shapes instead of emitting local copies of those Graph models.
- Generated .NET people helpers no longer emit duplicate local Graph enum declarations when the generated payloads already bind to the official Microsoft Graph SDK enum types.
- Generated TS and .NET people helpers now bind Graph `itemBody` through the official Microsoft Graph SDK model types instead of treating it as a local string-like special case.
- Generated TS and .NET people helpers now omit local model and enum boilerplate when a connector is fully SDK-backed and only needs shared people payload validation/serialization utilities.
- Generated .NET people payloads now pass inline per-property serialization options into a generic shared people helper instead of relying on emitted label-definition dictionaries and payload-kind enums.
- Generated .NET people transforms no longer wrap SDK model object initializers in redundant outer casts before serializing them.
- Generated TypeScript people helpers no longer export the internal label-serialization options type, and generated TS item payloads now avoid importing `contentPropertyName` when the schema has no content field.
- Generated TypeScript property-transform files now import only the datasource and validation helpers that their rendered transform expressions actually use.
- Generated TS and .NET people collection transforms no longer emit local `getCollectionValue` helpers when the rendered object graph only needs scalar per-index lookups.

## [1.0.50] - 2026-03-26

### Fixed
- Generated .NET date-only parsers now accept ISO date-time inputs and truncate them to the source calendar date instead of falling back to `Date.MinValue`.

## [1.0.49] - 2026-03-26

### Fixed
- Generated .NET people payload models now map Graph `Edm.Date` fields to date-only `Date` properties instead of strings.
- Generated .NET item and people payload classes now emit mutable `get; set;` properties instead of init-only members.

## [1.0.48] - 2026-03-16

### Changed
- Graph profile snapshot generation now extracts referenced `EnumType` members from Graph metadata.
- People payload generators now emit snapshot-backed TS/C# enums for Graph enum fields such as `emailType`, `personRelationship`, and `physicalAddressType`.

## [1.0.47] - 2026-03-16

## [1.0.46] - 2026-03-16

### Fixed
- People entity transforms now preserve strongly typed nested `physicalAddress` payloads when TypeSpec uses `...address.country`, normalizing that field to Graph's `countryOrRegion`.
- People entity transforms now parse typed scalar fields correctly in generated TS and .NET payload builders instead of emitting string values for numeric and boolean Graph fields.
- Repeated `@coco.source(..., to)` mappings on unlabeled `string` and `string[]` properties now emit anonymous serialized JSON objects instead of erroring as missing people labels.

## [1.0.45] - 2026-03-16

## [1.0.44] - 2026-03-16

### Added
- `@coco.source` now supports `transforms: ["trim" | "lowercase" | "uppercase"]` for generated TS and .NET ingestion pipelines, including people/principal mappings.

### Changed
- `@coco.source` transform examples and preferred usage now place `transforms` in the second argument object with `to`/`default`.

## [1.0.43] - 2026-02-12

### Fixed
- REST sample now creates connections with POST /external/connections instead of PUT per Graph guidance.
- REST profile source sample now merges existing prioritizedSourceUrls and patches the profile settings automatically.

## [1.0.42] - 2026-02-11

### Changed
- Generated people payload models now allow extension data (`AdditionalData` in .NET, `Open<T>` wrappers in TS) so arbitrary fields can be ingested.
- People label validation no longer errors when a required-field label is intentionally marked @coco.noSource; emits a warning so manual transforms can supply the fields.

## [1.0.41] - 2026-02-04

### Fixed
- Stop retrying 404s when checking external connection existence so missing connections are created (TS + .NET templates).

### Added
- `cocogen update --include-scaffold` to optionally regenerate scaffold/runtime files in existing projects.
- Tests covering TS connector connection provisioning (GET 200 vs 404 create) with mocked Graph responses.
- Tests ensuring .NET ConnectorCore templates log exists/created and pass through 404 before creation.

## [1.0.40] - 2026-02-04

### Fixed
- Remove redundant casts when serializing people entity collection payloads in .NET.
- Fixed serialization issues for Principals for dotnet

## [1.0.39] - 2026-02-04

### Fixed
- Apply people-entity string collection defaults consistently in generated .NET transforms.
- Avoid accidental JSONPath prefixing for people-entity source paths.

## [1.0.38] - 2026-02-03

## [1.0.37] - 2026-02-03

### Added
- Support `default` values in `@coco.source` mappings via the second argument object.

## [1.0.36] - 2026-02-03

### Added
- `cocogen init` now creates `AGENTS.md` with schema authoring guidance, best practices, and `validate` usage.

### Fixed
- People entity JSONPath sources now inherit a shared prefix for single-segment mappings (e.g., `assistant` under `position.*`).

## [1.0.35] - 2026-01-30
### Added
- `@coco.schemaDescription` for Graph schema property descriptions (preferred over `@coco.description`) to avoid naming collisions with the default TypeSpec `@description`.
- Validation warning when `@coco.description` is used (deprecated alias).
- Validation error for optional schema properties.

### Changed
- Schema description fallback now uses TypeSpec `@description` instead of doc comments.

## [1.0.34] - 2026-01-29
### Added
- Warning when a non-people connector schema lacks a `@coco.content` property.
- `@coco.content` now supports `type: "html"` and multi-source content formatting.

## [1.0.33] - 2026-01-28
### Added
- REST datasource input format with paginated ingestion scaffolds (TS + .NET).

### Changed
- Refactored init generation into shared core and language-specific generator modules for TS and .NET.
- Consolidated people-entity collection rendering to reuse shared renderers (TS + .NET) for multi-field paths.
- Added a TypeScript lint script that reports unused locals/parameters.

### Fixed
- Generated TS property transform base now indents multi-line expressions consistently.
- Removed references to missing TS scaffold template files in generator output.
- Fixed REST TypeScript templates to allow rest/custom input formats and satisfy strict type checks.
- People entity transforms now cast generated object payloads to their strongly typed Graph models before JSON serialization (TS).
- People entity transforms now cast generated object payloads to their strongly typed Graph models before JSON serialization (C#).
- Aligned REST datasource templates (TS + .NET) with simplified OData nextLink pagination and direct-key fallback resolution.
- People starter schemas from `cocogen init --kind people` now include a default `@coco.profileSource`.
- TypeSpec enum properties now map to Graph string types.
- Example generation/report scripts now include the REST input format (dry-run skipped for REST).

## [1.0.32] - 2026-01-27
### Fixed
- People entity transforms now emit nested collection payloads correctly for JSON/YAML sources (TS + .NET).
- People entity transforms now preserve nested string collections inside people arrays (TS + .NET).
- JSONPath array entry iteration now falls back to parent arrays when wildcard evaluation yields no results in .NET.
- Generated .NET JSONPath match handling no longer emits CS8601 nullable assignment warnings.
- Sample JSON/YAML data now preserves nested people arrays (e.g., collaboration tags).
- JSON/YAML row parsing now stringifies object/array values for rich JSON-serialized fields (TS + .NET).
- .NET JSON/YAML people collections now iterate array nodes directly instead of zipping string arrays.
- .NET JSON/YAML people collection transforms now use a shared array iterator helper.
- Sample JSON/YAML data no longer emits a "$" root key for JSONPath sources.
- Generated .NET JSONPath handling no longer triggers nullable warnings during builds.
- TS people transforms now include related person graph types for colleague mappings.

### Changed
- Updated credential precedence to: client secret → managed identity.
- Improved .NET Graph error messages to include HTTP status codes.
- Improved TS Graph error messages to include HTTP status text and parsed Graph error details.
- Added start-of-operation console messages for provision/delete flows (TS + .NET).
- CLI version output now reflects the package version.
- Update checks now honor custom npm registry configuration.
- Added Azure Functions migration tutorial (Node + .NET).

### Added
- Graph people enum helpers now include `PersonRelationship` (TS + .NET).
- `@coco.source(..., { serialized: Model })` for JSON-serialized custom payloads.

## [1.0.31] - 2026-01-22
### Fixed
- JsonPath.Net 2.x handling now returns array matches correctly in .NET JSON/YAML ingestion.
 - Invalid JSONPath syntax now fails fast during schema loading.

### Changed
- JSON/YAML collection parsing no longer splits on CSV-style delimiters.
- Bumped System.CommandLine to 2.0.2 in generated .NET projects.
- Updated .NET CLI template to use System.CommandLine 2.x APIs.

### Added
- Tests for JSONPath validation and .NET YAML JsonPath array ingestion.

### Changed
- Bumped JsonPath.Net to 2.2.0 in generated .NET projects.

## [1.0.30] - 2026-01-22

## [1.0.29] - 2026-01-22

### Added
- Input format support for JSON/YAML with JSONPath-based source mapping (TS + .NET).
- Custom input format that emits a stub datasource for user-provided backends.

### Changed
- Input format selection moved to `cocogen generate --data-format`; generated projects no longer expose runtime format configuration.
- Generated outputs now include only the datasource files and sample data for the selected input format.

### Fixed
- JSONPath normalization now preserves array indexes and wildcards for generated .NET transforms.
- Sample JSON/YAML generation now emits arrays for JSONPath index and wildcard segments.
- .NET JSON/YAML datasource async iterators now annotate cancellation tokens to avoid CS8425 warnings.

## [1.0.28] - 2026-01-22

### Added
- Graph profile metadata now includes referenced complex types so nested people graph types are fully populated.

### Fixed
- C# people graph types now map Edm.Int32 scalars correctly.

## [1.0.27] - 2026-01-22

### Added
- Graph profile metadata now includes ItemFacet and derived base types for people connectors.
- Read-only enforcement for ItemFacet server-generated fields in TS and .NET people payloads.
- Per-file coverage thresholds with new tests for profile schema and label registry.

### Changed
- People payload AdditionalData now uses nullable value types in .NET for safer serialization.
- People entity transforms now emit consistent indentation in generated TypeScript output.

### Fixed
- People payload serialization now rejects ItemFacet id ingestion and server-generated fields.
- Nested people graph types now map cleanly without JsonElement/Record fallbacks.

## [1.0.26] - 2026-01-22

### Added
- People connector runtime helpers now enforce JSON-encoded payloads for people labels (TS + .NET).
- People label registry snapshot and validation tests.
- Added all-labels people connector example for exercising complex TypeSpec usage.
- Added complex non-people connector example with extensive validations.

### Changed
- People entity transforms now build typed payload objects before JSON serialization (TS + .NET).
- .NET people payload types now use JsonIgnore attributes to omit nulls (instead of serializer options).
- TS principal cleanup helpers now live in core/principal.
- People graph helpers now derive missing nested types from mappings for stronger typing (TS + .NET).
- People graph types now map all scalars explicitly and treat Edm.Date as string.
- TS people entity transforms now cast nested objects to derived Graph types (e.g., PositionDetail) and import nested types.

### Fixed
- People label validators now check the correct field values in TS helpers.
- People profile graph enum/body types now map to string in TS helpers to avoid invalid type mismatches.
- C# people graph enum/body types now map to string for better alignment.

## [1.0.25] - 2026-01-21

### Fixed
- .NET CSV datasource/CLI now alias schema model types to avoid namespace/type name collisions (e.g., `Skills` as namespace).

## [1.0.24] - 2026-01-21

### Changed
- .NET core ingestion now uses generic payload adapters to avoid coupling core helpers to concrete schema models.
- TS datasource contracts now use generics to avoid coupling shared helpers to concrete schema models.

## [1.0.22] - 2026-01-21

### Changed
- Principal model now lives in generated core helpers (TS + .NET) for easier SDK migration.
- .NET principal serialization now uses a Kiota `IParsable` implementation with updated principal fields.
- Principal field mappings aligned with draft Graph docs (`externalName`, `externalId`, `entraDisplayName`, `entraId`, `email`, `upn`, `tenantId`).
- Added REST output (`--lang rest`) that emits .http files for connection, schema, profile source, and ingestion calls.

### Fixed
- Principal values now omit null fields in TS payloads and .NET serialization.
- PrincipalCollection now emits `Collection(microsoft.graph.externalConnectors.principal)` in `@odata.type`.
- Sample CSV generation uses email values for principal `upn`/`userPrincipalName` sources.

## [1.0.20] - 2026-01-21

### Changed
- Principal properties now emit a typed principal object with `@odata.type` and updated Graph fields.
- Added support for `coco.Principal[]` mapping to Graph `principalCollection` (preview).
- Updated principal field mappings to match Graph docs (`externalName`, `externalId`, `entraDisplayName`, `entraId`, `email`, `upn`, `tenantId`).

### Fixed
- .NET CLI now uses client secret credentials directly when configured (avoids managed identity failures).
- TS CLI now uses client secret credentials directly when configured (avoids managed identity failures).

## [1.0.19] - 2026-01-21

### Fixed
- Clarified error messaging for unsupported scalar types (with float64 hint).

### Changed
- Moved item payload ID encoding helpers into shared core helpers for TS and .NET.

## [1.0.18] - 2026-01-21

### Breaking Changes
- Removed legacy CSV-row helpers (`fromCsvRow`, `CsvParser`, `csv.ts`) in favor of row-based helpers.
- Renamed CLI commands: `init-tsp` → `init`, `init` → `generate`.

### Added
- Added agent-facing schema guidance document (docs/schema-assistant.md).
- Managed identity authentication as the preferred credential for generated TS and .NET projects (client secret fallback).
- .NET user-secrets support for configuration.
- TypeSpec metadata support for `@doc`, `@example`, `@minLength`, `@maxLength`, `@minValue`, `@maxValue`, `@pattern`, `@format`, and `#deprecated`.

## [1.0.16] - 2026-01-20

### Added
- `@coco.id` encoding options (`slug`, `base64`, `hash`) to produce URL-safe external item IDs.
- Profile source defaults emitted into generated constants for TypeScript and .NET projects (people connectors).
- Validation rules for `@coco.profileSource`/`personAccount` consistency and required `displayName`.

### Changed
- CSV collection parsing now splits on semicolons only.
- `@coco.connection` `connectionDescription` is optional (warning when missing).
- External item payloads always include `id` and `content` (empty content when no `@coco.content`).

### Fixed
- External item ID handling now aligns URL and payload for both content and people connectors.
- People connector item ID handling now preserves the raw CSV value before encoding.

### Breaking Changes
- `@coco.profileSource.displayName` is now required for people connectors.
- Collection values no longer split on commas; use semicolons instead.

[Unreleased]: https://github.com/wictorwilen/cocogen/compare/v1.0.16...HEAD
[1.0.50]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.50
[1.0.49]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.49
[1.0.48]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.48
[1.0.47]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.47
[1.0.46]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.46
[1.0.45]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.45
[1.0.44]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.44
[1.0.43]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.43
[1.0.42]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.42
[1.0.41]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.41
[1.0.40]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.40
[1.0.39]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.39
[1.0.38]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.38
[1.0.37]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.37
[1.0.36]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.36
[1.0.35]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.35
[1.0.34]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.34
[1.0.33]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.33
[1.0.32]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.32
[1.0.31]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.31
[1.0.30]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.30
[1.0.29]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.29
[1.0.28]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.28
[1.0.27]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.27
[1.0.26]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.26
[1.0.25]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.25
[1.0.24]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.24
[1.0.22]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.22
[1.0.20]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.20
[1.0.19]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.19
[1.0.18]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.18
[1.0.17]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.17
[1.0.16]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.16
