# End-user guide

This guide walks you through writing TypeSpec (`.tsp`) files, running `cocogen`, and working safely with the generated projects.

## Prerequisites
- Node.js 22+ (the generator targets Node 22 LTS)
- A TypeSpec schema file (`.tsp`)
- For generated projects: Azure app registration + Microsoft Graph permissions (see each generated project README)

## 1) Create your TypeSpec schema

### Generate a starter schema (prompt)
```bash
npx @wictorwilen/cocogen@latest init-tsp --prompt
```

Non-interactive:
```bash
npx @wictorwilen/cocogen@latest init-tsp --out ./schema.tsp --kind content
```

`init-tsp` also creates `package.json` and `tspconfig.yaml` alongside the schema if they are missing.

### Minimal content connector
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

### Minimal people connector (preview)
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

### Required rules
- Exactly one model must be marked with `@coco.item()`.
- Exactly one property must be marked with `@coco.id` (and it must be `string`).
- The model must be flat (no nested objects or models).
- Property names in Graph must be alphanumeric and ≤ 32 characters. Use `@coco.name("...")` if needed.
- People-labeled properties must define at least one `@coco.source("column", "entity.path")` mapping.

### Common decorators you will use
- `@coco.label("...")` — marks Graph property labels (including people labels)
- `@coco.search({ ... })` — search flags for Graph schema
- `@coco.content({ type: "text" })` — full-text content field (not allowed for people connectors)
- `@coco.source("csvHeader")` — map a property to a CSV header
- `@coco.source("csvHeader", "entity.path")` — people entity mapping from CSV to entity path
- `@coco.connection({ contentCategory, connectionId?, connectionDescription? })`
- `@coco.profileSource({ webUrl, displayName?, priority? })` (people connectors)

For the complete spec and validation rules, see docs/typespec.md.

### Fixing TypeSpec editor squiggles (VS Code)
Starter schemas created by `init-tsp` include `tspconfig.yaml` and a local `package.json`. To let the TypeSpec language server resolve `using coco;`:
- TypeScript projects: run `npm install` (installs `@wictorwilen/cocogen`).
- .NET projects: run `npm install` in the project folder (installs `@wictorwilen/cocogen`).

## 2) Validate the schema
```bash
npx @wictorwilen/cocogen@latest validate --tsp ./schema.tsp
```

If you use Graph beta features (for example `contentCategory: "people"`), pass:
```bash
npx @wictorwilen/cocogen@latest validate --tsp ./schema.tsp --use-preview-features
```

## 3) Generate a project

### TypeScript
```bash
npx @wictorwilen/cocogen@latest init --tsp ./schema.tsp --out ./my-connector
```

### .NET
```bash
npx @wictorwilen/cocogen@latest init --tsp ./schema.tsp --out ./my-connector --lang dotnet
```

Preview-only schemas require the flag:
```bash
npx @wictorwilen/cocogen@latest init --tsp ./schema.tsp --out ./my-connector --use-preview-features
```

## 4) Update generated code after schema changes
After `init`, the project contains a `schema.tsp` copy and a `cocogen.json` that records the entry `.tsp` file.

Regenerate TypeSpec-derived files:
```bash
npx @wictorwilen/cocogen@latest update --out ./my-connector
```

Override the TypeSpec file (also updates `cocogen.json`):
```bash
npx @wictorwilen/cocogen@latest update --out ./my-connector --tsp ../schema.tsp
```

## 5) Working with generated TypeScript projects

### Layout and what you can edit
- `src/schema/**` — generated files. These are overwritten by `cocogen update`.
- `src/schema/propertyTransform.ts` — created once; safe for manual edits.
- `src/datasource/**` — **editable**. Customize how items are read (CSV, APIs, databases).
- `src/cli.ts` — **editable**. Controls provisioning/ingestion commands.
- `src/index.ts` — **editable**. Main entrypoint and pipeline composition.
- `.env` / `.env.example` — configuration values (client credentials, connection defaults, CSV path).

### Typical flow
```bash
npm install
npm run build
node dist/cli.js provision
node dist/cli.js ingest --csv ./data.csv
```

Ingest debugging flags:
- `--dry-run` builds payloads but does not send to Graph
- `--limit <n>` limits items ingested
- `--verbose` prints item payloads

### Where to customize mapping
- Prefer editing the TypeSpec file and re-running `cocogen update`.
- Generated mapping helpers live in `src/schema/*` and are overwritten on update.
- Use `src/schema/propertyTransform.ts` for manual mapping tweaks (safe file).
- For advanced transforms, extend the ingestion pipeline in `src/index.ts` or `src/datasource/*`.

### Switching from CSV to another datasource (TypeScript)
1) Implement `ItemSource` in `src/datasource`.
2) Map your raw records to `Item` objects (you can reuse `fromCsvRow` logic or create your own mapping).
3) Update `src/cli.ts` to instantiate your new source instead of `CsvItemSource`.

## 6) Working with generated .NET projects

### Layout and what you can edit
- `Schema/**` — generated files. These are overwritten by `cocogen update`.
- `Schema/PropertyTransform.cs` — created once; safe for manual edits.
- `Datasource/**` — **editable**. Customize how items are read (CSV, APIs, databases).
- `Program.cs` and `Program.commandline.cs` — **editable**. CLI and pipeline wiring.
- `appsettings.json` — configuration values (client credentials, connection defaults, CSV path).

### Typical flow
```bash
dotnet build
dotnet run -- provision
dotnet run -- ingest --csv ./data.csv
```

Ingest debugging flags:
- `--dry-run` builds payloads but does not send to Graph
- `--limit <n>` limits items ingested
- `--verbose` prints item payloads

### Where to customize mapping
- Prefer editing the TypeSpec file and re-running `cocogen update`.
- Generated mapping helpers live in `Schema/*` and are overwritten on update.
- Use `Schema/PropertyTransform.cs` for manual mapping tweaks (safe file).
- For advanced transforms, extend the ingestion pipeline in `Program.cs` or `Datasource/*`.

### Switching from CSV to another datasource (.NET)
1) Implement `IItemSource` in `Datasource/`.
2) Map your raw records to `Item` objects (you can reuse `FromCsvRow` logic or create your own mapping).
3) Update `Program.cs` to instantiate your new source instead of `CsvItemSource`.

## 7) Common customization scenarios

### Change connection defaults
- Update `@coco.connection({ connectionId, connectionDescription })` in your TypeSpec.
- Re-run `cocogen update`.
- Update `.env` (TS) or `appsettings.json` (.NET) as needed.

### Change CSV headers
- Update `@coco.source("header")` in the TypeSpec.
- Re-run `cocogen update`.
- Update your CSV file headers accordingly.

### Add/modify people profile data
- Use people labels like `personName` or `personCurrentPosition`.
- Use `@coco.source("header", "entity.path")` to map CSV columns into the profile entity fields.
- For collection properties (`string[]`), CSV values can be separated with `;` and will be aligned by index.
- For custom entity shaping, edit the overrides file (safe file):
- For custom entity shaping, edit the overrides file (safe file):
  - TS: `src/schema/propertyTransform.ts`
  - .NET: `Schema/PropertyTransform.cs`

## 8) Troubleshooting

- If `cocogen` reports a beta requirement, re-run with `--use-preview-features`.
- If schema validation fails, run `cocogen validate` first to see actionable errors and hints.
- If your custom edits get overwritten, move them out of the generated schema folder or into the overrides file.

## Further reference
- Full TypeSpec format: docs/typespec.md
- Design details: docs/architecture.md
