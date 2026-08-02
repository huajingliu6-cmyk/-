export class ProjectNameConflictError extends Error {
  constructor() {
    super("\u9879\u76ee\u540d\u79f0\u5df2\u5b58\u5728");
    this.name = "ProjectNameConflictError";
  }
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super("\u9879\u76ee\u4e0d\u5b58\u5728");
    this.name = "ProjectNotFoundError";
  }
}
