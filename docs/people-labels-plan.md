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

### 1) Build-time schema snapshot pipeline
- [ ] Create a script to download Graph $metadata and extract only /profile entity types needed for the supported labels.
- [ ] Store a compact snapshot in repo (JSON/TS).
- [ ] Add npm script to refresh snapshot (e.g., update-graph-profile-schema).
- [ ] Document how to update snapshot.

### 2) Label registry and schema model
- [ ] Create a label registry mapping labels → Graph entity types, payload type, and constraints (collection limits).
- [ ] Add explicit blocked labels with actionable error messages.
- [ ] Expose a small schema model for validation and codegen.

### 3) Generator validation (compile-time)
- [ ] Validate that people-labeled properties use supported labels only.
- [ ] Validate property types (string/stringCollection) per label.
- [ ] Validate required fields for each entity based on schema model.
- [ ] Produce actionable errors with label/property context.

### 4) TS generated types and validators
- [ ] Emit TS types and validators for every supported entity.
- [ ] Validate payloads before serialization in generated transforms.
- [ ] Enforce collection limits (addresses/emails) and required fields.
- [ ] Provide clear runtime error messages.

### 5) .NET generated types and validators
- [ ] Emit C# types and validators for every supported entity.
- [ ] Validate payloads before serialization in generated transforms.
- [ ] Enforce collection limits (addresses/emails) and required fields.
- [ ] Provide clear runtime exceptions with label/property context.

### 6) Serialization rules
- [ ] Enforce JSON-encoded string for string labels.
- [ ] Enforce JSON-encoded array of strings for collection labels.
- [ ] Verify correct JSON shape before output.

### 7) Tests
- [ ] Unit tests for label registry and schema validation logic.
- [ ] Tests for required field and collection-limit validation.
- [ ] E2E tests for generated TS and .NET outputs that reject invalid payloads.

### 8) Documentation + changelog
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
