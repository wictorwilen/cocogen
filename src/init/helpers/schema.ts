import type { ConnectorIr, PropertyType } from "../../ir.js";

/** Build the Graph base URL for the selected API version. */
export function graphBaseUrl(ir: ConnectorIr): string {
  return `https://graph.microsoft.com/${ir.connection.graphApiVersion}`;
}

/** Create the external item schema payload for Graph provisioning. */
export function schemaPayload(ir: ConnectorIr): unknown {
  return {
    baseType: "microsoft.graph.externalItem",
    properties: ir.properties
      .filter((p) => p.name !== ir.item.contentPropertyName)
      .map((p) => ({
        name: p.name,
        type: p.type,
        labels: p.labels.length > 0 ? p.labels : undefined,
        aliases: p.aliases.length > 0 ? p.aliases : undefined,
        description: p.description,
        isSearchable: p.search.searchable ?? undefined,
        isQueryable: p.search.queryable ?? undefined,
        isRetrievable: p.search.retrievable ?? undefined,
        isRefinable: p.search.refinable ?? undefined,
        isExactMatchRequired: p.search.exactMatchRequired ?? undefined,
      })),
  };
}

/** Map property types to Graph schema enum names. */
export function toGraphPropertyTypeEnumName(type: PropertyType): string {
  switch (type) {
    case "string":
      return "String";
    case "boolean":
      return "Boolean";
    case "int64":
      return "Int64";
    case "double":
      return "Double";
    case "dateTime":
      return "DateTime";
    case "stringCollection":
      return "StringCollection";
    case "int64Collection":
      return "Int64Collection";
    case "doubleCollection":
      return "DoubleCollection";
    case "dateTimeCollection":
      return "DateTimeCollection";
    case "principal":
      return "Principal";
    case "principalCollection":
      return "PrincipalCollection";
    default:
      return "String";
  }
}

/** Map property types to OData collection type strings. */
export function toOdataCollectionType(type: PropertyType): string | null {
  switch (type) {
    case "stringCollection":
      return "Collection(String)";
    case "int64Collection":
      return "Collection(Int64)";
    case "doubleCollection":
      return "Collection(Double)";
    case "dateTimeCollection":
      return "Collection(DateTimeOffset)";
    case "principalCollection":
      return "Collection(microsoft.graph.externalConnectors.principal)";
    default:
      return null;
  }
}

/** Map property types to C# RowParser function names. */
export function toCsParseFunction(type: PropertyType): string {
  switch (type) {
    case "stringCollection":
      return "RowParser.ParseStringCollection";
    case "int64Collection":
      return "RowParser.ParseInt64Collection";
    case "doubleCollection":
      return "RowParser.ParseDoubleCollection";
    case "dateTimeCollection":
      return "RowParser.ParseDateTimeCollection";
    case "boolean":
      return "RowParser.ParseBoolean";
    case "int64":
      return "RowParser.ParseInt64";
    case "double":
      return "RowParser.ParseDouble";
    case "dateTime":
      return "RowParser.ParseDateTime";
    case "principal":
    case "principalCollection":
    case "string":
    default:
      return "RowParser.ParseString";
  }
}

/** Emit C# value expressions for schema payloads. */
export function toCsPropertyValueExpression(type: PropertyType, csPropertyName: string): string {
  switch (type) {
    case "dateTime":
      return `item.${csPropertyName}.ToString("o")`;
    case "dateTimeCollection":
      return `item.${csPropertyName}.Select((x) => x.ToString("o")).ToList()`;
    default:
      return `item.${csPropertyName}`;
  }
}
