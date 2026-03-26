import { describe, expect, test, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initTsProject } from "../../src/init/init.js";
import { writeTempDir, writeTempTspFile, baseSchema } from "../test-utils.js";

// Minimal item type for tests
interface Item { id: string }

type MockResponse = {
  status: number;
  statusText?: string;
  json?: unknown;
  text?: string;
};

describe("connectorCore.ensureConnection", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = fetch;
  });

  afterEach(() => {
    // @ts-expect-error restoring
    global.fetch = originalFetch;
  });

  test("returns early when connection exists (200)", async () => {
    const tspPath = await writeTempTspFile(baseSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "ts-core-exists");

    await initTsProject({ tspPath, outDir, force: false });

    const { ConnectorCore } = await import(
      pathToFileURL(path.join(outDir, "src", "core", "connectorCore.ts")).href
    );

    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    mockFetch([
      { status: 200, json: {} },
    ], calls);

    const core = new ConnectorCore<Item>({
      graphBaseUrls: {
        connectionProvisioning: "https://graph.test",
        schemaRegistration: "https://graph.test/schema",
        itemIngestion: "https://graph.test/items",
        profileSourceRegistration: "https://graph.test/profile",
      },
      contentCategory: null,
      schemaPayload: {},
      getAccessToken: async () => "token",
      getItemId: (item) => item.id,
      toExternalItem: (item) => ({ id: item.id, acl: [], properties: {} }),
    });

    await core.ensureConnection({
      connectionId: "conn",
      connectionName: "Conn",
      connectionDescription: "Desc",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "GET", url: "https://graph.test/external/connections/conn" });
  });

  test("creates connection when GET returns 404", async () => {
    const tspPath = await writeTempTspFile(baseSchema);
    const outRoot = await writeTempDir();
    const outDir = path.join(outRoot, "ts-core-create");

    await initTsProject({ tspPath, outDir, force: false });

    const { ConnectorCore } = await import(
      pathToFileURL(path.join(outDir, "src", "core", "connectorCore.ts")).href
    );

    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    mockFetch([
      { status: 404, text: "not found" },
      { status: 201, json: {} },
    ], calls);

    const core = new ConnectorCore<Item>({
      graphBaseUrls: {
        connectionProvisioning: "https://graph.test",
        schemaRegistration: "https://graph.test/schema",
        itemIngestion: "https://graph.test/items",
        profileSourceRegistration: "https://graph.test/profile",
      },
      contentCategory: null,
      schemaPayload: {},
      getAccessToken: async () => "token",
      getItemId: (item) => item.id,
      toExternalItem: (item) => ({ id: item.id, acl: [], properties: {} }),
    });

    await core.ensureConnection({
      connectionId: "conn",
      connectionName: "Conn",
      connectionDescription: "Desc",
    });

    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(calls[1].url).toBe("https://graph.test/external/connections");
    expect(calls[1].body).toMatchObject({ id: "conn", name: "Conn", description: "Desc" });
  });
});

function mockFetch(responses: MockResponse[], calls: Array<{ method: string; url: string; body?: unknown }>) {
  let i = 0;
  // @ts-expect-error overriding global
  global.fetch = async (url: string | URL, init?: RequestInit) => {
    const next = responses[i] ?? responses[responses.length - 1];
    i += 1;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url: String(url), body });
    const ok = next.status >= 200 && next.status < 300;
    const headers = new Headers();
    const textPayload = next.text ?? (next.json ? JSON.stringify(next.json) : "");
    return {
      ok,
      status: next.status,
      statusText: next.statusText ?? "",
      headers,
      async json() {
        return next.json ?? {};
      },
      async text() {
        return textPayload;
      },
    } as Response;
  };
}
