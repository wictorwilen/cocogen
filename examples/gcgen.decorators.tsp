// Minimal decorator declarations for examples.
// These are here so the examples look like “real TypeSpec”.
// The generator will eventually ship its own decorator library.

namespace coco {
  // Marks the external item model.
  extern dec item(target: Model);

  // Marks the item ID field.
  extern dec id(target: ModelProperty);

  // Schema labels (Graph externalConnectors.label values).
  extern dec label(
    target: ModelProperty,
    value:
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
      | "personNote"
  );

  // Aliases for schema fields.
  extern dec aliases(target: ModelProperty, value: string);

  // Schema property description (emitted to Microsoft Graph schema property.description).
  extern dec description(target: ModelProperty, value: string);

  // Field rename for Graph schema constraints.
  extern dec name(target: ModelProperty, value: string);

  // Connection-level settings.
  extern dec connection(
    target: Model,
    settings: { contentCategory?: string; connectionId?: string; connectionDescription?: string }
  );

  // People connector profile source settings.
  extern dec profileSource(
    target: Model,
    settings: { webUrl: string; displayName?: string; priority?: "first" | "last" }
  );

  // Search flags.
  extern dec search(
    target: ModelProperty,
    flags: {
      searchable?: boolean;
      queryable?: boolean;
      retrievable?: boolean;
      refinable?: boolean;
      exactMatchRequired?: boolean;
    }
  );

  // Marks an item content field for externalItem.content.value.
  extern dec content(target: ModelProperty, settings?: { type?: "text" });

  // Maps a CSV header to a destination property or entity path.
  extern dec source(target: ModelProperty, from: { csv?: string } | string, to?: string);

  // A custom scalar we map to Graph schema propertyType = principal.
  scalar Principal;
}
