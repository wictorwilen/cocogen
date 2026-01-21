import "@wictorwilen/cocogen";
using coco;

@coco.connection({
  contentCategory: "people",
  name: "People all labels",
  connectionId: "peoplealllabels",
  connectionDescription: "People connector covering all person labels"
})
@coco.profileSource({
  webUrl: "https://example.com/people/all",
  displayName: "All Labels Directory",
  priority: "first"
})
@doc("People connector example that exercises every person label and many TypeSpec attributes.")
@coco.item()
model PeopleAllLabelsProfile {
  @coco.id
  @coco.label("personAccount")
  @doc("Primary account identifier.")
  @example("alex@contoso.com")
  @minLength(5)
  @maxLength(320)
  @format("email")
  @coco.source("upn", "userPrincipalName")
  account: string;

  @coco.label("personName")
  @doc("Preferred display name.")
  @example("Alex Wilber")
  @minLength(2)
  @maxLength(128)
  @coco.source("display name", "displayName")
  @coco.source("first name", "first")
  @coco.source("last name", "last")
  name: string;

  @coco.label("personCurrentPosition")
  @doc("Current work position.")
  @example("Senior Software Engineer")
  @coco.source("job title", "detail.jobTitle")
  @coco.source("company", "detail.company.displayName")
  @coco.source("employee id", "detail.employeeId")
  @coco.source("role", "detail.role")
  currentPosition: string;

  @coco.label("personAddresses")
  @doc("Physical addresses.")
  @example(#["{\"displayName\":\"HQ\",\"detail\":{\"street\":\"1 Main St\",\"city\":\"Redmond\"}}"])
  @coco.source("address label", "displayName")
  @coco.source("street", "detail.street")
  @coco.source("city", "detail.city")
  @coco.source("state", "detail.state")
  @coco.source("postal code", "detail.postalCode")
  addresses: string[];

  @coco.label("personEmails")
  @doc("Email addresses.")
  @example(#["{\"type\":\"work\",\"address\":\"alex@contoso.com\"}"])
  @coco.source("email", "address")
  @coco.source("email type", "type")
  emails: string[];

  @coco.label("personPhones")
  @doc("Phone numbers.")
  @example(#["{\"type\":\"mobile\",\"number\":\"+1 555 123 4567\"}"])
  @coco.source("phone", "number")
  @coco.source("phone type", "type")
  phones: string[];

  @coco.label("personAwards")
  @doc("Awards and recognitions.")
  @example(#["{\"displayName\":\"Employee of the Month\",\"issuedDate\":\"2024-05-01\"}"])
  @coco.source("award", "displayName")
  @coco.source("award description", "description")
  @coco.source("award date", "issuedDate")
  awards: string[];

  @coco.label("personCertifications")
  @doc("Certifications held.")
  @example(#["{\"displayName\":\"Azure Administrator\",\"issuingAuthority\":\"Microsoft\"}"])
  @coco.source("certification", "displayName")
  @coco.source("cert authority", "issuingAuthority")
  @coco.source("cert issued", "issuedDate")
  certifications: string[];

  @coco.label("personProjects")
  @doc("Project participation.")
  @example(#["{\"displayName\":\"Project Orion\",\"detail\":{\"description\":\"Search modernization\"}}"])
  @coco.source("project", "displayName")
  @coco.source("project description", "detail.description")
  projects: string[];

  @coco.label("personSkills")
  @doc("Skills and proficiencies.")
  @example(#["{\"displayName\":\"TypeScript\",\"proficiency\":\"advanced\"}"])
  @coco.source("skill", "displayName")
  @coco.source("skill level", "proficiency")
  skills: string[];

  @coco.label("personWebAccounts")
  @doc("Web accounts.")
  @example(#["{\"userId\":\"alex\",\"service\":{\"displayName\":\"GitHub\"}}"])
  @coco.source("web user", "userId")
  @coco.source("web service", "service.displayName")
  @coco.source("web url", "webUrl")
  webAccounts: string[];

  @coco.label("personWebSite")
  @doc("Primary website.")
  @example("https://example.com/alex")
  @format("uri")
  @coco.source("website", "webUrl")
  website: string;

  @coco.label("personAnniversaries")
  @doc("Anniversary dates.")
  @example(#["{\"displayName\":\"Hire Date\",\"date\":\"2020-01-15\",\"type\":\"work\"}"])
  @coco.source("anniversary", "displayName")
  @coco.source("anniversary date", "date")
  @coco.source("anniversary type", "type")
  anniversaries: string[];

  @coco.label("personNote")
  @doc("Short bio note.")
  @example("Customer success leader based in Seattle.")
  @maxLength(512)
  @coco.source("bio", "detail")
  note: string;

  @doc("Full text profile summary for search.")
  @example("Alex leads the customer success team and focuses on enterprise adoption.")
  @minLength(10)
  @maxLength(2000)
  @coco.source("summary")
  profileSummary: string;

  @doc("Numeric metadata for testing validation constraints.")
  @example(7)
  @minValue(0)
  @maxValue(10)
  @coco.source("rank")
  confidenceRank: int64;

  @doc("Flag for active profiles.")
  @example(true)
  @coco.source("active")
  isActive: boolean;
}
