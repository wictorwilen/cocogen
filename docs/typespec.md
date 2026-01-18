# TypeSpec format (cocogen)

`cocogen` reads a single TypeSpec model and turns its properties into a Microsoft Graph external connection schema.

## Quick start

A minimal content connector schema:

```tsp
using coco;

@coco.item()
model Ticket {
  @coco.id
  ticketId: string;

  @coco.label("title")
  @coco.search({ searchable: true, retrievable: true })
  title: string;

  @coco.content({ type: "text" })
  body: string;
}
```

A minimal people connector schema:

```tsp
using coco;

@coco.connection({ contentCategory: "people" })
@coco.item()
model PersonProfile {
  @coco.id
  @coco.label("personAccount")
  @coco.source("upn", "userPrincipalName")
  userPrincipalName: string;

  @coco.label("personName")
  @coco.source("displayName", "displayName")
  displayName: string;
}
```

## Required structure

- Exactly one model must be marked with `@coco.item()`.
- Exactly one property on that model must be marked with `@coco.id`.
  - The `@coco.id` property must be `string`.
- The item model must be *flat*.
  - No nested models/objects; every property must be a scalar or scalar collection.

## Connection settings

### `@coco.connection({ contentCategory, connectionId?, connectionDescription? })`

Attach to the same model as `@coco.item()`.

`contentCategory` maps to Microsoft Graph `externalConnection.contentCategory` (enum values enforced by TypeSpec).

If you set `contentCategory`, `cocogen` requires `--use-preview-features` to allow Graph beta endpoints and SDKs.
`connectionId` and `connectionDescription` set defaults for the generated configuration.

Important:
- This property is exposed on Microsoft Graph **/beta**.
- If you set `contentCategory`, `cocogen` provisions using Graph `beta`.
- If you omit `contentCategory`, `cocogen` provisions using Graph `v1.0`.

Official values (Graph /beta):
- `uncategorized` (default)
- `knowledgeBase`
- `wikis`
- `fileRepository`
- `qna`
- `crm`
- `dashboard`
- `people`
- `media`
- `email`
- `messaging`
- `meetingTranscripts`
- `taskManagement`
- `learningManagement`

Reference:
- https://learn.microsoft.com/en-us/graph/api/resources/externalconnectors-externalconnection?view=graph-rest-beta

Notes:
- `people` enables people connector validation rules.

### `@coco.profileSource({ webUrl, displayName?, priority? })`

People connectors only. Attach to the same model as `@coco.item()`.

This decorator configures the default profile source settings for the generated project:
- `webUrl` (required): The profile source web URL.
- `displayName` (optional): Defaults to the connection name if omitted.
- `priority` (optional): `first` or `last` (default: `first`). Controls where the profile source is placed in `prioritizedSourceUrls`.

Example:

```tsp
@coco.profileSource({
  webUrl: "https://contoso.com/people",
  displayName: "Contoso HR",
  priority: "last"
})
```

## Property decorators

### `@coco.search({ ...flags })`

Supported flags:
- `searchable?: boolean`
- `queryable?: boolean`
- `retrievable?: boolean`
- `refinable?: boolean`
- `exactMatchRequired?: boolean`

Rules enforced:
- Only `string` and `string[]` can be `searchable`.
- `searchable` and `refinable` cannot both be true.

People connectors:
- Search flags are currently ignored by Microsoft Graph for people connectors.
- `cocogen validate` emits a warning if you use `@coco.search` in people schemas.

### `@coco.label("...")`

Adds Microsoft Graph schema `labels`.

Supported labels (enum):
- `title`
- `url`
- `createdDateTime`
- `lastModifiedDateTime`
- `fileExtension`
- `iconUrl`
- `containerName`
- `containerUrl`
- `createdBy`
- `lastModifiedBy`
- People labels (preview): see below.

People connectors:
- Exactly one property must have label `personAccount`.
- Any label that starts with `person` is treated as a people-domain label and has extra validation.
 - Only these labels are supported (preview):
   - `personAccount`
   - `personName`
   - `personCurrentPosition`
   - `personAddresses`
   - `personEmails`
   - `personPhones`
   - `personAwards`
   - `personCertifications`
   - `personProjects`
   - `personSkills`
   - `personWebAccounts`
   - `personWebSite`
   - `personAnniversaries`
   - `personNote`

### `@coco.aliases("...")`

Adds Graph schema property aliases. Can be repeated.

### `@coco.description("...")`

Sets the Graph schema property description.

If omitted, `cocogen` will also consider the TypeSpec doc comment on the property.

### `@coco.name("...")`

Overrides the emitted Graph schema property name.

Use this when your TypeSpec property name is not Graph-safe (non‑alphanumeric or > 32 chars), or when you want a friendly TypeSpec name while emitting a compliant Graph name.

This is useful to satisfy Graph naming constraints:
- names must be alphanumeric only (`A-Z`, `a-z`, `0-9`)
- max length is 32

### `@coco.source(...)`

Maps a schema property to one or more source fields (CSV headers).

Examples:

```tsp
// Map to a differently named CSV column.
@coco.source("jobtitle")
jobTitle: string;

// Use a single CSV column for displayName.
@coco.source("displayName")
displayName: string;
```

Notes:
- When omitted, the CSV header is assumed to match the schema property name.
- This mapping is source-only and does not change the Graph schema name; use `@coco.name("...")` for schema naming.
- Multi-column source transforms (merge/compose) are not supported yet; preprocess your CSV or wait for a future version.

### `@coco.source(from, to?)`

Maps a CSV header to a destination property or people-entity field.

