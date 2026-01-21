# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Principal model now lives in generated core helpers (TS + .NET) for easier SDK migration.
- .NET principal serialization now uses a Kiota `IParsable` implementation with updated principal fields.
- Principal field mappings aligned with draft Graph docs (`externalName`, `externalId`, `entraDisplayName`, `entraId`, `email`, `upn`, `tenantId`).

### Fixed
- Principal values now omit null fields in TS payloads and .NET serialization.
- PrincipalCollection now emits `Collection(microsoft.graph.externalConnectors.principal)` in `@odata.type`.
- Sample CSV generation uses email values for principal `upn`/`userPrincipalName` sources.

## [1.0.21] - 2026-01-21

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
[1.0.21]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.21
[1.0.20]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.20
[1.0.19]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.19
[1.0.18]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.18
[1.0.17]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.17
[1.0.16]: https://github.com/wictorwilen/cocogen/compare/main...v1.0.16
