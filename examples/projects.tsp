import "@wictorwilen/cocogen";
using coco;

// Required: set connection defaults in generated config.
// @coco.connection({ connectionId: "myconnection", connectionDescription: "My connector" })

@doc("Project records synchronized into Microsoft 365 Copilot.")
@coco.item()
@connection({
  name: "Project connector",
  connectionId: "projectconnector",
  connectionDescription: "Connector for project items",
})
model Project {
  @coco.id
  @coco.source("id")
  @coco.schemaDescription("Unique identifier for the project")
  @example("PRJ-1001")
  @pattern("^PRJ-[0-9]+$")
  projectId: string;

  @coco.schemaDescription("Name of the project")
  @coco.source("name")
  @coco.label("title")
  @coco.search({ retrievable: true })
  @example("Northwind expansion")
  @minLength(3)
  @maxLength(120)
  projectName: string;

  @coco.schemaDescription("Detailed description of the project")
  @coco.source("description")
  @example("Greenfield rollout of the Northwind expansion program.")
  description: string;

  @coco.source("start_date")
  @coco.label("createdDateTime")
  @coco.schemaDescription("Project start date")
  @coco.search({ retrievable: true })
  startDate: utcDateTime;

  @coco.source("end_date")
  @coco.schemaDescription("Project end date")
  endDate: utcDateTime;

  @coco.source("manager")
  @doc("UPN of the project manager.")
  projectManager: Principal;

  @coco.content({ type: "text" })
  content: string;

}
