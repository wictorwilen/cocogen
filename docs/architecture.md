# cocogen — TypeSpec-driven Microsoft Copilot Connector generator

## 1. Summary
`cocogen` is an `npx`-runnable generator that:
1) reads a TypeSpec (`.tsp`) file describing a flat external-item schema,
2) scaffolds either:
   - a TypeScript/Node.js project, or
   - a C#/.NET project,
3) provisions a Microsoft Graph External Connection ("Copilot Connector") and registers the schema,
4) ingests content from a CSV file into the connection as external items,
5) isolates the data source behind an interface so CSV can be swapped for DB / API / etc.

This spec defines the CLI UX, internal architecture, TypeSpec mapping rules, and the generated project outputs.

## 2. Goals / Non-goals
### Goals
- `npx` experience: `npx cocogen@latest ...` (or scoped package) generates a runnable project.
- Input: TypeSpec file is the schema source of truth.
- Output: scaffolded TS or C# project that can:
  - create connection
  - register/update schema
  - ingest items (CSV as baseline)
- Pluggable source model: swap CSV out with minimal changes.
- Reasonable defaults for:
  - auth (app-only)
  - ACL (Everyone) for sample
  - rate limiting/backoff

### People connectors (preview) goals
- Support generating Microsoft 365 Copilot connectors for people data ("People connectors") by:
  - setting `externalConnection.contentCategory = "people"` (Graph **beta** at time of writing)
  - enforcing people-specific schema rules (labels + constraints)
  - enforcing the required `acl` semantics for items (Everyone)
  - documenting the required post-provision registration steps (profile source + prioritized sources)

### Non-goals (initial)
- Full connector “admin center configuration” automation (e.g., customizing result types/UI) beyond what Graph APIs provide.
- Crawling/sync scheduling (we’ll generate a CLI app/library; hosting is user’s choice).
- Full fidelity mapping of every Graph connector feature (activities, external groups, compliance templates, etc.)

## 3. Primary user flows
### 3.1 Generate a project
User has `schema.tsp` and runs:
- `npx cocogen generate --tsp ./schema.tsp --lang ts --out ./my-connector`
- `npx cocogen generate --tsp ./schema.tsp --lang dotnet --out ./my-connector`

If they need a starter schema, they can scaffold one first:
- `npx cocogen init --prompt`

`init` also writes a `package.json` and `tspconfig.yaml` next to the schema (if missing) so the TypeSpec language server can resolve `@wictorwilen/cocogen`.

Generator produces:
- project skeleton
- generated strongly-typed model(s)
- schema registration payload

### 3.2 Provision the connection & schema

### 3.4 Update generated code after changing TypeSpec
User edits their `.tsp` file and runs:
- `npx cocogen update --out ./my-connector`

This regenerates **only** the TypeSpec-derived files under `src/<ConnectionName>/**`.

The generated project also contains a `cocogen.json` file that records which `.tsp` entrypoint to use. If needed, the user can override the entrypoint:
- `npx cocogen update --out ./my-connector --tsp ../schema.tsp`
- The generated project also includes `AGENTS.md` with quick instructions for re-running `cocogen update`, customizing property transforms, and swapping the datasource backend.
- calls `POST /external/connections` (create connection)
- calls `PATCH /external/connections/{id}/schema` (register schema)

- set `contentCategory` on the connection to `people` (Graph beta)
- `cocogen update`
  - regenerates TypeSpec-derived code inside an existing generated project

Generated project runs:
- `npm run ingest -- --csv ./data.csv`
- `dotnet run -- ingest --csv ./data.csv`


Notes (current implementation):
- `cocogen generate` supports `--lang ts|dotnet`.
- `cocogen update` takes `--out` and optional `--tsp`.
- `cocogen validate`
  - validates TypeSpec vs Graph connector constraints (names, types, labels)
Common:
- `--tsp <path>`: entry TypeSpec file.
- `--out <dir>`: output directory.
- `--lang <ts|dotnet>`: target project.
- `--item-type <ModelName>`: which TypeSpec model represents an `externalItem`.
- `--csv <path>`: (optional) seed CSV path copied into project.

Current state:
- This repo is a single TypeScript package.
- The CLI is compiled to `dist/` and runs as `cocogen`.
- `--yes`: skip prompts.


Current state:
- Templates are EJS files under `src/init/templates/**`.
- Build copies templates to `dist/init/templates/**` so the compiled CLI can render them at runtime.
- Template rendering must not HTML-escape output (codegen output is TypeScript).

