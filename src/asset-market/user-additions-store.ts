import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { MARKET_ADDITIONS_NAMESPACE } from "@/asset-market/constants";
import type {
  MarketUserAddition,
  MarketUserAdditionStore,
} from "@/asset-market/types";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  getRemoteDocument,
  isRemoteDataOnly,
  putRemoteDocument,
} from "@/persistence/remote-data-client";

function emptyStore(userId: string): MarketUserAdditionStore {
  return { version: 1, userId, additions: [] };
}

function localStorePath(userId: string): string {
  return resolveAppDataPath(
    MARKET_ADDITIONS_NAMESPACE,
    "users",
    `${userId}.json`,
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeAddition(
  userId: string,
  raw: unknown,
): MarketUserAddition | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  const marketAssetId =
    typeof rec.marketAssetId === "string" ? rec.marketAssetId.trim() : "";
  const personalAssetId =
    typeof rec.personalAssetId === "string" ? rec.personalAssetId.trim() : "";
  const createdAt =
    typeof rec.createdAt === "string" ? rec.createdAt.trim() : "";
  if (!id || !marketAssetId || !personalAssetId || !createdAt) return null;
  return {
    id,
    userId,
    marketAssetId,
    personalAssetId,
    createdAt,
  };
}

function normalizeStore(userId: string, raw: unknown): MarketUserAdditionStore {
  if (!raw || typeof raw !== "object") return emptyStore(userId);
  const rec = raw as Record<string, unknown>;
  const additions = Array.isArray(rec.additions)
    ? rec.additions
        .map((item) => normalizeAddition(userId, item))
        .filter((item): item is MarketUserAddition => item != null)
    : [];
  return { version: 1, userId, additions };
}

async function readStoreLocal(userId: string): Promise<MarketUserAdditionStore> {
  try {
    const raw = await fs.readFile(localStorePath(userId), "utf-8");
    return normalizeStore(userId, JSON.parse(raw));
  } catch {
    return emptyStore(userId);
  }
}

async function writeStoreLocal(store: MarketUserAdditionStore): Promise<void> {
  const file = localStorePath(store.userId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function readStoreRemote(
  userId: string,
): Promise<{ store: MarketUserAdditionStore; revision: number }> {
  const doc = await getRemoteDocument<MarketUserAdditionStore>(
    MARKET_ADDITIONS_NAMESPACE,
    userId,
  );
  if (!doc) return { store: emptyStore(userId), revision: 0 };
  return {
    store: normalizeStore(userId, doc.value),
    revision: doc.revision,
  };
}

async function writeStoreRemote(
  store: MarketUserAdditionStore,
  expectedRevision: number,
): Promise<void> {
  await putRemoteDocument({
    namespace: MARKET_ADDITIONS_NAMESPACE,
    key: store.userId,
    expectedRevision,
    value: store,
  });
}

async function readStore(userId: string): Promise<MarketUserAdditionStore> {
  if (isRemoteDataOnly()) {
    const remote = await readStoreRemote(userId);
    return remote.store;
  }
  return readStoreLocal(userId);
}

async function writeStore(store: MarketUserAdditionStore): Promise<void> {
  if (isRemoteDataOnly()) {
    const remote = await readStoreRemote(store.userId);
    await writeStoreRemote(store, remote.revision);
    return;
  }
  await writeStoreLocal(store);
}

export async function listMarketUserAdditions(
  userId: string,
): Promise<MarketUserAddition[]> {
  const store = await readStore(userId);
  return store.additions;
}

export async function getMarketUserAdditionIds(
  userId: string,
): Promise<Set<string>> {
  const additions = await listMarketUserAdditions(userId);
  return new Set(additions.map((item) => item.marketAssetId));
}

export async function findMarketUserAddition(input: {
  userId: string;
  marketAssetId: string;
}): Promise<MarketUserAddition | null> {
  const store = await readStore(input.userId);
  return (
    store.additions.find(
      (item) => item.marketAssetId === input.marketAssetId,
    ) ?? null
  );
}

export async function createMarketUserAddition(input: {
  userId: string;
  marketAssetId: string;
  personalAssetId: string;
}): Promise<MarketUserAddition> {
  const store = await readStore(input.userId);
  const existing = store.additions.find(
    (item) => item.marketAssetId === input.marketAssetId,
  );
  if (existing) return existing;

  const addition: MarketUserAddition = {
    id: `madd_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    userId: input.userId,
    marketAssetId: input.marketAssetId,
    personalAssetId: input.personalAssetId,
    createdAt: nowIso(),
  };
  store.additions.unshift(addition);
  await writeStore(store);
  return addition;
}
