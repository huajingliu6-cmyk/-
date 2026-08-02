import { createReadStream } from "fs";
import { promises as fs } from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { resolveLocalVoiceFile } from "@/projects/assets/local-voice-library";
import { planAssetContentResponse } from "@/video-generation/serve-generated-video";

type RouteContext = {
  params: Promise<{ voiceId: string }>;
};

const CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Accept-Ranges": "bytes",
} as const;

/**
 * Stream a local library voice file for preview / binding.
 * Supports HTML &lt;audio&gt; Range requests.
 */
export async function GET(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const { voiceId: rawId } = await context.params;
  const voiceId = decodeURIComponent(rawId);
  const resolved = await resolveLocalVoiceFile(voiceId);
  if (!resolved) {
    return NextResponse.json({ error: "本地音色不存在" }, { status: 404 });
  }

  let stat;
  try {
    stat = await fs.stat(resolved.absolutePath);
  } catch {
    return NextResponse.json({ error: "本地音色不存在" }, { status: 404 });
  }

  const plan = planAssetContentResponse({
    rangeHeader: request.headers.get("range"),
    fileSize: stat.size,
  });
  if (!plan.ok) {
    return new NextResponse(null, {
      status: plan.status,
      headers: {
        ...CACHE_HEADERS,
        "Content-Range": plan.contentRange,
        "Content-Type": resolved.mimeType,
      },
    });
  }

  const stream =
    plan.start == null || plan.end == null
      ? createReadStream(resolved.absolutePath)
      : createReadStream(resolved.absolutePath, {
          start: plan.start,
          end: plan.end,
        });

  const headers: Record<string, string> = {
    ...CACHE_HEADERS,
    "Content-Type": resolved.mimeType,
    "Content-Length": String(plan.contentLength),
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(resolved.fileName)}`,
  };
  if (plan.contentRange) {
    headers["Content-Range"] = plan.contentRange;
  }

  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: plan.status,
    headers,
  });
}
