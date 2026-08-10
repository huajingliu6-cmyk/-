import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Account = {
  balance: number;
  reservations: Record<string, number>;
};
type Reservation = {
  active: boolean;
  generationId: string;
  accountId: string;
  actorUserId: string;
  enterpriseId?: string;
  points: number;
};

const state = vi.hoisted(() => ({
  accounts: new Map<string, Account>(),
  reservations: new Map<string, Reservation>(),
}));

function account(userId: string): Account {
  const existing = state.accounts.get(userId);
  if (existing) return existing;
  const created = { balance: 100, reservations: {} };
  state.accounts.set(userId, created);
  return created;
}

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    if ((init.method ?? "GET") === "GET") {
      const current = account(
        url.searchParams.get("accountId") ??
          url.searchParams.get("userId") ??
          "",
      );
      return Response.json({
        balance: current.balance,
        frozen: Object.values(current.reservations).reduce(
          (total, points) => total + points,
          0,
        ),
      });
    }

    const input = JSON.parse(String(init.body));
    if (input.action === "reserve") {
      await Promise.resolve();
      const accountId = input.accountId ?? input.userId;
      const actorUserId = input.actorUserId ?? input.userId;
      const current = account(accountId);
      const existing = state.reservations.get(input.generationId);
      if (existing?.active) {
        return Response.json({ ok: true, balance: current.balance });
      }
      const points = Math.max(0, Math.floor(input.points));
      if (current.balance < points) {
        return Response.json({ ok: false, error: "剩余积分不足" });
      }
      current.balance -= points;
      current.reservations[input.generationId] = points;
      state.reservations.set(input.generationId, {
        active: true,
        generationId: input.generationId,
        accountId,
        actorUserId,
        enterpriseId: input.enterpriseId,
        points,
      });
      return Response.json({ ok: true, balance: current.balance });
    }

    if (input.action === "settle") {
      const reservation = state.reservations.get(input.generationId);
      if (!reservation?.active) return Response.json({ ok: true });
      const current = account(reservation.accountId);
      const refund = Math.max(
        0,
        reservation.points - Math.max(0, Math.floor(input.actualPoints)),
      );
      current.balance += refund;
      delete current.reservations[input.generationId];
      reservation.active = false;
      return Response.json({ ok: true });
    }

    return Response.json({ error: "invalid action" }, { status: 400 });
  }),
}));

import {
  getCreditBalance,
  getFrozenCredits,
  releaseReservation,
  reserveCredits,
  settleReservation,
} from "@/text-generation/credits";

describe("remote text credits", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-credits-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    process.env.TEXT_CREDITS_DEV_BALANCE = "100";
    state.accounts.clear();
    state.reservations.clear();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    delete process.env.TEXT_CREDITS_DEV_BALANCE;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("atomically reserves and settles without local files", async () => {
    expect(await getCreditBalance("user_1")).toBe(100);
    expect(
      await reserveCredits({
        userId: "user_1",
        points: 40,
        generationId: "generation_1",
        projectId: "project_1",
        reason: "text.generate",
      }),
    ).toEqual({ ok: true, balance: 60 });
    expect(await getFrozenCredits("user_1")).toBe(40);

    await settleReservation({
      generationId: "generation_1",
      actualPoints: 25,
      projectId: "project_1",
      reason: "text.generate",
    });

    expect(await getCreditBalance("user_1")).toBe(75);
    expect(await getFrozenCredits("user_1")).toBe(0);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("prevents concurrent reservations from overspending", async () => {
    const outcomes = await Promise.all([
      reserveCredits({
        userId: "user_1",
        points: 70,
        generationId: "generation_1",
        projectId: "project_1",
        reason: "text.generate",
      }),
      reserveCredits({
        userId: "user_1",
        points: 70,
        generationId: "generation_2",
        projectId: "project_1",
        reason: "text.generate",
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, error: "剩余积分不足" },
    ]);
    expect(await getCreditBalance("user_1")).toBe(30);
    expect(await getFrozenCredits("user_1")).toBe(70);
  });

  it("keeps duplicate reserve and settlement idempotent", async () => {
    const input = {
      userId: "user_1",
      points: 30,
      generationId: "generation_1",
      projectId: "project_1",
      reason: "text.generate",
    };
    expect(await reserveCredits(input)).toEqual({ ok: true, balance: 70 });
    expect(await reserveCredits(input)).toEqual({ ok: true, balance: 70 });

    await releaseReservation({
      generationId: "generation_1",
      projectId: "project_1",
      reason: "text.generate",
    });
    await releaseReservation({
      generationId: "generation_1",
      projectId: "project_1",
      reason: "text.generate",
    });

    expect(await getCreditBalance("user_1")).toBe(100);
    expect(await getFrozenCredits("user_1")).toBe(0);
  });

  it("isolates balances by user", async () => {
    await reserveCredits({
      userId: "user_1",
      points: 10,
      generationId: "generation_1",
      projectId: "project_1",
      reason: "text.generate",
    });
    expect(await getCreditBalance("user_1")).toBe(90);
    expect(await getCreditBalance("user_2")).toBe(100);
  });

  it("charges an enterprise account while preserving the acting user", async () => {
    const accountId = "enterprise:enterprise_1";

    expect(
      await reserveCredits({
        userId: "member_1",
        accountId,
        actorUserId: "member_1",
        enterpriseId: "enterprise_1",
        points: 35,
        generationId: "enterprise_generation_1",
        projectId: "enterprise_project_1",
        reason: "text.generate",
      }),
    ).toEqual({ ok: true, balance: 65 });

    expect(await getCreditBalance(accountId)).toBe(65);
    expect(await getCreditBalance("member_1")).toBe(100);
    expect(state.reservations.get("enterprise_generation_1")).toMatchObject({
      accountId,
      actorUserId: "member_1",
      enterpriseId: "enterprise_1",
    });

    await releaseReservation({
      generationId: "enterprise_generation_1",
      projectId: "enterprise_project_1",
      reason: "text.generate",
    });

    expect(await getCreditBalance(accountId)).toBe(100);
  });
});
