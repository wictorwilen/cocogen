# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Changed
- Added device code flow flag (`--device-code`) for delegated auth (TS + .NET).
- Updated credential precedence to: device code → client secret → managed identity.
- Improved .NET Graph error messages to include HTTP status codes.
- Improved TS Graph error messages to include HTTP status text and parsed Graph error details.
- Added start-of-operation console messages for provision/delete flows (TS + .NET).

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
