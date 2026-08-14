import { describe, expect, it } from "vitest";
import {
  getCreditBalance,
  listCreditLedger,
  releaseReservation,
  reserveCredits,
} from "@/text-generation/credits";
import { enterpriseCreditAccountId } from "@/enterprise/credit-account";

describe("enterprise credit account", () => {
  it("charges an enterprise account without changing the actor's personal balance", async () => {
    const enterpriseId = "enterprise-wallet";
    const accountId = enterpriseCreditAccountId(enterpriseId);
    const actorUserId = "enterprise-wallet-actor";
    const personalBefore = await getCreditBalance(actorUserId);
    const enterpriseBefore = await getCreditBalance(accountId);

    await expect(
      reserveCredits({
        userId: actorUserId,
        accountId,
        actorUserId,
        enterpriseId,
        points: 125,
        generationId: "enterprise-wallet-generation",
        projectId: "enterprise-wallet-project",
        reason: "enterprise-generation",
      }),
    ).resolves.toEqual({ ok: true, balance: enterpriseBefore - 125 });

    expect(await getCreditBalance(actorUserId)).toBe(personalBefore);
    expect(await getCreditBalance(accountId)).toBe(enterpriseBefore - 125);
    expect(await listCreditLedger(accountId)).toContainEqual(
      expect.objectContaining({
        userId: actorUserId,
        accountId,
        enterpriseId,
        delta: -125,
      }),
    );

    await releaseReservation({
      generationId: "enterprise-wallet-generation",
      projectId: "enterprise-wallet-project",
      reason: "enterprise-generation-cancel",
    });
    expect(await getCreditBalance(accountId)).toBe(enterpriseBefore);
  });
});
