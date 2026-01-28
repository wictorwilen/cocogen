export type CollectionEntryBuilderArgs<TInfo, TProp> = {
  key: string;
  value: string;
  level: number;
  info: TInfo | null;
  propInfo: TProp | null;
};

export type CollectionRendererContext<TInfo, TProp> = {
  indentUnit: string;
  getPropInfo: (info: TInfo | null, key: string) => TProp | null;
  getPropType: (propInfo: TProp) => string;
  isCollectionType: (propType: string) => boolean;
  getNestedInfo: (propType: string) => TInfo | null;
  buildEntry: (args: CollectionEntryBuilderArgs<TInfo, TProp>) => string | null;
  wrapObject: (entries: string[], level: number, info: TInfo | null) => string;
  formatNestedValue: (value: string, nestedInfo: TInfo | null) => string;
};

export type CollectionNodeRenderer<TInfo> = (
  node: Record<string, unknown>,
  level: number,
  propType: string | null,
  nestedInfo: TInfo | null
) => string;

export type LeafValueBuilder = (propType: string | null, valueVar: string) => string;

/** Create a reusable renderer for nested collection object trees. */
export function createCollectionRenderer<TInfo, TProp>(context: CollectionRendererContext<TInfo, TProp>) {
  const renderNodeForCollection = (
    node: Record<string, unknown>,
    level: number,
    valueVar: string,
    info: TInfo | null,
    renderCollectionNode: CollectionNodeRenderer<TInfo>,
    leafValueBuilder: LeafValueBuilder
  ): string => {
    const entries = Object.entries(node)
      .map(([key, value]) => {
        const propInfo = context.getPropInfo(info, key);
        const propType = propInfo ? context.getPropType(propInfo) : null;

        if (typeof value === "object" && value && "path" in (value as object)) {
          const leafValue = leafValueBuilder(propType, valueVar);
          return context.buildEntry({ key, value: leafValue, level, info, propInfo });
        }

        if (propType && context.isCollectionType(propType)) {
          const nestedInfo = context.getNestedInfo(propType);
          const rendered = renderCollectionNode(value as Record<string, unknown>, level + 1, propType, nestedInfo);
          return context.buildEntry({ key, value: rendered, level, info, propInfo });
        }

        const nestedInfo = propType ? context.getNestedInfo(propType) : null;
        const renderedChild = renderNodeForCollection(
          value as Record<string, unknown>,
          level + 1,
          valueVar,
          nestedInfo,
          renderCollectionNode,
          leafValueBuilder
        );
        const nestedValue = context.formatNestedValue(renderedChild, nestedInfo);
        return context.buildEntry({ key, value: nestedValue, level, info, propInfo });
      })
      .filter((entry): entry is string => Boolean(entry));

    return context.wrapObject(entries, level, info);
  };

  const renderNodeForCollectionMany = (
    node: Record<string, unknown>,
    level: number,
    info: TInfo | null,
    fieldVarByPath: Map<string, string>,
    renderCollectionNode: CollectionNodeRenderer<TInfo>,
    leafValueBuilder: LeafValueBuilder
  ): string => {
    const entries = Object.entries(node)
      .map(([key, value]) => {
        const propInfo = context.getPropInfo(info, key);
        const propType = propInfo ? context.getPropType(propInfo) : null;

        if (typeof value === "object" && value && "path" in (value as object)) {
          const field = value as { path: string };
          const varName = fieldVarByPath.get(field.path) ?? "";
          const leafValue = leafValueBuilder(propType, varName);
          return context.buildEntry({ key, value: leafValue, level, info, propInfo });
        }

        if (propType && context.isCollectionType(propType)) {
          const nestedInfo = context.getNestedInfo(propType);
          const rendered = renderCollectionNode(value as Record<string, unknown>, level + 1, propType, nestedInfo);
          return context.buildEntry({ key, value: rendered, level, info, propInfo });
        }

        const nestedInfo = propType ? context.getNestedInfo(propType) : null;
        const renderedChild = renderNodeForCollectionMany(
          value as Record<string, unknown>,
          level + 1,
          nestedInfo,
          fieldVarByPath,
          renderCollectionNode,
          leafValueBuilder
        );
        const nestedValue = context.formatNestedValue(renderedChild, nestedInfo);
        return context.buildEntry({ key, value: nestedValue, level, info, propInfo });
      })
      .filter((entry): entry is string => Boolean(entry));

    return context.wrapObject(entries, level, info);
  };

  return { renderNodeForCollection, renderNodeForCollectionMany };
}