### 7.3 Generated vs static separation
The generator output is intentionally split:
- `src/<ConnectionName>/**` is derived from TypeSpec and may be overwritten at any time.
- Everything else in the generated project is “runtime” code and should remain stable across schema updates.

The `cocogen update` command regenerates only `src/<ConnectionName>/**` based on the `.tsp` referenced by `cocogen.json`.
- which field (if any) is the content body (full-text)

## 5. TypeSpec input & extensions
Microsoft Graph connector schema is a **flat** property list (not nested). TypeSpec, however, can model nested types; we must either (a) restrict, or (b) flatten.

### 5.1 Baseline interpretation
- One “item model” represents an external item.
- Each property becomes a Graph schema property.
- A special field becomes the `itemId` used in the `PUT .../items/{itemId}` URL.
- Optionally (content connectors only), a “content” field becomes `externalItem.content.value` (full-text).

### 5.2 Proposed decorators (TypeSpec additions)
`cocogen` ships a small decorator library in the `coco` namespace. User schemas typically start with `using coco;` and then apply decorators.

- `@coco.item()` on a model: marks it as the external item type.
- `@coco.id()` on a string property: marks it as the item id.
- `@coco.label("title" | "url" | ... )` on a property: maps to Graph `labels`.
- `@coco.aliases("...")` repeatable: maps to Graph `aliases`.
- `@coco.search({ searchable?: boolean, queryable?: boolean, retrievable?: boolean, refinable?: boolean, exactMatchRequired?: boolean })`
- `@coco.description("...")`: maps to Graph schema property `description` (and may also be used for generated help/docs).
- `@coco.content({ type?: "text" })` on a property: marks full-text source for `externalItem.content`.
- `@coco.source(...)` on a property: maps the property to a source field (CSV header).
  - `@coco.noSource` marks a property as having no CSV source mapping (value computed elsewhere).
  - Multi-column source transforms are deferred to a future version; preprocess input data instead.

Notes on People connectors:
- People connectors do not support `externalItem.content`; all data must be represented as schema properties.

People connectors (preview) helpers:
- `@coco.connection({ contentCategory?, name, connectionId, connectionDescription })` on the item model: sets connection-level settings in IR (Graph /beta `externalConnection.contentCategory`).
- `contentCategory` MUST be specified in the TypeSpec input (not as a `cocogen` CLI flag) because it changes downstream validation and may require Graph beta.
- Graph beta usage requires `cocogen --use-preview-features` so that beta endpoints and SDKs are explicitly opt-in.
- People-domain labels are validated against the supported set (preview):
  - `personAccount`, `personName`, `personCurrentPosition`, `personAddresses`, `personEmails`, `personPhones`,
    `personAwards`, `personCertifications`, `personProjects`, `personSkills`, `personWebAccounts`, `personWebSite`,
    `personAnniversaries`, `personNote`.
- Repeated `@coco.source(...)` (with `to`) builds JSON-serialized profile entities. The entity is inferred from the people label:
  - personAccount → userAccountInformation
  - personName → personName
  - personCurrentPosition → workPosition
  - personAddresses → itemAddress
  - personEmails → itemEmail
  - personPhones → itemPhone
  - personAwards → personAward
  - personCertifications → personCertification
  - personProjects → projectParticipation
  - personSkills → skillProficiency
  - personWebAccounts → webAccount
  - personWebSite → personWebsite
  - personAnniversaries → personAnniversary
  - personNote → personAnnotation

Generated projects include a `PropertyTransform` override (TS/.NET) so you can customize how values and entity JSON are built. Defaults are generated in `PropertyTransformBase` from the TypeSpec fields.

Validation rule:
- People-labeled properties should define at least one `@coco.source(..., to)` mapping so the generator can build default JSON entity payloads. If omitted, validation warns and you must implement mapping manually in generated transforms/overrides.

Note:
- `@coco.search` flags are ignored by Microsoft Graph for people connectors. `cocogen validate` emits a warning when they are used in people schemas.

Notes:
- Graph schema property names must be alphanumeric, max 32 chars. If TypeSpec name violates rules, generator requires `@coco.name("...")`.
- Graph schema properties support a `description` field; `cocogen` MUST emit it.
  - Default source: `@coco.description("...")`.
  - If missing, `cocogen` SHOULD fall back to the TypeSpec doc comment (if present) as the schema property description.

