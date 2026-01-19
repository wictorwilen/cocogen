import "@wictorwilen/cocogen";
using coco;

// Optional: set connection defaults in generated config.
// @coco.connection({ connectionId: "myconnection", connectionDescription: "My connector" })

@coco.item()
@connection({
  connectionId: "projectconnector",
  connectionDescription: "Connector for project items",
})
model Project {
  @coco.id
  @coco.source("id")
  @coco.description("Unique identifier for the project")
  projectId: string;

  @coco.description("Name of the project")
  @coco.source("name")
  @coco.label("title")
  projectName: string;

  @coco.description("Detailed description of the project")
  @coco.source("description")
  description: string;

  @coco.source("start_date")
  @coco.label("createdDateTime")
  @coco.description("Project start date")
  startDate: utcDateTime;

  @coco.source("end_date")
  @coco.description("Project end date")
  endDate: utcDateTime;

  @coco.source("manager")
  projectManager: Principal;

  @coco.content({ type: "text" })
  content: string;

}
