import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  findAssetInDraft,
  findProduction,
  isRecord,
  loadAuthorizedWorkspace,
  parseJsonBody,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import type { MatchResolution } from "@/projects/storyboard/types";

/**
 * @deprecated deprecated for legacy compatibility；新分镜主流程不调用。
 */
type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; matchId: string }>;
};

const RESOLUTIONS: MatchResolution[] = [
  "unresolved",
  "matched",
  "not_needed",
  "temporary_character",
  "background_element",
  "generic_prop_or_sfx",
];

function parseResolution(value: unknown): MatchResolution | null {
  if (typeof value !== "string") return null;
  return RESOLUTIONS.includes(value as MatchResolution)
    ? (value as MatchResolution)
    : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId, matchId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  const matchIndex = production.assetMatches.findIndex((item) => item.id === matchId);
  if (matchIndex < 0) {
    return NextResponse.json({ error: "资产匹配项不存在" }, { status: 404 });
  }

  const body = await parseJsonBody(request);
  if (body === null || !isRecord(body)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const current = production.assetMatches[matchIndex]!;
  const next = { ...current };

  if (body.matchedAssetId !== undefined) {
    if (body.matchedAssetId !== null && typeof body.matchedAssetId !== "string") {
      return NextResponse.json({ error: "matchedAssetId 无效" }, { status: 400 });
    }
    if (body.matchedAssetId === null) {
      next.matchedAssetId = null;
      next.matchedAssetName = null;
      next.matchedAssetRevision = null;
    } else {
      const asset = findAssetInDraft(
        loaded.context.assetsDraft,
        current.assetType,
        body.matchedAssetId,
      );
      if (!asset) {
        return NextResponse.json({ error: "资产不存在或不属于本项目" }, { status: 400 });
      }
      next.matchedAssetId = asset.id;
      next.matchedAssetName = asset.name;
      next.matchedAssetRevision = asset.revision;
      next.matchSource = "manual";
      next.resolution = "matched";
    }
  }

  if (typeof body.matchedAssetName === "string") {
    next.matchedAssetName = body.matchedAssetName;
  }

  if (body.matchedAssetRevision !== undefined) {
    if (
      body.matchedAssetRevision !== null &&
      (typeof body.matchedAssetRevision !== "number" ||
        !Number.isFinite(body.matchedAssetRevision))
    ) {
      return NextResponse.json(
        { error: "matchedAssetRevision 无效" },
        { status: 400 },
      );
    }
    next.matchedAssetRevision =
      typeof body.matchedAssetRevision === "number"
        ? body.matchedAssetRevision
        : null;
  }

  if (body.resolution !== undefined) {
    const resolution = parseResolution(body.resolution);
    if (!resolution) {
      return NextResponse.json({ error: "resolution 无效" }, { status: 400 });
    }
    next.resolution = resolution;
  }

  if (typeof body.locked === "boolean") {
    next.locked = body.locked;
  }

  if (typeof body.confirmed === "boolean") {
    next.confirmed = body.confirmed;
  }

  if (next.matchedAssetId && next.matchSource !== "manual") {
    next.matchSource = "manual";
  }

  next.revision = current.revision + 1;

  const nextMatches = [...production.assetMatches];
  nextMatches[matchIndex] = next;

  const now = new Date().toISOString();
  const updated = await persistProduction(loaded.context.workspace, {
    ...production,
    assetMatches: nextMatches,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });

  const savedMatch = updated.assetMatches.find((item) => item.id === matchId);
  return NextResponse.json({ match: savedMatch, production: updated });
}
