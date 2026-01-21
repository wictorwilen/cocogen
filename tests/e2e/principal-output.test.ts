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

    @coco.source("ownerUpn", "userPrincipalName")
    @coco.source("ownerTid", "tenantId")
    @coco.source("ownerId", "id")
    @coco.source("ownerType", "type")
    @coco.source("ownerDisplay", "displayName")
    @coco.source("ownerCustom", "customField")
    owner: coco.Principal;

    @coco.source("approverUpn", "userPrincipalName")
    @coco.source("approverTid", "tenantId")
    @coco.source("approverDisplay", "displayName")
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
    expect(principalCore).toMatch(/userPrincipalName/);
    expect(principalCore).toMatch(/tenantId/);
    expect(principalCore).toMatch(/displayName/);

    const model = await readFile(path.join(outDir, "src", schemaFolder, "model.ts"), "utf8");
    expect(model).toMatch(/from "\.\.\/core\/principal\.js"/);
    expect(model).toMatch(/export type \{ Principal \}/);

    const transforms = await readFile(
      path.join(outDir, "src", schemaFolder, "propertyTransformBase.ts"),
      "utf8"
    );
    expect(transforms).toMatch(/"userPrincipalName"/);
    expect(transforms).toMatch(/"tenantId"/);
    expect(transforms).toMatch(/"displayName"/);
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
    expect(principalCore).toMatch(/JsonExtensionData/);

    const model = await readFile(path.join(outDir, schemaFolder, "Model.cs"), "utf8");
    expect(model).toMatch(/using .*\.Core;/);

    const transforms = await readFile(path.join(outDir, schemaFolder, "PropertyTransformBase.cs"), "utf8");
    expect(transforms).toMatch(/new Principal/);
    expect(transforms).toMatch(/UserPrincipalName =/);
    expect(transforms).toMatch(/TenantId =/);
    expect(transforms).toMatch(/Id =/);
    expect(transforms).toMatch(/Type =/);
    expect(transforms).toMatch(/DisplayName =/);
    expect(transforms).toMatch(/AdditionalData/);
    expect(transforms).toMatch(/\["customField"\]/);
  });
});
