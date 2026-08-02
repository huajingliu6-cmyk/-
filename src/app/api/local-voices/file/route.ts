import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import { promises as fs } from "fs";
import { Readable } from "stream";
import { requireSessionUser } from "@/auth/require-user";
import { resolveLocalVoiceFile } from "@/projects/assets/local-voice-library";
import { planAssetContentResponse } from "@/video-generation/serve-generated-video";

const CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Accept-Ranges": "bytes",
} as const;

/**
 * Stream a local library voice by query id.
 * Prefer this over path-param URLs (base64url ids are safer in query strings).
 * GET /api/local-voices/file?voiceId=localvoice_...
 */
export async function GET(request: Request) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const voiceId = new URL(request.url).searchParams.get("voiceId")?.trim() ?? "";
  if (!voiceId) {
    return NextResponse.json({ error: "缺少 voiceId" }, { status: 400 });
  }

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
