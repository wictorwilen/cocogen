import "@wictorwilen/cocogen";
using coco;

@coco.connection({
  contentCategory: "knowledgeBase",
  name: "Complex content connector",
  connectionId: "complexcontent",
  connectionDescription: "Non-people connector with extensive validation"
})
@doc("Content connector example that exercises validation, search flags, and semantic labels.")
@coco.item()
model ComplexContentItem {
  @coco.id
  @doc("Primary external item identifier.")
  @example("DOC-0001")
  @minLength(3)
  @maxLength(64)
  @pattern("^[A-Z0-9-]+$")
  @coco.source("doc id")
  documentId: string;

  @coco.name("docKey")
  @doc("Secondary document key with a non-alphanumeric property name.")
  @example("DOC_KEY_001")
  @coco.source("doc key")
  document_key: string;

  @coco.label("title")
  @coco.search({ searchable: true, retrievable: true })
  @doc("Document title.")
  @example("How to onboard customers")
  @minLength(4)
  @maxLength(200)
  @coco.source("title")
  title: string;

  @coco.label("url")
  @coco.search({ retrievable: true })
  @doc("Public URL for the document.")
  @example("https://example.com/docs/onboarding")
  @format("uri")
  @coco.source("url")
  url: string;

  @coco.label("createdDateTime")
  @coco.search({ retrievable: true })
  @doc("Creation timestamp.")
  @coco.source("created")
  createdAt: utcDateTime;

  @coco.label("lastModifiedDateTime")
  @coco.search({ retrievable: true })
  @doc("Last modified timestamp.")
  @coco.source("modified")
  modifiedAt: utcDateTime;

  @coco.search({ searchable: true, retrievable: true })
  @doc("Document authors.")
  @example(#["Alex Wilber", "Megan Bowen"])
  @coco.source("authors")
  authors: string[];

  @coco.search({ retrievable: true })
  @doc("Author user principal names.")
  @example(#["alex@contoso.com", "megan@contoso.com"])
  @coco.source("author upn")
  authorUpns: string[];

  @coco.search({ retrievable: true })
  @doc("File name used in storage.")
  @example("onboarding.pdf")
  @coco.source("file name")
  fileName: string;

  @coco.label("fileExtension")
  @coco.search({ retrievable: true })
  @doc("File extension.")
  @example("pdf")
  @pattern("^[a-z0-9]+$")
  @coco.source("file extension")
  fileExtension: string;

  @coco.label("containerName")
  @coco.search({ retrievable: true })
  @doc("Container name.")
  @example("KnowledgeBase")
  @coco.source("container name")
  containerName: string;

  @coco.label("containerUrl")
  @coco.search({ retrievable: true })
  @doc("Container URL.")
  @example("https://example.com/docs")
  @format("uri")
  @coco.source("container url")
  containerUrl: string;

  @coco.label("createdBy")
  @coco.search({ retrievable: true })
  @doc("Creator UPN.")
  @example("owner@contoso.com")
  @format("email")
  @coco.source("created by upn")
  createdByUpn: string;

  @coco.label("lastModifiedBy")
  @coco.search({ retrievable: true })
  @doc("Last modifier UPN.")
  @example("editor@contoso.com")
  @format("email")
  @coco.source("modified by upn")
  modifiedByUpn: string;

  @coco.search({ refinable: true, retrievable: true })
  @doc("Document category tags.")
  @example(#["onboarding", "customer-success"])
  @coco.aliases("topics")
  @coco.aliases("tags")
  @coco.source("tags")
  tags: string[];

  @coco.search({ retrievable: true })
  @doc("Estimated read time in minutes.")
  @example(12)
  @minValue(1)
  @maxValue(180)
  @coco.source("read minutes")
  readTimeMinutes: int64;

  @coco.search({ retrievable: true })
  @doc("Customer satisfaction score.")
  @example(4.7)
  @minValue(0)
  @maxValue(5)
  @coco.source("satisfaction")
  satisfactionScore: float64;

  @coco.search({ retrievable: true })
  @doc("Published flag.")
  @example(true)
  @coco.source("published")
  isPublished: boolean;

  @coco.search({ retrievable: true })
  @doc("Last review dates.")
  @coco.source("reviewed")
  reviewDates: utcDateTime[];

  @coco.search({ retrievable: true })
  @doc("Assigned reviewers.")
  @coco.source("reviewer upn")
  reviewers: coco.Principal[];

  @coco.search({ retrievable: true })
  @doc("Owning manager.")
  @coco.source("owner upn")
  owner: coco.Principal;

  @coco.content
  @example("This article describes the onboarding process in detail.")
  @minLength(10)
  @maxLength(5000)
  @coco.source("content")
  content: string;
}
