# gcgen — TypeSpec-driven Microsoft Graph (Copilot) Connector generator

## 1. Summary
`gcgen` is an `npx`-runnable generator that:
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
- `npx` experience: `npx gcgen@latest ...` (or scoped package) generates a runnable project.
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
- `npx gcgen init --tsp ./schema.tsp --lang ts --out ./my-connector`
- `npx gcgen init --tsp ./schema.tsp --lang dotnet --out ./my-connector`

Generator produces:
- project skeleton
- generated strongly-typed model(s)
- schema registration payload
- CSV ingestion pipeline + datasource interface
- sample `.env.example` / `appsettings.json`

### 3.2 Provision the connection & schema
Generated project runs:
- `npm run provision` (TS)
- `dotnet run -- provision` (C#)

It:
- calls `POST /external/connections` (create connection)
- calls `PATCH /external/connections/{id}/schema` (register schema)

People connectors (preview) additionally:
- set `contentCategory` on the connection to `people` (Graph beta)
- require extra admin/people steps after provisioning (see "People connectors (preview) operational steps")

### 3.3 Ingest items from CSV
Generated project runs:
- `npm run ingest -- --csv ./data.csv`
- `dotnet run -- ingest --csv ./data.csv`

It:
- reads CSV rows
- converts each row to `externalItem` shape
- calls `PUT /external/connections/{id}/items/{itemId}` per item

## 4. CLI design (gcgen)
### 4.1 Commands
- `gcgen init`
  - generates a TS or C# project from TypeSpec
- `gcgen validate`
  - validates TypeSpec vs Graph connector constraints (names, types, labels)
- `gcgen emit`
  - emits an intermediate JSON representation (IR) from TypeSpec (useful for debugging and CI)

### 4.2 Flags
Common:
- `--tsp <path>`: entry TypeSpec file.
- `--out <dir>`: output directory.
- `--lang <ts|dotnet>`: target project.
- `--name <string>`: connection name (defaults derived from folder).
- `--connection-id <string>`: Graph connection id (optional at generation time).
- `--item-type <ModelName>`: which TypeSpec model represents an `externalItem`.
- `--csv <path>`: (optional) seed CSV path copied into project.
- `--yes`: skip prompts.

### 4.3 Prompted values (if missing)
- connection id (must be unique in tenant; usually lowercase alphanumeric)
- connection display name + description
- item type (if multiple candidates)
- which field is the item id
- which field (if any) is the content body (full-text)

## 5. TypeSpec input & extensions
Microsoft Graph connector schema is a **flat** property list (not nested). TypeSpec, however, can model nested types; we must either (a) restrict, or (b) flatten.

### 5.1 Baseline interpretation
- One “item model” represents an external item.
- Each property becomes a Graph schema property.
- A special field becomes the `itemId` used in the `PUT .../items/{itemId}` URL.
- Optionally, a “content” field becomes `externalItem.content.value` (full-text).

### 5.2 Proposed decorators (TypeSpec additions)
We define a small decorator library (names are tentative):

- `@gc.item()` on a model: marks it as the external item type.
- `@gc.id()` on a string property: marks it as the item id.
- `@gc.label("title" | "url" | ... )` on a property: maps to Graph `labels`.
- `@gc.alias("...")` repeatable: maps to Graph `aliases`.
- `@gc.search({ searchable?: boolean, queryable?: boolean, retrievable?: boolean, refinable?: boolean, exactMatchRequired?: boolean })`
- `@gc.description("...")`: used for docstrings + optional generated help.
- `@gc.content({ type?: "text" })` on a property: marks full-text source for `externalItem.content`.

People connectors (preview) helpers:
- `@gc.connection({ contentCategory?: "content" | "people" | string })` on the item model (or a dedicated config model): sets connection-level settings in IR.
- `contentCategory` MUST be specified in the TypeSpec input (not as a `gcgen` CLI flag) because it changes downstream validation and may require Graph beta.
- `@gc.personLabel("personAccount" | "personEmails" | ... )` as a convenience alias for `@gc.label(...)` to make people-domain labels easier to discover.

Notes:
- Graph schema property names must be alphanumeric, max 32 chars. If TypeSpec name violates rules, generator requires `@gc.name("...")`.

### 5.3 Type mapping
TypeSpec → Graph `propertyType` mapping (initial):
- `string` → `string`
- `boolean` → `boolean`
- `int32 | int64` → `int64`
- `float32 | float64` → `double`
- `utcDateTime` → `dateTime`
- `string[]` → `stringCollection`

Additional scalar mappings:
- `gc.Principal` (custom scalar) → `principal`

Constraints enforced:
- Only `string` and `stringCollection` can be `searchable`.
- `refinable` cannot be combined with `searchable`.
- Max properties: 128.

Notes on `principalCollection`:
- Microsoft Graph external connectors schema `propertyType` (beta) includes `principal` but **does not list** `principalCollection`.
- Therefore, `gcgen validate` MUST fail if a schema attempts to emit `principalCollection`.
- If we later discover official support, we can add it behind a feature flag; until then, no "silent" generation.

### 5.4 Flattening policy
Initial version: **no nested objects**.
- If nested models are used, `gcgen validate` errors and suggests flattening.

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

People connectors (preview) validation state (derived):
- `people?: { enabled: boolean }`

TypeSpec compilation pipeline:
- `@typespec/compiler` program → walk models/decorators → emit IR.

## 7. Generator architecture (gcgen package)
### 7.1 Packages / modules
Monorepo recommended (single repo, multiple packages):
- `packages/gcgen-cli` — the `npx` CLI.
- `packages/gcgen-core` — TypeSpec → IR, validation, shared helpers.
- `packages/gcgen-templates` — embedded project templates.

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
- `Microsoft.Graph`
- CSV: `CsvHelper`
- Config: `Microsoft.Extensions.Configuration.*`

### 9.2 Structure
- `Program.cs` with commands `provision` and `ingest`
- `GraphConnectorClient` wrapper
- `IDataSource<T>` + `CsvDataSource`

## 10. Content ingestion details
### 10.1 externalItem shape
For each item:
- `acl`: default `[ { type: "everyone", value: "everyone", accessType: "grant" } ]` (configurable)
- `properties`: the mapped schema fields
- `content`: optional full-text content derived from `@gc.content` field

People connectors (preview) overrides:
- Item `acl` MUST grant access to everyone (generated templates should enforce this).

### 10.2 Id strategy
- Item id is mandatory.
- Default: `@gc.id` field.
- If missing, generator prompts and inserts `@gc.id` into TypeSpec (optional “fix mode”).

### 10.3 CSV mapping
- Default mapping: CSV header names match schema property names.
- Optional mapping config: `csvMapping.json` that maps `header` → `propertyName`.

Type conversion rules (generated code):
- `string`: pass through.
- `int64`, `double`, `boolean`, `dateTime`: parse from string with clear error messages (row/column context).
- `...Collection`: accept either a JSON array string (preferred) or a delimiter-split string (configurable).
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
- If `contentCategory` is set to `people` (People connectors preview), generated provisioning must use Graph `beta` for the connection create/update call to include `contentCategory`.
- Schema patch and item ingestion endpoints should use the minimum required version; if the generated project uses a single base URL for simplicity, it may use `beta` throughout in people mode.
- Config surface (generated project runtime only):
  - TS: `GRAPH_API_VERSION=v1.0|beta` env var override.
  - .NET: `GraphApiVersion` setting.

### 11.2 People connectors (preview) operational steps
People connectors require additional steps after provisioning to be treated as profile sources.

Generated output should:
- Include a `README` section describing the required steps and pointing to the official people connectors guidance.
- Optionally include a separate command (or documented script) that performs the "register profile source" and "prioritized sources" updates if/when those APIs are available to the calling app.

At minimum, the generated output must not claim to be "fully configured" until these admin steps are completed.

## 12. Decisions (resolved)
- Package name: `@wictorwilen/gcgen`.
- TypeSpec conventions: no existing conventions to preserve.
- Experiences: only Search/Copilot.
- Auth: app-only or managed credentials (no device code).
- ACL: simple only.
- Generator behavior: read-only TypeSpec input; provide feedback.
- CSV: “standard-ish” defaults.
- `principalCollection`: hard-fail validation (no escape hatch) until Microsoft Graph docs list it as supported.

## 13. Implementation plan (high-level milestones)
1) Build `gcgen validate` + IR emission from TypeSpec.
2) TS template: provision + ingest from CSV (working end-to-end).
3) C# template: provision + ingest from CSV.
4) Improve ergonomics: prompts, `.env.example`, sample CSV, docs.
5) Add datasource plugin interface + second sample (e.g., SQLite) to prove swap-ability.
