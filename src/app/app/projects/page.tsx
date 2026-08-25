"use client";

import { FULL_STACK_FLOW } from "@/projects/project-flow";
import { ProjectFlowListPage } from "@/projects/ui/ProjectFlowListPage";

export default function ProjectsPage() {
  return <ProjectFlowListPage flow={FULL_STACK_FLOW} />;
}
