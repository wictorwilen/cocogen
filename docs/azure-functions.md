# Migrating a generated connector to Azure Functions (in place)

This guide converts an existing generated project into an Azure Functions project **without copying files to a new repo**. The generated folders stay where they are so `cocogen update` continues to work. You add Functions host files and function handlers around the generated code.

## Goals
- Keep generated files intact so `cocogen update` still works.
- Replace CLI entrypoints with Functions triggers.
- Use client secret or managed identity for auth.

---

# Part A — Node.js (TypeScript) generated project → Azure Functions (Core Tools v4, code-first)

## 1) Initialize Functions with Azure Functions Core Tools v4 (code-first)
Ensure Core Tools v4 is installed before you start:

```bash
npm i -g azure-functions-core-tools@4 --unsafe-perm true
func --version
```

In your generated project root, run Core Tools to scaffold the Functions host files **in place**:

```bash
func init --worker-runtime node --language typescript
```

This creates `host.json`, `local.settings.json`, `.funcignore`, and updates `package.json`/`tsconfig.json` as needed.

## 2) Add triggers with the code-first programming model (don’t move generated code)
Use the **new Node.js programming model** (code-first, no `function.json`). Create function entrypoints under `src/functions/`. **Do not move** the existing generated folders under `src/` (for example, `src/core`, `src/datasource`, `src/<SchemaFolder>`).

Example layout:
```
/<generated-project>
  /src
    /functions
      provision.ts
      ingest.ts
      delete.ts
    /core
    /datasource
    /<SchemaFolder>
```

Example trigger code (code-first):

```ts
// src/functions/provision.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getConnectorCore } from "./connector.js";

app.http("Provision", {
  authLevel: "function",
  methods: ["POST"],
  handler: async (_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const core = getConnectorCore();
    const { connectionId, connectionName, connectionDescription } = core.getConnectionSettings();

    await core.provision({ connectionId, connectionName, connectionDescription });
    if (core.isPeopleConnector()) {
      await core.provisionProfileSource(connectionId);
    }

    context.log("Provisioned connection", connectionId);
    return { status: 200 };
  },
});
```

```ts
// src/functions/delete.ts
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getConnectorCore } from "./connector.js";

app.http("Delete", {
  authLevel: "function",
  methods: ["POST"],
  handler: async (_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const core = getConnectorCore();
    const { connectionId } = core.getConnectionSettings();

    await core.deleteConnection(connectionId);
    context.log("Deleted connection", connectionId);
    return { status: 200 };
  },
});
```

```ts
// src/functions/ingest.ts
import { app, InvocationContext, Timer } from "@azure/functions";
import { getConnectorCore, getItemSource } from "./connector.js";

app.timer("Ingest", {
  schedule: "0 */5 * * * *",
  handler: async (_timer: Timer, context: InvocationContext): Promise<void> => {
    const core = getConnectorCore();
    const { connectionId } = core.getConnectionSettings();
    const source = getItemSource();

    await core.ingest({ source, connectionId });
    context.log("Ingest complete", connectionId);
  },
});
```

## 3) Update `tsconfig.json` to include the Functions folder
Ensure the Functions sources are compiled with your existing build. Add `src/functions/**/*.ts` to `include` if needed.

## 4) Wire configuration to Function App settings
Use Function App settings (or `local.settings.json` locally) for:
- `TENANT_ID`
- `CLIENT_ID`
- `CLIENT_SECRET` (or omit for managed identity)
- `CONNECTION_ID`, `CONNECTION_NAME`, `CONNECTION_DESCRIPTION`
- If people connector: `PROFILE_SOURCE_WEB_URL`, `PROFILE_SOURCE_DISPLAY_NAME`, `PROFILE_SOURCE_PRIORITY`

## 5) Build a shared connector factory
Create a helper (for example `src/functions/connector.ts`) that:
- Creates an auth credential (client secret first, else managed identity)
- Builds `ConnectorCore` using generated helpers

Reuse the generated pieces directly:
- `ConnectorCore` from `src/core/connectorCore.ts`
- `schemaPayload` and constants from `src/<SchemaFolder>/index.ts`
- `getItemId` and `toExternalItem` from `src/<SchemaFolder>/itemPayload.ts`

