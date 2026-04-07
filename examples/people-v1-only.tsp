import "@wictorwilen/cocogen";
using coco;

@coco.connection({
  contentCategory: "people",
  name: "People v1 only",
  connectionId: "peoplev1only",
  connectionDescription: "People connector example using only stable people labels"
})
@coco.profileSource({
  webUrl: "https://example.com/people/v1",
  displayName: "Example Stable People Source",
  priority: "first"
})
@doc("People connector example that only uses v1.0 people labels and property types.")
@coco.item()
model PeopleV1OnlyProfile {
  @coco.id
  @coco.label("personAccount")
  @coco.source("upn", "userPrincipalName")
  account: string;

  @coco.label("personName")
  @coco.source("display name", "displayName")
  name: string;

  @coco.label("personCurrentPosition")
  @coco.source("job title", "detail.jobTitle")
  @coco.source("company", "detail.company.displayName")
  position: string;

  @coco.label("personEmails")
  @coco.source("email", "address")
  @coco.source("email type", "type")
  emails: string[];

  @coco.label("personSkills")
  @coco.source("skill", "displayName")
  @coco.source("skill level", "proficiency")
  skills: string[];

  @coco.label("personWebSite")
  @coco.source("website", "webUrl")
  website: string;

  @coco.schemaDescription("Manager identity using the stable principal property type.")
  manager: coco.Principal;

  @coco.schemaDescription("Delegate identities using the stable principalCollection property type.")
  @coco.source("delegate upn", "userPrincipalName")
  @coco.source("delegate tenant", "tenantId")
  delegates: coco.Principal[];
}