### 5.3 Type mapping
TypeSpec → Graph `propertyType` mapping (initial):
- `string` → `string`
- `boolean` → `boolean`
- `int32 | int64` → `int64`
- `float32 | float64` → `double`
- `utcDateTime` → `dateTime`
- `string[]` → `stringCollection`

Additional scalar mappings:
- `coco.Principal` (custom scalar) → `principal` (Graph /beta)

Constraints enforced:
- Only `string` and `stringCollection` can be `searchable`.
- `refinable` cannot be combined with `searchable`.
- Max properties: 128.
- Properties assigned to semantic labels must be `retrievable`.
- Semantic labels must match expected property types (for example, `createdDateTime` → `dateTime`).

Notes on `principalCollection`:
- Microsoft Graph external connectors schema `propertyType` (beta) includes `principal` but **does not list** `principalCollection`.
- Therefore, `cocogen validate` MUST fail if a schema attempts to emit `principalCollection`.
- If we later discover official support, we can add it behind a feature flag; until then, no "silent" generation.

### 5.4 Flattening policy
Initial version: **no nested objects**.
- If nested models are used, `cocogen validate` errors and suggests flattening.

(If we later support flattening, we can generate names like `address_city`, but that must still meet Graph constraints.)

## 6. Intermediate representation (IR)
We standardize on a language-neutral IR so both TS and C# generators share logic.

`connector.ir.json` (conceptually):
- `connection`: id, name, description
  - `contentCategory?`: string (for example `people`)
  - `graphApiVersion`: `v1.0 | beta` (derived from `contentCategory` rules)
- `item`:
  - `typeName`
  - `idProperty`
  - `contentProperty?`
- `properties[]`:
  - `name`
  - `type`
  - `description?`
  - `search`: flags
  - `labels[]`
  - `aliases[]`
  - `source`: csv header mapping info
    - `csvHeaders[]` (one or more source columns)
    - `csvHeaders[]` (source columns; currently only one is supported)

Schema emission rule:
- `properties[].description` MUST be emitted as `externalConnectors.property.description` in the schema registration payload.

People connectors (preview) validation state (derived):
- `people?: { enabled: boolean }`

TypeSpec compilation pipeline:
- `@typespec/compiler` program → walk models/decorators → emit IR.

## 7. Generator architecture (cocogen package)
### 7.1 Packages / modules
Monorepo recommended (single repo, multiple packages):
- `packages/cocogen-cli` — the `npx` CLI.
- `packages/cocogen-core` — TypeSpec → IR, validation, shared helpers.
- `packages/cocogen-templates` — embedded project templates.

(We can start single-package and split later; core separation is still useful in code layout.)

### 7.2 Key components
- **TypeSpecLoader**: compiles TypeSpec, evaluates decorators, creates IR.
- **Validator**: checks Graph constraints (names, types, schema rules).
- **ProjectWriter**: copies template files + applies render variables.
- **CodeEmitter**: emits:
  - schema registration payload code
  - model code
  - mapping code (CSV row → external item)
- **Template engine**: minimal mustache/handlebars/ejs, or custom simple token replacement.

### 7.3 Output templates
Each language template contains:
- a CLI runner (`src/index.ts` or `Program.cs`)
- `GraphConnectorClient` wrapper for Graph calls
- `SchemaRegistrar` (create connection + patch schema)
- `IngestionService` (iterates items from datasource)
- `IDataSource` interface + `CsvDataSource` implementation

## 8. Generated project architecture (TypeScript)
### 8.1 Dependencies
- Auth: `@azure/identity` for client credentials.
- Graph: `@microsoft/microsoft-graph-client` (or Graph SDK equivalent).
- CSV parsing: `csv-parse` or similar.
- Config: `dotenv`.

### 8.2 Module sketch
- `src/config.ts` loads env.
- `src/graph/graphClient.ts` builds Graph client.
- `src/graph/connection.ts` create connection.
- `src/graph/schema.ts` patch schema.
- `src/graph/items.ts` put items.
- `src/datasource/IItemSource.ts` + `src/datasource/CsvItemSource.ts`.
- `src/ingest/ingest.ts` orchestrator.

### 8.3 Auth model
Default: app-only client credentials.
- `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET` (or certificate as an optional alternative).

