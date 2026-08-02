"use client";

import { useParams } from "next/navigation";
import { StoryCreationWorkspace } from "@/projects/story/StoryCreationWorkspace";

export default function ProjectStoryPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  if (!projectId) {
    return (
      <div className="scw">
        <p>缺少项目 ID</p>
      </div>
    );
  }

  return <StoryCreationWorkspace projectId={projectId} />;
}
