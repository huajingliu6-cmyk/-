import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { loadWorkspace } from "@/projects/storyboard/production-store";
import type { EpisodeProductionStatus } from "@/projects/storyboard/types";
import { EPISODE_STATUS_LABEL } from "@/projects/storyboard/types";
import type { ProjectPublic, ProjectCreationSource } from "@/projects/types";
import {
  projectWorkbenchPath,
  workflowEditorPath,
} from "@/shell/nav";
import {
  getCurrentDocument,
  loadStoryDraft,
} from "@/text-generation/document-store";

export type WorkbenchStageStatus =
  | "not_started"
  | "in_progress"
  | "awaiting_confirm"
  | "completed"
  | "needs_reprocess"
  | "generation_failed";

export type WorkbenchStageId =
  | "script"
  | "assets"
  | "storyboard"
  | "video";

export type WorkbenchStageSummary = {
  id: WorkbenchStageId;
  title: string;
  description: string;
  status: WorkbenchStageStatus;
  statusLabel: string;
  updatedAt: string | null;
  href: string;
  enabled: boolean;
  disabledReason: string | null;
  actionLabel: string;
};

export type ContinueCreation = {
  href: string;
  label: string;
  stageId: WorkbenchStageId | "workbench";
};

export type ProjectWorkbenchSummary = {
  project: ProjectPublic;
  stages: WorkbenchStageSummary[];
  continueCreation: ContinueCreation;
  currentStageLabel: string;
  hasConfirmedStoryboard: boolean;
};

const STAGE_STATUS_LABEL: Record<WorkbenchStageStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  awaiting_confirm: "待确认",
  completed: "已完成",
  needs_reprocess: "需要重新处理",
  generation_failed: "生成失败",
};

function scriptHref(
  projectId: string,
  creationSource: ProjectCreationSource,
): string {
  return creationSource === "story"
    ? `/app/projects/${encodeURIComponent(projectId)}/story`
    : `/app/projects/${encodeURIComponent(projectId)}/script`;
}

function summarizeScriptStage(input: {
  projectId: string;
  creationSource: ProjectCreationSource;
  storyBrief: string;
  hasStoryDocument: boolean;
  episodeCount: number;
  savedEpisodeCount: number;
  updatedAt: string | null;
}): WorkbenchStageSummary {
  const href = scriptHref(input.projectId, input.creationSource);
  const title = "剧本创作";
  const description =
    input.creationSource === "story"
      ? "创编故事并生成剧本文本。"
      : "上传并分集保存本项目剧本。";

  let status: WorkbenchStageStatus = "not_started";
  if (input.creationSource === "story") {
    if (input.hasStoryDocument) status = "completed";
    else if (input.storyBrief.trim() || input.episodeCount > 0) {
      status = "in_progress";
    }
  } else if (input.savedEpisodeCount > 0) {
    status =
      input.savedEpisodeCount >= input.episodeCount && input.episodeCount > 0
        ? "completed"
        : "in_progress";
  } else if (input.episodeCount > 0) {
    status = "in_progress";
  }

  return {
    id: "script",
    title,
    description,
    status,
    statusLabel: STAGE_STATUS_LABEL[status],
    updatedAt: input.updatedAt,
    href,
    enabled: true,
    disabledReason: null,
    actionLabel: "进入剧本创作",
  };
}

function summarizeAssetsStage(input: {
  projectId: string;
  assetCount: number;
  completedCount: number;
  updatedAt: string | null;
}): WorkbenchStageSummary {
  let status: WorkbenchStageStatus = "not_started";
  if (input.assetCount > 0) {
    status =
      input.completedCount > 0 && input.completedCount === input.assetCount
        ? "completed"
        : "in_progress";
  }

  return {
    id: "assets",
    title: "项目资产",
    description: "管理角色、场景、道具与音频资产。",
    status,
    statusLabel: STAGE_STATUS_LABEL[status],
    updatedAt: input.updatedAt,
    href: `/app/projects/${encodeURIComponent(input.projectId)}/assets`,
    enabled: true,
    disabledReason: null,
    actionLabel: "进入项目资产",
  };
}

function pickStoryboardStatus(
  statuses: EpisodeProductionStatus[],
): WorkbenchStageStatus {
  if (statuses.length === 0) return "not_started";
  if (statuses.every((s) => s === "storyboard_done")) return "completed";
  if (statuses.some((s) => s === "generation_failed")) {
    return "generation_failed";
  }
  if (
    statuses.some(
      (s) =>
        s === "storyboard_review" ||
        s === "storyboard_incomplete" ||
        s === "assets_pending_confirm" ||
        s === "awaiting_script",
    )
  ) {
    return "awaiting_confirm";
  }
  if (
    statuses.some(
      (s) =>
        s === "storyboard_generating" ||
        s === "awaiting_storyboard" ||
        s === "awaiting_asset_match",
    )
  ) {
    return "in_progress";
  }
  if (statuses.some((s) => s !== "awaiting_script")) return "in_progress";
  return "not_started";
}

