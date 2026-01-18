import { describe, expect, test } from "vitest";

import { renderTemplate } from "../../src/init/template.js";

describe("renderTemplate", () => {
  test("renders a template with raw output", async () => {
    const content = await renderTemplate("ts/tspconfig.yaml.ejs", {});
    expect(content).toContain("@wictorwilen/cocogen");
    expect(content).toContain("imports:");
  });
});
