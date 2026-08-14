import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * Non-sensitive build identity for LAN/admin diagnostics.
 * Never includes secrets or full prompts.
 */
export async function GET() {
  const candidates = [
    path.join(process.cwd(), "public", "build-info.json"),
    path.join(process.cwd(), "build-info.json"),
  ];
  for (const file of candidates) {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as {
        source?: string;
        revision?: string;
        builtAt?: string;
        worktree?: string;
      };
      return NextResponse.json({
        source: parsed.source ?? "infinite-canvas-enterprise-spaces",
        revision: parsed.revision ?? process.env.BUILD_REVISION ?? "unknown",
        builtAt: parsed.builtAt ?? null,
        worktree: parsed.worktree ?? "infinite-canvas-enterprise-spaces",
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
    envRevision: process.env.BUILD_REVISION ?? null,
    envSource: process.env.BUILD_SOURCE ?? null,
  });
}
