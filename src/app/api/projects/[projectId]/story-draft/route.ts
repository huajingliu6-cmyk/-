import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  getCurrentDocument,
  loadStoryDraft,
  saveStoryDraft,
} from "@/text-generation/document-store";
import {
  BRIEF_MAX_CHARS,
  countVisibleChars,
  DEFAULT_TARGET_CHARS,
  TARGET_CHARS_MIN,
} from "@/text-generation/char-count";
import { getRecommendedModelKey } from "@/text-generation/model-registry";
import type { StoryDraft, TextOutputKind } from "@/text-generation/types";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** 草稿保存字数上限（与故事工作台 UI 对齐；生成接口仍可另有限制） */
const DRAFT_TARGET_CHARS_MAX = 3000;

function isValidDraftTargetChars(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= TARGET_CHARS_MIN &&
    value <= DRAFT_TARGET_CHARS_MAX
  );
}

async function getStoryDraft(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const draft = await loadStoryDraft(projectId);
  const current = await getCurrentDocument(projectId);
  return NextResponse.json({
    project: {
      projectId: project.projectId,
      rootFolderId: project.rootFolderId,
      name: project.name,
      status: project.status,
    },
    draft: draft ?? {
      projectId,
      brief: "",
      outputKind: "story" as TextOutputKind,
      modelKey: getRecommendedModelKey(),
      targetChars: DEFAULT_TARGET_CHARS,
      updatedAt: new Date().toISOString(),
    },
    currentDocument: current,
  });
}

async function putStoryDraft(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;
  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const brief = typeof raw.brief === "string" ? raw.brief : "";
  if (countVisibleChars(brief) > BRIEF_MAX_CHARS) {
    return NextResponse.json(
      { error: `灵感与大纲不能超过 ${BRIEF_MAX_CHARS} 字` },
      { status: 400 },
    );
  }
  const outputKind: TextOutputKind =
    raw.outputKind === "script" ? "script" : "story";
  const modelKey =
    typeof raw.modelKey === "string"
      ? raw.modelKey
      : getRecommendedModelKey();
  const targetChars = Number(raw.targetChars);
  if (!isValidDraftTargetChars(targetChars)) {
    return NextResponse.json(
      {
        error: `输出字数须为 ${TARGET_CHARS_MIN}—${DRAFT_TARGET_CHARS_MAX} 的整数`,
      },
      { status: 400 },
    );
  }

  const resultText =
    typeof raw.resultText === "string" ? raw.resultText : undefined;
  const scriptModeRaw = raw.scriptMode;
  const scriptMode =
    scriptModeRaw === "discuss-outline" || scriptModeRaw === "direct-episode"
      ? scriptModeRaw
      : scriptModeRaw === null
        ? null
        : undefined;
  const episodeNumber =
    typeof raw.episodeNumber === "number" &&
    Number.isInteger(raw.episodeNumber) &&
    raw.episodeNumber >= 1 &&
    raw.episodeNumber <= 8
      ? raw.episodeNumber
      : undefined;
  const episodeLength =
    raw.episodeLength === 300 ||
    raw.episodeLength === 400 ||
    raw.episodeLength === 500 ||
    raw.episodeLength === 800 ||
    raw.episodeLength === 1000
      ? raw.episodeLength
      : undefined;

  const draft: StoryDraft = {
    projectId,
    brief,
    outputKind,
    modelKey,
    targetChars,
    updatedAt: new Date().toISOString(),
    ...(resultText !== undefined ? { resultText } : {}),
    ...(scriptMode !== undefined ? { scriptMode } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    ...(episodeLength !== undefined ? { episodeLength } : {}),
  };
  await saveStoryDraft(draft);
  return NextResponse.json({ draft });
}

async function guardRemoteData<T>(operation: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await operation();
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}

export function GET(request: Request, context: RouteContext) {
  return guardRemoteData(() => getStoryDraft(request, context));
}

export function PUT(request: Request, context: RouteContext) {
  return guardRemoteData(() => putStoryDraft(request, context));
}
