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

type LedgerEntry = {
  id: string;
  userId: string;
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
    { userId: string; points: number; createdAt: string }
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
    if (reservation.userId === userId) {
      frozen += Math.max(0, Math.floor(reservation.points));
    }
  }
  return frozen;
}

export async function reserveCredits(input: {
  userId: string;
  points: number;
  generationId: string;
  projectId: string;
  reason: string;
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  if (isRemoteDataOnly()) return reserveCreditsRemote(input);
  const file = await readFile();
  const bal = file.balances[input.userId] ?? defaultBalance();
  file.balances[input.userId] = bal;
  if (bal < input.points) {
    return { ok: false, error: "剩余积分不足" };
  }
  if (file.reservations[input.generationId]) {
    return { ok: true, balance: bal };
  }
  file.balances[input.userId] = bal - input.points;
  file.reservations[input.generationId] = {
    userId: input.userId,
    points: input.points,
    createdAt: new Date().toISOString(),
  };
  file.ledger.push({
    id: randomUUID(),
    userId: input.userId,
    delta: -input.points,
    balanceAfter: file.balances[input.userId]!,
    reason: input.reason,
    generationId: input.generationId,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
  });
  await writeFile(file);
  return { ok: true, balance: file.balances[input.userId]! };
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
  const refund = Math.max(0, res.points - input.actualPoints);
  if (refund > 0) {
    file.balances[res.userId] = (file.balances[res.userId] ?? 0) + refund;
    file.ledger.push({
      id: randomUUID(),
      userId: res.userId,
      delta: refund,
      balanceAfter: file.balances[res.userId]!,
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
