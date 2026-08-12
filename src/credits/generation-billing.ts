import "server-only";

import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { resolveProjectCreditAccount } from "@/enterprise/credit-account";
import {
  INSUFFICIENT_CREDITS,
  estimateAssetImageCredits,
  quoteStoryboardVideoCredits,
  type VideoCreditQuote,
} from "@/credits/generation-pricing";
import {
  getCreditBalance,
  releaseReservation,
  reserveCredits,
  settleReservation,
} from "@/text-generation/credits";
import type { GeneratedMediaState } from "@/projects/assets/episode-design/types";
import type { VideoResolution } from "@/video-generation/types";

export type CreditChargeInfo = {
  chargedPoints: number;
  balance: number;
  resolution?: VideoResolution | string;
  durationSeconds?: number;
  firstGeneration?: boolean;
};

export function buildImageCreditReservationId(input: {
  projectId: string;
  itemKey: string;
  idempotencyKey: string;
}): string {
  const material = `asset-image:${input.projectId}:${input.itemKey}:${input.idempotencyKey}`;
  return `img_${createHash("sha256").update(material).digest("hex").slice(0, 40)}`;
}

export function buildVideoCreditReservationId(input: {
  projectId: string;
  shotId: string;
  idempotencyKey: string;
}): string {
  const material = `storyboard-video:${input.projectId}:${input.shotId}:${input.idempotencyKey}`;
  return `vid_${createHash("sha256").update(material).digest("hex").slice(0, 40)}`;
}

export function insufficientCreditsResponse(message = "剩余积分不足") {
  return NextResponse.json(
    { error: message, code: INSUFFICIENT_CREDITS },
    { status: 402 },
  );
}

export function videoPriceNotConfiguredResponse(quote: Extract<VideoCreditQuote, { ok: false }>) {
  return NextResponse.json(
    {
      error: quote.error,
      code: quote.code,
      resolution: quote.resolution,
      durationSeconds: quote.durationSeconds,
    },
    { status: 403 },
  );
}

export async function reserveImageGenerationCredits(input: {
  projectId: string;
  actorUserId: string;
  itemKey: string;
  idempotencyKey: string;
  generatedMedia?: GeneratedMediaState | null;
  reason?: string;
}): Promise<
  | {
      ok: true;
      reservationId: string;
      points: number;
      firstGeneration: boolean;
      balance: number;
    }
  | { ok: false; response: NextResponse }
> {
  const account = await resolveProjectCreditAccount({
    projectId: input.projectId,
    actorUserId: input.actorUserId,
  });
  if (!account) {
    return {
      ok: false,
      response: NextResponse.json({ error: "无权使用该项目积分账户" }, { status: 403 }),
    };
  }

  const estimate = estimateAssetImageCredits(input.generatedMedia);
  const reservationId = buildImageCreditReservationId({
    projectId: input.projectId,
    itemKey: input.itemKey,
    idempotencyKey: input.idempotencyKey,
  });

  const reserved = await reserveCredits({
    userId: input.actorUserId,
    accountId: account.accountId,
    actorUserId: account.actorUserId,
    enterpriseId: account.enterpriseId,
    points: estimate.points,
    generationId: reservationId,
    projectId: input.projectId,
    reason: input.reason ?? "asset-image-generation-reserve",
  });

  if (!reserved.ok) {
    return { ok: false, response: insufficientCreditsResponse(reserved.error) };
  }

  return {
    ok: true,
    reservationId,
    points: estimate.points,
    firstGeneration: estimate.firstGeneration,
    balance: reserved.balance,
  };
}

export async function reserveVideoGenerationCredits(input: {
  projectId: string;
  actorUserId: string;
  shotId: string;
  idempotencyKey: string;
  resolution: VideoResolution | string;
  durationSeconds: number;
  reason?: string;
}): Promise<
  | {
      ok: true;
      reservationId: string;
      quote: Extract<VideoCreditQuote, { ok: true }>;
      balance: number;
    }
  | { ok: false; response: NextResponse }
> {
  const quote = quoteStoryboardVideoCredits({
    resolution: input.resolution,
    durationSeconds: input.durationSeconds,
  });
  if (!quote.ok) {
    return { ok: false, response: videoPriceNotConfiguredResponse(quote) };
  }

  const account = await resolveProjectCreditAccount({
    projectId: input.projectId,
    actorUserId: input.actorUserId,
  });
  if (!account) {
    return {
      ok: false,
      response: NextResponse.json({ error: "无权使用该项目积分账户" }, { status: 403 }),
    };
  }

  const reservationId = buildVideoCreditReservationId({
    projectId: input.projectId,
    shotId: input.shotId,
    idempotencyKey: input.idempotencyKey,
  });

  const reserved = await reserveCredits({
    userId: input.actorUserId,
    accountId: account.accountId,
    actorUserId: account.actorUserId,
    enterpriseId: account.enterpriseId,
    points: quote.points,
    generationId: reservationId,
    projectId: input.projectId,
    reason: input.reason ?? "storyboard-video-generation-reserve",
  });

  if (!reserved.ok) {
    return { ok: false, response: insufficientCreditsResponse(reserved.error) };
  }

  return {
    ok: true,
    reservationId,
    quote,
    balance: reserved.balance,
  };
}

export async function settleGenerationCredits(input: {
  reservationId: string;
  projectId: string;
  actualPoints: number;
  reason: string;
  accountId?: string;
  knownBalance?: number;
}): Promise<CreditChargeInfo> {
  await settleReservation({
    generationId: input.reservationId,
    actualPoints: input.actualPoints,
    projectId: input.projectId,
    reason: input.reason,
  });
  const balance =
    typeof input.knownBalance === "number"
      ? input.knownBalance
      : input.accountId
        ? await getCreditBalance(input.accountId)
        : 0;
  return {
    chargedPoints: input.actualPoints,
    balance,
  };
}

export async function releaseGenerationCredits(input: {
  reservationId: string;
  projectId: string;
  reason: string;
}): Promise<void> {
  await releaseReservation({
    generationId: input.reservationId,
    projectId: input.projectId,
    reason: input.reason,
  });
}

export function parseIdempotencyKey(
  raw: unknown,
): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key ? key : null;
}
