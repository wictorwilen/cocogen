// TypeSpec library entrypoint for @wictorwilen/cocogen
//
// This file defines the decorators consumed by cocogen.
// The implementations live in the JS module for this package.

import "./tsp-index.js";

using TypeSpec.Reflection;

namespace coco {
  model ConnectionSettings {
    contentCategory?: ContentCategory;
    name: string;
    connectionId: string;
    connectionDescription?: string;
  }

  model IdSettings {
    encoding?: IdEncoding;
  }

  model ProfileSourceSettings {
    webUrl: string;
    displayName: string;
    priority?: "first" | "last";
  }

  model SearchFlags {
    searchable?: boolean;
    queryable?: boolean;
    retrievable?: boolean;
    refinable?: boolean;
    exactMatchRequired?: boolean;
  }

  model ContentSettings {
    type?: "text";
  }

  model SourceSettings {
    csv?: string;
  }


  alias ContentCategory =
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

  alias IdEncoding =
    | "slug"
    | "base64"
    | "hash";

  alias Label =
    | "title"
    | "url"
    | "createdDateTime"
    | "lastModifiedDateTime"
    | "fileExtension"
    | "iconUrl"
    | "containerName"
    | "containerUrl"
    | "createdBy"
    | "lastModifiedBy"
    | "personAccount"
    | "personName"
    | "personCurrentPosition"
    | "personAddresses"
    | "personEmails"
    | "personPhones"
    | "personAwards"
    | "personCertifications"
    | "personProjects"
    | "personSkills"
    | "personWebAccounts"
    | "personWebSite"
    | "personAnniversaries"
    | "personNote";

  // Marks the external item model.
  extern dec item(target: Model);

  // Marks the item ID field.
  extern dec id(target: ModelProperty, settings?: IdSettings);

  // Schema labels (Graph externalConnectors.label values).
  extern dec label(target: ModelProperty, value: Label);

  // Aliases for schema fields.
  extern dec aliases(target: ModelProperty, value: string);

  // Schema property description (emitted to Microsoft Graph schema property.description).
  extern dec description(target: ModelProperty, value: string);

  // Field rename for Graph schema constraints.
  extern dec name(target: ModelProperty, value: string);

  // Connection-level settings.
  extern dec connection(target: Model, settings: ConnectionSettings);

  // People connector profile source settings.
  extern dec profileSource(target: Model, settings: ProfileSourceSettings);

  // Search flags.
  extern dec search(target: ModelProperty, flags: SearchFlags);

  // Marks an item content field for externalItem.content.value.
  extern dec content(target: ModelProperty, settings?: ContentSettings);

  // Maps a source field (CSV header) to a property or entity path.
  extern dec source(target: ModelProperty, from: SourceSettings | string, to?: string);

  // Marks a property as having no CSV source mapping.
  extern dec noSource(target: ModelProperty);

  // A custom scalar we map to Graph schema propertyType = principal.
  scalar Principal;
}
