"use client";

import { useParams } from "next/navigation";
import { StoryboardCreationWorkspace } from "@/projects/storyboard/StoryboardCreationWorkspace";

export default function ProjectStoryboardPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  if (!projectId) {
    return (
      <div className="sbw">
        <p>缺少项目 ID</p>
      </div>
    );
  }

  return (
    <StoryboardCreationWorkspace key={projectId} projectId={projectId} />
  );
}
