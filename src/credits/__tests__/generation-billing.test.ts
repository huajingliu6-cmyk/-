import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/enterprise/credit-account", () => ({
  resolveProjectCreditAccount: vi.fn(async () => ({
    accountId: "user_billing",
    actorUserId: "user_billing",
    enterpriseId: undefined,
  })),
}));

import {
  buildImageCreditReservationId,
  buildVideoCreditReservationId,
  releaseGenerationCredits,
  reserveImageGenerationCredits,
  reserveVideoGenerationCredits,
  settleGenerationCredits,
} from "@/credits/generation-billing";
import { getCreditBalance, getFrozenCredits } from "@/text-generation/credits";

describe("generation-billing", () => {
  let tmp = "";
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousRemote = process.env.REMOTE_DATA_ONLY;
  const previousBalance = process.env.TEXT_CREDITS_DEV_BALANCE;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-gen-billing-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.REMOTE_DATA_ONLY = "false";
    process.env.TEXT_CREDITS_DEV_BALANCE = "100";
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousRemote === undefined) delete process.env.REMOTE_DATA_ONLY;
    else process.env.REMOTE_DATA_ONLY = previousRemote;
    if (previousBalance === undefined) delete process.env.TEXT_CREDITS_DEV_BALANCE;
    else process.env.TEXT_CREDITS_DEV_BALANCE = previousBalance;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("builds stable idempotent reservation ids", () => {
    const a = buildImageCreditReservationId({
      projectId: "p1",
      itemKey: "ep1:item1",
      idempotencyKey: "idem-1",
    });
    const b = buildImageCreditReservationId({
      projectId: "p1",
      itemKey: "ep1:item1",
      idempotencyKey: "idem-1",
    });
    const c = buildImageCreditReservationId({
      projectId: "p1",
      itemKey: "ep1:item1",
      idempotencyKey: "idem-2",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("img_")).toBe(true);

    const v1 = buildVideoCreditReservationId({
      projectId: "p1",
      shotId: "shot_1",
      idempotencyKey: "batch:shot_1",
    });
    const v2 = buildVideoCreditReservationId({
      projectId: "p1",
      shotId: "shot_1",
      idempotencyKey: "batch:shot_1",
    });
    expect(v1).toBe(v2);
    expect(v1.startsWith("vid_")).toBe(true);
  });

  it("reserves first image for 2 and subsequent for 1; settles and releases", async () => {
    const first = await reserveImageGenerationCredits({
      projectId: "p1",
      actorUserId: "user_billing",
      itemKey: "ep:item",
      idempotencyKey: "img-first",
      generatedMedia: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.points).toBe(2);
    expect(first.firstGeneration).toBe(true);
    expect(await getFrozenCredits("user_billing")).toBe(2);

    await settleGenerationCredits({
      reservationId: first.reservationId,
      projectId: "p1",
      actualPoints: 2,
      reason: "test-settle",
      knownBalance: first.balance,
    });
    expect(await getCreditBalance("user_billing")).toBe(98);
    expect(await getFrozenCredits("user_billing")).toBe(0);

    const next = await reserveImageGenerationCredits({
      projectId: "p1",
      actorUserId: "user_billing",
      itemKey: "ep:item",
      idempotencyKey: "img-next",
      generatedMedia: {
        currentId: "media_1",
        historyIds: ["media_1"],
        history: [],
      },
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.points).toBe(1);
    expect(next.firstGeneration).toBe(false);

    await releaseGenerationCredits({
      reservationId: next.reservationId,
      projectId: "p1",
      reason: "provider-failed",
    });
    expect(await getCreditBalance("user_billing")).toBe(98);
    expect(await getFrozenCredits("user_billing")).toBe(0);
  });

  it("returns 402 when image balance is insufficient", async () => {
    process.env.TEXT_CREDITS_DEV_BALANCE = "1";
    const reserved = await reserveImageGenerationCredits({
      projectId: "p1",
      actorUserId: "user_billing",
      itemKey: "ep:item",
      idempotencyKey: "img-poor",
      generatedMedia: null,
    });
    expect(reserved.ok).toBe(false);
    if (reserved.ok) return;
    expect(reserved.response.status).toBe(402);
    const body = await reserved.response.json();
    expect(body.code).toBe("INSUFFICIENT_CREDITS");
  });

  it("reserves video by resolution and blocks 1080P", async () => {
    const ok480 = await reserveVideoGenerationCredits({
      projectId: "p1",
      actorUserId: "user_billing",
      shotId: "shot_a",
      idempotencyKey: "v-480",
      resolution: "480P",
      durationSeconds: 5,
    });
    expect(ok480.ok).toBe(true);
    if (!ok480.ok) return;
    expect(ok480.quote.points).toBe(25);

    const blocked = await reserveVideoGenerationCredits({
      projectId: "p1",
      actorUserId: "user_billing",
      shotId: "shot_b",
      idempotencyKey: "v-1080",
      resolution: "1080P",
      durationSeconds: 5,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.response.status).toBe(403);
    const body = await blocked.response.json();
    expect(body.code).toBe("VIDEO_CREDIT_PRICE_NOT_CONFIGURED");
  });

  it("keeps duplicate image reserves idempotent", async () => {
    const input = {
      projectId: "p1",
      actorUserId: "user_billing",
      itemKey: "ep:item",
      idempotencyKey: "same-key",
      generatedMedia: null as null,
    };
    const a = await reserveImageGenerationCredits(input);
    const b = await reserveImageGenerationCredits(input);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.reservationId).toBe(b.reservationId);
    expect(await getFrozenCredits("user_billing")).toBe(2);
    expect(await getCreditBalance("user_billing")).toBe(98);
  });
});
