import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/** Public non-/api path so Go reverse proxy auth does not intercept. */
export async function GET() {
  const candidates = [
    path.join(process.cwd(), "public", "build-info.json"),
    path.join(process.cwd(), "build-info.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return NextResponse.json({
        ...parsed,
        envRevision: process.env.BUILD_REVISION ?? null,
        envSource: process.env.BUILD_SOURCE ?? null,
      });
    } catch {
      /* try next */
    }
  }
  return NextResponse.json({
    source: process.env.BUILD_SOURCE ?? "infinite-canvas-enterprise-spaces",
    revision: process.env.BUILD_REVISION ?? "unknown",
    builtAt: null,
    worktree: "infinite-canvas-enterprise-spaces",
  });
}
