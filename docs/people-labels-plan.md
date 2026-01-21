# People connector label serialization plan

Purpose: prevent incorrect JSON formats for people labels by generating strict, strongly typed serialization and validation based on the official people connector schema. This plan covers all profile entities and labels listed at https://aka.ms/peopleconnectors/build.

## Scope: supported labels and entities

Supported labels (must be enforced):
- personAccount → userAccountInformation (string)
- personName → personName (string)
- personCurrentPosition → workPosition (string)
- personAddresses → itemAddress (stringCollection, max 3: Home/Work/Other)
- personEmails → itemEmail (stringCollection, max 3)
- personPhones → itemPhone (stringCollection)
- personAwards → personAward (stringCollection)
- personCertifications → personCertification (stringCollection)
- personProjects → projectParticipation (stringCollection)
- personSkills → skillProficiency (stringCollection)
- personWebAccounts → webAccount (stringCollection)
- personWebSite → webSite (string)
- personAnniversaries → personAnniversary (stringCollection)
- personNote → personAnnotation (string)

Unsupported labels (must error):
- personManager
- personAssistants
- personColleagues
- personAlternateContacts
- personEmergencyContacts

## Execution rules

- Keep all generator implementation in TypeScript (Node 22, ESM, npm).
- Do not fetch Microsoft Graph metadata at runtime in generated projects.
- Any label payload must be validated before JSON serialization in generated code (TS + .NET).
- Do not edit dist/** directly.
- Update docs/architecture.md and CHANGELOG.md for consumer-facing changes.
- Maintain AGENT-TASKS.md as the task tracker (do not log release notes there).

## Task list

Mark tasks one-by-one in AGENT-TASKS.md using statuses: not-started, in-progress, completed. Only one task can be in-progress at a time.

### 1) Build-time schema snapshot pipeline *(status: completed)*
- [x] Create a script to download Graph $metadata and extract only /profile entity types needed for the supported labels.
- [x] Store a compact snapshot in repo (JSON/TS).
- [x] Add npm script to refresh snapshot (e.g., update-graph-profile-schema).
- [x] Document how to update snapshot.

**Snapshot refresh instructions**

1. Run `npm run update-graph-profile-schema` to pull the latest beta metadata and regenerate `data/graph-profile-schema.json`.
2. Review the diff (especially required/nullable fields) and commit the updated snapshot with any label validation changes.
3. Graph currently names the anniversary and website types `personAnnualEvent` and `personWebsite`; the snapshot preserves aliases (`personAnniversary`, `webSite`) so downstream logic can keep using the plan terminology.

### 2) Label registry and schema model *(status: completed)*
- [x] Create a label registry mapping labels → Graph entity types, payload type, and constraints (collection limits).
- [x] Add explicit blocked labels with actionable error messages.
- [x] Expose a small schema model for validation and codegen.

**Registry usage notes**

1. `src/people/profile-schema.ts` loads the snapshot once via `createRequire` and exposes helpers (`getProfileType`, `resolveProfileTypeName`) for future TS/.NET codegen work.
2. `src/people/label-registry.ts` centralizes supported labels, payload expectations, collection limits, and blocked-label messaging; validators and the TypeSpec loader now import these definitions.
3. `package.json` publishes the `data/` folder so downstream consumers (and the CLI) can access the schema snapshot at runtime.

### 3) Generator validation (compile-time) *(status: completed)*
- [x] Validate that people-labeled properties use supported labels only.
- [x] Validate property types (string/stringCollection) per label.
- [x] Validate required fields for each entity based on schema model.
- [x] Produce actionable errors with label/property context.

**Validation details**

1. The IR validator now pulls label metadata from `src/people/label-registry.ts`, so any new labels constraints automatically flow into compile-time checks.
2. Required Graph fields (non-nullable in the schema snapshot) must be covered by @coco.source mappings; missing mappings are surfaced as errors pointing to the offending label/property pair.
3. People properties without required fields still receive a warning if no @coco.source mapping is provided, encouraging explicit mappings for downstream runtime validation.

### 4) TS generated types and validators *(status: completed)*
- [x] Emit TS types and validators for every supported entity.
- [x] Validate payloads before serialization in generated transforms.
- [x] Enforce collection limits (addresses/emails) and required fields.
- [x] Provide clear runtime error messages.

**Runtime validation details**

1. Every TypeScript people connector now gets `src/core/people.ts`, which exports strongly-typed Graph payload models plus `serializePerson*` helpers that parse JSON strings, validate required fields, and normalize output.
2. `itemPayload.ts` automatically invokes the appropriate serializer for each people-labeled property, so even custom transform overrides must pass validation before we emit the Graph `ExternalItem`.
3. Per-label constraints (required fields, collection limits for addresses/emails, etc.) flow from the registry snapshot, and any violation surfaces a descriptive runtime error that names the offending label/property.

### 5) .NET generated types and validators *(status: completed)*
- [x] Emit C# types and validators for every supported entity.
- [x] Validate payloads before serialization in generated transforms.
- [x] Enforce collection limits (addresses/emails) and required fields.
- [x] Provide clear runtime exceptions with label/property context.

**Runtime validation details**

1. `Core/PeoplePayload.cs` now holds all Graph profile types plus label metadata (payload type, required fields, collection limits).
2. `ItemPayload.cs` routes people-labeled properties through `PeoplePayload.Serialize*`, which parses JSON, validates required fields, and enforces collection limits.
3. Errors include the label + property name for quick diagnosis.

### 6) Serialization rules *(status: completed)*
- [x] Enforce JSON-encoded string for string labels.
- [x] Enforce JSON-encoded array of strings for collection labels.
- [x] Verify correct JSON shape before output.

**Serialization enforcement**

1. TS `core/people.ts` now requires string labels to be JSON strings and collection labels to be arrays of JSON strings (no object/array shortcuts).
2. .NET `Core/PeoplePayload.cs` rejects empty strings and validates JSON object shape for each entry.

### 7) Tests *(status: completed)*
- [x] Unit tests for label registry and schema validation logic.
- [x] Tests for required field and collection-limit validation.
- [x] E2E tests for generated TS and .NET outputs that reject invalid payloads.

### 8) Documentation + changelog *(status: not-started)*
- [ ] Update docs/architecture.md with new people-label pipeline.
- [ ] Update docs/end-user.md and docs/typespec.md with usage guidance.
- [ ] Add CHANGELOG.md entry.

## How to follow this plan

1) Before starting, open AGENT-TASKS.md and add this plan as a “Now” item.
2) Select exactly one task above, set it to in-progress, and keep it the only in-progress task.
3) Implement the task fully, including tests and docs if applicable.
4) Mark the task completed and move to the next task.
5) If you discover new work, add it to AGENT-TASKS.md (do not put release notes there).
6) Keep docs aligned with behavior changes, and update CHANGELOG.md for user-visible changes.

## Completion checklist

- All tasks marked completed in AGENT-TASKS.md.
- Tests pass.
- Documentation updated.
- CHANGELOG.md updated.
