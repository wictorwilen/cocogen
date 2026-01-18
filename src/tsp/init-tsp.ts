import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { input, select } from "@inquirer/prompts";

export type StarterTspKind = "content" | "people";

export type StarterTspOptions = {
  outPath?: string;
  kind?: StarterTspKind;
  modelName?: string;
  idPropertyName?: string;
  force?: boolean;
  prompt?: boolean;
};

function defaultModelName(kind: StarterTspKind): string {
  return kind === "people" ? "PersonProfile" : "Item";
}

function defaultIdProperty(kind: StarterTspKind): string {
  return kind === "people" ? "userPrincipalName" : "id";
}

function ensureTspExtension(value: string): string {
  return value.endsWith(".tsp") ? value : `${value}.tsp`;
}

function starterTspContents(options: {
  kind: StarterTspKind;
  modelName: string;
  idPropertyName: string;
}): string {
  const { kind, modelName, idPropertyName } = options;

  if (kind === "people") {
    return `using coco;

// People connectors use Graph /beta. Use --use-preview-features with cocogen validate/init/update.
// Optional: set defaults for profile source registration.
// @coco.profileSource({ webUrl: "https://contoso.com/people", displayName: "Contoso HR", priority: "first" })

@coco.connection({ contentCategory: "people" })
@coco.item()
model ${modelName} {
  @coco.id
  @coco.label("personAccount")
  ${idPropertyName}: string;

  @coco.label("personName")
  displayName: string;

  // TODO: map CSV headers if they differ from property names.
  // @coco.source("upn", "userPrincipalName")
  // userPrincipalName: string;

  // TODO: add more people fields and labels.
  // @coco.label("personEmails")
  // @coco.source("email", "address")
  // emails: string;

  // TODO: map profile entities with @coco.source("column", "entity.path").
  // @coco.label("personCurrentPosition")
  // @coco.source("job title", "detail.jobTitle")
  // workPosition: string;
}
`;
  }

  return `using coco;

// Optional: set connection defaults in generated config.
// @coco.connection({ connectionId: "my-connection", connectionDescription: "My connector" })

@coco.item()
model ${modelName} {
  @coco.id
  ${idPropertyName}: string;

  // TODO: mark a title for rich results.
  // @coco.label("title")
  // title: string;

  // TODO: add searchable fields.
  // @coco.search({ searchable: true, retrievable: true })
  // summary: string;

  // Optional: full-text content field (content connectors only).
  // @coco.content({ type: "text" })
  // body: string;

  // TODO: map CSV headers if they differ from property names.
  // @coco.source("csv column")
  // field: string;
}
`;
}

export async function initStarterTsp(options: StarterTspOptions): Promise<{ outPath: string; kind: StarterTspKind }> {
  const wantsPrompt = Boolean(options.prompt);
  if (wantsPrompt && !process.stdin.isTTY) {
    throw new Error("Prompt requires an interactive TTY.");
  }

  let outPath = options.outPath ?? "schema.tsp";
  let kind: StarterTspKind = options.kind ?? "content";
  let modelName = options.modelName ?? defaultModelName(kind);
  let idPropertyName = options.idPropertyName ?? defaultIdProperty(kind);

  if (wantsPrompt) {
    outPath = ensureTspExtension(
      await input({
        message: "Where should the .tsp file be created?",
        default: outPath
      })
    );

    kind = await select<StarterTspKind>({
      message: "Which connector type?",
      default: kind,
      choices: [
        { value: "content", name: "content (Graph v1.0)" },
        { value: "people", name: "people (Graph beta)" }
      ]
    });

    modelName = await input({
      message: "Model name",
      default: defaultModelName(kind)
    });

    idPropertyName = await input({
      message: "ID property name",
      default: defaultIdProperty(kind)
    });
  }

  outPath = ensureTspExtension(outPath);
  const resolved = path.resolve(outPath);
  const dir = path.dirname(resolved);
  await mkdir(dir, { recursive: true });

  try {
    await access(resolved);
    if (!options.force) {
      throw new Error(`File already exists: ${resolved}. Use --force to overwrite.`);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }

  const contents = starterTspContents({ kind, modelName, idPropertyName });
  await writeFile(resolved, contents, "utf8");

  return { outPath: resolved, kind };
}
