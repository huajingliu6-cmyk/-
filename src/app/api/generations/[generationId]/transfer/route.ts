import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { assertSafeGenerationId, readGenerationRecord, updateGenerationRecord } from "@/video-generation/generation-store";
import { transferRemoteVideoToLocal } from "@/video-generation/transfer-video";

type RouteContext = { params: Promise<{ generationId: string }> };

/** 转存失败后重试下载临时 URL */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
) {
  try {
    const { generationId: rawId } = await context.params;
    const generationId = assertSafeGenerationId(rawId);
    const record = await readGenerationRecord(generationId);
    if (!record) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "任务不存在" },
        { status: 404 },
      );
    }
    if (!record.remoteVideoUrl) {
      return NextResponse.json(
        { code: "NO_REMOTE_URL", message: "没有可转存的远程视频地址" },
        { status: 400 },
      );
    }

    await updateGenerationRecord(generationId, {
      status: "downloading",
      progressLabel: "正在转存结果视频",
    });

    const transferred = await transferRemoteVideoToLocal({
      projectId: record.projectId,
      remoteVideoUrl: record.remoteVideoUrl,
      title: "镜头",
      generationId,
      isMock: record.isMock,
    });

    const generation = await updateGenerationRecord(generationId, {
      status: "completed",
      localVideoAssetId: transferred.asset.id,
      resultAsset: transferred.asset,
      progressLabel: record.isMock
        ? "Mock 演示结果，不是真实 AI 视频"
        : "已完成",
      completedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
    });

    return NextResponse.json({ generation, asset: transferred.asset });
  } catch (error) {
    return NextResponse.json(
      {
        code: "RESULT_TRANSFER_FAILED",
        message: error instanceof Error ? error.message : "转存失败",
      },
      { status: 400 },
    );
  }
}
