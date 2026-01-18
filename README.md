# cocogen

A TypeSpec-driven generator (run via `npx`) for scaffolding Microsoft Graph External Connections (Microsoft 365 Copilot connectors) projects.

- Input: a TypeSpec (`.tsp`) file describing the external item schema
- Output: a runnable project in TypeScript/Node.js or C#/.NET that can:
  - create an external connection
  - register/update the schema
  - ingest content from CSV (with a swappable datasource abstraction)

Design spec: see docs/architecture.md

End-user guide:
- docs/end-user.md

## TypeSpec format
`cocogen` expects a single “item model” decorated with `@coco.item()` and a single ID property decorated with `@coco.id`.

Start here:
- docs/typespec.md

Examples:
- examples/content-connector.tsp
- examples/people-connector.tsp

## Requirements
- Node.js 22+ (the generator targets Node 22 LTS)
- A TypeSpec schema file (`.tsp`)

## Install / Run
No install needed:

```bash
npx @wictorwilen/cocogen@latest --help
```

## Commands

### Create a starter TypeSpec file (prompt)

```bash
npx @wictorwilen/cocogen@latest init-tsp --prompt
```

Non-interactive:

```bash
npx @wictorwilen/cocogen@latest init-tsp --out ./schema.tsp --kind content
```

`init-tsp` also creates `package.json` and `tspconfig.yaml` in the same folder (if missing) so TypeSpec can resolve `@wictorwilen/cocogen` without squiggles.

### Validate a schema

```bash
npx @wictorwilen/cocogen@latest validate --tsp ./schema.tsp
```

If your schema uses Graph beta features (for example `contentCategory` or people connectors), add:

```bash
npx @wictorwilen/cocogen@latest validate --tsp ./schema.tsp --use-preview-features
```

JSON output (useful in CI):

```bash
npx @wictorwilen/cocogen@latest validate --tsp ./schema.tsp --json
```

### Emit IR JSON

```bash
npx @wictorwilen/cocogen@latest emit --tsp ./schema.tsp
```

For beta schemas:

```bash
npx @wictorwilen/cocogen@latest emit --tsp ./schema.tsp --use-preview-features
```

Write to a file:

```bash
npx @wictorwilen/cocogen@latest emit --tsp ./schema.tsp --out ./connector.ir.json
```

### Generate a runnable TypeScript project

```bash
npx @wictorwilen/cocogen@latest init --tsp ./schema.tsp --out ./my-connector
```

For beta schemas:

```bash
npx @wictorwilen/cocogen@latest init --tsp ./schema.tsp --out ./my-connector --use-preview-features
```

Overwrite an existing non-empty folder:

```bash
npx @wictorwilen/cocogen@latest init --tsp ./schema.tsp --out ./my-connector --force
```

Notes:
- `cocogen` will fail fast if the schema is invalid.
- Beta features require `--use-preview-features`.

### Update generated code after changing TypeSpec

After `init`, the project contains a `cocogen.json` that records which `.tsp` file to use.

When you change the schema, regenerate only the TypeSpec-derived files:

```bash
npx @wictorwilen/cocogen@latest update --out ./my-connector
```

Override the TypeSpec entrypoint (also updates `cocogen.json`):

```bash
npx @wictorwilen/cocogen@latest update --out ./my-connector --tsp ../schema.tsp
```

## Generated project layout (TypeScript)
`cocogen` intentionally separates:

- `src/schema/**` — generated from TypeSpec (safe to overwrite on `cocogen update`)
- `src/**` (non-generated) — runtime code you can edit safely (should not change on update)

## CLI output & colors
- Colors are enabled by default in TTYs.
- Set `NO_COLOR=1` to disable colors/spinners.
- In CI/non-TTY, spinners are automatically disabled.

## Development

```bash
npm install
npm test
```

Build output is in `dist/`. The CLI is `dist/cli.js`.

## License
MIT. See LICENSE.

## Trademarks
Microsoft, Microsoft Graph, and Microsoft 365 are trademarks of Microsoft Corporation.
