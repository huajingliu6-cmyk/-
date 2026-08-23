import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { loadEpisodeAssetDesignStore } from "@/projects/assets/episode-design/store";
import { ensureAssetExtractionMigrated } from "@/projects/assets/extraction/migrate";
import { getActiveVersion, loadAssetExtractionStore } from "@/projects/assets/extraction/store";
import {
  projectEntryPath,
  resolveProjectEntryStage,
} from "@/projects/project-entry";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

async function loadExtractionForEntry(projectId: string) {
  try {
    return await ensureAssetExtractionMigrated(projectId);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      throw error;
    }
    try {
      return await loadAssetExtractionStore(projectId);
    } catch {
      throw error;
    }
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  try {
    const [scriptDraft, assetStore, extraction] = await Promise.all([
      loadScriptDraft(projectId),
      loadEpisodeAssetDesignStore(projectId),
      loadExtractionForEntry(projectId),
    ]);
    const stage = resolveProjectEntryStage({
      creationSource: gated.project.creationSource,
      scriptDraft,
      assetStore,
      hasActiveVersion: Boolean(getActiveVersion(extraction)),
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
    console.error("project entry resolution failed", { projectId, error });
    return NextResponse.json(
      { error: "无法判断项目进度，请稍后重试" },
      { status: 500 },
    );
  }
}
