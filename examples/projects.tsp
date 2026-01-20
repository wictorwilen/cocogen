import "@wictorwilen/cocogen";
using coco;

// Required: set connection defaults in generated config.
// @coco.connection({ connectionId: "myconnection", connectionDescription: "My connector" })

@TypeSpec.doc("Project records synchronized into Microsoft 365 Copilot.")
@coco.item()
@connection({
  name: "Project connector",
  connectionId: "projectconnector",
  connectionDescription: "Connector for project items",
})
model Project {
  @coco.id
  @coco.source("id")
  @coco.description("Unique identifier for the project")
  @TypeSpec.example("PRJ-1001")
  @TypeSpec.pattern("^PRJ-[0-9]+$")
  projectId: string;

  @coco.description("Name of the project")
  @coco.source("name")
  @coco.label("title")
  @coco.search({ retrievable: true })
  @TypeSpec.example("Northwind expansion")
  @TypeSpec.minLength(3)
  @TypeSpec.maxLength(120)
  projectName: string;

  @coco.description("Detailed description of the project")
  @coco.source("description")
  @TypeSpec.example("Greenfield rollout of the Northwind expansion program.")
  description: string;

  @coco.source("start_date")
  @coco.label("createdDateTime")
  @coco.description("Project start date")
  @coco.search({ retrievable: true })
  startDate: utcDateTime;

  @coco.source("end_date")
  @coco.description("Project end date")
  endDate: utcDateTime;

  @coco.source("manager")
  @TypeSpec.doc("UPN of the project manager.")
  projectManager: Principal;

  @coco.content({ type: "text" })
  content: string;

}
