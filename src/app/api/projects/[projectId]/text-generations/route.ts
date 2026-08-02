import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { runTextGenerationStream } from "@/text-generation/run-generation";
import type { TextOutputKind } from "@/text-generation/types";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * POST：启动故事/剧本流式生成（SSE）。
 * 浏览器只提交 modelKey，不得提交任意供应商 model id。
 */
export async function POST(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const { projectId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const outputKind = raw.outputKind as TextOutputKind;
  const brief = typeof raw.brief === "string" ? raw.brief : "";
  const modelKey = typeof raw.modelKey === "string" ? raw.modelKey : "";
  const targetChars = raw.targetChars;
  const idempotencyKey =
    typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : "";
  const outlineText =
    typeof raw.outlineText === "string" ? raw.outlineText : undefined;
  const episodeNumber =
    typeof raw.episodeNumber === "number" && Number.isFinite(raw.episodeNumber)
      ? Math.trunc(raw.episodeNumber)
      : undefined;
  const episodeId =
    typeof raw.episodeId === "string" ? raw.episodeId.trim() : undefined;

  // 拒绝客户端直传供应商模型 ID / capability
  if (
    typeof raw.model === "string" ||
    typeof raw.providerModelId === "string" ||
    typeof raw.capabilityId === "string"
  ) {
    return NextResponse.json(
      { error: "不允许直接指定供应商模型或 capability" },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const chunk of runTextGenerationStream({
          projectId,
          user: session.user,
          outputKind,
          brief,
          modelKey,
          targetChars: Number(targetChars),
          idempotencyKey,
          outlineText,
          episodeNumber,
          episodeId,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        const unavailable = isRemoteDataServiceError(error);
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({
              code: unavailable ? "SERVICE_UNAVAILABLE" : "INTERNAL",
              message: unavailable ? "内网数据服务不可用" : "生成失败",
            })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
