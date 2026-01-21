# Schema assistant guidance

This guide is for agents helping users craft TypeSpec schemas for cocogen. Keep answers short, practical, and aligned with generator rules.

## Core rules
- Use the `coco` namespace decorators (e.g., `@coco.item`, `@coco.connection`).
- Do **not** add `using TypeSpec;`.
- Do **not** use `@TypeSpec.*` decorators.
- Use unqualified decorators like `@doc`, `@example`, `@minLength`, `@maxLength`, `@pattern`, `@format`, `@minValue`, `@maxValue`.
- Use `#deprecated "reason"` for deprecation.
- Exactly one model must be decorated with `@coco.item`.
- Exactly one property must be decorated with `@coco.id`.

## Connector kinds
- **Content connector**: default (Graph v1.0 unless `principal` or `contentCategory` forces beta).
- **People connector**: set `@coco.connection({ contentCategory: "people", ... })` and include `@coco.profileSource`.

## Required connection settings
- `@coco.connection({ name, connectionId, connectionDescription })`
  - `connectionId` must be alphanumeric (no spaces).
  - `connectionDescription` is recommended.

## Common property decorators
- `@doc("...")` → property documentation
- `@example("...")` → used in sample CSV generation
- `@minLength(n)`, `@maxLength(n)` → string constraints
- `@pattern("...")` → string regex
- `@format("email" | "uri" | "date-time" | ...)` → string format
- `@minValue(n)`, `@maxValue(n)` → numeric constraints
- `#deprecated "reason"` → deprecate a property (not allowed on `@coco.id`)

## Data source mapping
- Default mapping uses the property name as the CSV header.
- Override with `@coco.source("Header Name")`.
- Disable mapping with `@coco.noSource`.

## People entity mapping
People fields require **people labels** and **source mappings** when using `@coco.source(..., to)` paths.
- Add `@coco.label("person...")` on the property to select the entity.
- Add `@coco.source("csv header", "path.to.field")` for each field.
- If a people label is present but no mappings are provided, the generator emits a stub and requires manual transforms.

## Examples
### Minimal content connector
```typespec
using coco;

@coco.connection({
  name: "Projects",
  connectionId: "projects",
  connectionDescription: "Project records"
})
@coco.item
model Project {
  @coco.id
  id: string;

  @doc("Display name")
  @minLength(2)
  name: string;
}
```

### People connector with entity mappings
```typespec
using coco;

@coco.connection({
  contentCategory: "people",
  name: "Directory",
  connectionId: "directory",
  connectionDescription: "People directory"
})
@coco.profileSource({
  webUrl: "https://example.com",
  displayName: "Directory"
})
@coco.item
model Person {
  @coco.id
  @coco.label("personAccount")
  @coco.source("upn", "userPrincipalName")
  account: string;

  @coco.label("personSkills")
  @coco.source("skill", "displayName")
  @coco.source("level", "proficiency")
  skills: string[];
}
```

## Quick checklist
- [ ] `using coco;` present
- [ ] Exactly one `@coco.item` model
- [ ] Exactly one `@coco.id` property
- [ ] `@coco.connection` includes name/connectionId/connectionDescription
- [ ] No `using TypeSpec;` and no `@TypeSpec.*`
- [ ] People connectors include `@coco.profileSource`
- [ ] People entity fields have `@coco.label("person...")` + `@coco.source(..., to)`
