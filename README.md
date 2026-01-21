# cocogen

![cocogen logo](images/logo.png)

[![npm version](https://img.shields.io/npm/v/@wictorwilen/cocogen.svg)](https://www.npmjs.com/package/@wictorwilen/cocogen)
[![npm downloads](https://img.shields.io/npm/dm/@wictorwilen/cocogen.svg)](https://www.npmjs.com/package/@wictorwilen/cocogen)
[![license](https://img.shields.io/npm/l/@wictorwilen/cocogen.svg)](https://github.com/wictorwilen/cocogen/blob/main/LICENSE)
[![node version](https://img.shields.io/node/v/@wictorwilen/cocogen.svg)](https://www.npmjs.com/package/@wictorwilen/cocogen)

🚀 **Ship Microsoft 365 Copilot connectors fast** — from a single TypeSpec file to a runnable, production-ready project.

`cocogen` is a TypeSpec-driven generator (run via `npx`) for scaffolding Microsoft Graph External Connections (Microsoft 365 Copilot connectors) projects.

**You bring:** a `.tsp` schema.  
**You get:** a runnable TypeScript or C# connector project with clear defaults, great structure, and a friendly CLI. ✨

## Why cocogen? 💡
- **Schema-first workflow** — define your external item once in TypeSpec.
- **Runnables out of the box** — provision connections, register schemas, and ingest data.
- **People connectors ready** — profile source registration and person entity mappings.
- **Preview-aware** — beta features like `contentCategory` are supported with a flag.
- **Swappable datasource** — CSV included, plug in your own source easily.
- **Safe updates** — regenerate only schema-derived code via `cocogen update`.

## What you can do with the generated project 🔧
- ✅ Create or update an external connection
- ✅ Patch schema changes
- ✅ Ingest items from CSV (or your own datasource)
- ✅ Retry throttled requests with backoff + logging
- ✅ Customize transforms without losing changes on update

End-user guide:
- [docs/end-user.md](https://github.com/wictorwilen/cocogen/blob/main/docs/end-user.md)

Agent schema guidance:
- [docs/schema-assistant.md](https://github.com/wictorwilen/cocogen/blob/main/docs/schema-assistant.md)

## TypeSpec format
`cocogen` expects a single “item model” decorated with `@coco.item()` and a single ID property decorated with `@coco.id`.

Example (product):

```tsp
import "@wictorwilen/cocogen";
using coco;

@coco.connection({
	name: "Product catalog",
	connectionId: "productcatalog",
	connectionDescription: "External product catalog",
	contentCategory: "uncategorized"
})
@coco.item()
model Product {
	@coco.id
	@coco.description("Unique product identifier.")
	@coco.search({ queryable: true, retrievable: true })
	productId: string;

	@coco.label("title")
	@coco.description("Display name shown in search results.")
	@coco.search({ searchable: true, retrievable: true })
	name: string;

	@coco.label("url")
	@coco.description("Canonical product page URL.")
	@coco.search({ retrievable: true })
	url: string;

	@coco.content({ type: "text" })
	description: string;
}
```

Start here:
- [docs/typespec.md](https://github.com/wictorwilen/cocogen/blob/main/docs/typespec.md)

Examples:
- [examples/content-connector.tsp](https://github.com/wictorwilen/cocogen/blob/main/examples/content-connector.tsp)
- [examples/people-connector.tsp](https://github.com/wictorwilen/cocogen/blob/main/examples/people-connector.tsp)

## Requirements
- Node.js 22+ (the generator targets Node 22 LTS)
- A TypeSpec schema file (`.tsp`)
- Generated projects support managed identity (preferred) or client secret auth.

## Install / Run
No install needed:

```bash
npx @wictorwilen/cocogen@latest --help
```

Global install (system-wide command):

```bash
npm i -g @wictorwilen/cocogen
cocogen --help
```

## Commands

| Command | Purpose | Arguments |
| --- | --- | --- |
| `init` | Create a starter TypeSpec file | `--out <path>`, `--kind <content\|people>`, `--prompt`, `--force` |
| `validate` | Validate a TypeSpec schema | `--tsp <path>`, `--json`, `--use-preview-features` |
| `generate` | Generate a runnable connector project | `--tsp <path>`, `--out <dir>`, `--lang <ts\|dotnet>`, `--name <name>`, `--force`, `--use-preview-features` |
| `update` | Regenerate TypeSpec-derived code in a generated project | `--out <dir>`, `--tsp <path>`, `--use-preview-features` |
| `emit` | Emit cocogen IR as JSON | `--tsp <path>`, `--out <path>`, `--use-preview-features` |

Notes:
- `--use-preview-features` is required for Graph beta schemas (for example people connectors).

### Create a starter TypeSpec file

```bash
npx @wictorwilen/cocogen@latest init --prompt
```

`init` also creates `package.json` and `tspconfig.yaml` in the same folder (if missing) so TypeSpec can resolve `@wictorwilen/cocogen`.

### Validate a schema

```bash
npx @wictorwilen/cocogen@latest validate --tsp ./schema.tsp
```

Use `--use-preview-features` for Graph beta schemas (for example people connectors).

### Generate a runnable project

```bash
npx @wictorwilen/cocogen@latest generate --tsp ./schema.tsp --out ./my-connector
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

- `src/<ConnectionName>/**` — generated from TypeSpec (safe to overwrite on `cocogen update`)
- `src/**` (non-generated) — runtime code you can edit safely (should not change on update)

## CLI output & colors
- Colors are enabled by default in TTYs.
- Set `NO_COLOR=1` to disable colors/spinners.
- In CI/non-TTY, spinners are automatically disabled.

## License
MIT. See LICENSE.

## Trademarks
Microsoft, Microsoft Graph, Microsoft 365, and Microsoft 365 Copilot are trademarks of Microsoft Corporation.
