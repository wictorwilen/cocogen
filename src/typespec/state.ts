export const COCOGEN_STATE_ITEM_MODELS = Symbol.for("@wictorwilen/cocogen/itemModels");
export const COCOGEN_STATE_ID_PROPERTIES = Symbol.for("@wictorwilen/cocogen/idProperties");
export const COCOGEN_STATE_ID_SETTINGS = Symbol.for("@wictorwilen/cocogen/idSettings");
export const COCOGEN_STATE_CONTENT_PROPERTIES = Symbol.for("@wictorwilen/cocogen/contentProperties");
export const COCOGEN_STATE_CONNECTION_SETTINGS = Symbol.for("@wictorwilen/cocogen/connectionSettings");
export const COCOGEN_STATE_PROFILE_SOURCE_SETTINGS = Symbol.for("@wictorwilen/cocogen/profileSourceSettings");
export const COCOGEN_STATE_PROPERTY_LABELS = Symbol.for("@wictorwilen/cocogen/propertyLabels");
export const COCOGEN_STATE_PROPERTY_ALIASES = Symbol.for("@wictorwilen/cocogen/propertyAliases");
export const COCOGEN_STATE_PROPERTY_NAME_OVERRIDES = Symbol.for("@wictorwilen/cocogen/propertyNameOverrides");
export const COCOGEN_STATE_PROPERTY_DESCRIPTIONS = Symbol.for("@wictorwilen/cocogen/propertyDescriptions");
export const COCOGEN_STATE_PROPERTY_SEARCH = Symbol.for("@wictorwilen/cocogen/propertySearch");
export const COCOGEN_STATE_PROPERTY_SOURCE = Symbol.for("@wictorwilen/cocogen/propertySource");
export const COCOGEN_STATE_PROPERTY_NO_SOURCE = Symbol.for("@wictorwilen/cocogen/propertyNoSource");
export const COCOGEN_STATE_PROPERTY_PERSON_FIELDS = Symbol.for("@wictorwilen/cocogen/propertyPersonFields");

export type CocogenConnectionSettings = {
  contentCategory?:
    | "uncategorized"
    | "knowledgeBase"
    | "wikis"
    | "fileRepository"
    | "qna"
    | "crm"
    | "dashboard"
    | "people"
    | "media"
    | "email"
    | "messaging"
    | "meetingTranscripts"
    | "taskManagement"
    | "learningManagement";
  name?: string;
  connectionId?: string;
  connectionDescription?: string;
};

export type CocogenProfileSourceSettings = {
  webUrl: string;
  displayName: string;
  priority?: "first" | "last";
};

export type CocogenIdSettings = {
  encoding?: "slug" | "base64" | "hash";
};

export type CocogenSearchFlags = {
  searchable?: boolean;
  queryable?: boolean;
  retrievable?: boolean;
  refinable?: boolean;
  exactMatchRequired?: boolean;
};

export type CocogenSourceSettings = {
  csv?: string;
};

export type CocogenPersonEntityField = {
  path: string;
  source: CocogenSourceSettings | string;
};

