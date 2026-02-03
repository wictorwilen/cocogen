# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `cocogen init` now creates `AGENTS.md` with schema authoring guidance, best practices, and `validate` usage.

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