Notes:
- For people entity mappings, `to` is recommended and should be the entity JSON path. If you omit it, cocogen will skip defaults and you must build JSON yourself in generated transforms/overrides.
- For non-people connectors, omit `to` (equivalent to `@coco.source("header")`).
- For `coco.Principal`, you may provide `to` to build the principal JSON payload (for example `@coco.source("manager", "userPrincipalName")`).
- For people connectors, any property with a people label should define at least one `@coco.source(..., to)` mapping; otherwise validation warns and you must implement the mapping manually.

### People entity fields with `@coco.source(..., to)`

Builds JSON-serialized profile entity payloads for people connectors. The entity type is inferred from the people label on the property.

Example (current position / workPosition):

```tsp
@coco.label("personCurrentPosition")
@coco.source("job title", "detail.jobTitle")
@coco.source("company", "detail.company.displayName")
@coco.source("employee id", "detail.employeeId")
workPosition: string;
```

Example (skills / skillProficiency):

```tsp
@coco.label("personSkills")
@coco.source("skill", "displayName")
@coco.source("proficiency", "proficiency")
skills: string[];
```

Notes:
- The property type must be `string` or `string[]`.
- The people label determines the entity type. Supported mappings:
  - `personAccount` → `userAccountInformation`
  - `personName` → `personName`
  - `personCurrentPosition` → `workPosition`
  - `personAddresses` → `itemAddress`
  - `personEmails` → `itemEmail`
  - `personPhones` → `itemPhone`
  - `personAwards` → `personAward`
  - `personCertifications` → `personCertification`
  - `personProjects` → `projectParticipation`
  - `personSkills` → `skillProficiency`
  - `personWebAccounts` → `webAccount`
  - `personWebSite` → `personWebsite`
  - `personAnniversaries` → `personAnniversary`
  - `personNote` → `personAnnotation`

Generated projects include a `PropertyTransformBase` (regenerated) and `PropertyTransform` override (kept) under the schema folder (TS: `src/schema`, .NET: `Schema/`). Customize `PropertyTransform` to shape entity JSON (for example, combine a skill name and proficiency into `skillProficiency`).

Multi-value CSV handling:
- For people entity **collections** (`string[]`), CSV values can be separated with `;` (for example, `TypeScript;Python`).
- If multiple mapped fields have multiple values, they are aligned by index.
- If a field has a single value while others have multiple, the single value is reused for each entity.

### Generated property transform samples

`cocogen` generates a `PropertyTransformBase` with default implementations and a `PropertyTransform` override you can edit. Defaults always receive the full row and read the configured CSV headers.

TypeSpec:

```tsp
@coco.source("body")
@coco.content({ type: "text" })
body: string;

status: string;
```

Generated (TS):

```ts
export abstract class PropertyTransformBase {
  protected transformBody(row: Record<string, unknown>): string {
    return parseString(readSourceValue(row, ["body"]));
  }

  protected transformStatus(row: Record<string, unknown>): string {
    return parseString(readSourceValue(row, ["status"]));
  }
}
```

Generated (.NET):

```csharp
public abstract class PropertyTransformBase
{
    protected virtual string TransformBody(IReadOnlyDictionary<string, string?> row)
    {
        return CsvParser.ParseString(row, new[] { "body" });
    }

    protected virtual string TransformStatus(IReadOnlyDictionary<string, string?> row)
    {
        return CsvParser.ParseString(row, new[] { "status" });
    }
}
```

### `@coco.content({ type: "text" })`

Marks a full-text content field, emitted as `externalItem.content.value` during ingestion.

Rules:
- The content property must be `string`.
- People connectors (`contentCategory: "people"`) must not use `@coco.content`.

## Supported property types

Scalar types:
- `string` → Graph `string`
- `boolean` → Graph `boolean`
- `int32 | int64` → Graph `int64`
- `float32 | float64` → Graph `double`
- `utcDateTime` → Graph `dateTime`
- `coco.Principal` → Graph `principal` (**requires Graph beta / `--use-preview-features`**)

Collection types:
- `string[]` → Graph `stringCollection`
- `int32[] | int64[]` → Graph `int64Collection`
- `float32[] | float64[]` → Graph `doubleCollection`
- `utcDateTime[]` → Graph `dateTimeCollection`

Not supported:
- Nested models / objects (flatten your schema)
- `coco.Principal[]` (Graph does not support `principalCollection`)

## People connectors: mapping to profile shapes

People connectors use Graph labels to compose rich person profiles. Use labels (for example, `personAccount`, `personName`, or other people-domain labels) to tell Graph how fields map into the profile shape.

Source mapping is independent from labels, so you can map CSV columns to the labeled schema fields:

```tsp
using coco;

@coco.connection({ contentCategory: "people" })
@coco.item()
model PersonProfile {
  @coco.id
  @coco.label("personAccount")
  @coco.source("upn", "userPrincipalName")
  userPrincipalName: string;

  @coco.label("personName")
  @coco.source("displayName", "displayName")
  displayName: string;

  @coco.label("personCurrentPosition")
  @coco.source("jobtitle", "detail.jobTitle")
  workPosition: string;
}
```

The schema stays flat; Graph interprets people-domain labels to build profile entities (for example, the current work position). The source mapping lets you pull data from differently named or multiple columns.

## Common validation errors

- **No `@coco.item()` model found**: add `@coco.item()` to the external item model.
- **Missing `@coco.id`**: add `@coco.id` to the unique identifier property (must be `string`).
- **Invalid property name**: use `@coco.name("...")` to make it alphanumeric and ≤ 32 chars.
- **People connector missing `personAccount`**: add `@coco.label("personAccount")` to the person account identifier.
- **People connector includes `@coco.content`**: remove it and represent data as schema properties instead.
- **People label missing entity mapping**: add `@coco.source("column", "entity.path")` to each people-labeled property (recommended). If you skip it, implement the JSON payload manually in generated transforms/overrides.
