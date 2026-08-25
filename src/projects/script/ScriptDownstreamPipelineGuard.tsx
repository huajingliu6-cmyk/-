"use client";

import { usePathname } from "next/navigation";
import { useGenerationBusy } from "@/shell/GenerationBusyGuard";
import { useScriptDownstreamPipeline } from "@/projects/script/use-script-downstream-pipeline";

type Props = {
  projectId: string;
  mode: "management" | "workspace";
};

function storyboardPathPrefix(projectId: string, mode: Props["mode"]): string {
  return mode === "workspace"
    ? `/app/workspace/projects/${encodeURIComponent(projectId)}/storyboard`
    : `/app/projects/${encodeURIComponent(projectId)}/storyboard`;
}

export function ScriptDownstreamPipelineGuard({ projectId, mode }: Props) {
  const pathname = usePathname();
  const apiRoot =
    mode === "workspace"
      ? `/api/workspace/projects/${encodeURIComponent(projectId)}`
      : `/api/projects/${encodeURIComponent(projectId)}`;
  const pipeline = useScriptDownstreamPipeline(projectId, apiRoot);
  const storyboardPrefix = storyboardPathPrefix(projectId, mode);
  const onStoryboardPage =
    pathname === storyboardPrefix || pathname.startsWith(`${storyboardPrefix}/`);

  const blockProjectNavigation =
    pipeline.extractingAssets && !onStoryboardPage;

  useGenerationBusy(
    blockProjectNavigation,
    `script-downstream-${projectId}`,
    "资产提取",
    {
      projectId,
      kind: "asset-extraction",
      leaveMessage: pipeline.message || "资产提取进行中，请稍候。",
    },
  );

  return null;
}
