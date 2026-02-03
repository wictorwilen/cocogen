export type PersonEntityField = {
  path: string;
  source: { csvHeaders: string[]; jsonPath?: string; default?: string };
};

export type SourceDescriptor = { csvHeaders: string[]; jsonPath?: string; default?: string };
