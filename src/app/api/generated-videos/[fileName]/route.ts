import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";

function generatedVideosDir(): string {
  return resolveAppDataPath("generated-videos");
}
const SAFE = /^[a-zA-Z0-9._-]+$/;

type RouteContext = { params: Promise<{ fileName: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  if (isRemoteDataOnly()) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
  const { fileName } = await context.params;
  if (!SAFE.test(fileName) || fileName.includes("..")) {
    return NextResponse.json({ error: "非法文件名" }, { status: 400 });
  }
  const dir = generatedVideosDir();
  const filePath = path.join(dir, fileName);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }
  try {
    const buffer = await fs.readFile(resolved);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}
