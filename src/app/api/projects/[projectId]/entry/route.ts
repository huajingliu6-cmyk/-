import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { loadEpisodeAssetDesignStore } from "@/projects/assets/episode-design/store";
import {
  projectEntryPath,
  resolveProjectEntryStage,
} from "@/projects/project-entry";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  try {
    const [scriptDraft, assetStore] = await Promise.all([
      loadScriptDraft(projectId),
      loadEpisodeAssetDesignStore(projectId),
    ]);
    const stage = resolveProjectEntryStage({
      creationSource: gated.project.creationSource,
      scriptDraft,
      assetStore,
    });
    return NextResponse.json({
      stage,
      path: projectEntryPath(projectId, stage),
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json(
        { error: "项目数据服务暂不可用" },
        { status: 503 },
      );
    }
    throw error;
  }
}