## 6) Implement Functions triggers
Add handlers under `src/functions/`:

- **provision.ts (HTTP trigger)**
  - `core.provision({ connectionId, connectionName, connectionDescription })`
  - If people connector: `core.provisionProfileSource(connectionId)`

- **delete.ts (HTTP trigger)**
  - `core.deleteConnection(connectionId)`

- **ingest.ts (Timer or Queue trigger)**
  - Build an `ItemSource` (use generated CSV/JSON/YAML source or a custom one)
  - `core.ingest({ source, connectionId })`

## 7) Keep cocogen update safe
Continue to run `cocogen update --out .` in this same project. Generated folders stay in `src/` and your Functions code lives in `src/functions/`, so updates won’t overwrite your triggers.

---

# Part B — .NET generated project → Azure Functions (Core Tools v4)

## 1) Initialize Functions with Azure Functions Core Tools v4
Ensure Core Tools v4 is installed before you start:

```bash
npm i -g azure-functions-core-tools@4 --unsafe-perm true
func --version
```

In the generated .NET project root, scaffold the Functions host files **in place**:

```bash
func init --worker-runtime dotnetIsolated
```

This creates `host.json`, `local.settings.json`, and updates the `.csproj` for the isolated worker model.

Keep the existing `<SchemaFolder>/`, `Core/`, and `Datasource/` folders where they are.

## 2) Add triggers with Core Tools
Create a `Functions/` folder for triggers and add them with Core Tools:

```bash
func new --name Provision --template "HTTP trigger" --authlevel "function"
func new --name Delete --template "HTTP trigger" --authlevel "function"
func new --name Ingest --template "Timer trigger"
```

## 3) Configure settings
Use Function App settings or `local.settings.json` with:
- `AzureAd:TenantId`
- `AzureAd:ClientId`
- `AzureAd:ClientSecret` (or omit for managed identity)
- `Connection:Id`, `Connection:Name`, `Connection:Description`
- People connector: `ProfileSource:WebUrl`, `ProfileSource:DisplayName`, `ProfileSource:Priority`

## 4) Create a shared connector builder
Create a helper (for example `Functions/ConnectorFactory.cs`) that:
- Creates `TokenCredential` (client secret first, else managed identity)
- Creates `GraphServiceClient`
- Builds `ConnectorCore<ItemModel>` with `ItemPayloadAdapter` and connection settings

Reuse generated code directly:
- `ConnectorCore` in `Core/ConnectorCore.cs`
- Schema payload types and constants in `<SchemaFolder>`
- `ItemPayloadAdapter` in `Core/ItemPayloadAdapter.cs`

## 5) Add Functions triggers
Add triggers under `Functions/`:

- **ProvisionFunction** (HTTP trigger)
  - `core.ProvisionAsync()`
  - If people connector: `core.ProvisionProfileSourceAsync()`

- **DeleteFunction** (HTTP trigger)
  - `core.DeleteConnectionAsync()`

- **IngestFunction** (Timer or Queue trigger)
  - Create `IItemSource<ItemModel>` (reuse generated source or custom)
  - `core.IngestAsync(source, dryRun, limit, verbose, failFast)`

## 6) Keep cocogen update safe
Continue to run `cocogen update --out .` in the same project. Generated folders remain where they are and your Functions code lives under `Functions/`.

---

## Common pitfalls
- **Connection ownership**: app ID used for provisioning must match the app ID used for ingestion.
- **Missing permissions**: for application auth, grant `ExternalConnection.ReadWrite.OwnedBy` and `ExternalItem.ReadWrite.OwnedBy` and admin consent.
- **People connectors**: profile source registration requires `PeopleSettings.ReadWrite.All`.

## Checklist
- [ ] Functions host files added in the generated project root
- [ ] Triggers added without moving generated folders
- [ ] Auth settings wired (client secret or managed identity)
- [ ] `ConnectorCore` used directly from generated code
- [ ] `cocogen update` still runs cleanly in-place
