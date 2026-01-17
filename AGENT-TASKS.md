# AGENT-TASKS.md

This is the living task list for the `gcgen` repo. Keep it current as work progresses.

## Now
- Scaffold single-package TypeScript (Node 22, ESM) workspace
- Add GitHub Actions CI + npm publish workflows
- Implement `gcgen` CLI skeleton with `commander` + `ora` + color (NO_COLOR-safe)
- Implement TypeSpec → IR loader and baseline validation
- Implement People connectors mode validation rules (contentCategory from TSP)

## Next
- Implement `gcgen init` to emit runnable TS connector project
- Implement CSV datasource interface + Csv implementation in generated output
- Add `gcgen emit` and `gcgen validate` commands + docs updates

## Later
- Add C#/.NET project emitter
- Add snapshot tests for emitted file trees
- Add richer schema features (display templates, activities) if needed

## Decisions / Notes
- Generator code: TypeScript only
- Runtime: Node 22 LTS + npm
- Module system: ESM
- CLI: commander + colorful UX + spinners (must degrade in CI/non-TTY, respect NO_COLOR)
- People connectors: contentCategory configured in TSP; `principalCollection` hard-fails validation
