import { NextResponse } from "next/server";
import { applyCandidateVersion } from "@/projects/assets/extraction/apply-candidate";
import { getAssetExtractionSnapshot } from "@/projects/assets/extraction/snapshot";
import { startAssetExtractionTask } from "@/projects/assets/extraction/start-task";
import { toPublicExtractionTask } from "@/projects/assets/extraction/public-task";
import { getScriptSourceFingerprint, loadScriptDraft } from "@/projects/script/script-draft-store";
import type { ConflictDecision } from "@/projects/assets/extraction/types";

export async function handleGetAssetExtraction(projectId: string) {
  const snapshot = await getAssetExtractionSnapshot(projectId);
  return NextResponse.json(snapshot);
}

export async function handleStartAssetExtraction(
  projectId: string,
  body: unknown,
) {
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const scope = raw.scope === "episode" ? "episode" : "all";
  const episodeId =
    typeof raw.episodeId === "string" ? raw.episodeId.trim() : "";
  const modelKey =
    typeof raw.modelKey === "string" ? raw.modelKey.trim() : null;
  const draft = await loadScriptDraft(projectId);
  const fingerprint =
    (typeof raw.sourceFingerprint === "string" && raw.sourceFingerprint.trim()) ||
    getScriptSourceFingerprint(draft?.sourceText ?? "") ||
    "";
  if (!fingerprint) {
    return NextResponse.json(
      { error: "缺少剧本指纹，请先确认分集", code: "MISSING_FINGERPRINT" },
      { status: 400 },
    );
  }
  if (scope === "episode" && !episodeId) {
    return NextResponse.json(
      { error: "缺少剧集", code: "MISSING_EPISODE_ID" },
      { status: 400 },
    );
  }
  try {
    const started = await startAssetExtractionTask({
      projectId,
      sourceFingerprint: fingerprint,
      scope,
      episodeId: scope === "episode" ? episodeId : null,
      modelKey,
    });
    return NextResponse.json({
      task: toPublicExtractionTask(started.task),
      reused: started.reused,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法开始提取";
    if (message === "ASSET_EXTRACTION_IN_PROGRESS") {
      return NextResponse.json(
        { error: "资产提取尚未完成，请耐心等待。", code: message },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function handleApplyExtractionCandidate(
  projectId: string,
  body: unknown,
) {
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const decisions = Array.isArray(raw.decisions)
    ? (raw.decisions as ConflictDecision[])
    : undefined;
  const result = await applyCandidateVersion({ projectId, decisions });
  if (!result.ok) {
    const status = result.code === "CONFLICTS_REQUIRE_CONFIRM" ? 409 : 404;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }
  return NextResponse.json({ ok: true });
}