function summarizeStoryboardStage(input: {
  projectId: string;
  statuses: EpisodeProductionStatus[];
  stale: boolean;
  updatedAt: string | null;
}): WorkbenchStageSummary {
  let status = pickStoryboardStatus(input.statuses);
  if (input.stale && status !== "not_started") {
    status = "needs_reprocess";
  }

  const detail =
    input.statuses.length === 0
      ? "尚未开始分镜创作。"
      : `共 ${input.statuses.length} 集 · ${input.statuses
          .map((s) => EPISODE_STATUS_LABEL[s])
          .slice(0, 3)
          .join(" / ")}`;

  return {
    id: "storyboard",
    title: "分镜创作",
    description: `确认剧本、匹配资产并生成文字分镜。${detail}`,
    status,
    statusLabel: STAGE_STATUS_LABEL[status],
    updatedAt: input.updatedAt,
    href: `/app/projects/${encodeURIComponent(input.projectId)}/storyboard`,
    enabled: true,
    disabledReason: null,
    actionLabel: "进入分镜创作",
  };
}

function summarizeVideoStage(input: {
  projectId: string;
  hasConfirmedStoryboard: boolean;
  updatedAt: string | null;
}): WorkbenchStageSummary {
  const enabled = input.hasConfirmedStoryboard;
  return {
    id: "video",
    title: "视频制作",
    description: "在节点画布中编排镜头并生成视频。",
    status: enabled ? "in_progress" : "not_started",
    statusLabel: enabled ? "可进入" : STAGE_STATUS_LABEL.not_started,
    updatedAt: input.updatedAt,
    href: workflowEditorPath(input.projectId),
    enabled,
    disabledReason: enabled
      ? null
      : "请先完成并确认至少一集分镜。",
    actionLabel: "进入视频制作画布",
  };
}

function resolveContinue(
  stages: WorkbenchStageSummary[],
  projectId: string,
): ContinueCreation {
  const script = stages.find((s) => s.id === "script");
  const assets = stages.find((s) => s.id === "assets");
  const storyboard = stages.find((s) => s.id === "storyboard");

  if (script && script.status !== "completed") {
    return {
      href: script.href,
      label: "继续创作",
      stageId: "script",
    };
  }
  if (assets && assets.status !== "completed") {
    return {
      href: assets.href,
      label: "继续创作",
      stageId: "assets",
    };
  }
  if (
    storyboard &&
    storyboard.status !== "completed" &&
    storyboard.status !== "needs_reprocess"
  ) {
    return {
      href: storyboard.href,
      label: "继续创作",
      stageId: "storyboard",
    };
  }
  if (storyboard && storyboard.status === "needs_reprocess") {
    return {
      href: storyboard.href,
      label: "继续创作",
      stageId: "storyboard",
    };
  }

  return {
    href: projectWorkbenchPath(projectId),
    label: "查看项目进度",
    stageId: "workbench",
  };
}

/** 从现有草稿与项目元数据聚合只读工作台摘要。 */
export async function buildProjectWorkbenchSummary(
  project: ProjectPublic,
): Promise<ProjectWorkbenchSummary> {
  const projectId = project.projectId;

  const [storyDraft, currentDoc, scriptDraft, assetsDraft, storyboardWs] =
    await Promise.all([
      loadStoryDraft(projectId),
      getCurrentDocument(projectId),
      loadScriptDraft(projectId),
      loadAssetBundleDraft(projectId),
      loadWorkspace(projectId),
    ]);

  const episodes = scriptDraft?.episodes ?? [];
  const savedEpisodeCount = episodes.filter(
    (ep) => ep.status === "saved" && ep.content.trim().length > 0,
  ).length;

  const assets = assetsDraft
    ? [
        ...assetsDraft.characters,
        ...assetsDraft.scenes,
        ...assetsDraft.props,
        ...assetsDraft.audios,
      ]
    : [];
  const completedAssets = assets.filter((a) => a.status === "completed");

  const productions = storyboardWs?.productions ?? [];
  const statuses = productions.map((p) => p.status);
  const hasConfirmedStoryboard = productions.some(
    (p) => p.status === "storyboard_done",
  );
  const stale = productions.some((p) => p.assetsStale || p.storyboardStale);

  const scriptUpdated =
    scriptDraft?.updatedAt ??
    storyDraft?.updatedAt ??
    currentDoc?.createdAt ??
    null;
  const assetsUpdated = assetsDraft?.updatedAt ?? null;
  const storyboardUpdated = storyboardWs?.updatedAt ?? null;

  const stages: WorkbenchStageSummary[] = [
    summarizeScriptStage({
      projectId,
      creationSource: project.creationSource,
      storyBrief: storyDraft?.brief ?? "",
      hasStoryDocument: Boolean(
        currentDoc &&
          typeof currentDoc.content === "string" &&
          currentDoc.content.trim().length > 0,
      ),
      episodeCount: episodes.length,
      savedEpisodeCount,
      updatedAt: scriptUpdated,
    }),
    summarizeAssetsStage({
      projectId,
      assetCount: assets.length,
      completedCount: completedAssets.length,
      updatedAt: assetsUpdated,
    }),
    summarizeStoryboardStage({
      projectId,
      statuses,
      stale,
      updatedAt: storyboardUpdated,
    }),
  ];

  if (project.projectMode === "canvas") {
    stages.push(
      summarizeVideoStage({
        projectId,
        hasConfirmedStoryboard,
        updatedAt: hasConfirmedStoryboard ? storyboardUpdated : null,
      }),
    );
  }

  const continueCreation = resolveContinue(stages, projectId);
  const active =
    stages.find((s) => s.status !== "completed" && s.id !== "video") ??
    stages.find((s) => s.id === "video" && s.enabled) ??
    stages[0]!;

  return {
    project,
    stages,
    continueCreation,
    currentStageLabel: active.title,
    hasConfirmedStoryboard,
  };
}
