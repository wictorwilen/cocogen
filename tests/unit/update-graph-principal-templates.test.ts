import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  parsePrincipalComplexTypeSnapshot,
  syncPrincipalTemplates,
  writePrincipalSnapshot,
} from "../../scripts/update-graph-principal-templates.ts";

const metadataXml = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema Namespace="microsoft.graph.externalConnectors" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <ComplexType Name="principal">
        <Property Name="email" Type="Edm.String" />
        <Property Name="entraDisplayName" Type="Edm.String" />
        <Property Name="entraId" Type="Edm.String" />
        <Property Name="externalId" Type="Edm.String" />
        <Property Name="externalName" Type="Edm.String" />
        <Property Name="tenantId" Type="Edm.String" />
        <Property Name="upn" Type="Edm.String" />
      </ComplexType>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

describe("scripts/update-graph-principal-templates", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("extracts the external connectors principal complex type from metadata", () => {
    const snapshot = parsePrincipalComplexTypeSnapshot(
      metadataXml,
      "2026-03-30T00:00:00.000Z",
      "https://graph.microsoft.com/v1.0/$metadata"
    );

    expect(snapshot.generatedAt).toBe("2026-03-30T00:00:00.000Z");
    expect(snapshot.graphVersion).toBe("v1.0");
    expect(snapshot.fullName).toBe("microsoft.graph.externalConnectors.principal");
    expect(snapshot.properties.map((property) => property.name)).toEqual([
      "email",
      "entraDisplayName",
      "entraId",
      "externalId",
      "externalName",
      "tenantId",
      "upn",
    ]);
  });

  test("writes the parsed principal snapshot to the data folder", async () => {
    const snapshot = parsePrincipalComplexTypeSnapshot(metadataXml, "2026-03-30T00:00:00.000Z");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "cocogen-principal-snapshot-"));

    const outPath = await writePrincipalSnapshot(snapshot, cwd);
    const disk = JSON.parse(await readFile(outPath, "utf8")) as typeof snapshot;

    expect(outPath).toBe(path.join(cwd, "data", "graph-external-connectors-principal.json"));
    expect(disk.fullName).toBe("microsoft.graph.externalConnectors.principal");
    expect(disk.properties.map((property) => property.name)).toContain("upn");
  });

  test("falls back to the cached principal snapshot and rewrites templates when metadata fetch fails", async () => {
    const snapshot = parsePrincipalComplexTypeSnapshot(metadataXml, "2026-03-30T00:00:00.000Z");
    const cwd = await mkdtemp(path.join(os.tmpdir(), "cocogen-principal-sync-"));
    await mkdir(path.join(cwd, "data"), { recursive: true });
    await writePrincipalSnapshot(snapshot, cwd);

    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    const synced = await syncPrincipalTemplates(cwd);

    expect(synced.fullName).toBe(snapshot.fullName);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Falling back to cached principal metadata")
    );

    const dotnetTemplate = await readFile(
      path.join(cwd, "src", "init", "templates", "dotnet", "Core", "Principal.cs.ejs"),
      "utf8"
    );
    const tsTemplate = await readFile(
      path.join(cwd, "src", "init", "templates", "ts", "src", "core", "principal.ts.ejs"),
      "utf8"
    );

    expect(dotnetTemplate).toContain('namespace <%= namespaceName %>.Core;');
    expect(dotnetTemplate).toContain('public string? Email { get; set; }');
    expect(dotnetTemplate).toContain('writer.WriteStringValue("upn", Upn);');

    expect(tsTemplate).toContain('"@odata.type": "#microsoft.graph.externalConnectors.principal";');
    expect(tsTemplate).toContain("  email?: string;");
    expect(tsTemplate).toContain("  upn?: string;");
  });
});