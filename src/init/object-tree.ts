export function buildObjectTree<T extends { path: string }>(fields: T[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const field of fields) {
    const parts = field.path.split(".").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    let cursor: Record<string, unknown> = root;
    for (let i = 0; i < parts.length; i += 1) {
      const key = parts[i]!;
      if (i === parts.length - 1) {
        cursor[key] = field;
        continue;
      }
      const next = cursor[key];
      if (typeof next === "object" && next && !Array.isArray(next) && !("path" in (next as object))) {
        cursor = next as Record<string, unknown>;
      } else {
        const child: Record<string, unknown> = {};
        cursor[key] = child;
        cursor = child;
      }
    }
  }

  return root;
}
