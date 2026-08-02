import "server-only";

import { requestRemoteData } from "@/persistence/remote-data-client";

async function creditsRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await requestRemoteData(path, init);
  if (!response.ok) {
    throw new Error(`REMOTE_CREDITS_REQUEST_FAILED:${response.status}`);
  }
  return (await response.json()) as T;
}

async function getCreditsRemote(userId: string) {
  return creditsRequest<{ balance: number; frozen: number }>(
    `/v1/text-credits?userId=${encodeURIComponent(userId)}`,
  );
}

export async function getCreditBalanceRemote(userId: string): Promise<number> {
  return (await getCreditsRemote(userId)).balance;
}

export async function getFrozenCreditsRemote(userId: string): Promise<number> {
  return (await getCreditsRemote(userId)).frozen;
}

export function reserveCreditsRemote(input: {
  userId: string;
  points: number;
  generationId: string;
  projectId: string;
  reason: string;
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  return creditsRequest("/v1/text-credits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "reserve", ...input }),
  });
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