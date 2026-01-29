import "@wictorwilen/cocogen";
using coco;

@coco.connection({
  contentCategory: "people",
  name: "People connector complex JSON",
  connectionId: "peoplecomplex",
  connectionDescription: "People connector example with nested JSON input"
})
@coco.profileSource({
  webUrl: "https://example.com/people",
  displayName: "Example People Directory",
  priority: "first"
})
@doc("People connector example using nested JSON input structures.")
@coco.item()
model PersonProfile {
  @coco.id
  @coco.label("personAccount")
  @coco.schemaDescription("Unique identifier for this person profile.")
  @example("alex@contoso.com")
  @format("email")
  @coco.source("profile.account.upn", "userPrincipalName")
  userPrincipalName: string;

  @coco.label("personName")
  @coco.schemaDescription("Preferred display name for this person.")
  @example("Alex Wilber")
  @minLength(2)
  @maxLength(128)
  @coco.source("profile.name.display", "displayName")
  displayName: string;

  @coco.label("personCurrentPosition")
  @coco.schemaDescription("Current work position mapped from nested fields.")
  @example("Senior Software Engineer")
  @coco.source("profile.position.detail.jobTitle", "detail.jobTitle")
  @coco.source("profile.position.detail.company.displayName", "detail.company.displayName")
  @coco.source("profile.position.detail.employeeId", "detail.employeeId")
  workPosition: string;

  @coco.label("personEmails")
  @coco.schemaDescription("Email addresses associated with this person.")
  @example(#["alex@contoso.com"])
  @coco.source("contact.emails[*].address", "address")
  @coco.source("contact.emails[*].type", "type")
  emails: string[];

  @coco.label("personPhones")
  @coco.schemaDescription("Phone numbers associated with this person.")
  @example(#["+1 555 0100"])
  @coco.source("contact.phones[*].number", "number")
  @coco.source("contact.phones[*].type", "type")
  phones: string[];

  @coco.schemaDescription("Department name from nested JSON.")
  @coco.source("profile.department.name")
  department: string;

  @coco.schemaDescription("Primary project name from nested JSON.")
  @coco.source("projects[0].name")
  primaryProject: string;
}
