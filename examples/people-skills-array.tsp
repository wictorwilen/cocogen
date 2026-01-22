import "@wictorwilen/cocogen";
using coco;

@coco.connection({
  contentCategory: "people",
  name: "People skills array example",
  connectionId: "peopleskillsarray",
  connectionDescription: "People connector example using array-based skill input"
})
@coco.profileSource({
  webUrl: "https://example.com/people",
  displayName: "Example People Directory",
  priority: "first"
})
@doc("People connector example with skills array input and @example values.")
@coco.item()
model PersonProfile {
  @coco.id
  @coco.label("personAccount")
  @example("user@contoso.com")
  @coco.source("userId", "userPrincipalName")
  userId: string;

  @coco.label("personSkills")
  @example(#[
    "{\"displayName\":\"SkillA\",\"proficiency\":\"expert\"}",
    "{\"displayName\":\"SkillB\",\"proficiency\":\"intermediate\"}"
  ])
  @coco.source("skills[*].name", "displayName")
  @coco.source("skills[*].level", "proficiency")
  skills: string[];
}
