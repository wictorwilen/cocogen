import "@wictorwilen/cocogen";
using coco;

@coco.connection({
  contentCategory: "people",
  name: "People beta labels",
  connectionId: "peoplebetalabels",
  connectionDescription: "People connector example using beta-only people labels"
})
@coco.profileSource({
  webUrl: "https://example.com/people/beta",
  displayName: "Example Beta People Source",
  priority: "first"
})
@doc("People connector example that exercises beta-only people labels.")
@coco.item()
model PeopleBetaLabelsProfile {
  @coco.id
  @coco.label("personAccount")
  @coco.source("upn", "userPrincipalName")
  account: string;

  @coco.label("personEducationalActivities")
  @coco.source("education institution", "institution.displayName")
  @coco.source("education program", "program.displayName")
  @coco.source("education abbreviation", "program.abbreviation")
  educationalActivities: string[];

  @coco.label("personInterests")
  @coco.source("interest", "displayName")
  @coco.source("interest detail", "description")
  interests: string[];

  @coco.label("personLanguages")
  @coco.source("language", "displayName")
  @coco.source("language tag", "tag")
  @coco.source("spoken level", "spoken")
  languages: string[];

  @coco.label("personPatents")
  @coco.source("patent", "displayName")
  @coco.source("patent number", "number")
  @coco.source("patent web", "webUrl")
  patents: string[];

  @coco.label("personPublications")
  @coco.source("publication", "displayName")
  @coco.source("publisher", "publisher")
  @coco.source("publication web", "webUrl")
  publications: string[];
}