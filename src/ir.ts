export type GraphApiVersion = "v1.0" | "beta";

export type PropertyType =
  | "string"
  | "int64"
  | "double"
  | "dateTime"
  | "boolean"
  | "stringCollection"
  | "int64Collection"
  | "doubleCollection"
  | "dateTimeCollection"
  | "principal";

export type SearchFlags = {
  searchable?: boolean;
  queryable?: boolean;
  retrievable?: boolean;
  refinable?: boolean;
  exactMatchRequired?: boolean;
};

export type ConnectorIr = {
  connection: {
    contentCategory?: string;
    connectionName?: string;
    connectionId?: string;
    connectionDescription?: string;
    profileSource?: {
      webUrl: string;
      displayName: string;
      priority?: "first" | "last";
    };
    graphApiVersion: GraphApiVersion;
  };
  item: {
    typeName: string;
    idPropertyName: string;
    idEncoding: "slug" | "base64" | "hash";
    contentPropertyName?: string;
    doc?: string;
  };
  properties: Array<{
    name: string;
    type: PropertyType;
    description?: string;
    doc?: string;
    example?: unknown;
    format?: string;
    pattern?: {
      regex: string;
      message?: string;
    };
    minLength?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
    labels: string[];
    aliases: string[];
    search: SearchFlags;
    personEntity?: {
      entity:
        | "userAccountInformation"
        | "personName"
        | "workPosition"
        | "itemAddress"
        | "itemEmail"
        | "itemPhone"
        | "personAward"
        | "personCertification"
        | "projectParticipation"
        | "skillProficiency"
        | "webAccount"
        | "personWebsite"
        | "personAnniversary"
        | "personAnnotation";
      fields: Array<{
        path: string;
        source: {
          csvHeaders: string[];
        };
      }>;
    };
    source: {
      csvHeaders: string[];
      explicit?: boolean;
      noSource?: boolean;
    };
  }>;
};
