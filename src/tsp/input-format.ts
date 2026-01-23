export type InputFormat = "csv" | "json" | "yaml" | "custom";

export function normalizeInputFormat(raw?: string): InputFormat {
  if (!raw) return "csv";
  const value = raw.trim().toLowerCase();
  if (value === "csv" || value === "json" || value === "yaml" || value === "custom") return value;
  throw new Error("Invalid input format. Expected csv, json, yaml, or custom.");
}
