import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  getCreditBalanceRemote,
  getFrozenCreditsRemote,
  reserveCreditsRemote,
  settleReservationRemote,
} from "@/text-generation/remote-credits";

/**
 * 文件级积分账本（开发阶段）。
 * TODO: 文本模型正式倍率与生产积分体系对接后替换测试定价。
 */

const FILE = () => resolveAppDataPath("credits.json");

export type LedgerEntry = {
  id: string;
  userId: string;
  accountId?: string;
  enterpriseId?: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  generationId?: string;
  projectId?: string;
  meta?: Record<string, string | number | null>;
  createdAt: string;
};

type CreditsFile = {
  version: 1;
  balances: Record<string, number>;
  ledger: LedgerEntry[];
  reservations: Record<
    string,
    {
      accountId?: string;
      actorUserId?: string;
      userId?: string;
      enterpriseId?: string;
      points: number;
      createdAt: string;
    }
  >;
};

async function readFile(): Promise<CreditsFile> {
  try {
    const raw = await fs.readFile(FILE(), "utf-8");
    const parsed = JSON.parse(raw) as CreditsFile;
    return {
      version: 1,
      balances: parsed.balances ?? {},
      ledger: parsed.ledger ?? [],
      reservations: parsed.reservations ?? {},
    };
  } catch {
    return { version: 1, balances: {}, ledger: [], reservations: {} };
  }
}

async function writeFile(data: CreditsFile) {
  const dir = path.dirname(FILE());
  await fs.mkdir(dir, { recursive: true });
  const temp = `${FILE()}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(temp, FILE());
}

function defaultBalance(): number {
  const n = Number(process.env.TEXT_CREDITS_DEV_BALANCE ?? "10000");
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 10000;
}

export async function getCreditBalance(userId: string): Promise<number> {
  if (isRemoteDataOnly()) return getCreditBalanceRemote(userId);
  const file = await readFile();
  if (file.balances[userId] == null) {
    file.balances[userId] = defaultBalance();
    await writeFile(file);
  }
  return file.balances[userId]!;
}

/** 进行中预扣（reservations）合计，不改动扣费逻辑 */
export async function getFrozenCredits(userId: string): Promise<number> {
  if (isRemoteDataOnly()) return getFrozenCreditsRemote(userId);
  const file = await readFile();
  let frozen = 0;
  for (const reservation of Object.values(file.reservations)) {
    if ((reservation.accountId ?? reservation.userId) === userId) {
      frozen += Math.max(0, Math.floor(reservation.points));
    }
  }
  return frozen;
}

/** Read-only ledger view for organization audit screens. */
export async function listCreditLedger(userId: string): Promise<LedgerEntry[]> {
  if (isRemoteDataOnly()) {
    const { listCreditLedgerRemote } = await import("@/text-generation/remote-credits");
    return listCreditLedgerRemote(userId);
  }
  const file = await readFile();
  return file.ledger
    .filter((entry) => (entry.accountId ?? entry.userId) === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function reserveCredits(input: {
  userId: string;
  accountId?: string;
  actorUserId?: string;
  enterpriseId?: string;
  points: number;
  generationId: string;
  projectId: string;
  reason: string;
}): Promise<
  | { ok: true; balance: number }
  | { ok: false; error: string; code: "INSUFFICIENT_CREDITS" }
> {
  if (isRemoteDataOnly()) return reserveCreditsRemote(input);
  const file = await readFile();
  const accountId = input.accountId ?? input.userId;
  const actorUserId = input.actorUserId ?? input.userId;
  const bal = file.balances[accountId] ?? defaultBalance();
  file.balances[accountId] = bal;
  if (bal < input.points) {
    return {
      ok: false,
      error: "剩余积分不足",
      code: "INSUFFICIENT_CREDITS",
    };
  }
  if (file.reservations[input.generationId]) {
    return { ok: true, balance: bal };
  }
  file.balances[accountId] = bal - input.points;
  file.reservations[input.generationId] = {
    accountId,
    actorUserId,
    enterpriseId: input.enterpriseId,
    points: input.points,
    createdAt: new Date().toISOString(),
  };
  file.ledger.push({
    id: randomUUID(),
    userId: actorUserId,
    accountId,
    enterpriseId: input.enterpriseId,
    delta: -input.points,
    balanceAfter: file.balances[accountId]!,
    reason: input.reason,
    generationId: input.generationId,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
  });
  await writeFile(file);
  return { ok: true, balance: file.balances[accountId]! };
}

export async function settleReservation(input: {
  generationId: string;
  actualPoints: number;
  projectId: string;
  reason: string;
}): Promise<void> {
  if (isRemoteDataOnly()) return settleReservationRemote(input);
  const file = await readFile();
  const res = file.reservations[input.generationId];
  if (!res) return;
  const accountId = res.accountId ?? res.userId;
  const actorUserId = res.actorUserId ?? res.userId;
  if (!accountId || !actorUserId) return;
  const refund = Math.max(0, res.points - input.actualPoints);
  if (refund > 0) {
    file.balances[accountId] = (file.balances[accountId] ?? 0) + refund;
    file.ledger.push({
      id: randomUUID(),
      userId: actorUserId,
      accountId,
      enterpriseId: res.enterpriseId,
      delta: refund,
      balanceAfter: file.balances[accountId]!,
      reason: `${input.reason}:release`,
      generationId: input.generationId,
      projectId: input.projectId,
      createdAt: new Date().toISOString(),
    });
  }
  delete file.reservations[input.generationId];
  await writeFile(file);
}

export async function releaseReservation(input: {
  generationId: string;
  projectId: string;
  reason: string;
}): Promise<void> {
  await settleReservation({
    generationId: input.generationId,
    actualPoints: 0,
    projectId: input.projectId,
    reason: input.reason,
  });
}

export function estimatePointsCost(input: {
  inputTokens: number;
  outputTokens: number;
  pointsPer1kInput: number;
  pointsPer1kOutput: number;
}): number {
  const inPts =
    (input.inputTokens / 1000) * input.pointsPer1kInput;
  const outPts =
    (input.outputTokens / 1000) * input.pointsPer1kOutput;
  return Math.max(1, Math.ceil(inPts + outPts));
}
