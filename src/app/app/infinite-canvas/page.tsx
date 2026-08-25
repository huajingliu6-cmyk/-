"use client";

import { INFINITE_CANVAS_FLOW } from "@/projects/project-flow";
import { ProjectFlowListPage } from "@/projects/ui/ProjectFlowListPage";

export default function InfiniteCanvasProjectsPage() {
  return <ProjectFlowListPage flow={INFINITE_CANVAS_FLOW} />;
}
