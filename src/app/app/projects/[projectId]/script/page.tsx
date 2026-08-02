"use client";

import { useParams } from "next/navigation";
import { ScriptCreationWorkspace } from "@/projects/script/ScriptCreationWorkspace";

export default function ProjectScriptPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  if (!projectId) {
    return (
      <div className="scw-script">
        <p>缺少项目 ID</p>
      </div>
    );
  }

  return <ScriptCreationWorkspace projectId={projectId} />;
}
