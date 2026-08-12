import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";
import type { LedgerEntry } from "@/text-generation/credits";

async function creditsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const response = await requestRemoteData(path, init);
  const body = (await response.json().catch(() => ({}))) as T;
  if (!response.ok && response.status !== 402) {
    throw new Error(`REMOTE_CREDITS_REQUEST_FAILED:${response.status}`);
  }
  return { status: response.status, body };
}

async function getCreditsRemote(accountId: string) {
  const { body } = await creditsRequest<{ balance: number; frozen: number }>(
    `/v1/text-credits?accountId=${encodeURIComponent(accountId)}`,
  );
  return body;
}

export async function getCreditBalanceRemote(userId: string): Promise<number> {
  return (await getCreditsRemote(userId)).balance;
}

export async function getFrozenCreditsRemote(userId: string): Promise<number> {
  return (await getCreditsRemote(userId)).frozen;
}

export async function reserveCreditsRemote(input: {
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
  const { status, body } = await creditsRequest<{
    ok?: boolean;
    balance?: number;
    error?: string;
    code?: string;
  }>("/v1/text-credits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reserve", ...input }),
  });

  if (status === 402 || body.ok === false) {
    return {
      ok: false,
      error: body.error ?? "剩余积分不足",
      code: "INSUFFICIENT_CREDITS",
    };
  }
  return { ok: true, balance: Number(body.balance ?? 0) };
}

export async function settleReservationRemote(input: {
  generationId: string;
  actualPoints: number;
  projectId: string;
  reason: string;
}): Promise<void> {
  await creditsRequest("/v1/text-credits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "settle", ...input }),
  });
}

export async function listCreditLedgerRemote(accountId: string): Promise<LedgerEntry[]> {
  const { body } = await creditsRequest<{ ledger: LedgerEntry[] }>(
    `/v1/text-credits?accountId=${encodeURIComponent(accountId)}&includeLedger=true`,
  );
  return [...(body.ledger ?? [])].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}
