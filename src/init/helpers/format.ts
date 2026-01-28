/** Wrap a string in a block doc comment with optional indentation. */
export function formatDocComment(doc: string, indent = ""): string {
  const lines = doc.split(/\r?\n/).map((line) => `${indent} * ${line}`);
  return `${indent}/**\n${lines.join("\n")}\n${indent} */`;
}

/** Build a C# XML doc summary block from plain text. */
export function formatCsDocSummary(doc: string): string[] {
  const lines = doc.split(/\r?\n/).map((line) => `/// ${line}`);
  return ["/// <summary>", ...lines, "/// </summary>"];
}