## 9. Generated project architecture (C#/.NET)
### 9.1 Dependencies
- `Azure.Identity`
- `Microsoft.Graph.Beta`
- CSV: `CsvHelper`
- Config: `Microsoft.Extensions.Configuration.*`

### 9.2 Structure
- `Program.cs` with commands `provision`, `ingest`, `register-profile-source` (people), and `delete`
- `GraphConnectorClient` wrapper
- `IDataSource<T>` + `CsvDataSource`

## 10. Content ingestion details
### 10.1 externalItem shape
For each item:
- `acl`: default `[ { type: "everyone", value: "everyone", accessType: "grant" } ]` (configurable)
- `properties`: the mapped schema fields
- `content`: always included. If `@coco.content` is present, `content.value` is derived from it; otherwise `content.value` is an empty string and `content.type` is "text".

People connectors (preview) overrides:
- Item `acl` MUST grant access to everyone (generated templates should enforce this).

### 10.2 Id strategy
- Item id is mandatory.
- Default: `@coco.id` field.
- If missing, generator prompts and inserts `@coco.id` into TypeSpec (optional “fix mode”).

### 10.3 CSV mapping
- Default mapping: CSV header names match schema property names.
- Override mapping with TypeSpec:
  - `@coco.source("headerName")` to map a different CSV column.
  - `@coco.source("firstName")` to map a CSV column to a property.
  - `@coco.source("job title", "detail.jobTitle")` to map CSV columns into a JSON entity payload (people connectors only).

Type conversion rules (generated code):
- `string`: pass through.
- `int64`, `double`, `boolean`, `dateTime`: parse from string with clear error messages (row/column context).
- `...Collection`: accept either a JSON array string (preferred) or a delimiter-split string (semicolon-only).
- `principal`: accept a JSON object string (recommended) and parse to an object shape compatible with Microsoft Graph `externalConnectors.identity` (`{ id: string, type: "user"|"group"|"externalgroup" }`).
  - If the cell is empty, treat as missing/undefined.
  - Validation should ensure this property is *not* marked `searchable`.

### 10.4 Throttling & retries
Graph ingestion will be throttled.
- Provide exponential backoff for 429/5xx.
- Concurrency control (configurable batch size, parallelism).

## 11. Operational concerns
- Provisioning is idempotent: if connection exists, continue; if schema exists, update.
- Ingest supports:
  - `--dry-run`
  - `--limit N`
  - `--since` (future)
- Logging: structured logs to stdout.

### 11.1 Graph API versioning strategy (beta vs v1.0)
- Generated projects should default to calling Microsoft Graph `v1.0`.
- If `contentCategory` is set (Graph exposes this property on `/beta`), generated provisioning must use Graph `beta` for the connection create/update call.
- Schema patch and item ingestion endpoints should use the minimum required version; if the generated project uses a single base URL for simplicity, it may use `beta` throughout in people mode.
- Config surface (generated project runtime only):
  - TS: `GRAPH_API_VERSION=v1.0|beta` env var override.
  - .NET: `GraphApiVersion` setting.

### 11.2 People connectors (preview) operational steps
People connectors require additional steps after provisioning to be treated as profile sources.

Generated output should:
- Include a `README` section describing the required steps and pointing to the official people connectors guidance.
- Include a command that registers the connection as a profile source and updates prioritized source settings using Graph beta admin APIs.
- Allow configuring whether the profile source is inserted first or last in `prioritizedSourceUrls`.

At minimum, the generated output must not claim to be "fully configured" until these admin steps are completed.

### 11.3 Multiple connections
The generated CLIs currently target a single connection via configuration. Multi-connection support is planned.

## 12. Decisions (resolved)
- Package name: `@wictorwilen/cocogen`.
- TypeSpec conventions: no existing conventions to preserve.
- Experiences: only Search/Copilot.
- Auth: app-only or managed credentials (no device code).
- ACL: simple only.
- Generator behavior: read-only TypeSpec input; provide feedback.
- CSV: “standard-ish” defaults.
- `principalCollection`: hard-fail validation (no escape hatch) until Microsoft Graph docs list it as supported.

## 13. Implementation plan (high-level milestones)
1) Build `cocogen validate` + IR emission from TypeSpec.
2) TS template: provision + ingest from CSV (working end-to-end).
3) C# template: provision + ingest from CSV.
4) Improve ergonomics: prompts, `.env.example`, sample CSV, docs.
5) Add datasource plugin interface + second sample (e.g., SQLite) to prove swap-ability.
