import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { runNode, writeTempTspFile } from "../test-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function distCliPath(): string {
  return path.join(repoRoot, "dist", "cli.js");
}

const principalSchema = `
  @coco.connection({
    name: "Principal test",
    connectionId: "principaltest",
    connectionDescription: "Principal test"
  })
  @coco.item
  model Item {
    @coco.id
    id: string;

    @coco.source("ownerUpn", "upn")
    @coco.source("ownerTenant", "tenantId")
    @coco.source("ownerExternalName", "externalName")
    @coco.source("ownerExternalId", "externalId")
    @coco.source("ownerEntraName", "entraDisplayName")
    @coco.source("ownerEntraId", "entraId")
    @coco.source("ownerEmail", "email")
    @coco.source("ownerCustom", "customField")
    owner: coco.Principal;

    @coco.source("approverUpn", "upn")
    @coco.source("approverTenant", "tenantId")
    @coco.source("approverExternalName", "externalName")
    @coco.source("approverExternalId", "externalId")
    @coco.source("approverEntraName", "entraDisplayName")
    @coco.source("approverEntraId", "entraId")
    @coco.source("approverEmail", "email")
    @coco.source("approverCustom", "customField")
    approvers: coco.Principal[];

    title: string;
  }
`;

describe("cocogen generate principal outputs (e2e)", () => {
  test("generates TS principal helpers and transforms", async () => {
    const entry = await writeTempTspFile(principalSchema);
    const outDir = path.join(path.dirname(entry), "out-principal-ts");

    const result = await runNode(
      [distCliPath(), "generate", "--tsp", entry, "--out", outDir, "--use-preview-features"],
      {
        cwd: repoRoot,
        env: {
          NO_COLOR: "1",
          CI: "1",
        },
      }
    );

    expect(result.code).toBe(0);

    const schemaFolder = "PrincipalTest";
    const principalCore = await readFile(path.join(outDir, "src", "core", "principal.ts"), "utf8");
    expect(principalCore).toMatch(/export type Principal/);
    expect(principalCore).toMatch(/externalName/);
    expect(principalCore).toMatch(/externalId/);
    expect(principalCore).toMatch(/entraDisplayName/);
    expect(principalCore).toMatch(/entraId/);
    expect(principalCore).toMatch(/email/);
    expect(principalCore).toMatch(/upn/);
    expect(principalCore).toMatch(/tenantId/);

    const model = await readFile(path.join(outDir, "src", schemaFolder, "model.ts"), "utf8");
    expect(model).toMatch(/from "\.\.\/core\/principal\.js"/);
    expect(model).toMatch(/export type \{ Principal \}/);

    const transforms = await readFile(
      path.join(outDir, "src", schemaFolder, "propertyTransformBase.ts"),
      "utf8"
    );
    expect(transforms).toMatch(/"upn"/);
    expect(transforms).toMatch(/"tenantId"/);
    expect(transforms).toMatch(/"externalName"/);
    expect(transforms).toMatch(/"externalId"/);
    expect(transforms).toMatch(/"entraDisplayName"/);
    expect(transforms).toMatch(/"entraId"/);
    expect(transforms).toMatch(/"email"/);
    expect(transforms).toMatch(/"customField"/);
    expect(transforms).toMatch(/"@odata.type"/);
    expect(transforms).toMatch(/const results: Principal\[\] = \[\]/);
  });

  test("generates .NET principal helpers and transforms", async () => {
    const entry = await writeTempTspFile(principalSchema);
    const outDir = path.join(path.dirname(entry), "out-principal-dotnet");

    const result = await runNode(
      [
        distCliPath(),
        "generate",
        "--lang",
        "dotnet",
        "--tsp",
        entry,
        "--out",
        outDir,
        "--use-preview-features",
      ],
      {
        cwd: repoRoot,
        env: {
          NO_COLOR: "1",
          CI: "1",
        },
      }
    );

    expect(result.code).toBe(0);

    const schemaFolder = "PrincipalTest";
    const principalCore = await readFile(path.join(outDir, "Core", "Principal.cs"), "utf8");
    expect(principalCore).toMatch(/namespace .*\.Core;/);
    expect(principalCore).toMatch(/IParsable/);
    expect(principalCore).toMatch(/WriteAdditionalData/);

    const model = await readFile(path.join(outDir, schemaFolder, "Model.cs"), "utf8");
    expect(model).toMatch(/using .*\.Core;/);

    const transforms = await readFile(path.join(outDir, schemaFolder, "PropertyTransformBase.cs"), "utf8");
    expect(transforms).toMatch(/new Principal/);
    expect(transforms).toMatch(/Upn =/);
    expect(transforms).toMatch(/TenantId =/);
    expect(transforms).toMatch(/ExternalName =/);
    expect(transforms).toMatch(/ExternalId =/);
    expect(transforms).toMatch(/EntraDisplayName =/);
    expect(transforms).toMatch(/EntraId =/);
    expect(transforms).toMatch(/Email =/);
    expect(transforms).toMatch(/AdditionalData/);
    expect(transforms).toMatch(/\["customField"\]/);
  });
});
