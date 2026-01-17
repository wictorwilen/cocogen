# gcgen

A TypeSpec-driven generator (run via `npx`) for scaffolding Microsoft Graph External Connections (Microsoft 365 Copilot connectors) projects.

- Input: a TypeSpec (`.tsp`) file describing the external item schema
- Output: a runnable project in TypeScript/Node.js or C#/.NET that can:
  - create an external connection
  - register/update the schema
  - ingest content from CSV (with a swappable datasource abstraction)

Design spec: see docs/architecture.md
