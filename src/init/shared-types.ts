export type PersonEntityField = {
  path: string;
  source: {
    csvHeaders: string[];
    jsonPath?: string;
    default?: string;
    transforms?: Array<"trim" | "lowercase" | "uppercase">;
  };
};

export type SourceDescriptor = {
  csvHeaders: string[];
  jsonPath?: string;
  default?: string;
  transforms?: Array<"trim" | "lowercase" | "uppercase">;
};
